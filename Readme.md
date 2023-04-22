# Factorio test

A Testing framework for factorio mods.

```lua
describe("the factory", function()
    it("must grow", function()
        assert.is_true(get_factory_size() > old_factory_size)
    end)
end)

```

Test real setups in-game, no mocking necessary!

Features include:
- Framework inspired by [busted](https://olivinelabs.com/busted/)
- Bundled [luassert](https://github.com/Olivine-Labs/luassert) for assertions
- Integration with [factorio debug adapter](https://github.com/justarandomgeek/vscode-factoriomod-debug), and [typed-factorio](https://github.com/GlassBricks/typed-factorio)
- CLI to run tests in factorio! From the command line
