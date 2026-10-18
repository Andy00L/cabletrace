import { useRef } from "react";

/**
 * Remembers the element that had focus when a Radix layer opened and gives focus back to it when the layer closes.
 * Radix returns focus to its own Trigger, and CableTrace's layers open from controls that are not Triggers (rail
 * rows, scene picks, keyboard shortcuts), so without this the focus fell to the page body on Esc
 * (scripts/checks/keyboard-path.ts). Pass `rememberOpener` to `onOpenAutoFocus` and `returnFocus` to `onCloseAutoFocus`.
 */
export function useReturnFocusToOpener() {
  const openerRef = useRef<HTMLElement | null>(null);
  return {
    rememberOpener: () => {
      openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    },
    returnFocus: (event: Event) => {
      event.preventDefault();
      openerRef.current?.focus();
    },
  };
}
