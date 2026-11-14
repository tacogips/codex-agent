/**
 * Asserts that a value is neither null nor undefined, then returns it.
 *
 * Use in tests instead of the non-null assertion operator (!) to keep
 * assertions strict while still satisfying TypeScript's type checker.
 * Unlike optional chaining (?.) this throws immediately when the value
 * is absent, producing a clear failure message.
 *
 * @example
 * const item = defined(array[0]);
 * expect(item.name).toBe("expected");
 */
export function defined<T>(
  value: T | null | undefined,
  message?: string,
): NonNullable<T> {
  if (value === null || value === undefined) {
    throw new Error(
      message ?? "Expected value to be defined (got null or undefined)",
    );
  }
  return value as NonNullable<T>;
}
