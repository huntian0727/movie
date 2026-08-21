export type WireType = 0 | 1 | 2 | 5;

const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

export class ProtoReader {
  private offset = 0;

  constructor(private readonly buffer: Buffer) {}

  get done(): boolean {
    return this.offset >= this.buffer.length;
  }

  readTag(): { fieldNumber: number; wireType: WireType } {
    const value = this.readVarint();
    const wireType = Number(value & 0x7n) as WireType;
    const fieldNumber = Number(value >> 3n);
    if (fieldNumber <= 0) throw new Error(`Invalid protobuf field number: ${fieldNumber}`);
    if (wireType !== 0 && wireType !== 1 && wireType !== 2 && wireType !== 5) {
      throw new Error(`Unsupported protobuf wire type: ${wireType}`);
    }
    return { fieldNumber, wireType };
  }

  readVarint(): bigint {
    let result = 0n;
    let shift = 0n;
    for (let index = 0; index < 10; index += 1) {
      if (this.offset >= this.buffer.length) throw new Error("Unexpected end of protobuf varint");
      const byte = this.buffer[this.offset++];
      result |= BigInt(byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) return result;
      shift += 7n;
    }
    throw new Error("Invalid protobuf varint");
  }

  readBool(): boolean {
    return this.readVarint() !== 0n;
  }

  readSafeNumber(label = "protobuf integer"): number {
    const value = this.readVarint();
    if (value > MAX_SAFE_BIGINT) throw new Error(`${label} exceeds JavaScript safe integer range`);
    return Number(value);
  }

  readBytes(): Buffer {
    const length = this.readSafeNumber("protobuf length");
    const end = this.offset + length;
    if (end > this.buffer.length) throw new Error("Unexpected end of protobuf length-delimited field");
    const result = this.buffer.subarray(this.offset, end);
    this.offset = end;
    return result;
  }

  readString(): string {
    return this.readBytes().toString("utf8");
  }

  skip(wireType: WireType): void {
    if (wireType === 0) this.readVarint();
    else if (wireType === 1) this.advance(8);
    else if (wireType === 2) this.advance(this.readSafeNumber("protobuf skipped length"));
    else this.advance(4);
  }

  private advance(length: number): void {
    const nextOffset = this.offset + length;
    if (nextOffset > this.buffer.length) throw new Error("Unexpected end of protobuf field");
    this.offset = nextOffset;
  }
}

export function encodeVarint(value: number | bigint): Buffer {
  let remaining = typeof value === "bigint" ? value : BigInt(value);
  if (remaining < 0n) throw new Error("Negative protobuf varints are not supported");
  const bytes: number[] = [];
  do {
    let byte = Number(remaining & 0x7fn);
    remaining >>= 7n;
    if (remaining !== 0n) byte |= 0x80;
    bytes.push(byte);
  } while (remaining !== 0n);
  return Buffer.from(bytes);
}

export function encodeTag(fieldNumber: number, wireType: WireType): Buffer {
  return encodeVarint((BigInt(fieldNumber) << 3n) | BigInt(wireType));
}

export function encodeStringField(fieldNumber: number, value: string): Buffer {
  const payload = Buffer.from(value, "utf8");
  return Buffer.concat([encodeTag(fieldNumber, 2), encodeVarint(payload.length), payload]);
}

export function encodeBoolField(fieldNumber: number, value: boolean): Buffer {
  return Buffer.concat([encodeTag(fieldNumber, 0), encodeVarint(value ? 1 : 0)]);
}

export function encodeUInt32Field(fieldNumber: number, value: number): Buffer {
  return Buffer.concat([encodeTag(fieldNumber, 0), encodeVarint(value)]);
}

export function encodeUInt64Field(fieldNumber: number, value: number | bigint): Buffer {
  return Buffer.concat([encodeTag(fieldNumber, 0), encodeVarint(value)]);
}

export function encodeMessageField(fieldNumber: number, encodedMessage: Buffer): Buffer {
  return Buffer.concat([encodeTag(fieldNumber, 2), encodeVarint(encodedMessage.length), encodedMessage]);
}

export function encodeBytesField(fieldNumber: number, data: Buffer): Buffer {
  return Buffer.concat([encodeTag(fieldNumber, 2), encodeVarint(data.length), data]);
}

export function decodeTimestamp(payload: Buffer): string | null {
  const reader = new ProtoReader(payload);
  let seconds = 0n;
  let nanos = 0;
  while (!reader.done) {
    const { fieldNumber, wireType } = reader.readTag();
    if (fieldNumber === 1 && wireType === 0) seconds = reader.readVarint();
    else if (fieldNumber === 2 && wireType === 0) nanos = reader.readSafeNumber("timestamp nanos");
    else reader.skip(wireType);
  }
  if (seconds > MAX_SAFE_BIGINT) return null;
  const date = new Date(Number(seconds) * 1000 + Math.trunc(nanos / 1_000_000));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
