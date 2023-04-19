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

---@vararg string
function tags(...) end

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

---@param func TestFn
function part(func) end


---@class TestorioConfig
---@field show_progress_gui boolean | nil
---@field default_timeout number | nil
---@field default_ticks_between_tests number | nil
---@field game_speed number | nil
---@field log_to_game boolean | nil
---@field log_to_DA boolean | nil
---@field log_to_log boolean | nil
-- @field log_passed_tests boolean | nil
-- @field log_skipped_tests boolean | nil
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
---@param name string
---@param func fun(vararg T): void
---@return TestBuilder<fun(vararg T): void>
---@overload fun<T>(values: T[], name: string, func: fun(v: T): void): TestBuilder<fun(v: T): void>
---@overload fun<T>(values: T[][]): fun(name: string, func: fun(vararg T): void): void
---@overload fun<T>(values: T[]): fun(name: string, func: fun(v: T): void): void
function TestCreatorBase.each(values, name, func) end

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

---@param func T
---@return TestBuilder<T>
function TestBuilder.after_script_reload(func) end

---@param func T
---@return TestBuilder<T>
function TestBuilder.after_mod_reload(func) end

---@class DescribeBlockCreatorBase
---@overload fun(name: string, func: TestFn): void
local DescribeCreatorBase = {}

---@generic T
---@param values T[][]
---@param name string
---@param func fun(vararg T): void
---@overload fun<T>(values: T[], name: string, func: fun(v: T): void): void
---@overload fun<T>(values: T[][]): fun(name: string, func: fun(vararg T): void): void
---@overload fun<T>(values: T[]): fun(name: string, func: fun(v: T): void): void
function DescribeCreatorBase.each(values, name, func) end

---@class DescribeCreator : DescribeCreatorBase
---@overload fun(name: string, func: TestFn): void
---@field skip DescribeCreator
---@field only DescribeCreator

---@alias LifecycleFn fun(func: HookFn): void
