/** Lets the page run (input, a frame, a React commit) before the next piece of work: resolves in a task of its own. */
export function yieldToPage(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
