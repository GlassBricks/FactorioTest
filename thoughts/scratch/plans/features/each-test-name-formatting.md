# Better .each Test Name Formatting

## Overview

Improve test name formatting for `.each()` tests beyond Lua's `string.format()`, supporting template syntax like `$foo` for named parameters.

## Current State

In `setup-globals.ts`, `createEachItems()` generates names:
```typescript
const rowValues = row.map((v) => (typeof v === "object" ? serpent.line(v) : v))
const itemName = string.format(name, ...rowValues)
```

Current capabilities:
- Lua format specifiers: `%d`, `%s`, `%f`, etc.
- Objects serialized via `serpent.line()` (verbose table representation)
- Positional parameters only

## Limitations

- No named parameter support (`$foo`, `${foo}`)
- Objects always serialize verbosely: `{prop = "value"}`
- Cannot access specific object properties in name
- Format specifiers are cryptic for non-Lua users

## Proposed Enhancement

Support Jest-like template syntax and format specifiers:

**Template syntax ($-style):**
```typescript
test.each([
  { id: 1, name: "first", meta: { type: "unit" } },
  { id: 2, name: "second", meta: { type: "integration" } }
])("test $id: $name ($meta.type)", (params) => {
  // ...
})
// Generates: "test 1: first (unit)", "test 2: second (integration)"
```

**Enhanced format specifiers (%-style):**
```typescript
test.each([
  [1, { foo: "bar" }],
  [2, { baz: "qux" }]
])("test %# with %p", (id, obj) => {
  // ...
})
// Generates: "test 0 with {foo = "bar"}", "test 1 with {baz = "qux"}"
```

**Supported Jest format specifiers:**
- `%p` - Pretty-formatted value using `serpent.block()` (multi-line for objects)
- `%s` - Native string representation (primitives as-is, no serpent)
- `%d`, `%i` - Integer formatting
- `%f` - Float formatting
- `%#` - Index of the test case (0-based)
- `%$` - 1-indexed test case number

**Template features:**
- `$name` - Simple property access
- `$foo.bar.baz` - Nested property access with dot notation
- Works only with object parameters

## Implementation

Create a template string formatter with Jest compatibility:
```typescript
function formatTemplateName(template: string, params: unknown, index: number): string {
  let result = template

  // Handle Jest-style index specifiers
  result = result.replace(/%#/g, String(index))
  result = result.replace(/%\$/g, String(index + 1))

  // Handle template syntax for objects
  if (typeof params === "object" && params !== null) {
    result = result.replace(/\$(\w+(?:\.\w+)*)/g, (_, path) => {
      const value = getNestedProperty(params, path)
      return formatValue(value)
    })
  }

  // Handle enhanced format specifiers
  if (result.includes("%p")) {
    const rowValues = Array.isArray(params) ? params : [params]
    result = result.replace(/%p/g, () => {
      const value = rowValues.shift()
      return typeof value === "object" ? serpent.block(value) : String(value)
    })
  }

  if (result.includes("%s")) {
    const rowValues = Array.isArray(params) ? params : [params]
    result = result.replace(/%s/g, () => {
      const value = rowValues.shift()
      // Native representation without serpent
      return String(value)
    })
  }

  // Fall back to existing string.format for other specifiers
  if (result.match(/%[dif]/)) {
    const rowValues = Array.isArray(params) ? params : [params]
    result = string.format(result, ...rowValues)
  }

  return result
}

function getNestedProperty(obj: any, path: string): unknown {
  return path.split('.').reduce((current, key) => current?.[key], obj)
}
```
## Files to Modify

| File | Changes |
|------|---------|
| `mod/factorio-test/setup-globals.ts` | Modify `createEachItems()` with template parser |
| `types/index.d.ts` | Update `.each()` type docs to document template syntax |
| `mod/factorio-test/test/meta.test.ts` | Add tests for new template syntax |

## Additional Options

Consider supporting:
- `${foo.bar}` - Nested property access
- `${foo:format}` - Custom format per property
- Fallback values: `${foo:-default}`
