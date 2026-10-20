// Which keyboard shortcuts the console may take from the element that has focus. The shortcuts dialog promises they
// work anywhere except inside a text field: a field that takes typing keeps every key, a slider (the replay scrubber)
// keeps only its arrow keys, which step it one minute, and everything else lets every shortcut through.

export type KeyTargetKind = "text-entry" | "slider" | "other";

/** Input types a reader types into (HTML living standard, the input element's type attribute). */
const TYPED_INPUT_TYPES: ReadonlySet<string> = new Set(["text", "search", "email", "url", "tel", "password", "number", "date", "datetime-local", "month", "time", "week"]);

/** What the focused element is, from its tag name (upper case, as the DOM gives it), input type and editability. */
export function classifyKeyTarget(target: { tagName: string; inputType: string | null; isContentEditable: boolean }): KeyTargetKind {
  if (target.isContentEditable || target.tagName === "TEXTAREA" || target.tagName === "SELECT") return "text-entry";
  if (target.tagName !== "INPUT") return "other";
  const inputType = (target.inputType ?? "text").toLowerCase();
  if (inputType === "range") return "slider";
  return TYPED_INPUT_TYPES.has(inputType) ? "text-entry" : "other";
}
