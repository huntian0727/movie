import { describe, it, expect } from "vitest";
import { getShortcutCode, matchesShortcut } from "../../src/shared/shortcuts";

describe("shortcut virtual-key fallback", () => {
  it("recognizes rotation modifiers when a virtual-key event has no scan code", () => {
    expect(matchesShortcut({ code: "", key: "ArrowRight", ctrlKey: true, altKey: false, shiftKey: false, metaKey: false }, "Ctrl+ArrowRight")).toBe(true);
    expect(matchesShortcut({ code: "", key: "ArrowLeft", ctrlKey: false, altKey: false, shiftKey: false, metaKey: false }, "Ctrl+ArrowLeft")).toBe(false);
  });
  it("retains physical mappings and rejects unknown or modifier-only keys", () => {
    expect(getShortcutCode({ code: "KeyQ", key: "a" })).toBe("KeyQ");
    for(const key of ["Control", "Shift", "Unidentified", "未知", "", "code"]) expect(getShortcutCode({ code: "", key })).toBe("");
    expect(getShortcutCode({ code: "", key: "f" })).toBe("KeyF");
    expect(getShortcutCode({ code: "", key: "1" })).toBe("Digit1");
    expect(getShortcutCode({ code: "", key: " " })).toBe("Space");
  });
});
