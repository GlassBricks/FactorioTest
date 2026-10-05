import { majorMinor } from "./dependency.js"

type BuiltinMods = Readonly<Record<string, readonly string[]>>

// Snapshots of the mods shipped with the game, from their info.json.
// The game's data dir can't be located reliably (wrapper scripts), so it's not read.
const BUILTIN_MODS_2_0: BuiltinMods = {
  base: [],
  "elevated-rails": ["base"],
  quality: ["base"],
  "space-age": ["base", "elevated-rails", "quality"],
}

const BUILTIN_MODS_2_1: BuiltinMods = {
  base: [],
  recycler: ["base"],
  "elevated-rails": ["base"],
  quality: ["base", "recycler"],
  "space-age": ["base", "elevated-rails", "recycler", "+ quality"],
}

/** Builtin mod names to their dependencies, for a game version. Unknown versions use the latest snapshot. */
export function builtinMods(gameVersion: string): BuiltinMods {
  return majorMinor(gameVersion) === "2.0" ? BUILTIN_MODS_2_0 : BUILTIN_MODS_2_1
}

export function isBuiltinMod(name: string, gameVersion: string): boolean {
  return Object.hasOwn(builtinMods(gameVersion), name)
}
