test("Pass", () => {
  assert(2 === 2, "2 should equal 2")
})
test.skip("Skip", () => {
  error("Uh oh")
})
test.todo("TODO")
test.each([1, 2])("each %d", (v) => {
  assert(1 === v, `expected 1, got ${v}`)
})
test("In world", () => {
  assert(game.surfaces[1]!.count_entities_filtered({}) > 0, "expected entities in world")
})

let partsRun: string[] = []
test("Steps", () => {
  partsRun = ["body"]
})
  .step("captioned step", () => {
    partsRun.push("captioned step")
  })
  .step(() => {
    assert(partsRun.join() === "body,captioned step", `unexpected parts run: ${partsRun.join()}`)
  })

const ticksPerStep = 60
let multiTickStart = 0
test("Multi-tick steps", () => {
  multiTickStart = game.tick
  after_ticks(ticksPerStep, () => {})
})
  .step("on_tick", () => {
    on_tick((tick) => tick < ticksPerStep)
  })
  .step("async and done", () => {
    async()
    after_ticks(ticksPerStep, done)
  })
  .step(() => {
    const elapsed = game.tick - multiTickStart
    assert(elapsed >= 3 * ticksPerStep, `expected each step to take ${ticksPerStep} ticks, took ${elapsed} in total`)
  })

describe("fail in describe block", () => {
  error("Oh no")
})

describe("Failing after_all hook", () => {
  after_all(() => {
    error("Oh no")
  })
  test("Pass", () => {
    assert(2 === 2, "2 should equal 2")
  })
})
