import http2, { type ClientHttp2Session, type IncomingHttpHeaders } from "node:http2";
import {
  ProtoReader,
  decodeTimestamp,
  encodeBoolField,
  encodeMessageField,
  encodeStringField,
  encodeUInt32Field,
  encodeUInt64Field
} from "./protobuf.js";

const SERVICE_NAME = "clouddrive.CloudDriveFileSrv";
const DEFAULT_RPC_TIMEOUT_MS = 20_000;
const DEFAULT_FIRST_BYTE_TIMEOUT_MS = 10_000;
const KEEPALIVE_INTERVAL_MS = 30_000;
const KEEPALIVE_TIMEOUT_MS = 10_000;
const MAX_GRPC_MESSAGE_BYTES = 64 * 1024 * 1024;

export interface RpcTimeouts {
  /** Time allowed between sending the request and receiving the first response byte. */
  firstByteMs: number;
  /** Idle timeout between consecutive data frames after the first byte. */
  idleMs: number;
}

export interface CloudDriveGrpcClientOptions {
  endpoint: string;
  apiToken: string;
  /** Idle timeout used when an RPC does not specify its own timeouts. */
  timeoutMs?: number;
  /** Default first-byte timeout applied to streaming RPCs that do not override it. */
  firstByteTimeoutMs?: number;
  /** Override keepalive interval in ms. Pass 0 to disable. Default 30s. */
  keepAliveIntervalMs?: number;
  /** Override keepalive timeout in ms. Default 10s. */
  keepAliveTimeoutMs?: number;
  /**
   * Optional token-bucket rate limiter. When provided, every gRPC call
   * awaits acquire() before sending, to stay within cloud QPS limits.
   */
  rateLimiter?: { acquire(): Promise<void> };
}

export const RPC_TIMEOUTS = {
  getMountPoints: { firstByteMs: 5_000, idleMs: 10_000 },
  getSubFiles: { firstByteMs: 10_000, idleMs: 20_000 },
  closeFileReader: { firstByteMs: 5_000, idleMs: 5_000 },
  prefetchFileRanges: { firstByteMs: 5_000, idleMs: 5_000 },
  cancelFilePrefetch: { firstByteMs: 5_000, idleMs: 5_000 }
} as const satisfies Record<string, RpcTimeouts>;

export const HINT_PRIORITY = {
  LOW: 0,
  NORMAL: 1,
  HIGH: 2
} as const;

export type HintPriority = typeof HINT_PRIORITY[keyof typeof HINT_PRIORITY];

export interface ByteRange {
  start: number;
  length: number;
}

export interface PrefetchHint {
  hintId: number;
  acceptedRangeCount: number;
  rejectedRangeCount: number;
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
  accessTime: string | null;
  thumbnailUrl: string;
  previewUrl: string;
  isForbidden: boolean;
  readOnly: boolean;
  canDirectAccessThumbnailURL: boolean;
  hasDetailProperties: boolean;
  dirCacheTimeToLiveSecs: number;
}

export class CloudDriveGrpcClient {
  private readonly origin: string;
  private readonly apiToken: string;
  private readonly timeoutMs: number;
  private readonly firstByteTimeoutMs: number;
  private readonly keepAliveIntervalMs: number;
  private readonly keepAliveTimeoutMs: number;
  private readonly rateLimiter?: { acquire(): Promise<void> };
  private session: ClientHttp2Session | null = null;
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  private pingInFlight = false;

  constructor(options: CloudDriveGrpcClientOptions) {
    const endpoint = new URL(options.endpoint);
    if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") {
      throw new Error(`CloudDrive endpoint must be http(s), got ${endpoint.protocol}`);
    }
    this.origin = endpoint.origin;
    this.apiToken = options.apiToken.trim();
    this.timeoutMs = options.timeoutMs ?? DEFAULT_RPC_TIMEOUT_MS;
    this.firstByteTimeoutMs = options.firstByteTimeoutMs ?? DEFAULT_FIRST_BYTE_TIMEOUT_MS;
    this.keepAliveIntervalMs = options.keepAliveIntervalMs ?? KEEPALIVE_INTERVAL_MS;
    this.keepAliveTimeoutMs = options.keepAliveTimeoutMs ?? KEEPALIVE_TIMEOUT_MS;
    this.rateLimiter = options.rateLimiter;
    if (!this.apiToken) throw new Error("CloudDrive API token is empty");
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) throw new Error("CloudDrive RPC timeout must be positive");
    if (!Number.isFinite(this.firstByteTimeoutMs) || this.firstByteTimeoutMs <= 0) {
      throw new Error("CloudDrive first-byte timeout must be positive");
    }
  }

  async getMountPoints(isCancelled?: () => boolean): Promise<CloudDriveMountPoint[]> {
    const payloads: Buffer[] = [];
    for await (const payload of this.serverStream("GetMountPoints", Buffer.alloc(0), isCancelled, this.effectiveTimeouts(RPC_TIMEOUTS.getMountPoints))) {
      payloads.push(payload);
    }
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
    for await (const payload of this.serverStream("GetSubFiles", request, isCancelled, this.effectiveTimeouts(RPC_TIMEOUTS.getSubFiles))) {
      const reply = new ProtoReader(payload);
      while (!reply.done) {
        const { fieldNumber, wireType } = reply.readTag();
        if (fieldNumber === 1 && wireType === 2) yield decodeCloudDriveFile(reply.readBytes());
        else reply.skip(wireType);
      }
    }
  }

  /**
   * Best-effort hint that the client will not read this file again soon.
   * CloudDrive2 releases the server-side EntryReader immediately instead of
   * keeping it open for the default 2 second window. Call after one-shot reads
   * (ffprobe, thumbnail generation) so they do not hold download threads on
   * the cloud drive. Errors are propagated; callers should swallow and log.
   */
  async closeFileReader(remotePath: string, isCancelled?: () => boolean): Promise<void> {
    const request = encodeStringField(1, remotePath);
    // Response is google.protobuf.Empty — drain and discard exactly zero/one frame.
    for await (const _payload of this.serverStream("CloseFileReader", request, isCancelled, this.effectiveTimeouts(RPC_TIMEOUTS.closeFileReader))) {
      // intentionally empty
    }
  }

  /**
   * Hint to CloudDrive2 that the client will read the given byte ranges soon.
   * Returns the server-assigned hint_id for later cancellation.
   *
   * This is advisory: if the server rejects ranges (already cached or out of
   * bounds), the reply still returns successfully. Errors are propagated so
   * the caller can decide whether to log; typically callers should swallow.
   */
  async prefetchFileRanges(
    remotePath: string,
    ranges: ByteRange[],
    priority: HintPriority = HINT_PRIORITY.NORMAL,
    options?: { ttlSeconds?: number; replaceExisting?: boolean; hintId?: number },
    isCancelled?: () => boolean
  ): Promise<PrefetchHint> {
    const rangeFields = ranges.map((range) => {
      const inner = Buffer.concat([
        encodeUInt64Field(1, range.start),
        encodeUInt64Field(2, range.length)
      ]);
      return encodeMessageField(2, inner);
    });
    const parts: Buffer[] = [
      encodeStringField(1, remotePath),
      ...rangeFields,
      encodeUInt32Field(3, priority)
    ];
    if (options?.hintId) parts.push(encodeUInt64Field(4, options.hintId));
    if (options?.ttlSeconds) parts.push(encodeUInt32Field(5, options.ttlSeconds));
    if (options?.replaceExisting) parts.push(encodeBoolField(6, true));
    const request = Buffer.concat(parts);

    const payloads: Buffer[] = [];
    for await (const payload of this.serverStream("PrefetchFileRanges", request, isCancelled, this.effectiveTimeouts(RPC_TIMEOUTS.prefetchFileRanges))) {
      payloads.push(payload);
    }
    if (payloads.length !== 1) {
      throw new Error(`CloudDrive PrefetchFileRanges returned ${payloads.length} gRPC messages; expected 1`);
    }
    const reader = new ProtoReader(payloads[0]);
    let hintId = 0;
    let acceptedRangeCount = 0;
    let rejectedRangeCount = 0;
    while (!reader.done) {
      const { fieldNumber, wireType } = reader.readTag();
      if (fieldNumber === 1 && wireType === 0) hintId = reader.readSafeNumber("prefetch hint_id");
      else if (fieldNumber === 2 && wireType === 0) acceptedRangeCount = reader.readSafeNumber("prefetch accepted count");
      else if (fieldNumber === 3 && wireType === 0) rejectedRangeCount = reader.readSafeNumber("prefetch rejected count");
      else reader.skip(wireType);
    }
    return { hintId, acceptedRangeCount, rejectedRangeCount };
  }

  /**
   * Cancel previously registered prefetch hints on a path.
   * If hintIds is empty/omitted, cancels ALL hints on that path.
   */
  async cancelFilePrefetch(remotePath: string, hintIds?: number[], isCancelled?: () => boolean): Promise<void> {
    const parts: Buffer[] = [encodeStringField(1, remotePath)];
    if (hintIds && hintIds.length > 0) {
      for (const id of hintIds) {
        parts.push(encodeUInt64Field(2, id));
      }
    }
    const request = Buffer.concat(parts);
    for await (const _payload of this.serverStream("CancelFilePrefetch", request, isCancelled, this.effectiveTimeouts(RPC_TIMEOUTS.cancelFilePrefetch))) {
      // intentionally empty (google.protobuf.Empty)
    }
  }

  close(): void {
    this.stopKeepAlive();
    const session = this.session;
    this.session = null;
    if (session && !session.closed && !session.destroyed) session.close();
  }

  private effectiveTimeouts(perRpc: RpcTimeouts): RpcTimeouts {
    return {
      firstByteMs: Math.min(perRpc.firstByteMs, this.timeoutMs),
      idleMs: Math.min(perRpc.idleMs, this.timeoutMs)
    };
  }

  private async *serverStream(
    method: string,
    requestPayload: Buffer,
    isCancelled: (() => boolean) | undefined,
    timeouts: RpcTimeouts
  ): AsyncGenerator<Buffer> {
    if (isCancelled?.()) throw cancelledError(method);
    if (this.rateLimiter) {
      await this.rateLimiter.acquire();
      if (isCancelled?.()) throw cancelledError(method);
    }
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
    let firstByteTimedOut = false;
    let idleTimedOut = false;
    let cancelled = false;
    let firstByteReceived = false;
    let firstByteTimer: ReturnType<typeof setTimeout> | undefined;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    let cancellationPoll: ReturnType<typeof setInterval> | undefined;

    const armFirstByteTimeout = () => {
      if (firstByteTimer) clearTimeout(firstByteTimer);
      firstByteTimer = setTimeout(() => {
        firstByteTimedOut = true;
        request.destroy(new Error(`first-byte timeout after ${timeouts.firstByteMs}ms`));
      }, timeouts.firstByteMs);
    };
    const armIdleTimeout = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        idleTimedOut = true;
        request.destroy(new Error(`idle timeout after ${timeouts.idleMs}ms`));
      }, timeouts.idleMs);
    };
    const markFirstByte = () => {
      if (firstByteReceived) return;
      firstByteReceived = true;
      if (firstByteTimer) clearTimeout(firstByteTimer);
      armIdleTimeout();
    };
    const clearTimers = () => {
      if (firstByteTimer) clearTimeout(firstByteTimer);
      if (idleTimer) clearTimeout(idleTimer);
      if (cancellationPoll) clearInterval(cancellationPoll);
    };

    armFirstByteTimeout();
    if (isCancelled) {
      cancellationPoll = setInterval(() => {
        if (!isCancelled()) return;
        cancelled = true;
        request.destroy();
      }, 50);
    }

    request.on("response", (headers) => { responseHeaders = headers; markFirstByte(); });
    request.on("trailers", (headers) => { trailers = headers; armIdleTimeout(); });
    request.end(encodeGrpcFrame(requestPayload));

    let buffered: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    try {
      for await (const chunk of request) {
        markFirstByte();
        if (isCancelled?.()) {
          cancelled = true;
          request.destroy();
          throw cancelledError(method);
        }
        buffered = buffered.length === 0 ? Buffer.from(chunk) : Buffer.concat([buffered, Buffer.from(chunk)]);
        const decoded = takeGrpcFrames(buffered);
        buffered = decoded.remainder;
        for (const payload of decoded.payloads) yield payload;
      }
    } catch (error) {
      if (cancelled || isCancelled?.()) throw cancelledError(method);
      if (firstByteTimedOut) {
        this.invalidateSession(session);
        throw new Error(`CloudDrive ${method} first-byte timeout after ${timeouts.firstByteMs / 1000}s`);
      }
      if (idleTimedOut) {
        this.invalidateSession(session);
        throw new Error(`CloudDrive ${method} idle timeout after ${timeouts.idleMs / 1000}s`);
      }
      this.invalidateSession(session);
      if (error instanceof Error) throw error;
      throw new Error(String(error));
    } finally {
      clearTimers();
    }

    // If the stream ended without any response data and no first byte was
    // received, classify it as a first-byte timeout (e.g. when the server
    // never responded and close() did not produce a stream error).
    if (!firstByteReceived && !cancelled && !isCancelled?.()) {
      this.invalidateSession(session);
      throw new Error(`CloudDrive ${method} first-byte timeout after ${timeouts.firstByteMs / 1000}s`);
    }

    if (cancelled || isCancelled?.()) throw cancelledError(method);
    if (firstByteTimedOut) throw new Error(`CloudDrive ${method} first-byte timeout after ${timeouts.firstByteMs / 1000}s`);
    if (idleTimedOut) throw new Error(`CloudDrive ${method} idle timeout after ${timeouts.idleMs / 1000}s`);
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
    session.on("close", () => {
      this.stopKeepAlive();
      this.invalidateSession(session);
    });
    this.session = session;
    this.startKeepAlive(session);
    return session;
  }

  private startKeepAlive(session: ClientHttp2Session): void {
    this.stopKeepAlive();
    if (this.keepAliveIntervalMs <= 0) return;
    this.pingInFlight = false;
    this.keepAliveTimer = setInterval(() => {
      if (session.closed || session.destroyed) {
        this.stopKeepAlive();
        return;
      }
      if (this.pingInFlight) {
        // Previous PING did not return within one interval; recycle the session.
        this.invalidateSession(session);
        return;
      }
      this.pingInFlight = true;
      session.ping((error) => {
        this.pingInFlight = false;
        if (error) this.invalidateSession(session);
      });
    }, this.keepAliveIntervalMs);
    // Don't keep the Node event loop alive solely for keepalive pings.
    this.keepAliveTimer.unref?.();
  }

  private stopKeepAlive(): void {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
    this.pingInFlight = false;
  }

  private invalidateSession(session: ClientHttp2Session): void {
    if (this.session === session) {
      this.session = null;
      this.stopKeepAlive();
    }
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
    isDirectory: false, writeTime: null, createTime: null, accessTime: null,
    thumbnailUrl: "", previewUrl: "", isForbidden: false, readOnly: false,
    canDirectAccessThumbnailURL: false, hasDetailProperties: false,
    dirCacheTimeToLiveSecs: 0
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
    else if (wireType === 2 && fieldNumber === 8) result.accessTime = decodeTimestamp(reader.readBytes());
    else if (wireType === 2 && fieldNumber === 10) result.thumbnailUrl = reader.readString();
    else if (wireType === 2 && fieldNumber === 11) result.previewUrl = reader.readString();
    else if (wireType === 0 && fieldNumber === 30) result.isDirectory = reader.readBool();
    else if (wireType === 0 && fieldNumber === 36) result.isForbidden = reader.readBool();
    else if (wireType === 0 && fieldNumber === 62) result.canDirectAccessThumbnailURL = reader.readBool();
    else if (wireType === 0 && fieldNumber === 64) result.hasDetailProperties = reader.readBool();
    else if (wireType === 0 && fieldNumber === 68) result.dirCacheTimeToLiveSecs = reader.readSafeNumber("CloudDrive dirCacheTTL");
    else if (wireType === 0 && fieldNumber === 80) result.readOnly = reader.readBool();
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
