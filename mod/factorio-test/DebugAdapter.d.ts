/** @noResolution */
declare module "__debugadapter__/json" {
  function encode(this: void, value: AnyBasic | object | undefined, stack?: object): string
}

/** @noResolution */
declare module "__debugadapter__/variables" {
  function translate(this: void, value: LocalisedString): string | number
}

declare const __DebugAdapter:
  | {
      defineGlobal?(this: void, name: string): void
      breakpoint(this: void): void
    }
  | undefined
