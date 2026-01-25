import Config = FactorioTest.Config
import { Settings } from "./constants"
import { getAutoStartMod } from "./factorio-test/auto-start-config"

let initCalled = false
function init(this: void, files: string[], config?: Partial<Config>): void
function init(
  this: void,
  a: string[] | undefined,
  b: string[] | Partial<Config> | undefined,
  c?: Partial<Config>,
): void {
  const files = (a ?? b ?? error("Files must be specified")) as string[]
  const config = ((a ? b : c) ?? {}) as Config
  if (initCalled) {
    error("Duplicate call to test init")
  }
  initCalled = true
  remote.add_interface("factorio-test-tests-available-for-" + script.mod_name, {})
  const autoStartMod = getAutoStartMod()
  const manualMod = settings.global[Settings.ModToTest]!.value
  if (script.mod_name === autoStartMod || script.mod_name === manualMod) {
    require("@NoResolution:__factorio-test__/_factorio-test")(files, config)
  }
}

export = init
