---@type TestCreator
test = nil
---@type TestCreator
it = nil
---@type DescribeCreator
describe = nil
---@type LifecycleFn
before_all = nil
---@type LifecycleFn
after_all = nil
---@type LifecycleFn
before_each = nil
---@type LifecycleFn
after_each = nil
---@type LifecycleFn
after_test = nil

---@param timeout number|nil
---@overload fun()
function async(timeout) end

function done() end

---@param func OnTickFn
function on_tick(func) end

---@param ticks number
---@param func TestFn
function after_ticks(ticks, func) end

---@param ticks number
function ticks_between_tests(ticks) end

---@vararg string
function tags(...) end

---@class FactorioTestConfig
---@field default_timeout number | nil
---@field default_ticks_between_tests number | nil
---@field game_speed number | nil
---@field log_passed_tests boolean | nil
---@field log_skipped_tests boolean | nil
---@field test_pattern string | nil
---@field tag_whitelist string[] | nil
---@field tag_blacklist string[] | nil
---@field before_test_run fun() | nil
---@field after_test_run fun() | nil
---@field sound_effects boolean | nil

---@alias TestFn fun(): void
---@alias HookFn TestFn
---@alias OnTickFn (fun(tick: number): void) | (fun(tick: number): boolean)

---@class TestCreatorBase
---@overload fun(name: string, func: TestFn): TestBuilder<TestFn>
local TestCreatorBase = {}

---@generic T
---@param values T[][]
---@return fun(name: string, func: fun(vararg T): void): void
---@overload fun<T>(values: T[]): fun(name: string, func: fun(v: T): void): void
function TestCreatorBase.each(values) end

---@class TestCreator : TestCreatorBase
---@overload fun(name: string, func: TestFn): TestBuilder<TestFn>
---@field skip TestCreatorBase
---@field only TestCreatorBase
local TestCreator = {
    ---@param name string
    todo = function(name)
    end
}

---@class TestBuilder<T>
local TestBuilder = {}

---@generic T
---@param func T
---@return TestBuilder<T>
function TestBuilder.after_script_reload(func) end

---@generic T
---@param func T
---@return TestBuilder<T>
function TestBuilder.after_mod_reload(func) end

---@class DescribeCreatorBase
---@overload fun(name: string, func: TestFn): void
local DescribeCreatorBase = {}

---@generic T
---@param values T[][]
---@return fun(name: string, func: fun(vararg T): void): void
---@overload fun<T>(values: T[]): fun(name: string, func: fun(v: T): void): void
function DescribeCreatorBase.each(values) end

---@class DescribeCreator : DescribeCreatorBase
---@overload fun(name: string, func: TestFn): void
---@field skip DescribeCreatorBase
---@field only DescribeCreatorBase

---@alias LifecycleFn fun(func: HookFn): void
