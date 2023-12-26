/** @noResolution */
declare module "__debugadapter__/json" {
  import { AnyBasic } from "factorio:runtime"

  function encode(this: void, value: AnyBasic | object | undefined, stack?: object): string
}

/** @noResolution */
declare module "__debugadapter__/variables" {
  import { LocalisedString } from "factorio:runtime"

  function translate(this: void, value: LocalisedString): string | number
}

declare const __DebugAdapter:
  | {
      defineGlobal?(this: void, name: string): void
      breakpoint(this: void): void
    }
  | undefined
