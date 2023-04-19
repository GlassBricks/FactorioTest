/** @noSelfInFile */
/// <reference types="luassert-tstl" />

declare var test: FactorioTest.TestCreator
declare var it: FactorioTest.TestCreator
declare var describe: FactorioTest.DescribeCreator
declare var before_all: FactorioTest.Lifecycle
declare var after_all: FactorioTest.Lifecycle
declare var before_each: FactorioTest.Lifecycle
declare var after_each: FactorioTest.Lifecycle
declare var after_test: FactorioTest.Lifecycle
declare function async(timeout?: number): void
declare function done(): void
declare function on_tick(func: FactorioTest.OnTickFn): void
declare function after_ticks(ticks: number, func: FactorioTest.TestFn): void
declare function ticks_between_tests(ticks: number): void
declare function tags(...tags: string[]): void

/** @noSelf */
declare namespace FactorioTest {
  interface Config {
    show_progress_gui: boolean

    default_timeout: number
    default_ticks_between_tests: number

    game_speed: number

    log_to_game: boolean
    log_to_DA: boolean
    log_to_log: boolean

    log_passed_tests: boolean
    log_skipped_tests: boolean

    test_pattern?: string
    tag_whitelist?: string[]
    tag_blacklist?: string[]

    before_test_run?(): void
    after_test_run?(): void

    sound_effects: boolean
  }

  type TestFn = () => void
  type HookFn = TestFn
  type OnTickFn = (tick: number) => void | boolean

  /** @noSelf */
  interface TestCreatorBase {
    (name: string, func: TestFn): TestBuilder

    each<V extends any[]>(
      values: readonly V[],
    ): (name: string, func: (...values: V) => void) => TestBuilder<typeof func>
    each<T>(values: readonly T[]): (name: string, func: (value: T) => void) => TestBuilder<typeof func>

    each<V extends any[]>(values: readonly V[], name: string, func: (...values: V) => void): TestBuilder<typeof func>
    each<T>(values: readonly T[], name: string, func: (value: T) => void): TestBuilder<typeof func>
  }

  /** @noSelf */
  interface TestCreator extends TestCreatorBase {
    skip: TestCreatorBase
    only: TestCreatorBase
    todo(name: string): void
  }

  /** @noSelf */
  export interface TestBuilder<F extends (...args: any) => void = TestFn> {
    after_script_reload(func: F): TestBuilder<F>
    after_mod_reload(func: F): TestBuilder<F>
  }

  /** @noSelf */
  interface DescribeCreatorBase {
    (name: string, func: TestFn): void

    each<V extends any[]>(values: readonly V[]): (name: string, func: (...values: V) => void) => void
    each<T>(values: readonly T[]): (name: string, func: (value: T) => void) => void

    each<V extends any[]>(values: readonly V[], name: string, func: (...values: V) => void): void
    each<T>(values: readonly T[], name: string, func: (value: T) => void): void
  }

  /** @noSelf */
  interface DescribeCreator extends DescribeCreatorBase {
    skip: DescribeCreatorBase
    only: DescribeCreatorBase
  }

  type Lifecycle = (func: HookFn) => void
}
