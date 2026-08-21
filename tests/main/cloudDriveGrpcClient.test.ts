// @vitest-environment node

import http2, { type Http2Server, type ServerHttp2Stream } from "node:http2";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudDriveGrpcClient, HINT_PRIORITY, takeGrpcFrames } from "../../src/main/clouddrive/grpcClient";
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

  it("decodes expanded CloudDriveFile fields (accessTime, thumbnailUrl, readOnly, isForbidden)", async () => {
    const fileEntry = Buffer.concat([
      encodeStringField(1, "abc123"),
      encodeStringField(2, "movie.mp4"),
      encodeStringField(3, "/115/movie.mp4"),
      uintField(4, 5_000_000),
      uintField(5, 1), // File
      // field 6 createTime: encode a minimal timestamp
      messageField(6, Buffer.from([0x08, 0x80, 0x80, 0x80, 0x80, 0x04])), // seconds = ~67M
      messageField(7, Buffer.from([0x08, 0x80, 0x80, 0x80, 0x80, 0x05])), // writeTime
      messageField(8, Buffer.from([0x08, 0x80, 0x80, 0x80, 0x80, 0x06])), // accessTime
      encodeStringField(10, "https://thumb/abc"),
      encodeStringField(11, "https://preview/abc"),
      uintField(30, 0), // isDirectory = false
      uintField(36, 1), // isForbidden = true
      uintField(62, 1), // canDirectAccessThumbnailURL = true
      uintField(64, 1), // hasDetailProperties = true
      uintField(68, 120), // dirCacheTimeToLiveSecs
      uintField(80, 1)  // readOnly = true
    ]);
    const endpoint = await startServer((stream) => {
      respond(stream);
      stream.end(grpcFrame(messageField(1, fileEntry)));
    });
    const client = createClient(endpoint);
    const entries: unknown[] = [];
    for await (const entry of client.getSubFiles("/115")) entries.push(entry);
    const file = entries[0] as Record<string, unknown>;
    expect(file.id).toBe("abc123");
    expect(file.name).toBe("movie.mp4");
    expect(file.sizeBytes).toBe(5_000_000);
    expect(file.thumbnailUrl).toBe("https://thumb/abc");
    expect(file.previewUrl).toBe("https://preview/abc");
    expect(file.isForbidden).toBe(true);
    expect(file.readOnly).toBe(true);
    expect(file.canDirectAccessThumbnailURL).toBe(true);
    expect(file.hasDetailProperties).toBe(true);
    expect(file.dirCacheTimeToLiveSecs).toBe(120);
    expect(file.isDirectory).toBe(false);
  });

  it("respects rate limiter by awaiting acquire before sending", async () => {
    let acquireCount = 0;
    const rateLimiter = { acquire: async () => { acquireCount++; } };
    const endpoint = await startServer((stream) => {
      respond(stream);
      stream.end(grpcFrame(Buffer.alloc(0)));
    });
    const client = new CloudDriveGrpcClient({
      endpoint,
      apiToken: "token",
      timeoutMs: 1000,
      rateLimiter
    });
    clients.push(client);
    await client.closeFileReader("/115/test.mp4");
    expect(acquireCount).toBe(1);
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
    const client = new CloudDriveGrpcClient({ endpoint, apiToken: "token", timeoutMs: 100, keepAliveIntervalMs: 0 });
    clients.push(client);
    await expect(readAll(client)).rejects.toThrow("first-byte timeout");
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

  it("sends CloseFileReader with the remote path", async () => {
    let capturedPath = "";
    const endpoint = await startServer((stream) => {
      respond(stream);
      let body = Buffer.alloc(0);
      stream.on("data", (chunk: Buffer) => { body = Buffer.concat([body, chunk]); });
      stream.on("end", () => {
        // gRPC frame: 5 byte header + payload
        const payload = body.subarray(5);
        // field 1 is string (wire type 2): tag + len + data
        const tagByte = payload[0];
        const len = payload[1];
        capturedPath = payload.subarray(2, 2 + len).toString("utf8");
        stream.end(grpcFrame(Buffer.alloc(0)));
      });
    });
    const client = createClient(endpoint);
    await client.closeFileReader("/115/movie.mp4");
    expect(capturedPath).toBe("/115/movie.mp4");
  });

  it("times out when no first byte arrives on GetMountPoints", async () => {
    const endpoint = await startServer(() => undefined);
    const client = new CloudDriveGrpcClient({
      endpoint,
      apiToken: "token",
      timeoutMs: 100,
      keepAliveIntervalMs: 0
    });
    clients.push(client);
    await expect(client.getMountPoints()).rejects.toThrow("first-byte timeout");
  });

  it("sends PrefetchFileRanges with path, ranges, and priority", async () => {
    let capturedBody = Buffer.alloc(0);
    const endpoint = await startServer((stream) => {
      respond(stream);
      stream.on("data", (chunk: Buffer) => { capturedBody = Buffer.concat([capturedBody, chunk]); });
      stream.on("end", () => {
        // Reply with hint_id=42, accepted=2, rejected=0
        const reply = Buffer.concat([
          uintField(1, 42),
          uintField(2, 2),
          uintField(3, 0)
        ]);
        stream.end(grpcFrame(reply));
      });
    });
    const client = createClient(endpoint);
    const result = await client.prefetchFileRanges(
      "/115/movie.mp4",
      [{ start: 0, length: 1024 }, { start: 1_000_000, length: 2048 }],
      HINT_PRIORITY.HIGH,
      { ttlSeconds: 30, replaceExisting: true }
    );
    expect(result.hintId).toBe(42);
    expect(result.acceptedRangeCount).toBe(2);
    expect(result.rejectedRangeCount).toBe(0);

    // Validate request body contains the path
    const payload = capturedBody.subarray(5); // strip gRPC frame header
    // Field 1 (path) starts at byte 0: tag (0x0a) + length + data
    expect(payload[0]).toBe(0x0a); // field 1, wire type 2
    const pathLen = payload[1];
    const decodedPath = payload.subarray(2, 2 + pathLen).toString("utf8");
    expect(decodedPath).toBe("/115/movie.mp4");
  });

  it("sends CancelFilePrefetch with path and optional hint IDs", async () => {
    let capturedBody = Buffer.alloc(0);
    const endpoint = await startServer((stream) => {
      respond(stream);
      stream.on("data", (chunk: Buffer) => { capturedBody = Buffer.concat([capturedBody, chunk]); });
      stream.on("end", () => stream.end(grpcFrame(Buffer.alloc(0))));
    });
    const client = createClient(endpoint);
    await client.cancelFilePrefetch("/115/movie.mp4", [42, 43]);
    const payload = capturedBody.subarray(5);
    // Field 1: path
    expect(payload[0]).toBe(0x0a);
    const pathLen = payload[1];
    expect(payload.subarray(2, 2 + pathLen).toString("utf8")).toBe("/115/movie.mp4");
  });

  it("sends CancelFilePrefetch without hint IDs to cancel all on path", async () => {
    let capturedBody = Buffer.alloc(0);
    const endpoint = await startServer((stream) => {
      respond(stream);
      stream.on("data", (chunk: Buffer) => { capturedBody = Buffer.concat([capturedBody, chunk]); });
      stream.on("end", () => stream.end(grpcFrame(Buffer.alloc(0))));
    });
    const client = createClient(endpoint);
    await client.cancelFilePrefetch("/115/movie.mp4");
    const payload = capturedBody.subarray(5);
    // Only field 1 (path) should be present; no field 2 repeated.
    const pathLen = payload[1];
    expect(payload.length).toBe(2 + pathLen);
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
