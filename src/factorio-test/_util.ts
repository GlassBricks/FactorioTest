export function __factorio_test__pcallWithStacktrace<A extends any[], R>(
  fn: (...args: A) => R,
  ...args: A
): LuaMultiReturn<[boolean, R | string]> {
  // prevent tail call optimization, which messes with stacktrace
  const [success, result] = xpcall(fn, getErrorWithStacktrace, ...args)
  return $multi(success, result)
}

function getErrorWithStacktrace(error: unknown) {
  // level: 1 = here, 2 = getErrorWithStackTrace(), 3 = error location
  const stacktrace = error instanceof Error ? error.toString() : debug.traceback(tostring(error), 3)

  const lines = stacktrace.split("\n")
  for (let i = 1, l = lines.length; i <= l; i++) {
    if (lines[i - 1]!.endsWith(": in function '__factorio-test__pcallWithStacktrace'")) {
      if (lines[i - 3] === "\t[C]: in function 'rawxpcall'") i-- // remove extra line from debugadapter
      return table.concat(lines, "\n", 1, i - 2)
    }
  }
  return stacktrace
}

export const debugAdapterEnabled = script.active_mods["debugadapter"] !== undefined
export function assertNever(value: never): never {
  return error(`value ${value} should be never`)
}
