# Development Tools

## Type Definitions

Type definitions are available for IDE support.

### Lua (EmmyLua/Sumneko/LuaLS)

Copy [`factorio-test.def.lua`](../factorio-test.def.lua) from this repository into your project's workspace.

### TypeScript (TSTL)

If you're using [TypeScriptToLua](https://github.com/TypescriptToLua/TypescriptToLua)
with [typed-factorio](https://github.com/GlassBricks/typed-factorio), install the npm package:

```bash
npm install --save-dev factorio-test
```

Add to your `tsconfig.json`:

```json
{
  "compilerOptions": {
    "types": ["factorio-test"]
  }
}
```

This provides types for all test globals (`test`, `describe`, `before_each`, etc.) and the config interface.
