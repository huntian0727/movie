import http2, { type ClientHttp2Session, type IncomingHttpHeaders } from "node:http2";
import { ProtoReader, decodeTimestamp, encodeBoolField, encodeStringField } from "./protobuf.js";

const SERVICE_NAME = "clouddrive.CloudDriveFileSrv";
const DEFAULT_RPC_TIMEOUT_MS = 20_000;
const MAX_GRPC_MESSAGE_BYTES = 64 * 1024 * 1024;

export interface CloudDriveGrpcClientOptions {
  endpoint: string;
  apiToken: string;
  timeoutMs?: number;
}

export interface CloudDriveMountPoint {
  mountPoint: string;
  sourceDir: string;
  readOnly: boolean;
  isMounted: boolean;
  failReason: string;
  name: string;
}

export interface CloudDriveFileEntry {
  id: string;
  name: string;
  fullPathName: string;
  sizeBytes: number;
  fileType: number;
  isDirectory: boolean;
  writeTime: string | null;
  createTime: string | null;
}

export class CloudDriveGrpcClient {
  private readonly origin: string;
  private readonly apiToken: string;
  private readonly timeoutMs: number;
  private session: ClientHttp2Session | null = null;

  constructor(options: CloudDriveGrpcClientOptions) {
    const endpoint = new URL(options.endpoint);
    if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") {
      throw new Error(`CloudDrive endpoint must be http(s), got ${endpoint.protocol}`);
    }
    this.origin = endpoint.origin;
    this.apiToken = options.apiToken.trim();
    this.timeoutMs = options.timeoutMs ?? DEFAULT_RPC_TIMEOUT_MS;
    if (!this.apiToken) throw new Error("CloudDrive API token is empty");
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) throw new Error("CloudDrive RPC timeout must be positive");
  }

  async getMountPoints(isCancelled?: () => boolean): Promise<CloudDriveMountPoint[]> {
    const payloads: Buffer[] = [];
    for await (const payload of this.serverStream("GetMountPoints", Buffer.alloc(0), isCancelled)) payloads.push(payload);
    if (payloads.length !== 1) {
      throw new Error(`CloudDrive GetMountPoints returned ${payloads.length} gRPC messages; expected 1`);
    }
    const reader = new ProtoReader(payloads[0]);
    const mountPoints: CloudDriveMountPoint[] = [];
    while (!reader.done) {
      const { fieldNumber, wireType } = reader.readTag();
      if (fieldNumber === 1 && wireType === 2) mountPoints.push(decodeMountPoint(reader.readBytes()));
      else reader.skip(wireType);
    }
    return mountPoints;
  }

  async *getSubFiles(
    remotePath: string,
    forceRefresh = false,
    isCancelled?: () => boolean
  ): AsyncGenerator<CloudDriveFileEntry> {
    const request = Buffer.concat([
      encodeStringField(1, remotePath),
      ...(forceRefresh ? [encodeBoolField(2, true)] : [])
    ]);
    for await (const payload of this.serverStream("GetSubFiles", request, isCancelled)) {
      const reply = new ProtoReader(payload);
      while (!reply.done) {
        const { fieldNumber, wireType } = reply.readTag();
        if (fieldNumber === 1 && wireType === 2) yield decodeCloudDriveFile(reply.readBytes());
        else reply.skip(wireType);
      }
    }
  }

  close(): void {
    const session = this.session;
    this.session = null;
    if (session && !session.closed && !session.destroyed) session.close();
  }

  private async *serverStream(
    method: string,
    requestPayload: Buffer,
    isCancelled?: () => boolean
  ): AsyncGenerator<Buffer> {
    if (isCancelled?.()) throw cancelledError(method);
    const session = this.getSession();
    const request = session.request({
      ":method": "POST",
      ":path": `/${SERVICE_NAME}/${method}`,
      "content-type": "application/grpc",
      te: "trailers",
      authorization: `Bearer ${this.apiToken}`,
      "grpc-encoding": "identity",
      "grpc-accept-encoding": "identity",
      "user-agent": "local-video-manager-clouddrive/1"
    });

    let responseHeaders: IncomingHttpHeaders | null = null;
    let trailers: IncomingHttpHeaders | null = null;
    let timedOut = false;
    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const armIdleTimeout = () => {
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(() => {
        timedOut = true;
        request.close(http2.constants.NGHTTP2_CANCEL);
      }, this.timeoutMs);
    };
    armIdleTimeout();
    const cancellationPoll = isCancelled ? setInterval(() => {
      if (!isCancelled()) return;
      cancelled = true;
      request.close(http2.constants.NGHTTP2_CANCEL);
    }, 50) : undefined;

    request.on("response", (headers) => { responseHeaders = headers; armIdleTimeout(); });
    request.on("trailers", (headers) => { trailers = headers; armIdleTimeout(); });
    request.end(encodeGrpcFrame(requestPayload));

    let buffered: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    try {
      for await (const chunk of request) {
        armIdleTimeout();
        if (isCancelled?.()) {
          cancelled = true;
          request.close(http2.constants.NGHTTP2_CANCEL);
          throw cancelledError(method);
        }
        buffered = buffered.length === 0 ? Buffer.from(chunk) : Buffer.concat([buffered, Buffer.from(chunk)]);
        const decoded = takeGrpcFrames(buffered);
        buffered = decoded.remainder;
        for (const payload of decoded.payloads) yield payload;
      }
    } catch (error) {
      if (cancelled || isCancelled?.()) throw cancelledError(method);
      if (timedOut) throw new Error(`CloudDrive ${method} timed out after ${this.timeoutMs / 1000}s`);
      this.invalidateSession(session);
      throw error;
    } finally {
      if (timeout) clearTimeout(timeout);
      if (cancellationPoll) clearInterval(cancellationPoll);
    }

    if (cancelled || isCancelled?.()) throw cancelledError(method);
    if (timedOut) throw new Error(`CloudDrive ${method} timed out after ${this.timeoutMs / 1000}s`);
    if (buffered.length !== 0) throw new Error(`CloudDrive ${method} ended with a partial gRPC frame`);
    const httpStatus = responseHeaders?.[":status"];
    if (httpStatus !== 200) throw new Error(`CloudDrive ${method} returned HTTP ${String(httpStatus ?? "unknown")}`);
    const grpcStatus = headerValue(trailers, "grpc-status") ?? headerValue(responseHeaders, "grpc-status");
    if (grpcStatus === null) throw new Error(`CloudDrive ${method} response omitted grpc-status`);
    if (grpcStatus !== "0") {
      const message = decodeGrpcMessage(
        headerValue(trailers, "grpc-message") ?? headerValue(responseHeaders, "grpc-message") ?? "Unknown gRPC error"
      );
      throw grpcStatusError(method, grpcStatus, message);
    }
  }

  private getSession(): ClientHttp2Session {
    if (this.session && !this.session.closed && !this.session.destroyed) return this.session;
    const session = http2.connect(this.origin);
    session.on("error", () => this.invalidateSession(session));
    session.on("close", () => this.invalidateSession(session));
    this.session = session;
    return session;
  }

  private invalidateSession(session: ClientHttp2Session): void {
    if (this.session === session) this.session = null;
    if (!session.destroyed) session.destroy();
  }
}

function decodeMountPoint(payload: Buffer): CloudDriveMountPoint {
  const reader = new ProtoReader(payload);
  const result: CloudDriveMountPoint = { mountPoint: "", sourceDir: "", readOnly: false, isMounted: false, failReason: "", name: "" };
  while (!reader.done) {
    const { fieldNumber, wireType } = reader.readTag();
    if (wireType === 2 && fieldNumber === 1) result.mountPoint = reader.readString();
    else if (wireType === 2 && fieldNumber === 2) result.sourceDir = reader.readString();
    else if (wireType === 0 && fieldNumber === 4) result.readOnly = reader.readBool();
    else if (wireType === 0 && fieldNumber === 9) result.isMounted = reader.readBool();
    else if (wireType === 2 && fieldNumber === 10) result.failReason = reader.readString();
    else if (wireType === 2 && fieldNumber === 11) result.name = reader.readString();
    else reader.skip(wireType);
  }
  return result;
}

function decodeCloudDriveFile(payload: Buffer): CloudDriveFileEntry {
  const reader = new ProtoReader(payload);
  const result: CloudDriveFileEntry = {
    id: "", name: "", fullPathName: "", sizeBytes: 0, fileType: 2,
    isDirectory: false, writeTime: null, createTime: null
  };
  while (!reader.done) {
    const { fieldNumber, wireType } = reader.readTag();
    if (wireType === 2 && fieldNumber === 1) result.id = reader.readString();
    else if (wireType === 2 && fieldNumber === 2) result.name = reader.readString();
    else if (wireType === 2 && fieldNumber === 3) result.fullPathName = reader.readString();
    else if (wireType === 0 && fieldNumber === 4) result.sizeBytes = reader.readSafeNumber("CloudDrive file size");
    else if (wireType === 0 && fieldNumber === 5) result.fileType = reader.readSafeNumber("CloudDrive file type");
    else if (wireType === 2 && fieldNumber === 6) result.createTime = decodeTimestamp(reader.readBytes());
    else if (wireType === 2 && fieldNumber === 7) result.writeTime = decodeTimestamp(reader.readBytes());
    else if (wireType === 0 && fieldNumber === 30) result.isDirectory = reader.readBool();
    else reader.skip(wireType);
  }
  result.isDirectory ||= result.fileType === 0;
  return result;
}

function encodeGrpcFrame(payload: Buffer): Buffer {
  const frame = Buffer.allocUnsafe(5 + payload.length);
  frame[0] = 0;
  frame.writeUInt32BE(payload.length, 1);
  payload.copy(frame, 5);
  return frame;
}

export function takeGrpcFrames(buffer: Buffer): { payloads: Buffer[]; remainder: Buffer } {
  const payloads: Buffer[] = [];
  let offset = 0;
  while (buffer.length - offset >= 5) {
    if (buffer[offset] !== 0) throw new Error("Compressed gRPC responses are not supported");
    const length = buffer.readUInt32BE(offset + 1);
    if (length > MAX_GRPC_MESSAGE_BYTES) throw new Error(`gRPC message exceeds ${MAX_GRPC_MESSAGE_BYTES} bytes`);
    if (buffer.length - offset - 5 < length) break;
    payloads.push(buffer.subarray(offset + 5, offset + 5 + length));
    offset += 5 + length;
  }
  return { payloads, remainder: buffer.subarray(offset) };
}

function headerValue(headers: IncomingHttpHeaders | null, name: string): string | null {
  if (!headers) return null;
  const value = headers[name];
  if (Array.isArray(value)) return value[0] ?? null;
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return null;
}

function decodeGrpcMessage(message: string): string {
  try {
    return decodeURIComponent(message.replace(/\+/g, "%20"));
  } catch {
    return message;
  }
}

function cancelledError(method: string): Error & { code: string } {
  const error = new Error(`CloudDrive ${method} cancelled`) as Error & { code: string };
  error.code = "ABORT_ERR";
  return error;
}

function grpcStatusError(method: string, status: string, message: string): Error & { code: string } {
  const error = new Error(`CloudDrive ${method} failed (gRPC ${status}): ${message}`) as Error & { code: string };
  error.code = status === "5" ? "ENOENT" : `GRPC_${status}`;
  return error;
}
