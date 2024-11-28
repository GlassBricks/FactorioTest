import { TestStage } from "../../constants"
import { getTestState } from "../state"

let someValue = "initial"

test("reload", () => {
  someValue = "changed"
}).after_mod_reload(() => {
  assert.equal(getTestState().getTestStage(), TestStage.Running)
  assert.equal("initial", someValue)
})
