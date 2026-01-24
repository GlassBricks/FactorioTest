import { Settings } from "./constants"
import { SettingsData } from "factorio:common"

declare const data: SettingsData

data.extend([
  {
    type: "string-setting",
    setting_type: "runtime-global",
    name: Settings.ModToTest,
    default_value: "",
    allow_blank: true,
    order: "a",
  },
  {
    type: "bool-setting",
    setting_type: "startup",
    name: Settings.AutoStart,
    default_value: false,
    order: "b",
  },
  {
    type: "string-setting",
    setting_type: "runtime-global",
    name: Settings.Config,
    default_value: "{}",
    allow_blank: true,
    hidden: true,
    order: "c",
  },
])
