# Factorio test

A testing framework for factorio mods.
Test real setups in-game, no mocking necessary!

```lua
describe("the factory", function()
    it("must grow", function()
        assert.is_true(get_factory_size() > old_factory_size)
    end)
end)

```

- Framework inspired by [busted](https://olivinelabs.com/busted/)
- Bundled [luassert](https://github.com/Olivine-Labs/luassert) for assertions
- Integration with [factorio debug adapter](https://github.com/justarandomgeek/vscode-factoriomod-debug)
  and [typed-factorio](https://github.com/GlassBricks/typed-factorio)
- A [CLI](./cli/README.md) for launching Factorio and running tests from the command line

## Getting started

For setting up your mod, see the wiki page on [getting started]().
