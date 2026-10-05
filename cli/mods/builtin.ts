// Snapshot of the mods shipped with the game, from their info.json in Factorio 2.1.
// The game's data dir can't be located reliably (wrapper scripts), so it's not read.
export const BUILTIN_MODS: Readonly<Record<string, readonly string[]>> = {
  base: [],
  recycler: ["base"],
  "elevated-rails": ["base"],
  quality: ["base", "recycler"],
  "space-age": ["base", "elevated-rails", "recycler", "+ quality"],
}

export function isBuiltinMod(name: string): boolean {
  return Object.hasOwn(BUILTIN_MODS, name)
}
