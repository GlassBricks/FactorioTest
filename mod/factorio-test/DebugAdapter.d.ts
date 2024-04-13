/** @noResolution */
declare module "__debugadapter__/print" {
  function outputEvent(
    this: void,
    body: {
      output: string
      category?: "console" | "important" | "stdout" | "stderr"
    },
    info?: {
      source: string
      currentline: number
    },
  ): void
}

/** @noResolution */
declare module "__debugadapter__/variables" {
  import { LocalisedString } from "factorio:runtime"

  function translate(this: void, value: LocalisedString): LuaMultiReturn<[i: string | undefined, message?: string]>

  const __dap: any
}

declare let __DebugAdapter:
  | {
      defineGlobal(name: string): void
      outputEvent: typeof import("__debugadapter__/print").outputEvent
      translate: typeof import("__debugadapter__/variables").translate
      breakpoint(): void
    }
  | undefined
