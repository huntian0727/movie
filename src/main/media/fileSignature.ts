import { open } from "node:fs/promises";

export interface KnownNonVideoContent {
  kind: string;
  label: string;
}

const SIGNATURE_READ_BYTES = 32;

export async function detectKnownNonVideoContent(filePath: string): Promise<KnownNonVideoContent | null> {
  const handle = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(SIGNATURE_READ_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return identifyKnownNonVideoContent(buffer.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
}

export function identifyKnownNonVideoContent(bytes: Uint8Array): KnownNonVideoContent | null {
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])
    || startsWith(bytes, [0x50, 0x4b, 0x05, 0x06])
    || startsWith(bytes, [0x50, 0x4b, 0x07, 0x08])) {
    return { kind: "zip", label: "ZIP 压缩包" };
  }
  if (startsWith(bytes, [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07])) return { kind: "rar", label: "RAR 压缩包" };
  if (startsWith(bytes, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) return { kind: "7z", label: "7z 压缩包" };
  if (startsWith(bytes, [0x1f, 0x8b])) return { kind: "gzip", label: "GZIP 压缩文件" };
  if (startsWithAscii(bytes, "%PDF-")) return { kind: "pdf", label: "PDF 文档" };
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { kind: "png", label: "PNG 图片" };
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { kind: "jpeg", label: "JPEG 图片" };
  if (startsWithAscii(bytes, "GIF87a") || startsWithAscii(bytes, "GIF89a")) return { kind: "gif", label: "GIF 图片" };
  if (startsWithAscii(bytes, "BM")) return { kind: "bmp", label: "BMP 图片" };
  if (startsWithAscii(bytes, "MZ")) return { kind: "executable", label: "Windows 可执行文件" };
  return null;
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return bytes.length >= signature.length && signature.every((value, index) => bytes[index] === value);
}

function startsWithAscii(bytes: Uint8Array, signature: string): boolean {
  return startsWith(bytes, [...Buffer.from(signature, "ascii")]);
}
