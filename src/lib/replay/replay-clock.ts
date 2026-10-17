// The replay's single source of time. The timeline reads it through useSyncExternalStore; the 3D view reads
// getSnapshot() inside its own render loop, so neither drives the other and React never re-renders the scene.

export type ReplaySnapshot = { progress: number; isPlaying: boolean };

export type FrameScheduler = {
  request: (callback: (timeMs: number) => void) => number;
  cancel: (handle: number) => void;
};

export type ReplayClock = {
  getSnapshot: () => ReplaySnapshot;
  subscribe: (listener: () => void) => () => void;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seek: (progress: number) => void;
  dispose: () => void;
};

// A frame gap longer than this (a background tab) advances the replay by this much at most.
const MAX_FRAME_STEP_SECONDS = 0.1;

function clampProgress(progress: number): number {
  return Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
}

/** Creates a clock that runs from 0 to 1 over `durationSeconds` of wall time while playing. */
export function createReplayClock({ durationSeconds, scheduler }: { durationSeconds: number; scheduler: FrameScheduler }): ReplayClock {
  let snapshot: ReplaySnapshot = { progress: 0, isPlaying: false };
  let frameHandle: number | null = null;
  let lastFrameMs: number | null = null;
  const listeners = new Set<() => void>();

  function publish(next: ReplaySnapshot) {
    if (next.progress === snapshot.progress && next.isPlaying === snapshot.isPlaying) return;
    snapshot = next;
    listeners.forEach((listener) => listener());
  }

  function stopFrames() {
    if (frameHandle !== null) scheduler.cancel(frameHandle);
    frameHandle = null;
    lastFrameMs = null;
  }

  function advance(timeMs: number) {
    frameHandle = null;
    const stepSeconds = lastFrameMs === null ? 0 : Math.min(MAX_FRAME_STEP_SECONDS, (timeMs - lastFrameMs) / 1000);
    lastFrameMs = timeMs;
    const progress = clampProgress(snapshot.progress + stepSeconds / durationSeconds);
    if (progress >= 1) {
      stopFrames();
      publish({ progress: 1, isPlaying: false });
      return;
    }
    publish({ progress, isPlaying: true });
    frameHandle = scheduler.request(advance);
  }

  function play() {
    if (snapshot.isPlaying) return;
    publish({ progress: snapshot.progress >= 1 ? 0 : snapshot.progress, isPlaying: true });
    lastFrameMs = null;
    frameHandle = scheduler.request(advance);
  }

  function pause() {
    stopFrames();
    publish({ progress: snapshot.progress, isPlaying: false });
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    play,
    pause,
    toggle: () => (snapshot.isPlaying ? pause() : play()),
    seek(progress) {
      publish({ progress: clampProgress(progress), isPlaying: snapshot.isPlaying });
    },
    dispose() {
      stopFrames();
      listeners.clear();
    },
  };
}
