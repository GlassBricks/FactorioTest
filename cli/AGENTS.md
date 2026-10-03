# CLI

## Configuration Architecture

Options are defined in `config/options.ts` (`optionDefs`).

- camelCase everywhere in CLI code and config files (Commander's native kebab → camel mapping)
- `forMod`: passed to the mod; converted to snake_case at that boundary (`toModConfig()` → `ModConfig`)
- `cliOnly`: not allowed in config files
- `isPath`: resolved relative to the config file
- Mod-side defaults live only in the mod (`mod/factorio-test/config.ts`); don't give `forMod` options a zod default
- Legacy `test: { snake_case }` config key is migrated in `loader.ts`

## Notes

- For user-visible changes, update changelog (CHANGELOG.md), under "Unreleased".
