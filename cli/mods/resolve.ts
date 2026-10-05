import { CliError } from "../cli-error.js"
import { type Dependency, type DependencyKind, formatConstraint, majorMinor, satisfies } from "./dependency.js"
import type { PortalRelease } from "./portal.js"

export type CandidateOrigin = "builtin" | "mut" | "user-managed" | "locked" | "installed" | "portal"

export interface Candidate {
  name: string
  version: string
  factorioVersion: string
  dependencies: Dependency[]
  origin: CandidateOrigin
  /** False: needs download. */
  installed: boolean
  /** Portal release to download, if not installed. */
  release?: PortalRelease
}

export interface CandidateSource {
  /** Ordered by preference; fixed mods yield exactly one. */
  candidates(name: string): AsyncIterable<Candidate>
  /** Reason a mod has no candidates at all, e.g. `No mod named "x" on the mod portal`. */
  describeMissing(name: string): string
}

export interface Requirement {
  dependency: Dependency
  /** Who imposed it, e.g. `config mods`, `foo 1.3.0`. */
  from: string
  /** Name of the mod that imposed it, if any. */
  fromMod?: string
}

export interface GameInfo {
  version: string
  executable: string
}

export interface Resolution {
  /** Enabled mods, in the order they were chosen. */
  enabled: Map<string, Candidate>
  /** Everything imposed on each mod: requirements, constraints and incompatibilities. */
  imposed: ReadonlyMap<string, readonly Requirement[]>
}

const ENABLING_KINDS: ReadonlySet<DependencyKind> = new Set(["required", "unordered", "recommended"])
const HARD_KINDS: ReadonlySet<DependencyKind> = new Set(["required", "unordered"])

export function describeCandidate(candidate: Pick<Candidate, "name" | "version">): string {
  return `${candidate.name} ${candidate.version}`
}

/**
 * Greedy breadth-first resolution: each mod's version is chosen once, when first reached.
 */
export function resolve(requirements: Requirement[], source: CandidateSource, game: GameInfo): Promise<Resolution> {
  return new Resolver(source, game).run(requirements)
}

class Resolver {
  private readonly imposed = new Map<string, Requirement[]>()
  private readonly chosen = new Map<string, Candidate>()
  private readonly excluded = new Set<string>()
  private readonly queue: string[] = []
  private readonly gameMajorMinor: string

  constructor(
    private readonly source: CandidateSource,
    private readonly game: GameInfo,
  ) {
    this.gameMajorMinor = majorMinor(game.version)
  }

  async run(requirements: Requirement[]): Promise<Resolution> {
    for (const requirement of requirements) {
      if (requirement.dependency.kind === "incompatible") this.excluded.add(requirement.dependency.name)
    }
    for (const requirement of requirements) this.impose(requirement)

    for (let name = this.queue.shift(); name !== undefined; name = this.queue.shift()) {
      if (this.chosen.has(name) || this.excluded.has(name)) continue
      this.choose(await this.findCandidate(name))
    }

    this.checkFinal()
    return { enabled: this.chosen, imposed: this.imposed }
  }

  private impose(requirement: Requirement): void {
    const { name, kind } = requirement.dependency
    const list = this.imposed.get(name) ?? []
    list.push(requirement)
    this.imposed.set(name, list)
    if (ENABLING_KINDS.has(kind) && !this.excluded.has(name)) this.queue.push(name)
  }

  private async findCandidate(name: string): Promise<Candidate> {
    const constraints = this.versionConstraints(name)
    let sawAny = false
    for await (const candidate of this.source.candidates(name)) {
      sawAny = true
      if (candidate.origin === "mut") this.checkMutGameVersion(candidate)
      if (candidate.factorioVersion !== this.gameMajorMinor) continue
      if (constraints.every(({ dependency }) => satisfies(candidate.version, dependency.constraint!))) {
        return candidate
      }
    }
    if (!sawAny) throw new CliError(`${this.source.describeMissing(name)} (required by ${this.enablers(name)}).`)
    throw this.noVersionError(name)
  }

  private choose(candidate: Candidate): void {
    this.chosen.set(candidate.name, candidate)
    const from = describeCandidate(candidate)
    for (const dependency of candidate.dependencies) this.impose({ dependency, from, fromMod: candidate.name })
  }

  private checkMutGameVersion(candidate: Candidate): void {
    if (candidate.factorioVersion === this.gameMajorMinor) return
    throw new CliError(
      `${candidate.name} requires Factorio ${candidate.factorioVersion}, but the Factorio found is ${this.game.version} (${this.game.executable}).\n` +
        "Use --factorio-path to choose a different installation.",
    )
  }

  private checkFinal(): void {
    for (const [name, requirements] of this.imposed) {
      const target = this.chosen.get(name)
      if (this.excluded.has(name)) this.checkExcluded(name, requirements)
      if (!target) continue
      for (const requirement of requirements) {
        const { kind, constraint } = requirement.dependency
        if (kind === "incompatible") throw this.incompatibleError(name, requirement)
        if (constraint && !satisfies(target.version, constraint)) throw this.violatedError(target, requirement)
      }
    }
  }

  private checkExcluded(name: string, requirements: Requirement[]): void {
    const hard = requirements.find(({ dependency }) => HARD_KINDS.has(dependency.kind))
    if (!hard) return
    const exclusion = requirements.find(({ dependency }) => dependency.kind === "incompatible")!
    throw new CliError(`"${name}" (required by ${hard.from}) is excluded by "!${name}" in ${exclusion.from}.`)
  }

  private versionConstraints(name: string): Requirement[] {
    return (this.imposed.get(name) ?? []).filter(
      ({ dependency }) => dependency.constraint && dependency.kind !== "incompatible",
    )
  }

  private enablingRequirements(name: string): Requirement[] {
    return (this.imposed.get(name) ?? []).filter(({ dependency }) => ENABLING_KINDS.has(dependency.kind))
  }

  private enablers(name: string): string {
    return [...new Set(this.enablingRequirements(name).map(({ from }) => from))].join(", ")
  }

  private recommendedOnlyHint(name: string): string {
    const enabling = this.enablingRequirements(name)
    const recommendedOnly = enabling.length > 0 && enabling.every(({ dependency }) => dependency.kind === "recommended")
    return recommendedOnly
      ? `\n"${name}" is only a recommended dependency; list "!${name}" in mods to leave it out.`
      : ""
  }

  private formatConstraints(name: string): string {
    return this.versionConstraints(name)
      .map(({ dependency, from }) => `${formatConstraint(dependency.constraint!)} (from ${from})`)
      .join(", ")
  }

  private noVersionError(name: string): CliError {
    const constraints = this.formatConstraints(name)
    const message = constraints
      ? `No version of "${name}" satisfies: ${constraints}, for Factorio ${this.gameMajorMinor}.`
      : `No version of "${name}" is available for Factorio ${this.gameMajorMinor} (required by ${this.enablers(name)}).`
    return new CliError(message + this.recommendedOnlyHint(name))
  }

  private violatedError(target: Candidate, requirement: Requirement): CliError {
    const { name, version, origin } = target
    const constraint = formatConstraint(requirement.dependency.constraint!)
    const constrainedByUser = this.versionConstraints(name).some(({ fromMod }) => fromMod === undefined)
    const fix = constrainedByUser
      ? `constraints on "${name}": ${this.formatConstraints(name)}.`
      : `list "${name} ${constraint}" in mods to choose a matching version.`
    return new CliError(
      `"${name}" ${version} (${origin}) was chosen before ${requirement.from} required ${constraint}; ${fix}` +
        this.recommendedOnlyHint(name),
    )
  }

  private incompatibleError(name: string, requirement: Requirement): CliError {
    const otherName = requirement.fromMod!
    const otherEnablers = this.enablers(otherName)
    return new CliError(
      `"${name}" (required by ${this.enablers(name)}) is incompatible with "${otherName}" (required by ${otherEnablers}).` +
        this.recommendedOnlyHint(name) +
        this.recommendedOnlyHint(otherName),
    )
  }
}
