"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/icons/Icon";
import type { WatchKind } from "@/lib/watchlist/watch-items";

type WatchState = "idle" | "saving" | "watching" | "limit-reached" | "failed";

const STATE_LABELS: Record<WatchState, string> = {
  idle: "Watch",
  saving: "Saving",
  watching: "Watching",
  "limit-reached": "Watchlist full",
  failed: "Try again",
};

/**
 * Adds a case, a cable or a ship to the reader's watchlist (POST /api/watchlist). A signed-out reader is sent to
 * sign in and comes back to this page. The button does not ask the server whether the item is already watched, so
 * pages carry no session check and stay static; watching twice is harmless.
 */
export function WatchButton({ kind, watchRef, label, testId }: { kind: WatchKind; watchRef: string; label: string; testId?: string }) {
  const router = useRouter();
  const [state, setState] = useState<WatchState>("idle");

  async function watch() {
    setState("saving");
    const response = await fetch("/api/watchlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, ref: watchRef, label }),
    }).catch((error: unknown) => {
      console.error(`[WatchButton] ${error instanceof Error ? error.message : String(error)}`);
      return null;
    });
    if (response === null) {
      setState("failed");
      return;
    }
    if (response.status === 401) {
      router.push(`/sign-in?redirect_url=${encodeURIComponent(window.location.href)}`);
      return;
    }
    if (response.status === 201 || response.status === 200) setState("watching");
    else if (response.status === 422) setState("limit-reached");
    else setState("failed");
  }

  if (state === "watching") {
    return (
      <Link href="/watchlist" prefetch={false} className="flex h-10 items-center gap-2 rounded-full bg-soft px-3.5 text-label text-ink transition-colors duration-140 ease-standard hover:bg-page" data-testid={testId}>
        <Icon name="check" />
        Watching
      </Link>
    );
  }
  return (
    <button
      type="button"
      onClick={() => void watch()}
      disabled={state === "saving"}
      aria-label={`${STATE_LABELS[state]}: ${label}`}
      className="flex h-10 items-center gap-2 rounded-full px-3.5 text-label text-ink transition-colors duration-140 ease-standard hover:bg-soft active:scale-[0.97] disabled:text-muted"
      data-testid={testId}
    >
      <Icon name="bookmark" />
      <span className="hidden sm:inline">{STATE_LABELS[state]}</span>
    </button>
  );
}
