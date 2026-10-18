"use client";

import * as Dialog from "@radix-ui/react-dialog";
import * as Popover from "@radix-ui/react-popover";
import type { ReactNode } from "react";
import { Icon } from "@/components/icons/Icon";
import { useReturnFocusToOpener } from "@/components/ui/use-return-focus";

/** Anything the card can sit next to: a control's element, or a point projected from the 3D view. */
export type LayerAnchor = { getBoundingClientRect: () => DOMRect };

type LayerCardProps = {
  isOpen: boolean;
  onClose: () => void;
  anchor: LayerAnchor | null;
  /** Read by screen readers as the card's name. */
  label: string;
  /** The element the card must stay inside (the stage), or null for the viewport. */
  boundary: Element | null;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  /** Re-measure the anchor every frame, for a card that follows a moving object. */
  followsAnchor?: boolean;
  /** Hide the card (without closing it) while its anchor lies outside the boundary, for a card on a 3D object. */
  hidesWhenDetached?: boolean;
  /** Room kept between the card and the boundary's edges (CSS px), wider on a side a panel covers. */
  collisionPadding?: number | Partial<Record<"top" | "right" | "bottom" | "left", number>>;
  /** `popover` sits next to its anchor; `sheet` docks to the bottom of a phone screen, where no anchor has room. */
  presentation?: "popover" | "sheet";
  width?: number;
  testId?: string;
  children: ReactNode;
};

/** Where a card goes relative to its anchor and what it must stay inside, chosen together by the caller. */
export type LayerCardPlacement = Pick<LayerCardProps, "boundary" | "side" | "align" | "collisionPadding">;

/**
 * A card that opens over the console next to what it explains (docs/UI_DESIGN_SYSTEM.md, Console, Layers): it stays
 * inside the stage, flips side near an edge, stays open while the scene is orbited, closes on Esc or its close
 * button, and gives focus back to the control that opened it.
 */
export function LayerCard({
  isOpen,
  onClose,
  anchor,
  label,
  boundary,
  side = "left",
  align = "start",
  followsAnchor = false,
  hidesWhenDetached = false,
  collisionPadding = 16,
  presentation = "popover",
  width = 360,
  testId,
  children,
}: LayerCardProps) {
  const { rememberOpener, returnFocus } = useReturnFocusToOpener();

  if (presentation === "sheet") {
    // Not modal, like the popover: the scene and the dock stay usable under it; Esc and the close button close it.
    return (
      <Dialog.Root open={isOpen} modal={false} onOpenChange={(nextIsOpen) => !nextIsOpen && onClose()}>
        <Dialog.Portal>
          <Dialog.Content
            aria-describedby={undefined}
            onOpenAutoFocus={rememberOpener}
            onCloseAutoFocus={returnFocus}
            onInteractOutside={(event) => event.preventDefault()}
            className="fixed inset-x-4 bottom-4 z-(--layer-popover) flex max-h-[70svh] flex-col gap-3.5 overflow-y-auto rounded-row bg-card p-5 text-ink shadow-popover outline-none data-[state=closed]:animate-layer-exit data-[state=open]:animate-layer-enter"
            data-testid={testId}
          >
            <Dialog.Title className="sr-only">{label}</Dialog.Title>
            {children}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    );
  }

  return (
    <Popover.Root open={isOpen && anchor !== null} onOpenChange={(nextIsOpen) => !nextIsOpen && onClose()}>
      {anchor && <Popover.Anchor virtualRef={{ current: anchor }} />}
      <Popover.Portal>
        <Popover.Content
          aria-label={label}
          side={side}
          align={align}
          sideOffset={12}
          collisionBoundary={boundary}
          collisionPadding={collisionPadding}
          hideWhenDetached={hidesWhenDetached}
          updatePositionStrategy={followsAnchor ? "always" : "optimized"}
          onOpenAutoFocus={rememberOpener}
          onCloseAutoFocus={returnFocus}
          // Orbiting the scene or using the rail must not close the card; Esc and the close button do.
          onInteractOutside={(event) => event.preventDefault()}
          style={{ width }}
          className="z-(--layer-popover) flex max-h-(--radix-popover-content-available-height) max-w-[calc(100vw-32px)] flex-col gap-3.5 overflow-y-auto rounded-row bg-card p-5 text-ink shadow-popover outline-none data-[state=closed]:animate-layer-exit data-[state=open]:animate-layer-enter"
          data-testid={testId}
        >
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** The round close button in a card or sheet header. */
export function CloseButton({ onClick, label = "Close" }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="grid size-9 flex-none place-items-center rounded-full bg-soft text-ink transition-colors duration-140 ease-standard hover:bg-page active:scale-[0.97]"
    >
      <Icon name="close" size={18} />
    </button>
  );
}
