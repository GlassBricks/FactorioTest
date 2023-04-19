import { TestStage } from "../../shared-constants"
import { getTestState } from "../state"

declare const global: {
  foo?: () => 0
  weakTable: {
    value: unknown
  }
}

let someValue = "initial"

const refValue = { ___refValueId: true }

// this function holds a reference to "refValue" as an upvalue
// this reference should be dropped during reload, i.e. this function should not be saved in global
// otherwise this may cause problems when using weak tables in global: the value is saved as it is still referenced
// by the function. However, during load, the value is no longer referenced, so when making the table weak during
// on_load the global table will change, causing an error.

// multiple tests in one, as reload is slow

before_all(() => {
  tostring(refValue) // reference should not be saved
})
test("reload", () => {
  someValue = "changed"

  global.foo = () => 0 // can't be serialized

  global.weakTable = setmetatable({ value: refValue, value2: refValue }, { __mode: "v" })
  after_test(() => {
    tostring(refValue) // reference in hook
  })
}).after_mod_reload(() => {
  assert.equal(getTestState().getTestStage(), TestStage.Running)

  assert.equal("initial", someValue)

  assert.is_nil(global.foo)
  // assert.same([], findRefValue())
  assert.is_nil(global.weakTable.value)
})

// function findRefValue(): string[] {
//   const seen = new LuaTable()
//   const currentPath: string[] = []
//
//   const found: string[] = []
//
//   function visit(value: any) {
//     if (typeof value !== "object" && typeof value !== "function") return
//     if (seen.has(value)) return
//     seen.set(value, true)
//
//     if (typeof value === "function") {
//       const info = debug.getinfo(value, "nu")
//       if (info.nups === 0) return
//       for (const i of $range(1, info.nups!)) {
//         const [name, upvalue] = debug.getupvalue(value, i)
//         currentPath.push("upvalue " + name)
//         visit(upvalue)
//         currentPath.pop()
//       }
//       seen.set(value, false)
//       return
//     }
//     if (rawget(value, "___refValueId")) {
//       found.push(currentPath.join("."))
//     }
//
//     for (const [k, v] of pairs(value as unknown)) {
//       currentPath.push("in key " + tostring(k))
//       visit(k)
//       currentPath.pop()
//       currentPath.push(tostring(k))
//       visit(v)
//       currentPath.pop()
//     }
//     seen.set(value, false)
//   }
//   visit(_G)
//   return found
// }
