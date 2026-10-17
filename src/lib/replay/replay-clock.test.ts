import { describe, expect, test } from "bun:test";
import { createReplayClock, type FrameScheduler } from "./replay-clock";

// A scheduler the test steps by hand: each step runs the pending frame at the given time.
function createManualScheduler() {
  let pending: ((timeMs: number) => void) | null = null;
  const scheduler: FrameScheduler = {
    request(callback) {
      pending = callback;
      return 1;
    },
    cancel() {
      pending = null;
    },
  };
  return {
    scheduler,
    runFrameAt(timeMs: number) {
      const callback = pending;
      pending = null;
      callback?.(timeMs);
    },
    hasPendingFrame: () => pending !== null,
  };
}

describe("createReplayClock", () => {
  test("advances with wall time while playing and stops at the end", () => {
    const frames = createManualScheduler();
    const clock = createReplayClock({ durationSeconds: 1, scheduler: frames.scheduler });
    clock.play();
    frames.runFrameAt(1000);
    expect(clock.getSnapshot()).toEqual({ progress: 0, isPlaying: true });
    frames.runFrameAt(1050);
    expect(clock.getSnapshot().progress).toBeCloseTo(0.05, 5);
    for (let frame = 1; frame <= 30; frame += 1) frames.runFrameAt(1050 + frame * 50);
    expect(clock.getSnapshot()).toEqual({ progress: 1, isPlaying: false });
    expect(frames.hasPendingFrame()).toBe(false);
  });

  test("caps a long frame gap so a background tab does not jump to the end", () => {
    const frames = createManualScheduler();
    const clock = createReplayClock({ durationSeconds: 10, scheduler: frames.scheduler });
    clock.play();
    frames.runFrameAt(0);
    frames.runFrameAt(60_000);
    expect(clock.getSnapshot().progress).toBeCloseTo(0.01, 5);
  });

  test("seeks inside 0 to 1 and restarts from the start when played at the end", () => {
    const frames = createManualScheduler();
    const clock = createReplayClock({ durationSeconds: 10, scheduler: frames.scheduler });
    clock.seek(1.7);
    expect(clock.getSnapshot().progress).toBe(1);
    clock.seek(Number.NaN);
    expect(clock.getSnapshot().progress).toBe(0);
    clock.seek(1);
    clock.toggle();
    expect(clock.getSnapshot()).toEqual({ progress: 0, isPlaying: true });
  });

  test("notifies subscribers only on change and keeps the snapshot stable between changes", () => {
    const frames = createManualScheduler();
    const clock = createReplayClock({ durationSeconds: 10, scheduler: frames.scheduler });
    let notifications = 0;
    const unsubscribe = clock.subscribe(() => {
      notifications += 1;
    });
    const before = clock.getSnapshot();
    clock.pause();
    expect(clock.getSnapshot()).toBe(before);
    expect(notifications).toBe(0);
    clock.seek(0.5);
    expect(notifications).toBe(1);
    unsubscribe();
    clock.seek(0.6);
    expect(notifications).toBe(1);
  });

  test("pause and dispose cancel the pending frame", () => {
    const frames = createManualScheduler();
    const clock = createReplayClock({ durationSeconds: 10, scheduler: frames.scheduler });
    clock.play();
    clock.pause();
    expect(frames.hasPendingFrame()).toBe(false);
    clock.play();
    clock.dispose();
    expect(frames.hasPendingFrame()).toBe(false);
  });
});
