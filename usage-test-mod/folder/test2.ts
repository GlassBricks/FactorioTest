let foo = 0
test("Reload", () => {
  foo = 1
}).after_reload_mods(() => {
  assert.equal(foo, 0)
})

tags("no")
test("Skip due to tag", () => {
  //
})
