// Errors as values: every fallible function in the app returns one of these instead of throwing.
export type Result<Value> = { ok: true; value: Value } | { ok: false; reason: string };
