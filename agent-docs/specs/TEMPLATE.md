<!--
How to use this template:

Sections are loosely ordered by stability and how much human review need, in this rough order:

0: Context, background facts
1: Goals, non-goals: plus "PRD", use cases or scenarios (user stories, etc.)
2: Functional spec: still user facing, in more detail
3: Verification: how acceptance criteria and rules are checked; handoff to impl ("done" = all hold)
4: Design:
   Modules, data types, state/error handling, etc.. Most consequential/load bearing first
5: Impl plan

General workflow:
1. Context + Goals. Gate: human agrees with goals and scenarios.
2. Functional spec drafted from scenarios. Check both directions: every scenario maps to rules,
   and every rule traces back to a scenario or goal (an orphan rule means scope creep or a missing
   goal).
3. Verification: agent drafts, human skims. Validate load-bearing external assumptions early
   (spike before design), since a wrong one can invalidate the design.
4. Design: agent drafts. Start with most load-bearing/design fork items first; human reviews rest.
5. Implement/verify. May use harness "plan" mode (plan is ephemeral).
   Agents may change design details (below functional spec), changing anything higher tier needs flagging/human approval, editing later.

Notes:
- Not a strict template, bend freely. Include an item only if useful, omit unused or empty sections. Add subsections as needed. Use what's most flexible or natural.
- Having enough detail to clarify intent and key decisions, not so much detail as to be pedantic to add review burden.
- Light commentary outside normative rules ok.
- Ensure plan is standalone or has pointers to needed external context.

Conventions:
- Normative rules have IDs (`AREA-n`), used for cross-references.
- `>` block quotes are informative, not normative (rationale, commentary)
- State each fact once; refer to it by ID elsewhere.
-->

# <Feature> — Spec

Problem / why now, in 2–5 lines.

## Background

External existing facts and constraints the design must respect.

## Goals

In priority order; the order settles tradeoffs between them.

- **G-1** …
- **G-2** …

### Non-goals

- **NG-1** … —

### Scenarios

Specify the "use cases" or "acceptance criteria".
Suggested format only; use what's most natural.

- **US-1** — [As a/When ...], I want ... So that ...
  - Optional elaboration.
  - Acceptance criteria: ... (include only if non-obvious/elaboration needed)

## Functional Spec

User visible behavior in more detail. Still what, not how.
Interface, expected behavior, messages, etc.
Give concrete examples of outputs if applicable.

### <Area>

- **AREA-1** Rule.
  > Optional rationale.

## Verification

How acceptance criteria and rules key get checked.
May be: automated (unit, integration, e2e, etc.), manual tests by agent or user

- Test's what's important or needs verification, skip what's trivial. Testing in aggregate should cover all important criteria, not a one-to-one mapping
- For automated tests, prefer testing at minimal module/interface boundaries
- Integration/e2e/manual tests needed to validate model against reality or external systems: check that external assumptions have test coverage.

### Automated testing

Unit, integration, or e2e tests; at what boundaries/modules

### Manual testing

Agent:

- ...

User:
(only include if not possible to do with agent)

- ...

## Design

Sketch the design.

- Record important choices: serious alternatives considered and rejected with rationale.
- Module boundaries: key signatures, data structures.
- Testability seams: interactions with other modules/systems (I/O, network, etc.), what gets faked
- State and error handling, key impl details, etc.

## Open Questions

## Notes

Any notes not directly related to current spec
Deferred work that may happen later.
