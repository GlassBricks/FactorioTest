let foo = 0
test("Reload", () => {
  foo = 1
}).after_mod_reload(() => {
  assert.equal(foo, 0)
})

tags("no")
test("Skip due to tag", () => {
  //
})
