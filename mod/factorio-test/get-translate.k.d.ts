import { LocalisedString } from "factorio:runtime"

declare function getTranslate(
  translate: typeof import("__debugadapter__/variables").translate,
): (value: LocalisedString) => string

export = getTranslate
