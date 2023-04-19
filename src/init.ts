import Config = FactorioTest.Config
import { Settings } from "./constants"

let initCalled = false
function init(this: void, files: string[], config?: Partial<Config>): void
function init(
  this: void,
  a: string[] | undefined,
  b: string[] | Partial<Config> | undefined,
  c?: Partial<Config>,
): void {
  // this works both with this param and without, so users of both tstl and lua can use it without problems
  const files = (a ?? b ?? error("Files must be specified")) as string[]
  const config = ((a ? b : c) ?? {}) as Config
  if (initCalled) {
    error("Duplicate call to test init")
  }
  initCalled = true
  remote.add_interface("factorio-test-tests-available-for-" + script.mod_name, {})
  if (script.mod_name === settings.global[Settings.ModToTest]!.value) {
    require("@NoResolution:__factorio-test__/_factorio-test")(files, config)
  }
}

export = init
