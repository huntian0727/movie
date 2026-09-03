// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { showMainWindowMaximized } from "../../src/main/windowPresentation.js";

describe("main window presentation", () => {
  it("maximizes the loaded main window before showing it", () => {
    const calls: string[] = [];
    const window = {
      maximize: vi.fn(() => calls.push("maximize")),
      show: vi.fn(() => calls.push("show"))
    };

    showMainWindowMaximized(window);

    expect(calls).toEqual(["maximize", "show"]);
    expect(window.maximize).toHaveBeenCalledOnce();
    expect(window.show).toHaveBeenCalledOnce();
  });
});
