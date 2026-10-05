import { describe, expect, it } from "vitest"
import { parseDependency, parseListedMod } from "./dependency.js"
import { type Candidate, type CandidateOrigin, type CandidateSource, resolve, type Requirement } from "./resolve.js"

const game = { version: "2.1.20", executable: "/opt/factorio/bin/x64/factorio" }

interface FakeMod {
  version: string
  deps?: string[]
  origin?: CandidateOrigin
  factorioVersion?: string
}

/** In-memory source: candidates yielded in the given order (= preference). */
class FakeSource implements CandidateSource {
  readonly requested: string[] = []

  constructor(private readonly mods: Record<string, FakeMod[]>) {}

  async *candidates(name: string): AsyncIterable<Candidate> {
    this.requested.push(name)
    for (const mod of this.mods[name] ?? []) {
      yield {
        name,
        version: mod.version,
        factorioVersion: mod.factorioVersion ?? "2.1",
        dependencies: (mod.deps ?? []).map((spec) => parseDependency(spec)!),
        origin: mod.origin ?? "installed",
        installed: true,
      }
    }
  }

  describeMissing(name: string): string {
    return `No mod named "${name}" on the mod portal`
  }
}

const baseMods: Record<string, FakeMod[]> = {
  base: [{ version: "2.1.20", origin: "builtin" }],
  "factorio-test": [{ version: "3.1.1" }],
  recycler: [{ version: "2.1.20", origin: "builtin", deps: ["base"] }],
  quality: [{ version: "2.1.20", origin: "builtin", deps: ["base", "recycler"] }],
  "elevated-rails": [{ version: "2.1.20", origin: "builtin", deps: ["base"] }],
  "space-age": [{ version: "2.1.20", origin: "builtin", deps: ["base", "elevated-rails", "recycler", "+ quality"] }],
}

function mut(deps: string[]): Record<string, FakeMod[]> {
  return { "my-mod": [{ version: "1.0.0", origin: "mut", deps }] }
}

function requirements(listed: string[] = []): Requirement[] {
  return [
    { dependency: { kind: "required", name: "base" }, from: "factorio-test-cli" },
    { dependency: parseDependency("factorio-test >= 3.1.1")!, from: "factorio-test-cli" },
    { dependency: { kind: "required", name: "my-mod" }, from: "mod under test" },
    ...listed.map((spec) => ({ dependency: parseListedMod(spec, "config mods"), from: "config mods" })),
  ]
}

async function resolveVersions(
  mods: Record<string, FakeMod[]>,
  mutDeps: string[],
  listed: string[] = [],
): Promise<Record<string, string>> {
  const source = new FakeSource({ ...baseMods, ...mut(mutDeps), ...mods })
  const { enabled } = await resolve(requirements(listed), source, game)
  return Object.fromEntries([...enabled.values()].map(({ name, version }) => [name, version]))
}

const core = { base: "2.1.20", "factorio-test": "3.1.1", "my-mod": "1.0.0" }

describe("resolve", () => {
  it.each<[string, Record<string, FakeMod[]>, string[], string[], Record<string, string>]>([
    ["only the core requirements", {}, [], [], core],
    [
      "transitive required and ~ dependencies",
      {
        a: [{ version: "1.0.0", deps: ["~ b"] }],
        b: [{ version: "2.0.0", deps: ["c >= 1"] }],
        c: [{ version: "1.5.0" }],
      },
      ["a"],
      [],
      { ...core, a: "1.0.0", b: "2.0.0", c: "1.5.0" },
    ],
    [
      "optional dependencies are not enabled",
      { a: [{ version: "1.0.0", deps: ["? b", "(?) c"] }], b: [{ version: "1.0.0" }], c: [{ version: "1.0.0" }] },
      ["a"],
      [],
      { ...core, a: "1.0.0" },
    ],
    [
      "first candidate satisfying constraints (source order)",
      { a: [{ version: "1.0.0" }, { version: "2.0.0" }, { version: "0.5.0" }] },
      ["a >= 1.5"],
      [],
      { ...core, a: "2.0.0" },
    ],
    [
      "listed constraint known before the mod is chosen",
      { a: [{ version: "1.0.0", deps: ["b"] }], b: [{ version: "3.0.0" }, { version: "2.0.0" }] },
      ["a"],
      ["b < 3"],
      { ...core, a: "1.0.0", b: "2.0.0" },
    ],
    [
      "constraints of a chosen version apply to later choices",
      {
        a: [{ version: "1.0.0", deps: ["b", "c"] }],
        b: [{ version: "1.0.0", deps: ["? c < 2"] }],
        c: [{ version: "2.0.0" }, { version: "1.0.0" }],
      },
      ["a"],
      [],
      { ...core, a: "1.0.0", b: "1.0.0", c: "1.0.0" },
    ],
    [
      "skips versions for another game version",
      { a: [{ version: "2.0.0", factorioVersion: "2.0" }, { version: "1.0.0" }] },
      ["a"],
      [],
      { ...core, a: "1.0.0" },
    ],
    [
      "listed DLC with its dependencies",
      {},
      [],
      ["space-age"],
      { ...core, "space-age": "2.1.20", "elevated-rails": "2.1.20", recycler: "2.1.20", quality: "2.1.20" },
    ],
    [
      "! leaves out a recommended dependency",
      {},
      [],
      ["space-age", "!quality"],
      { ...core, "space-age": "2.1.20", "elevated-rails": "2.1.20", recycler: "2.1.20" },
    ],
  ])("%s", async (_, mods, mutDeps, listed, expected) => {
    expect(await resolveVersions(mods, mutDeps, listed)).toEqual(expected)
  })

  it("chooses breadth-first, in requirement order", async () => {
    const source = new FakeSource({
      ...baseMods,
      ...mut(["a", "b"]),
      a: [{ version: "1.0.0", deps: ["c"] }],
      b: [{ version: "1.0.0" }],
      c: [{ version: "1.0.0" }],
    })
    await resolve(requirements(), source, game)
    expect(source.requested).toEqual(["base", "factorio-test", "my-mod", "a", "b", "c"])
  })

  it("does not ask the source for optional dependencies", async () => {
    const source = new FakeSource({ ...baseMods, ...mut(["a"]), a: [{ version: "1.0.0", deps: ["? b"] }] })
    await resolve(requirements(), source, game)
    expect(source.requested).not.toContain("b")
  })

  it.each<[string, Record<string, FakeMod[]>, string[], string[], string]>([
    [
      "no version satisfies constraints",
      { foo: [{ version: "1.3.0", deps: ["bar >= 2.0"] }], bar: [{ version: "1.0.0" }, { version: "2.5.0" }] },
      [],
      ["foo", "bar < 2.0"],
      'No version of "bar" satisfies: < 2.0 (from config mods), >= 2.0 (from foo 1.3.0), for Factorio 2.1.',
    ],
    [
      "no version for the game version",
      { foo: [{ version: "1.0.0", factorioVersion: "2.0" }] },
      ["foo"],
      [],
      'No version of "foo" is available for Factorio 2.1 (required by my-mod 1.0.0).',
    ],
    [
      "recommended-only dependency suggests !name",
      { foo: [{ version: "1.0.0", deps: ["+ bar >= 2"] }], bar: [{ version: "1.0.0" }] },
      ["foo"],
      [],
      'list "!bar" in mods to leave it out',
    ],
    [
      "missing mod names who required it",
      {},
      ["flb"],
      [],
      'No mod named "flb" on the mod portal (required by my-mod 1.0.0).',
    ],
    [
      "factorio-test below minimum",
      { "factorio-test": [{ version: "3.0.0" }] },
      [],
      [],
      'No version of "factorio-test" satisfies: >= 3.1.1 (from factorio-test-cli), for Factorio 2.1.',
    ],
    [
      "constraint violated by an earlier choice",
      {
        a: [{ version: "1.0.0", deps: ["c", "b"] }],
        b: [{ version: "1.0.0", deps: ["c >= 2"] }],
        c: [{ version: "1.0.0" }, { version: "2.0.0" }],
      },
      ["a"],
      [],
      '"c" 1.0.0 (installed) was chosen before b 1.0.0 required >= 2; list "c >= 2" in mods to choose a matching version.',
    ],
    [
      "incompatibility names who required each side",
      {
        foo: [{ version: "1.3.0", deps: ["bar"] }],
        bar: [{ version: "1.0.0" }],
        baz: [{ version: "1.0.0", deps: ["! bar"] }],
      },
      ["foo"],
      ["baz"],
      '"bar" (required by foo 1.3.0) is incompatible with "baz" (required by config mods).',
    ],
    [
      "excluding a required dependency",
      {},
      [],
      ["quality", "!recycler"],
      '"recycler" (required by quality 2.1.20) is excluded by "!recycler" in config mods.',
    ],
  ])("error: %s", async (_, mods, mutDeps, listed, message) => {
    await expect(resolveVersions(mods, mutDeps, listed)).rejects.toThrow(message)
  })

  it("errors if the mod under test is for another game version", async () => {
    const mods = { "my-mod": [{ version: "1.0.0", origin: "mut" as const, factorioVersion: "2.0" }] }
    const source = new FakeSource({ ...baseMods, ...mods })
    await expect(resolve(requirements(), source, game)).rejects.toThrow(
      "my-mod requires Factorio 2.0, but the Factorio found is 2.1.20 (/opt/factorio/bin/x64/factorio).\n" +
        "Use --factorio-path to choose a different installation.",
    )
  })
})
