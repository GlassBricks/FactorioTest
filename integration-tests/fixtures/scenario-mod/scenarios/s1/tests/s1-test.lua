local mod_lib = require("__factorio-test-scenario-mod__/lib")

test("Level from mod", function()
  assert(script.mod_name == "level", "expected level script, got " .. script.mod_name)
  assert(script.level.mod_name == "factorio-test-scenario-mod", "expected scenario from mod")
  assert(script.level.level_name == "s1", "expected level s1, got " .. script.level.level_name)
  assert(mod_lib.name == "factorio-test-scenario-mod")
end)
