import type { ShortcutActionId, ShortcutSettings } from "./videoTypes.js";

export type ShortcutScope = "library" | "player";

export interface ShortcutDefinition {
  id: ShortcutActionId;
  scope: ShortcutScope;
  label: string;
  description: string;
}

export interface ShortcutKeyboardEvent {
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

export const DEFAULT_SHORTCUTS: ShortcutSettings = {
  libraryPreviousPage: "ArrowLeft",
  libraryNextPage: "ArrowRight",
  playerTogglePlayback: "Space",
  playerSeekBackward: "ArrowLeft",
  playerSeekForward: "ArrowRight",
  playerVolumeUp: "ArrowUp",
  playerVolumeDown: "ArrowDown",
  playerRotateLeft: "Ctrl+ArrowLeft",
  playerRotateRight: "Ctrl+ArrowRight",
  playerDelete: "Ctrl+KeyD"
};

export const SHORTCUT_DEFINITIONS: readonly ShortcutDefinition[] = [
  { id: "libraryPreviousPage", scope: "library", label: "视频库上一页", description: "在视频列表中切换到上一页" },
  { id: "libraryNextPage", scope: "library", label: "视频库下一页", description: "在视频列表中切换到下一页" },
  { id: "playerTogglePlayback", scope: "player", label: "播放或暂停", description: "切换当前视频的播放状态" },
  { id: "playerSeekBackward", scope: "player", label: "快退", description: "按设置的秒数向后跳转" },
  { id: "playerSeekForward", scope: "player", label: "快进", description: "按设置的秒数向前跳转" },
  { id: "playerVolumeUp", scope: "player", label: "提高音量", description: "内置播放器音量提高 5%" },
  { id: "playerVolumeDown", scope: "player", label: "降低音量", description: "内置播放器音量降低 5%" },
  { id: "playerRotateLeft", scope: "player", label: "向左旋转", description: "画面向左旋转 90°" },
  { id: "playerRotateRight", scope: "player", label: "向右旋转", description: "画面向右旋转 90°" },
  { id: "playerDelete", scope: "player", label: "永久删除", description: "打开当前视频的永久删除确认框" }
];

const NON_ASSIGNABLE_CODES = new Set(["", "ControlLeft", "ControlRight", "AltLeft", "AltRight", "ShiftLeft", "ShiftRight", "MetaLeft", "MetaRight", "Escape", "Enter", "Tab"]);
const BINDING_PATTERN = /^(?:(?:Ctrl|Alt|Shift|Meta)\+)*(?:[A-Za-z][A-Za-z0-9]*)$/;

export function shortcutFromKeyboardEvent(event: ShortcutKeyboardEvent): string | null {
  if (NON_ASSIGNABLE_CODES.has(event.code)) return null;
  return [
    event.ctrlKey ? "Ctrl" : null,
    event.altKey ? "Alt" : null,
    event.shiftKey ? "Shift" : null,
    event.metaKey ? "Meta" : null,
    event.code
  ].filter(Boolean).join("+");
}

export function matchesShortcut(event: ShortcutKeyboardEvent, binding: string): boolean {
  return shortcutFromKeyboardEvent(event) === binding;
}

export function isValidShortcutBinding(binding: unknown): binding is string {
  if (typeof binding !== "string" || binding.length > 64 || !BINDING_PATTERN.test(binding)) return false;
  const parts = binding.split("+");
  const code = parts.at(-1) ?? "";
  if (NON_ASSIGNABLE_CODES.has(code)) return false;
  const modifiers = parts.slice(0, -1);
  return new Set(modifiers).size === modifiers.length
    && modifiers.every((modifier) => modifier === "Ctrl" || modifier === "Alt" || modifier === "Shift" || modifier === "Meta");
}

export function normalizeShortcutSettings(input: Partial<ShortcutSettings> | null | undefined): ShortcutSettings {
  const normalized = { ...DEFAULT_SHORTCUTS };
  for (const definition of SHORTCUT_DEFINITIONS) {
    const candidate = input?.[definition.id];
    if (isValidShortcutBinding(candidate)) normalized[definition.id] = candidate;
  }
  return hasShortcutConflict(normalized) ? { ...DEFAULT_SHORTCUTS } : normalized;
}

export function hasShortcutConflict(shortcuts: ShortcutSettings): boolean {
  for (const scope of ["library", "player"] as const) {
    const bindings = SHORTCUT_DEFINITIONS
      .filter((definition) => definition.scope === scope)
      .map((definition) => shortcuts[definition.id]);
    if (new Set(bindings).size !== bindings.length) return true;
  }
  return false;
}

export function formatShortcutBinding(binding: string): string {
  const names: Record<string, string> = {
    Space: "空格",
    ArrowLeft: "←",
    ArrowRight: "→",
    ArrowUp: "↑",
    ArrowDown: "↓",
    PageUp: "Page Up",
    PageDown: "Page Down",
    Backspace: "退格",
    Delete: "Delete"
  };
  return binding.split("+").map((part) => {
    if (part.startsWith("Key") && part.length === 4) return part.slice(3);
    if (part.startsWith("Digit") && part.length === 6) return part.slice(5);
    return names[part] ?? part;
  }).join(" + ");
}
