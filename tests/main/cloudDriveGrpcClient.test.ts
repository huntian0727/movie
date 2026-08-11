// @vitest-environment node

import http2, { type Http2Server, type ServerHttp2Stream } from "node:http2";
import { afterEach, describe, expect, it } from "vitest";
import { CloudDriveGrpcClient, takeGrpcFrames } from "../../src/main/clouddrive/grpcClient";
import { encodeStringField, encodeTag, encodeVarint } from "../../src/main/clouddrive/protobuf";

const servers: Http2Server[] = [];
const clients: CloudDriveGrpcClient[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) client.close();
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe("CloudDrive gRPC client", () => {
  it("keeps fragmented and multiple frames intact", () => {
    const first = grpcFrame(Buffer.from("first"));
    const second = grpcFrame(Buffer.from("second"));
    const partial = takeGrpcFrames(Buffer.concat([first, second.subarray(0, 3)]));
    expect(partial.payloads.map((payload) => payload.toString())).toEqual(["first"]);
    const complete = takeGrpcFrames(Buffer.concat([partial.remainder, second.subarray(3)]));
    expect(complete.payloads.map((payload) => payload.toString())).toEqual(["second"]);
    expect(complete.remainder).toHaveLength(0);
  });

  it("decodes a fragmented server stream and validates trailers", async () => {
    const response = messageField(1, Buffer.concat([
      encodeStringField(1, "id-1"),
      encodeStringField(2, "电影.mp4"),
      encodeStringField(3, "/115/电影.mp4"),
      uintField(4, 123),
      uintField(5, 1)
    ]));
    const endpoint = await startServer((stream) => {
      respond(stream);
      const frame = grpcFrame(response);
      stream.write(frame.subarray(0, 2));
      stream.write(frame.subarray(2, 8));
      stream.end(frame.subarray(8));
    });
    const client = createClient(endpoint);

    const entries = [];
    for await (const entry of client.getSubFiles("/115")) entries.push(entry);

    expect(entries).toEqual([expect.objectContaining({ name: "电影.mp4", sizeBytes: 123, fileType: 1 })]);
  });

  it("decodes GetMountPoints using the current proto field numbers", async () => {
    const mountPoint = Buffer.concat([
      encodeStringField(1, "X:"),
      encodeStringField(2, "/115"),
      uintField(4, 1),
      uintField(9, 1),
      encodeStringField(11, "CloudDrive")
    ]);
    const endpoint = await startServer((stream) => {
      respond(stream);
      stream.end(grpcFrame(messageField(1, mountPoint)));
    });
    const client = createClient(endpoint);
    await expect(client.getMountPoints()).resolves.toEqual([
      expect.objectContaining({ mountPoint: "X:", sourceDir: "/115", readOnly: true, isMounted: true, name: "CloudDrive" })
    ]);
  });

  it("rejects non-zero gRPC status without exposing authorization data", async () => {
    const endpoint = await startServer((stream) => {
      stream.respond({ ":status": 200, "content-type": "application/grpc", "grpc-status": "7", "grpc-message": "permission%20denied" });
      stream.end();
    });
    const client = createClient(endpoint);
    await expect(readAll(client)).rejects.toThrow("gRPC 7): permission denied");
  });

  it("rejects a response that omits grpc-status", async () => {
    const endpoint = await startServer((stream) => {
      stream.respond({ ":status": 200, "content-type": "application/grpc" });
      stream.end();
    });
    const client = createClient(endpoint);
    await expect(readAll(client)).rejects.toThrow("omitted grpc-status");
  });

  it("times out an unresponsive stream", async () => {
    const endpoint = await startServer(() => undefined);
    const client = createClient(endpoint, 30);
    await expect(readAll(client)).rejects.toThrow("timed out");
  });

  it("cancels an active stream cooperatively", async () => {
    const endpoint = await startServer(() => undefined);
    const client = createClient(endpoint, 5_000);
    let cancelled = false;
    setTimeout(() => { cancelled = true; }, 20);
    const operation = (async () => {
      for await (const _entry of client.getSubFiles("/115", false, () => cancelled)) {
        // The server intentionally never yields a message.
      }
    })();
    await expect(operation).rejects.toMatchObject({ code: "ABORT_ERR" });
  });
});

function createClient(endpoint: string, timeoutMs = 1_000): CloudDriveGrpcClient {
  const client = new CloudDriveGrpcClient({ endpoint, apiToken: "test-token-never-logged", timeoutMs });
  clients.push(client);
  return client;
}

async function readAll(client: CloudDriveGrpcClient): Promise<void> {
  for await (const _entry of client.getSubFiles("/115")) {
    // Drain the stream.
  }
}

async function startServer(handler: (stream: ServerHttp2Stream) => void): Promise<string> {
  const server = http2.createServer();
  servers.push(server);
  server.on("stream", (stream) => handler(stream));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("HTTP/2 test server did not bind a TCP port");
  return `http://127.0.0.1:${address.port}`;
}

function respond(stream: ServerHttp2Stream): void {
  stream.respond({ ":status": 200, "content-type": "application/grpc", trailer: "grpc-status" }, { waitForTrailers: true });
  stream.on("wantTrailers", () => stream.sendTrailers({ "grpc-status": "0" }));
}

function grpcFrame(payload: Buffer): Buffer {
  const frame = Buffer.alloc(5 + payload.length);
  frame.writeUInt32BE(payload.length, 1);
  payload.copy(frame, 5);
  return frame;
}

function uintField(fieldNumber: number, value: number): Buffer {
  return Buffer.concat([encodeTag(fieldNumber, 0), encodeVarint(value)]);
}

function messageField(fieldNumber: number, payload: Buffer): Buffer {
  return Buffer.concat([encodeTag(fieldNumber, 2), encodeVarint(payload.length), payload]);
}
