local lib = require("lib")

script.on_init(function()
  storage.initialized_by = lib.name
end)

if script.active_mods["factorio-test"] then
  require("__factorio-test__/init")({ "tests.scenario-test" })
end
