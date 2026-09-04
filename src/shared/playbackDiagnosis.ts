import type { PlaybackPreference, PlaybackRoute, VideoRecord } from "./videoTypes.js";

export type PlaybackDiagnosisConfidence = "high" | "medium" | "low";
export type PlaybackDiagnosisRisk = "low" | "medium" | "high" | "unknown";

export interface PlaybackDiagnosis {
  route: PlaybackRoute;
  routeLabel: string;
  confidence: PlaybackDiagnosisConfidence;
  risk: PlaybackDiagnosisRisk;
  reason: string;
  suggestion: string;
  disclaimer: string;
}

const DISCLAIMER = "这是基于资料库缓存字段的规则分析，不代表实际播放结果或硬件解码验证。";

/**
 * Explains an already selected playback route. Route selection remains owned by
 * choosePlaybackRoute so this helper cannot become a second routing policy.
 */
export function explainPlaybackRoute(
  video: VideoRecord,
  preference: PlaybackPreference,
  route: PlaybackRoute
): PlaybackDiagnosis {
  const routeLabel = route === "native" ? "内置播放器" : "MPV 外部播放器";
  const metadataIncomplete = video.metadataStatus === "pending" || video.codecProbeStatus === "unprobed";
  const metadataFailed = video.metadataStatus === "failed" || video.codecProbeStatus === "failed";
  const riskyCodec = includesAny(video.videoCodec, ["hevc", "h265", "av1"]);
  const riskyAudio = includesAny(video.audioCodec, ["dts", "truehd", "eac3"]);

  if (video.isMissing) {
    return {
      route,
      routeLabel,
      confidence: "low",
      risk: "unknown",
      reason: "资料库记录显示文件当前缺失，无法据此判断实际播放表现。",
      suggestion: "先到扫描异常中确认文件位置，或选择其他视频。",
      disclaimer: DISCLAIMER
    };
  }

  if (preference === "mpv-first") {
    return {
      route,
      routeLabel,
      confidence: metadataIncomplete || metadataFailed ? "low" : "high",
      risk: metadataIncomplete || metadataFailed ? "unknown" : riskyCodec || riskyAudio ? "medium" : "low",
      reason: "播放偏好设置为 MPV 优先，因此当前策略优先选择 MPV 外部播放器。",
      suggestion: metadataIncomplete || metadataFailed
        ? "可以补充元数据，以获得更完整的格式风险提示。"
        : "如需使用内置播放器，可在设置中调整播放策略后重新查看。",
      disclaimer: DISCLAIMER
    };
  }

  if (preference === "native-first") {
    const compatibilityNote = riskyCodec || riskyAudio
      ? "已记录的编码组合可能存在兼容风险。"
      : "当前缓存字段未发现明显的高风险编码组合。";
    return {
      route,
      routeLabel,
      confidence: metadataIncomplete || metadataFailed ? "low" : "medium",
      risk: metadataIncomplete || metadataFailed ? "unknown" : riskyCodec || riskyAudio ? "high" : "medium",
      reason: `播放偏好设置为内置播放器优先，当前容器按现有规则选择${routeLabel}。${compatibilityNote}`,
      suggestion: route === "native" && (riskyCodec || riskyAudio)
        ? "若内置播放出现声音或画面问题，可尝试 MPV 外部播放器。"
        : metadataIncomplete || metadataFailed
          ? "可以补充元数据，以获得更完整的格式风险提示。"
          : "可先按当前策略播放，遇到问题时再尝试另一播放器。",
      disclaimer: DISCLAIMER
    };
  }

  if (video.metadataStatus === "pending") {
    return {
      route,
      routeLabel,
      confidence: "low",
      risk: "unknown",
      reason: `元数据仍在补充，当前自动策略暂时依据文件容器选择${routeLabel}。`,
      suggestion: "等待扫描完成，或手动补充元数据后再查看更完整的分析。",
      disclaimer: DISCLAIMER
    };
  }

  if (metadataFailed || video.codecProbeStatus === "unprobed") {
    return {
      route,
      routeLabel,
      confidence: "low",
      risk: "unknown",
      reason: `媒体信息${metadataFailed ? "读取失败" : "尚未探测"}，当前自动策略选择${routeLabel}。`,
      suggestion: "可以补充元数据，诊断页不会自动读取视频内容。",
      disclaimer: DISCLAIMER
    };
  }

  if (route === "native") {
    return {
      route,
      routeLabel,
      confidence: "high",
      risk: "low",
      reason: "当前容器、视频编码、像素格式和音频编码符合内置播放器规则。",
      suggestion: "可按当前策略播放。如实际设备表现异常，再尝试 MPV 外部播放器。",
      disclaimer: DISCLAIMER
    };
  }

  return {
    route,
    routeLabel,
    confidence: "high",
    risk: riskyCodec || riskyAudio ? "high" : "medium",
    reason: riskyCodec || riskyAudio
      ? "当前编码组合可能超出内置播放器的稳定兼容范围，因此自动策略选择 MPV 外部播放器。"
      : "当前媒体字段不完全符合内置播放器规则，因此自动策略选择 MPV 外部播放器。",
    suggestion: "建议使用 MPV 外部播放器，并以实际播放结果为准。",
    disclaimer: DISCLAIMER
  };
}

function includesAny(value: string | null, candidates: string[]): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase().replaceAll("-", "");
  return candidates.some((candidate) => normalized.includes(candidate.replaceAll("-", "")));
}
