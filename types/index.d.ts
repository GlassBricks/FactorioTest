/** @noSelfInFile */

declare var test: FactorioTest.TestCreator
declare var it: FactorioTest.TestCreator
declare var describe: FactorioTest.DescribeCreator
declare var before_all: FactorioTest.LifecycleFn
declare var after_all: FactorioTest.LifecycleFn
declare var before_each: FactorioTest.LifecycleFn
declare var after_each: FactorioTest.LifecycleFn
declare var after_test: FactorioTest.LifecycleFn
declare function async(timeout?: number): void
declare function done(): void
declare function on_tick(func: FactorioTest.OnTickFn): void
declare function after_ticks(ticks: number, func: FactorioTest.TestFn): void
declare function ticks_between_tests(ticks: number): void
declare function tags(...tags: string[]): void

/** @noSelf */
declare namespace FactorioTest {
  interface Config {
    test_pattern?: string
    tag_whitelist?: string[]
    tag_blacklist?: string[]
    default_timeout: number
    game_speed: number
    log_passed_tests: boolean
    log_skipped_tests: boolean
    reorder_failed_first: boolean
    bail?: number

    /**
     * Walk the run: pause before each test, and before each part declared with
     * {@link TestBuilder.step}, until the user continues from the test GUI.
     *
     * Only supported when running with graphics; ignored (with a warning) in headless mode.
     * While stepping, `game_speed` is forced to 1 and the world is held still between steps.
     */
    step: boolean

    default_ticks_between_tests: number
    before_test_run?(): void
    after_test_run?(): void
    sound_effects: boolean
    load_luassert: boolean
  }

  type TestFn = () => void
  type HookFn = TestFn
  type OnTickFn = (tick: number) => void | boolean

  type MutableValues<A extends readonly any[]> = {
    -readonly [K in keyof A]: A[K]
  }

  /** @noSelf */
  interface TestCreatorBase {
    (name: string, func: TestFn): TestBuilder

    /**
     * Template syntax for name parameter:
     * - `$property` - Access object property (when value is an object)
     * - `$foo.bar` - Nested property access
     * - `%#` - 0-based test index
     * - `%$` - 1-based test index
     * - `%p` - Pretty-format value
     * - `%d`, `%s`, etc. - Lua format specifiers
     */
    each<const V extends readonly any[]>(
      values: readonly V[],
    ): (name: string, func: (...values: MutableValues<V>) => void) => TestBuilder<typeof func>
    each<const T>(values: readonly T[]): (name: string, func: (value: T) => void) => TestBuilder<typeof func>
  }

  /** @noSelf */
  interface TestCreator extends TestCreatorBase {
    skip: TestCreatorBase
    only: TestCreatorBase
    todo(name: string): void
  }

  /** @noSelf */
  export interface TestBuilder<F extends (this: void, ...args: any) => void = TestFn> {
    after_reload_script(func: F): TestBuilder<F>
    after_reload_mods(func: F): TestBuilder<F>

    /**
     * Adds another part to this test, with a caption describing what it does.
     *
     * Parts run back-to-back, exactly like the rest of the test body, unless step mode is on
     * (`step` config option / `--step` CLI flag). In step mode the run pauses before this
     * part, showing the caption in the test GUI, until the user chooses to continue.
     *
     * @example
     * test("connects an underground pipe", () => {
     *   placeUnderground()
     * })
     *   .step("place the covering tile", () => {
     *     placeTile()
     *   })
     *   .step("check the connector", () => {
     *     assertConnected()
     *   })
     */
    step(caption: string, func: F): TestBuilder<F>
  }

  /** @noSelf */
  interface DescribeBlockCreatorBase {
    (name: string, func: TestFn): void

    /**
     * Template syntax for name parameter:
     * - `$property` - Access object property (when value is an object)
     * - `$foo.bar` - Nested property access
     * - `%#` - 0-based test index
     * - `%$` - 1-based test index
     * - `%p` - Pretty-format value
     * - `%d`, `%s`, etc. - Lua format specifiers
     */
    each<const V extends readonly any[]>(
      values: readonly V[],
    ): (name: string, func: (this: void, ...values: MutableValues<V>) => void) => void
    each<const T>(values: readonly T[]): (name: string, func: (value: T) => void) => void
  }

  /** @noSelf */
  interface DescribeCreator extends DescribeBlockCreatorBase {
    skip: DescribeBlockCreatorBase
    only: DescribeBlockCreatorBase
  }

  type LifecycleFn = (func: HookFn) => void
}

/** @noResolution */
declare module "__factorio-test__/init" {
  function init(this: void, files: string[], config?: Partial<FactorioTest.Config>): void
  export = init
}
