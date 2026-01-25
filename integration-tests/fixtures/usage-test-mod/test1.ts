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
