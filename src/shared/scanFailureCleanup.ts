import type { ScanFailure, ScanFailureErrorType } from "./videoTypes.js";

export type { ScanFailureErrorType };

export interface ScanFailureClassification {
  category: ScanFailureErrorType;
  label: string;
  reason: string;
}

const NETWORK_PATTERNS = [
  /timed?\s*out/i,
  /etimedout/i,
  /enet(?:down|unreach|reset)/i,
  /econn(?:refused|reset|aborted)/i,
  /ehostunreach/i,
  /eai_again/i,
  /network (?:read )?failed/i,
  /network is unreachable/i,
  /connection (?:refused|reset|closed)/i,
  /socket hang up/i
];

const PERMISSION_PATTERNS = [
  /eacces/i,
  /eperm/i,
  /permission denied/i,
  /access is denied/i,
  /operation not permitted/i,
  /insufficient (?:permissions|privileges)/i
];

const MISSING_PATTERNS = [
  /enoent/i,
  /no such file or directory/i,
  /cannot find the (?:file|path)/i,
  /path does not exist/i
];

const CORRUPT_PATTERNS = [
  /moov atom not found/i,
  /invalid data found when processing input/i,
  /error reading header/i,
  /invalid (?:nal|packet|chunk|box) (?:size|data)/i,
  /could not find codec parameters/i,
  /unsupported codec/i,
  /invalid stream specifier/i,
  /invalid argument found when processing input/i,
  /invalid frame dimensions/i,
  /header missing/i,
  /invalid (?:start|end) time/i,
  /invalid (?:dts|pts)/i,
  /non-monotonous (?:dts|pts)/i,
  /invalid (?:width|height)/i,
  /invalid (?:pix_fmt|pixel format)/i,
  /invalid (?:sample rate|channels)/i
];

const BUSY_PATTERNS = [
  /ebusy/i,
  /file is being used/i,
  /resource busy/i,
  /device or resource busy/i,
  /being used by another process/i,
  /sharing violation/i,
  /file locked/i,
  /lock (?:failed|conflict)/i
];

const IO_ERROR_PATTERNS = [
  /eio/i,
  /input\/output error/i,
  /i\/o error/i,
  /read error/i,
  /write error/i,
  /disk i\/o error/i,
  /resource temporarily unavailable/i,
  /eagain/i,
  /ewouldblock/i,
  /broken pipe/i,
  /epipe/i,
  /no space left on device/i,
  /enospc/i,
  /read-only file system/i,
  /erofs/i,
  /too many open files/i,
  /emfile/i
];

export function classifyScanFailureForCleanup(failure: ScanFailure): ScanFailureClassification {
  const diagnostic = `${failure.errorCode ?? ""}\n${failure.errorSummary}`;
  if (failure.objectType !== "file") {
    return { category: "unknown", label: "目录访问异常", reason: "目录异常不能作为损坏视频删除。" };
  }
  if (MISSING_PATTERNS.some((pattern) => pattern.test(diagnostic))) {
    return { category: "missing", label: "文件不存在", reason: "文件已不存在，可直接清理记录。" };
  }
  if (CORRUPT_PATTERNS.some((pattern) => pattern.test(diagnostic))) {
    return { category: "corrupt", label: "容器损坏", reason: "FFprobe 报告了明确的容器损坏特征。" };
  }
  if (NETWORK_PATTERNS.some((pattern) => pattern.test(diagnostic))) {
    return { category: "network", label: "网络异常", reason: "可能是网盘超时、断线或网络不可达。" };
  }
  if (PERMISSION_PATTERNS.some((pattern) => pattern.test(diagnostic))) {
    return { category: "permission", label: "权限异常", reason: "文件或目录访问权限不足。" };
  }
  if (BUSY_PATTERNS.some((pattern) => pattern.test(diagnostic))) {
    return { category: "busy", label: "资源占用", reason: "文件正被其他程序使用，稍后重试。" };
  }
  if (IO_ERROR_PATTERNS.some((pattern) => pattern.test(diagnostic))) {
    return { category: "io-error", label: "I/O 错误", reason: "磁盘读写错误，请检查磁盘状态。" };
  }
  return { category: "unknown", label: "未知异常", reason: "扫描失败原因无法自动识别，建议人工确认。" };
}

export const SCAN_FAILURE_ERROR_TYPES: Array<{ value: ScanFailureErrorType; label: string }> = [
  { value: "network", label: "网络异常" },
  { value: "permission", label: "权限异常" },
  { value: "missing", label: "文件不存在" },
  { value: "corrupt", label: "容器损坏" },
  { value: "busy", label: "资源占用" },
  { value: "io-error", label: "I/O 错误" },
  { value: "unknown", label: "未知异常" }
];

export function isScanFailureBatchEligible(failure: ScanFailure): boolean {
  return failure.objectType === "file";
}
