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

// Permanent deletion must never be enabled from FFprobe text alone. Messages such as
// "moov atom not found" can also mean that a playable archive or another container was
// given a video extension, or that a mounted remote file returned incomplete data.
const CONFIRMED_CORRUPT_ERROR_CODES = new Set(["CONFIRMED_CORRUPT"]);

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
  if (errorCode === "CONTENT_TYPE_MISMATCH") {
    return { category: "manual-review", label: "扩展名与内容不一致", reason: "文件头显示它不是当前扩展名所代表的视频容器；可能是可正常使用的压缩包或其他文件，不允许自动删除。" };
  }
  if (CONFIRMED_CORRUPT_ERROR_CODES.has(errorCode)) {
    return { category: "confirmed-corrupt", label: "复核确认损坏，可清理", reason: "该文件已通过独立复核流程确认损坏；普通 FFprobe 解析失败不会进入此分类。" };
  }
  if (errorCode === "INVALID_MEDIA" || /moov atom not found|invalid data found when processing input|error reading header/i.test(diagnostic)) {
    return { category: "manual-review", label: "媒体解析失败，需复核", reason: "FFprobe 解析失败不能单独证明文件损坏；可能是扩展名不符、特殊封装、远端读取不完整或播放器兼容性差异。" };
  }
  return { category: "manual-review", label: "需要人工确认", reason: "扫描失败不足以证明视频无法播放。" };
}
