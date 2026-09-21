import type { ScanFailure } from "./videoTypes.js";

export type ScanFailureCleanupCategory = "confirmed-corrupt" | "transient" | "missing" | "manual-review";

export interface ScanFailureCleanupClassification {
  category: ScanFailureCleanupCategory;
  label: string;
  reason: string;
}

const TRANSIENT_PATTERNS = [
  /timed?\s*out/i,
  /etimedout/i,
  /eacces|eperm|ebusy|enet(?:down|unreach|reset)/i,
  /permission denied/i,
  /network (?:read )?failed/i,
  /input\/output error/i,
  /resource temporarily unavailable/i,
  /file is being used/i
];

const MISSING_PATTERNS = [/enoent/i, /no such file or directory/i, /cannot find the (?:file|path)/i];

const MISSING_ERROR_CODES = new Set(["ENOENT", "ENOTDIR"]);
const TRANSIENT_ERROR_CODES = new Set([
  "EACCES",
  "EPERM",
  "EBUSY",
  "ETIMEDOUT",
  "TIMEOUT",
  "ENETDOWN",
  "ENETUNREACH",
  "ENETRESET",
  "ECONNRESET",
  "EAI_AGAIN"
]);

// Keep this list deliberately narrow. A metadata error is not proof that a file is
// unplayable; only signatures emitted by ffprobe for a structurally invalid container
// are eligible for the high-frequency cleanup flow.
const CONFIRMED_CORRUPT_PATTERNS = [
  /moov atom not found/i,
  /invalid data found when processing input/i,
  /error reading header/i,
  /invalid (?:nal|packet|chunk|box) (?:size|data)/i
];

export function classifyScanFailureForCleanup(failure: ScanFailure): ScanFailureCleanupClassification {
  const errorCode = failure.errorCode?.trim().toUpperCase() ?? "";
  const diagnostic = `${failure.errorCode ?? ""}\n${failure.errorSummary}`;
  if (failure.objectType !== "file") {
    return { category: "manual-review", label: "目录访问异常", reason: "目录异常不能作为损坏视频删除。" };
  }
  if (MISSING_ERROR_CODES.has(errorCode)) {
    return { category: "missing", label: "文件已不存在", reason: `错误码 ${errorCode} 表明文件路径已不存在；清理前仍会重新确认远端状态。` };
  }
  if (TRANSIENT_ERROR_CODES.has(errorCode)) {
    return { category: "transient", label: "访问异常，不可清理", reason: `错误码 ${errorCode} 表明这是网络、权限或占用问题，不能据此判断文件损坏。` };
  }
  if (MISSING_PATTERNS.some((pattern) => pattern.test(diagnostic))) {
    return { category: "missing", label: "文件已不存在", reason: "只需刷新资料库记录，不需要再次删除磁盘文件。" };
  }
  if (TRANSIENT_PATTERNS.some((pattern) => pattern.test(diagnostic))) {
    return { category: "transient", label: "访问异常，不可清理", reason: "可能是网盘、权限或临时占用问题，不能据此判断文件损坏。" };
  }
  if (CONFIRMED_CORRUPT_PATTERNS.some((pattern) => pattern.test(diagnostic))) {
    return { category: "confirmed-corrupt", label: "确认损坏，可清理", reason: "FFprobe 返回了明确的容器损坏特征。" };
  }
  return { category: "manual-review", label: "需要人工确认", reason: "扫描失败不足以证明视频无法播放。" };
}
