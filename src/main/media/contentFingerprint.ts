import crypto from "node:crypto";
import { createReadStream } from "node:fs";
import { open } from "node:fs/promises";
import { stat } from "node:fs/promises";

const SEGMENT_SIZE = 64 * 1024;

interface FingerprintDependencies {
  openFile?: typeof open;
}

export interface FileVersion {
  sizeBytes: number;
  modifiedAt: string;
}

export async function buildContentFingerprint(
  filePath: string,
  sizeBytes: number,
  dependencies: FingerprintDependencies = {}
): Promise<string> {
  const openFile = dependencies.openFile ?? open;
  const fileHandle = await openFile(filePath, "r");

  try {
    const hash = crypto.createHash("sha256");
    hash.update(`size:${sizeBytes}|segment:${SEGMENT_SIZE}|`);

    for (const offset of getSegmentOffsets(sizeBytes)) {
      const buffer = Buffer.alloc(Math.min(SEGMENT_SIZE, Math.max(0, sizeBytes - offset)));
      const { bytesRead } = await fileHandle.read(buffer, 0, buffer.length, offset);
      hash.update(`${offset}:${bytesRead}|`);
      hash.update(buffer.subarray(0, bytesRead));
    }

    return hash.digest("hex");
  } finally {
    await fileHandle.close();
  }
}

export async function buildFullContentHash(filePath: string, signal?: AbortSignal): Promise<string> {
  const hash = crypto.createHash("sha256");
  const stream = createReadStream(filePath, { signal });
  for await (const chunk of stream) {
    hash.update(chunk as Buffer);
  }
  return hash.digest("hex");
}

export async function captureFileVersion(filePath: string): Promise<FileVersion> {
  const info = await stat(filePath);
  if (!info.isFile()) throw new Error("目标不是普通文件");
  return { sizeBytes: info.size, modifiedAt: info.mtime.toISOString() };
}

export async function assertFileVersion(filePath: string, expected: FileVersion): Promise<void> {
  const current = await captureFileVersion(filePath);
  if (current.sizeBytes !== expected.sizeBytes || current.modifiedAt !== expected.modifiedAt) {
    throw new Error("文件已变化，已停止删除");
  }
}

export async function verifyIdenticalFiles(
  filePaths: string[],
  expectedVersions: ReadonlyMap<string, FileVersion> = new Map(),
  signal?: AbortSignal
): Promise<Map<string, FileVersion>> {
  if (filePaths.length === 0) throw new Error("没有需要校验的文件");
  const versions = new Map<string, FileVersion>();
  let expectedHash: string | null = null;

  for (const filePath of filePaths) {
    const before = await captureFileVersion(filePath);
    const expected = expectedVersions.get(filePath);
    if (expected && (before.sizeBytes !== expected.sizeBytes || before.modifiedAt !== expected.modifiedAt)) {
      throw new Error("文件已变化，已停止删除");
    }
    const fullHash = await buildFullContentHash(filePath, signal);
    await assertFileVersion(filePath, before);
    if (expectedHash !== null && fullHash !== expectedHash) {
      throw new Error("完整内容不一致，已停止删除");
    }
    expectedHash = fullHash;
    versions.set(filePath, before);
  }

  return versions;
}

function getSegmentOffsets(sizeBytes: number): number[] {
  if (sizeBytes <= SEGMENT_SIZE) {
    return [0];
  }

  const middleOffset = Math.max(0, Math.floor((sizeBytes - SEGMENT_SIZE) / 2));
  const tailOffset = Math.max(0, sizeBytes - SEGMENT_SIZE);

  return [...new Set([0, middleOffset, tailOffset])].sort((left, right) => left - right);
}
