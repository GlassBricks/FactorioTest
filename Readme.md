# Factorio test

A testing framework for factorio mods.
Test real setups in-game, no mocking necessary!

```lua
describe("the factory", function()
    it("must grow", function()
        assert(get_factory_size() > old_factory_size)
    end)
end)

```

- Framework inspired by [busted](https://olivinelabs.com/busted/)
- Optional bundled [luassert](https://github.com/Olivine-Labs/luassert) for assertions
- Integration with [factorio debug adapter](https://github.com/justarandomgeek/vscode-factoriomod-debug)
  and [typed-factorio](https://github.com/GlassBricks/typed-factorio)
- A [CLI](./cli/README.md) for launching Factorio and running tests from the command line

## Getting started

For setting up your mod, see [getting started](docs/Getting-Started.md).
Full documentation is in [docs](docs/README.md).
