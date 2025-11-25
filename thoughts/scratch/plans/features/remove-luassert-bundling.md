# Luassert as Importable Library

## Overview

Change luassert from auto-loaded globals to an importable library, giving users explicit control over assertion loading.

## Current State

Luassert is automatically loaded and exposes globals:
```typescript
if (config.load_luassert) {
  debug.getmetatable = getmetatable
  require("@NoResolution:__factorio-test__/luassert/init")
}
```

This sets up globals: `assert`, `spy`, `mock`, `stub`, `match`

Config default: `load_luassert: true`

## Proposed Behavior

Keep luassert bundled but don't auto-load. Users explicitly import what they need:

```typescript
import { assert, spy, mock } from "__factorio-test__/luassert"
```

Or in Lua:
```lua
local assert = require("__factorio-test__/luassert").assert
local spy = require("__factorio-test__/luassert").spy
```

## Benefits

- No global namespace pollution
- Users only import what they use
- Clearer dependencies in test files
- Still zero-config for the framework itself
- Keeps bundled luassert for convenience

## Implementation

Modify `mod/luassert/init.lua` to export instead of setting globals:

```lua
-- Current: sets globals
_G.assert = assert
spy = require("__factorio-test__.luassert.spy")
-- ...

-- New: return module table
return {
  assert = assert,
  spy = require("__factorio-test__.luassert.spy"),
  mock = require("__factorio-test__.luassert.mock"),
  stub = require("__factorio-test__.luassert.stub"),
  match = require("__factorio-test__.luassert.match"),
}
```

## Files to Modify

| File | Change |
|------|--------|
| `mod/luassert/init.lua` | Return exports instead of setting globals |
| `mod/factorio-test/load.ts` | Remove auto-loading logic |
| `mod/factorio-test/config.ts` | Remove `load_luassert` option |
| `types/index.d.ts` | Remove `load_luassert` from Config, add luassert module types |
| `mod/factorio-test/luassert.d.ts` | Update to declare module exports |

## Migration

Users update from:
```typescript
test("example", () => {
  assert.equals(1, 1)  // global
})
```

To:
```typescript
import { assert } from "__factorio-test__/luassert"

test("example", () => {
  assert.equals(1, 1)  // explicit import
})
```
