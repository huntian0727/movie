import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlayerTimelinePreviewContent } from "../../src/shared/playerTimelinePreview";
import { PlayerTimelinePreviewWindow } from "../../src/renderer/components/PlayerTimelinePreviewWindow";

afterEach(() => { delete window.videoManager; });
describe("timeline preview window", () => {
  it("renders cached image/time updates and releases its subscription", () => {
    let update!: (content: PlayerTimelinePreviewContent | null) => void;
    const unsubscribe = vi.fn();
    window.videoManager = { windowMode: "timeline-preview", subscribePlayerTimelinePreview: (listener: (content: PlayerTimelinePreviewContent | null) => void) => { update = listener; listener(null); return unsubscribe; } } as never;
    const view = render(<PlayerTimelinePreviewWindow />);
    expect(view.container.firstChild).toBeNull();
    act(() => update({ url: "local-video://preview/v1/45000", timeMs: 45000, imageHeight: 90 }));
    expect(view.container.querySelector("img")).toHaveAttribute("src", "local-video://preview/v1/45000");
    expect(view.container).toHaveTextContent("00:45");
    act(() => update(null)); expect(view.container.firstChild).toBeNull();
    view.unmount(); expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
