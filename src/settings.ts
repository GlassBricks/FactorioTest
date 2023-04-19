import { Data } from "typed-factorio/settings/types"
import { Settings } from "./constants"

declare const data: Data

data.extend([
  {
    type: "string-setting",
    setting_type: "runtime-global",
    name: Settings.ModToTest,
    default_value: "",
    allow_blank: true,
  },
])
