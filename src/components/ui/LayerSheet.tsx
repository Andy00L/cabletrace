"use client";

import * as Dialog from "@radix-ui/react-dialog";
import type { ReactNode } from "react";
import { CloseButton } from "@/components/ui/LayerCard";
import { useReturnFocusToOpener } from "@/components/ui/use-return-focus";

type LayerSheetProps = {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description: ReactNode;
  /** `sheet` slides in at the right edge; `dialog` sits in the middle of the screen. */
  placement: "sheet" | "dialog";
  testId?: string;
  children: ReactNode;
};

/**
 * A modal layer over the whole console: the sources sheet, the aftermath and shortcut dialogs. The scrim dims the
 * console behind it, focus stays inside until it closes, and Esc or the close button returns focus to the control
 * that opened it (useReturnFocusToOpener: these layers have no Radix Trigger to fall back on).
 */
export function LayerSheet({ isOpen, onClose, title, description, placement, testId, children }: LayerSheetProps) {
  const { rememberOpener, returnFocus } = useReturnFocusToOpener();
  const position =
    placement === "sheet"
      ? "top-4 right-4 bottom-4 w-[460px] max-w-[calc(100vw-32px)] data-[state=closed]:animate-sheet-exit data-[state=open]:animate-sheet-enter"
      : "top-1/2 left-1/2 max-h-[calc(100dvh-64px)] w-[560px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 data-[state=closed]:animate-layer-exit data-[state=open]:animate-layer-enter";
  return (
    <Dialog.Root open={isOpen} onOpenChange={(nextIsOpen) => !nextIsOpen && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-(--layer-sheet) bg-scrim data-[state=closed]:animate-scrim-exit data-[state=open]:animate-scrim-enter" />
        <Dialog.Content
          className={`fixed z-(--layer-sheet) flex flex-col gap-4 overflow-hidden rounded-card bg-card px-5 pt-6 text-ink shadow-popover outline-none ${position}`}
          data-testid={testId}
          onOpenAutoFocus={rememberOpener}
          onCloseAutoFocus={returnFocus}
        >
          <div className="flex items-start gap-3 px-1">
            <div className="flex min-w-0 flex-col gap-0.5">
              <Dialog.Title className="text-heading">{title}</Dialog.Title>
              <Dialog.Description className="text-caption font-normal text-muted">{description}</Dialog.Description>
            </div>
            <span className="ml-auto">
              <CloseButton onClick={onClose} />
            </span>
          </div>
          <div className="-mx-5 min-h-0 flex-1 overflow-y-auto px-5 pb-5">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
