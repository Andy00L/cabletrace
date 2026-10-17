"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/icons/Icon";

/** Removes one watched item (DELETE /api/watchlist?id=) and re-renders the watchlist page from the server. */
export function RemoveWatchButton({ itemId, label }: { itemId: number; label: string }) {
  const router = useRouter();
  const [hasFailed, setHasFailed] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);

  async function remove() {
    setIsRemoving(true);
    const response = await fetch(`/api/watchlist?id=${itemId}`, { method: "DELETE" }).catch((error: unknown) => {
      console.error(`[RemoveWatchButton] ${error instanceof Error ? error.message : String(error)}`);
      return null;
    });
    setIsRemoving(false);
    // Already gone (404) is the state the reader asked for.
    if (response !== null && (response.ok || response.status === 404)) {
      router.refresh();
      return;
    }
    setHasFailed(true);
  }

  return (
    <button
      type="button"
      onClick={() => void remove()}
      disabled={isRemoving}
      aria-label={hasFailed ? `Removing ${label} failed, try again` : `Stop watching ${label}`}
      className="grid size-9 flex-none place-items-center rounded-full text-muted transition-colors duration-140 ease-standard hover:bg-page hover:text-ink disabled:opacity-50"
    >
      <Icon name={hasFailed ? "reset" : "close"} size={18} />
    </button>
  );
}
