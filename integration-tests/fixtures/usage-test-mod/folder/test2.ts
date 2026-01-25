let foo = 0
test("Reload", () => {
  foo = 1
}).after_reload_mods(() => {
  assert(foo === 0, `expected foo to be 0, got ${foo}`)
})

tags("no")
test("Skip due to tag", () => {
  //
})
