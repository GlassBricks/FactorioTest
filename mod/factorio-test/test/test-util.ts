import * as util from "util"

export function assertEqual<T>(actual: T, expected: T, msg?: string): void {
  if (actual !== expected) error(msg ?? `Expected ${serpent.line(expected)}, got ${serpent.line(actual)}`)
}

export function assertNotNil<T>(value: T | undefined | null, msg?: string): asserts value is T {
  if (value === undefined || value === null) error(msg ?? `Expected value to not be nil`)
}

export function assertDeepEquals(actual: unknown, expected: unknown, msg?: string): void {
  if (!util.table.compare(actual as object, expected as object)) {
    error(msg ?? `Expected ${serpent.block(expected)}, got ${serpent.block(actual)}`)
  }
}

export function assertNotDeepEquals(actual: unknown, expected: unknown, msg?: string): void {
  if (util.table.compare(actual as object, expected as object)) {
    error(msg ?? `Expected values to differ, but both are ${serpent.block(actual)}`)
  }
}

export function assertMatches(str: string, pattern: string, msg?: string): void {
  if (!string.match(str, pattern)[0]) error(msg ?? `Expected "${str}" to match pattern "${pattern}"`)
}

export function assertTrue(value: unknown, msg?: string): void {
  if (value !== true) error(msg ?? `Expected true, got ${serpent.line(value)}`)
}

export function assertFalse(value: unknown, msg?: string): void {
  if (value !== false) error(msg ?? `Expected false, got ${serpent.line(value)}`)
}

export function assertThrows(fn: () => void, msg?: string): void {
  const [ok] = pcall(fn)
  if (ok) error(msg ?? "Expected function to throw")
}
