import { CliError } from "../cli-error.js"

export type DependencyKind = "required" | "unordered" | "recommended" | "optional" | "hidden-optional" | "incompatible"
export type VersionOp = "<" | "<=" | "=" | ">=" | ">"

export interface VersionConstraint {
  op: VersionOp
  version: string
}

export interface Dependency {
  kind: DependencyKind
  name: string
  constraint?: VersionConstraint
}

const PREFIX_KINDS: Record<string, DependencyKind> = {
  "": "required",
  "~": "unordered",
  "+": "recommended",
  "?": "optional",
  "(?)": "hidden-optional",
  "!": "incompatible",
}

const DEPENDENCY_PATTERN = /^\s*(\(\?\)|[~+?!])?\s*([\w\-. ]*?[\w\-.])\s*(?:(<=|>=|<|>|=)\s*(\d+(?:\.\d+){0,2}))?\s*$/

/** Parses an info.json dependency string: `[prefix] name [op version]`, spaces optional. */
export function parseDependency(spec: string): Dependency | undefined {
  const match = DEPENDENCY_PATTERN.exec(spec)
  if (!match) return undefined
  const [, prefix = "", name, op, version] = match
  const dependency: Dependency = { kind: PREFIX_KINDS[prefix]!, name: name! }
  if (op) dependency.constraint = { op: op as VersionOp, version: version! }
  return dependency
}

/** Parses info.json dependencies; invalid entries are an error naming the mod. */
export function parseDependencies(specs: readonly string[], modDescription: string): Dependency[] {
  return specs.map((spec) => {
    const dependency = parseDependency(spec)
    if (!dependency) throw new CliError(`Invalid dependency "${spec}" in info.json of ${modDescription}.`)
    return dependency
  })
}

const LEGACY_ENABLE_SPEC = /^\s*\S+\s*=\s*(?:true|false)\s*$/

/** Parses an entry of config `mods` / `--mods`. */
export function parseListedMod(spec: string, source: string): Dependency {
  if (LEGACY_ENABLE_SPEC.test(spec)) {
    throw new CliError(
      `"name=true|false" is no longer supported (got "${spec}" in ${source}). ` +
        `List "name" to enable it; unlisted mods are disabled. Use "!name" to leave out a recommended dependency.`,
    )
  }
  const dependency = parseDependency(spec)
  if (!dependency || (dependency.kind !== "required" && dependency.kind !== "incompatible")) {
    throw new CliError(`Invalid entry "${spec}" in mods (${source}): expected [!] name [op version].`)
  }
  return dependency
}

function versionParts(version: string): number[] {
  const parts = version.split(".").map(Number)
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0]
}

export function compareVersions(a: string, b: string): number {
  const aParts = versionParts(a)
  const bParts = versionParts(b)
  for (let i = 0; i < 3; i++) {
    const diff = aParts[i]! - bParts[i]!
    if (diff !== 0) return diff
  }
  return 0
}

export function satisfies(version: string, { op, version: target }: VersionConstraint): boolean {
  const cmp = compareVersions(version, target)
  switch (op) {
    case "<":
      return cmp < 0
    case "<=":
      return cmp <= 0
    case "=":
      return cmp === 0
    case ">=":
      return cmp >= 0
    case ">":
      return cmp > 0
  }
}

/** Major.minor of a version, as used by info.json `factorio_version`. */
export function majorMinor(version: string): string {
  const [major, minor] = versionParts(version)
  return `${major}.${minor}`
}

export function formatConstraint({ op, version }: VersionConstraint): string {
  return `${op} ${version}`
}
