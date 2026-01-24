import { TestStage } from "../../constants"
import { getTestState } from "../state"
import { assertEqual } from "./test-util"

let someValue = "initial"

test("reload", () => {
  someValue = "changed"
}).after_reload_mods(() => {
  assertEqual(TestStage.Running, getTestState().getTestStage())
  assertEqual("initial", someValue)
})
