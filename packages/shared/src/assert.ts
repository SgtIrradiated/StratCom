/** Thrown by {@link assert} and {@link assertNever}; signals a programming error, not a user error. */
export class AssertionError extends Error {
  override name = "AssertionError";
}

/**
 * Narrowing runtime assertion. Use for invariants that indicate a bug if violated.
 *
 * @example
 * assert(unit !== undefined, `unknown unit ${id}`);
 */
export function assert(condition: unknown, message = "Assertion failed"): asserts condition {
  if (!condition) throw new AssertionError(message);
}

/**
 * Exhaustiveness check for discriminated unions: the compiler reports an error at the call
 * site if a case is missing, and the runtime throws if an unexpected value slips through.
 */
export function assertNever(value: never, message = "Unexpected value"): never {
  throw new AssertionError(`${message}: ${JSON.stringify(value)}`);
}
