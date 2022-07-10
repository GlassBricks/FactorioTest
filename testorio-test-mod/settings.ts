import { Data } from "typed-factorio/settings/types"

declare const data: Data

data.extend([
  {
    type: "string-setting",
    setting_type: "runtime-global",
    name: "__testorio-test-mod:state",
    default_value: "",
    allow_blank: true,
  },
])
