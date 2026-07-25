import type { DomainEvent, VideoManagerApi, WindowSyncSnapshot } from "../shared/videoTypes";

interface WindowSyncHandlers {
  onSnapshot(snapshot: WindowSyncSnapshot): void | Promise<void>;
  onEvent(event: DomainEvent): void | Promise<void>;
  onError(error: unknown): void;
}

export interface WindowSyncSubscription {
  ready: Promise<void>;
  dispose(): void;
}

/**
 * Subscribes before reading the snapshot. Events delivered during snapshot
 * loading are buffered and only sequences newer than the snapshot are replayed.
 */
export function startWindowSync(
  api: Pick<VideoManagerApi, "getWindowSyncSnapshot" | "subscribeDomainEvents">,
  handlers: WindowSyncHandlers
): WindowSyncSubscription {
  let disposed = false;
  let ready = false;
  let snapshotSequence = 0;
  let eventChain = Promise.resolve();
  const buffered: DomainEvent[] = [];

  const dispatch = (event: DomainEvent) => {
    if (disposed || event.sequence <= snapshotSequence) return;
    eventChain = eventChain.then(() => handlers.onEvent(event)).catch(handlers.onError);
  };

  const unsubscribe = api.subscribeDomainEvents((event) => {
    if (!ready) buffered.push(event);
    else dispatch(event);
  });

  const readyPromise = api
    .getWindowSyncSnapshot()
    .then(async (snapshot) => {
      if (disposed) return;
      snapshotSequence = snapshot.sequence;
      await handlers.onSnapshot(snapshot);
      if (disposed) return;
      ready = true;
      for (const event of buffered.splice(0).sort((left, right) => left.sequence - right.sequence)) {
        dispatch(event);
      }
      await eventChain;
    })
    .catch((error) => {
      if (!disposed) handlers.onError(error);
    });

  return {
    ready: readyPromise,
    dispose() {
      if (disposed) return;
      disposed = true;
      buffered.length = 0;
      unsubscribe();
    }
  };
}
