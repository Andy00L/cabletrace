"use client";

import { useRef, useState, type PointerEvent, type ReactNode } from "react";

// A drag shorter than this (CSS px) is a press on the handle, which toggles the sheet; a longer one snaps it.
const DRAG_SNAP_PX = 48;
const PRESS_SLOP_PX = 6;

type BottomSheetProps = {
  /** Read by screen readers as the sheet's name. */
  label: string;
  /** True when the sheet stands open; false when only its header shows at the bottom of the screen. */
  isExpanded: boolean;
  onExpandedChange: (isExpanded: boolean) => void;
  /** Height of the folded sheet (CSS px): the handle and the header, always on screen. */
  peekHeightPx: number;
  /** Always visible: the controls that belong to the sheet (the console's mode switch). */
  header: ReactNode;
  testId?: string;
  children: ReactNode;
};

/**
 * A panel docked to the bottom of a phone screen with two snap points (docs/UI_DESIGN_SYSTEM.md, Console, Layout):
 * folded, only its handle and header show; open, it covers most of the screen and its content scrolls inside. Drag
 * the header to move between them, or press the handle (a button, so the keyboard reaches it). Not modal: the 3D
 * view and the dock stay usable while it is folded.
 */
export function BottomSheet({ label, isExpanded, onExpandedChange, peekHeightPx, header, testId, children }: BottomSheetProps) {
  const [dragOffsetPx, setDragOffsetPx] = useState<number | null>(null);
  const dragStartRef = useRef<{ pointerId: number; clientY: number; isDragging: boolean } | null>(null);

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    // The header's own controls keep their clicks; the drag starts on the handle and the bare header.
    if (event.target instanceof Element && event.target.closest("button:not([data-sheet-handle]), a, input")) return;
    dragStartRef.current = { pointerId: event.pointerId, clientY: event.clientY, isDragging: false };
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const dragStart = dragStartRef.current;
    if (!dragStart || dragStart.pointerId !== event.pointerId) return;
    const draggedPx = event.clientY - dragStart.clientY;
    if (!dragStart.isDragging) {
      if (Math.abs(draggedPx) <= PRESS_SLOP_PX) return;
      // Captured only once it is a drag: capturing at the press would swallow the handle button's click.
      dragStart.isDragging = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    setDragOffsetPx(draggedPx);
  }

  function handlePointerEnd(event: PointerEvent<HTMLDivElement>) {
    const dragStart = dragStartRef.current;
    if (!dragStart || dragStart.pointerId !== event.pointerId) return;
    dragStartRef.current = null;
    if (!dragStart.isDragging) return;
    const draggedPx = event.clientY - dragStart.clientY;
    setDragOffsetPx(null);
    if (draggedPx <= -DRAG_SNAP_PX) onExpandedChange(true);
    else if (draggedPx >= DRAG_SNAP_PX) onExpandedChange(false);
  }

  // Folded, the sheet slides down until only `peekHeightPx` of it is left on screen; a drag follows the finger.
  const restingOffset = isExpanded ? "0px" : `calc(100% - ${peekHeightPx}px)`;
  const transform = `translateY(calc(${restingOffset} + ${dragOffsetPx ?? 0}px))`;

  return (
    <section
      aria-label={label}
      className={`fixed inset-x-0 bottom-0 z-(--layer-panel) flex h-[85svh] flex-col rounded-t-card bg-page shadow-popover ${dragOffsetPx === null ? "transition-transform duration-320 ease-enter motion-reduce:transition-none" : ""}`}
      style={{ transform }}
      data-state={isExpanded ? "expanded" : "folded"}
      data-testid={testId}
    >
      <div
        className="flex flex-none touch-none flex-col gap-2 px-4 pt-2 pb-3"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
      >
        <button
          type="button"
          onClick={() => onExpandedChange(!isExpanded)}
          aria-expanded={isExpanded}
          aria-label={isExpanded ? `Fold ${label}` : `Open ${label}`}
          className="mx-auto grid h-6 w-16 place-items-center rounded-full"
          data-sheet-handle
        >
          <span className="h-1 w-9 rounded-full bg-faint" />
        </button>
        {header}
      </div>
      <div inert={!isExpanded} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain px-4 pb-4">
        {children}
      </div>
    </section>
  );
}
