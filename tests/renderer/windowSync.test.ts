import { describe, expect, it, vi } from "vitest";
import type { DomainEvent, VideoManagerApi, WindowSyncSnapshot } from "../../src/shared/videoTypes";
import { startWindowSync } from "../../src/renderer/windowSync";

describe("startWindowSync", () => {
  it("subscribes before snapshot and replays only newer events in sequence order", async () => {
    const fixture = createApi();
    const snapshots: number[] = [];
    const events: number[] = [];
    const subscription = startWindowSync(fixture.api, {
      onSnapshot: async (snapshot) => {
        snapshots.push(snapshot.sequence);
      },
      onEvent: async (event) => {
        events.push(event.sequence);
      },
      onError: vi.fn()
    });

    fixture.emit({ sequence: 4, type: "video:updated", videoIds: ["old"] });
    fixture.emit({ sequence: 6, type: "favorite:changed", videoIds: ["newer"] });
    fixture.resolveSnapshot({ sequence: 5, playerSession: null });
    await subscription.ready;
    fixture.emit({ sequence: 7, type: "video:removed", videoIds: ["latest"] });
    await Promise.resolve();
    await Promise.resolve();

    expect(snapshots).toEqual([5]);
    expect(events).toEqual([6, 7]);
    subscription.dispose();
  });

  it("removes exactly one listener on dispose and remains stable across repeated open/close cycles", async () => {
    const fixture = createApi();
    fixture.resolveSnapshot({ sequence: 0, playerSession: null });
    const first = startWindowSync(fixture.api, emptyHandlers());
    await first.ready;
    expect(fixture.listenerCount()).toBe(1);
    first.dispose();
    first.dispose();
    expect(fixture.listenerCount()).toBe(0);

    const second = startWindowSync(fixture.api, emptyHandlers());
    await second.ready;
    expect(fixture.listenerCount()).toBe(1);
    second.dispose();
    expect(fixture.listenerCount()).toBe(0);
  });

  it("does not deliver snapshot or queued events after disposal", async () => {
    const fixture = createApi();
    const onSnapshot = vi.fn();
    const onEvent = vi.fn();
    const subscription = startWindowSync(fixture.api, { onSnapshot, onEvent, onError: vi.fn() });
    fixture.emit({ sequence: 1, type: "video:updated", videoIds: ["v1"] });
    subscription.dispose();
    fixture.resolveSnapshot({ sequence: 0, playerSession: null });
    await subscription.ready;

    expect(onSnapshot).not.toHaveBeenCalled();
    expect(onEvent).not.toHaveBeenCalled();
    expect(fixture.listenerCount()).toBe(0);
  });
});

function createApi() {
  let listener: ((event: DomainEvent) => void) | null = null;
  let resolveSnapshot!: (snapshot: WindowSyncSnapshot) => void;
  const snapshotPromise = new Promise<WindowSyncSnapshot>((resolve) => {
    resolveSnapshot = resolve;
  });
  const api = {
    getWindowSyncSnapshot: () => snapshotPromise,
    subscribeDomainEvents: (nextListener: (event: DomainEvent) => void) => {
      listener = nextListener;
      return () => {
        if (listener === nextListener) listener = null;
      };
    }
  } as Pick<VideoManagerApi, "getWindowSyncSnapshot" | "subscribeDomainEvents">;
  return {
    api,
    emit(event: DomainEvent) {
      listener?.(event);
    },
    resolveSnapshot,
    listenerCount: () => listener ? 1 : 0
  };
}

function emptyHandlers() {
  return {
    onSnapshot: vi.fn(),
    onEvent: vi.fn(),
    onError: vi.fn()
  };
}
