import { Remote, TestStage } from "../../constants"
import { assertDeepEquals, assertEqual } from "./test-util"

let someValue = "initial"

test("reload", () => {
  someValue = "changed"
}).after_reload_mods(() => {
  assertEqual(TestStage.Running, remote.call(Remote.FactorioTest, "getTestStage"))
  assertEqual("initial", someValue)
})

declare const storage: { stepPartsRun?: string[] }

test("step parts around a reload run in declaration order", () => {
  storage.stepPartsRun = ["body"]
})
  .step(() => {
    storage.stepPartsRun!.push("step 1")
  })
  .after_reload_mods(() => {
    storage.stepPartsRun!.push("after reload")
  })
  .step(() => {
    storage.stepPartsRun!.push("step 2")
    assertDeepEquals(["body", "step 1", "after reload", "step 2"], storage.stepPartsRun)
    storage.stepPartsRun = undefined
  })
