"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { findReplayTimeForVideoSeconds, findVideoSecondsForReplayTime, type FootageCrop, type FootageEvent, type ReplayFootage } from "@/lib/landing/replay-footage";
import { formatUtcClock } from "@/lib/replay/format-utc";

// Below this width the stage plays the 4:5 phone cut (the same break as the landing's pictures).
const PHONE_MEDIA = "(max-width: 767px)";

type HeroReplayProps = {
  footage: ReplayFootage;
  /** The moments the list offers, in order; picking one moves the footage there. */
  events: readonly FootageEvent[];
  /** The list's title, the case and its day ("Eagle S, 25 December 2024"). */
  listTitle: string;
  /** The console link the dock offers, on the same case. */
  consoleHref: string;
  /** Grid placement of the two parts, set by the hero's layout (src/app/page.tsx). */
  listClassName: string;
  stageClassName: string;
};

function readFootageCrop(): FootageCrop {
  return window.matchMedia(PHONE_MEDIA).matches ? "phone" : "desktop";
}

/** The index of the last listed moment at or before the replay time, or -1 before the first. */
function findCurrentEventIndex(events: readonly FootageEvent[], atMs: number): number {
  let currentIndex = -1;
  events.forEach((event, index) => {
    if (event.atMs <= atMs) currentIndex = index;
  });
  return currentIndex;
}

/**
 * The hero's live replay, the stage first and the moments after it (the order a phone reads them in): real footage of
 * the console (src/lib/landing/replay-footage.ts) in a white window, with the console's own dock under it (play, the
 * UTC clock, the scrubber) and the case's moments beside it. Picking a moment
 * moves the footage there; the clock and the marked moment follow the footage. Until the video draws its first frame
 * the stage shows the poster, which is that frame, so nothing jumps; under reduced motion it waits for Play. It pauses
 * while off screen.
 */
export function HeroReplay({ footage, events, listTitle, consoleHref, listClassName, stageClassName }: HeroReplayProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const clockRef = useRef<HTMLSpanElement>(null);
  const scrubberRef = useRef<HTMLInputElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const isPausedByReaderRef = useRef(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [hasFirstFrame, setHasFirstFrame] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const desktopFile = footage.files.desktop;
  const phoneFile = footage.files.phone;

  // Syncs with the video element, matchMedia, IntersectionObserver and the animation frame clock, none of which React
  // owns: picks the cut for this screen, starts it unless motion is reduced, pauses it off screen, and writes the clock
  // and the scrubber straight into the DOM on every frame while it plays (no render per frame).
  useEffect(() => {
    const video = videoRef.current;
    const stage = stageRef.current;
    if (!video || !stage) return;
    // WebM first, MP4 for the browsers that cannot play it: the element takes the first source it can decode.
    const file = footage.files[readFootageCrop()];
    video.replaceChildren(
      ...[
        { src: file.webm, type: "video/webm" },
        { src: file.mp4, type: "video/mp4" },
      ].map((candidate) => Object.assign(document.createElement("source"), candidate)),
    );
    video.poster = file.posterAvif;
    video.load();
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReducedMotion) isPausedByReaderRef.current = true;
    let frameHandle = 0;
    const writeFrame = () => {
      // To the second: a seek to a moment can land a hair before it in floating point, which would show the minute before.
      const atMs = Math.round(findReplayTimeForVideoSeconds(footage, video.currentTime) / 1000) * 1000;
      if (clockRef.current) clockRef.current.textContent = formatUtcClock(atMs);
      if (scrubberRef.current) scrubberRef.current.value = String(video.currentTime);
      setCurrentIndex(findCurrentEventIndex(events, atMs));
      if (!video.paused) frameHandle = window.requestAnimationFrame(writeFrame);
    };
    const handlePlay = () => {
      setIsPlaying(true);
      window.cancelAnimationFrame(frameHandle);
      frameHandle = window.requestAnimationFrame(writeFrame);
    };
    const handlePause = () => {
      setIsPlaying(false);
      writeFrame();
    };
    const handleFirstFrame = () => setHasFirstFrame(true);
    video.addEventListener("play", handlePlay);
    video.addEventListener("pause", handlePause);
    video.addEventListener("seeked", writeFrame);
    video.addEventListener("loadeddata", handleFirstFrame);
    const visibilityObserver = new IntersectionObserver((entries) => {
      const isOnScreen = entries.some((entry) => entry.isIntersecting);
      if (!isOnScreen) video.pause();
      else if (!isPausedByReaderRef.current) video.play().catch((error: unknown) => console.error(`[HeroReplay] play: ${String(error)}`));
    });
    visibilityObserver.observe(stage);
    return () => {
      window.cancelAnimationFrame(frameHandle);
      visibilityObserver.disconnect();
      video.removeEventListener("play", handlePlay);
      video.removeEventListener("pause", handlePause);
      video.removeEventListener("seeked", writeFrame);
      video.removeEventListener("loadeddata", handleFirstFrame);
    };
  }, [footage, events]);

  const togglePlayback = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      isPausedByReaderRef.current = false;
      video.play().catch((error: unknown) => console.error(`[HeroReplay] play: ${String(error)}`));
    } else {
      isPausedByReaderRef.current = true;
      video.pause();
    }
  };
  const seekToSeconds = (videoSeconds: number) => {
    const video = videoRef.current;
    if (video) video.currentTime = Math.min(footage.durationSeconds, Math.max(0, videoSeconds));
  };

  return (
    <>
      {/* The stage: the console's window, a white frame holding the footage and its dock, laid over the painting's sea. */}
      <div ref={stageRef} className={`${stageClassName} rounded-card bg-card p-2`}>
        <div className="flex flex-col gap-2" data-ui>
          <div className="landing-shutter relative overflow-hidden rounded-inner bg-ink">
            <picture className={`transition-opacity duration-220 ${hasFirstFrame ? "opacity-0" : "opacity-100"}`}>
              <source media={PHONE_MEDIA} type="image/avif" srcSet={phoneFile.posterAvif} />
              <source media={PHONE_MEDIA} type="image/webp" srcSet={phoneFile.posterWebp} />
              <source type="image/avif" srcSet={desktopFile.posterAvif} />
              <img
                src={desktopFile.posterWebp}
                width={desktopFile.width}
                height={desktopFile.height}
                alt="The CableTrace console replaying the Eagle S on 25 December 2024: the tanker's track crosses the Gulf of Finland, its anchor drags, and the cables it crosses turn red as they fail"
                className="landing-settle block aspect-[4/5] h-auto w-full object-cover md:aspect-[16/10]"
              />
            </picture>
            <video
              ref={videoRef}
              muted
              loop
              playsInline
              preload="auto"
              aria-hidden="true"
              className="landing-settle absolute inset-0 size-full object-cover"
              data-testid="hero-footage"
            />
          </div>
          <div className="flex items-center gap-3.5 py-1 pr-3 pl-1">
            <button
              type="button"
              onClick={togglePlayback}
              aria-label={isPlaying ? "Pause the replay" : "Play the replay"}
              className="grid size-11 flex-none place-items-center rounded-full bg-ink transition-colors duration-140 ease-standard hover:bg-ink-hover active:scale-[0.97]"
              data-testid="hero-play"
            >
              {isPlaying ? (
                <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                  <path d="M6 4 V14 M12 4 V14" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" className="text-card" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                  <path d="M5.5 3.5 L14.5 9 L5.5 14.5 Z" fill="currentColor" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" className="text-card" />
                </svg>
              )}
            </button>
            <p className="flex-none text-heading tabular-nums" aria-live="off">
              <span ref={clockRef} data-testid="hero-clock">{formatUtcClock(footage.replayStartMs)}</span> <span className="text-label text-muted">UTC</span>
            </p>
            <input
              ref={scrubberRef}
              type="range"
              min={0}
              max={footage.durationSeconds}
              step={0.01}
              defaultValue={0}
              onInput={(event) => seekToSeconds(Number(event.currentTarget.value))}
              aria-label="Move through the replay"
              className="h-11 min-w-0 flex-1 cursor-pointer accent-ink"
            />
            <Link href={consoleHref} className="hidden flex-none text-label text-ink underline-offset-4 hover:underline lg:block">
              Open in the console
            </Link>
          </div>
        </div>
      </div>
      <div className={listClassName} data-testid="hero-moments">
        <h2 className="px-3 pb-2 text-label text-muted">{listTitle}</h2>
        <ol className="flex flex-col gap-0.5">
          {events.map((event, index) => {
            const isCurrent = index === currentIndex;
            return (
              <li key={event.atMs}>
                <button
                  type="button"
                  onClick={() => seekToSeconds(findVideoSecondsForReplayTime(footage, event.atMs))}
                  aria-current={isCurrent ? "step" : undefined}
                  className={`grid min-h-11 w-full grid-cols-[64px_minmax(0,1fr)] items-baseline gap-x-3 rounded-field px-3 py-2.5 text-left transition-colors duration-140 ease-standard hover:bg-card ${isCurrent ? "bg-card" : ""}`}
                >
                  {/* The playing moment's time in ink with an alarm dot: alarm text on card is 4.3:1, under the 4.5:1 small text needs. */}
                  <span className={`flex items-center gap-1.5 text-label tabular-nums ${isCurrent ? "text-ink" : "text-muted"}`}>
                    {formatUtcClock(event.atMs)}
                    {isCurrent && <span className="size-1.5 flex-none rounded-full bg-alarm" aria-hidden="true" />}
                  </span>
                  <span className="text-body text-ink">{event.title}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    </>
  );
}
