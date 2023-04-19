test("Pass", () => {
  assert.are_equal(2, 2)
})
test.skip("Skip", () => {
  error("Uh oh")
})
test.todo("TODO")
test.each([1, 2], "each %d", (v) => {
  assert.are_equal(1, v) // meant to fail on the second time
})
test("In world", () => {
  assert.is_true(game.surfaces[1].count_entities_filtered({}) > 0)
})

describe("fail in describe block", () => {
  error("Oh no")
})

describe("Failing after_all hook", () => {
  after_all(() => {
    error("Oh no")
  })
  test("Pass", () => {
    assert.are_equal(2, 2)
  })
})
