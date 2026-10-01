import { Remote, TestStage } from "../../constants"
import { assertEqual } from "./test-util"

let someValue = "initial"

test("reload", () => {
  someValue = "changed"
}).after_reload_mods(() => {
  assertEqual(TestStage.Running, remote.call(Remote.FactorioTest, "getTestStage"))
  assertEqual("initial", someValue)
})
