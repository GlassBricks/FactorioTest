local lib = require("lib")

test("Pass", function()
  assert(script.mod_name == "level", "expected level script, got " .. script.mod_name)
  assert(lib.name == "test-scenario")
  assert(storage.initialized_by == "test-scenario", "expected scenario on_init to have run")
end)

test("Fail", function()
  error("expected failure")
end)
