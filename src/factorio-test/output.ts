import { debugAdapterEnabled } from "./_util"
import { TestListener } from "./testEvents"
import { Source } from "./tests"

export const enum MessageColor {
  White = 1,
  Green,
  Yellow,
  Red,
  Purple,
}
export const Colors: Record<MessageColor, ColorArray> = {
  [MessageColor.White]: [1, 1, 1],
  [MessageColor.Green]: [71, 221, 37],
  [MessageColor.Yellow]: [252, 237, 50],
  [MessageColor.Red]: [200, 50, 50],
  [MessageColor.Purple]: [177, 156, 220],
}
const ColorFormat: Record<MessageColor, string> = {} as any
for (const [code, color] of pairs(Colors)) {
  ColorFormat[code] = `[color=${color.join()}]`
}

interface MessagePart {
  text: string | LuaProfiler
  color?: MessageColor
  bold?: boolean
}

function bold(text: string): MessagePart {
  return {
    text,
    bold: true,
  }
}

function red(text: string): MessagePart {
  return {
    text,
    color: MessageColor.Red,
  }
}

function yellow(text: string): MessagePart {
  return {
    text,
    color: MessageColor.Yellow,
  }
}

function green(text: string): MessagePart {
  return {
    text,
    color: MessageColor.Green,
  }
}

function purple(text: string): MessagePart {
  return {
    text,
    color: MessageColor.Purple,
  }
}

function m(
  strings: TemplateStringsArray,
  ...substitutions: (string | number | LuaProfiler | MessagePart)[]
): MessagePart[] {
  const result: MessagePart[] = []
  for (const i of $range(1, strings.length * 2 - 1)) {
    const item = i % 2 === 0 ? strings[i / 2] : substitutions[(i - 1) / 2]
    if (typeof item === "object" && !(item as LuaProfiler).object_name) {
      result.push(item as MessagePart)
    } else {
      result.push({ text: item as string })
    }
  }
  return result
}

export function joinToPlainText(parts: MessagePart[]): LocalisedString {
  let isString = true
  let result: ["", ...string[]] = [""]
  for (const part of parts) {
    if (typeof part.text !== "object") {
      result.push(part.text)
    } else {
      if (isString) result = ["", table.concat(result), part.text as never]
      isString = false
    }
  }
  return isString ? table.concat(result) : result
}

export function joinToRichText(parts: MessagePart[]): LocalisedString {
  let isString = true
  let result: ["", ...string[]] = [""]
  for (const part of parts) {
    if (part.bold) result.push("[font=default-bold]")
    if (part.color) result.push(ColorFormat[part.color])
    if (typeof part.text !== "object") {
      result.push(part.text)
    } else {
      if (isString) result = ["", table.concat(result), part.text as never]
      isString = false
    }
    if (part.color) result.push("[/color]")
    if (part.bold) result.push("[/font]")
  }
  return isString ? table.concat(result) : result
}

export type LogHandler = (message: MessagePart[], source: Source | undefined) => void

const logHandlers: LogHandler[] = []

export function addLogHandler(handler: LogHandler): void {
  logHandlers.push(handler)
}

function testLog(message: MessagePart[], source?: Source): void {
  for (const logHandler of logHandlers) {
    logHandler(message, source)
  }
}
const jsonEncode: typeof import("__debugadapter__/json").encode = !debugAdapterEnabled
  ? undefined
  : require("@NoResolution:__debugadapter__/json").encode
const daTranslate: typeof import("__debugadapter__/variables").translate = !debugAdapterEnabled
  ? undefined
  : __DebugAdapter
  ? require("@NoResolution:__debugadapter__/variables").translate
  : (() => {
      let id = 0
      return (message) => {
        const translationID = id++
        const [success, result] = pcall(localised_print, [
          "",
          "***DebugAdapterBlockPrint***\nDBGtranslate: ",
          translationID,
          "\n",
          message,
          "\n***EndDebugAdapterBlockPrint***",
        ])
        return success ? translationID : (result as string)
      }
    })()

const DebugAdapterCategories: Record<MessageColor, string> = {
  [MessageColor.White]: "stdout",
  [MessageColor.Green]: "stdout",
  [MessageColor.Yellow]: "console",
  [MessageColor.Red]: "stderr",
  [MessageColor.Purple]: "console",
}
function printDebugAdapterText(text: string, source: Source | undefined, category: string) {
  const lines = text.split("\n")
  for (const line of lines) {
    let sourceFile: string | undefined, sourceLine: number | undefined
    if (source) {
      sourceFile = source.file
      sourceLine = source.line
      source = undefined
    } else {
      const [, , file1, line1] = string.find(line, "(__[%w%-_]+__/.-%.%a+):(%d*)")
      sourceFile = file1 as string
      sourceLine = tonumber(line1)
    }
    if (sourceFile && !sourceFile.startsWith("@")) sourceFile = "@" + sourceFile
    const body = {
      category,
      output: line,
      line: sourceFile && (sourceLine ?? 1),
      source: {
        name: sourceFile,
        path: sourceFile,
      },
    }

    print("DBGprint: " + jsonEncode!(body))
  }
}
export const debugAdapterLogger: LogHandler = (message, source) => {
  const color = message.find((x) => x.color)?.color ?? MessageColor.White
  const category = DebugAdapterCategories[color]
  const text = joinToPlainText(message)
  const output = typeof text === "string" ? text : `{LocalisedString ${daTranslate(text)}}`
  printDebugAdapterText(output, source, category)
}

export const logLogger: LogHandler = (message) => {
  log(joinToPlainText(message))
}

export const logListener: TestListener = (event, state) => {
  switch (event.type) {
    case "testPassed": {
      if (state.config.log_passed_tests) {
        const { test } = event
        testLog(
          m`${bold(test.path)} ${green("passed")} (${test.profiler!}${
            test.tags.has("after_mod_reload") || test.tags.has("after_script_reload") ? " after reload" : ""
          })`,
          test.source,
        )
      }
      break
    }
    case "testFailed": {
      const { test } = event
      testLog(m`${bold(test.path)} ${red("failed")}`, test.source)
      for (const error of test.errors) {
        testLog([red(error)])
      }
      break
    }
    case "testTodo": {
      const { test } = event
      testLog(m`${bold(test.path)}: ${purple("todo")}`, test.source)
      break
    }
    case "testSkipped": {
      if (state.config.log_skipped_tests) {
        const { test } = event
        testLog(m`${bold(test.path)}: ${yellow("skipped")}`, test.source)
      }
      break
    }
    case "describeBlockFailed": {
      const { block } = event
      testLog(m`${bold(block.path)} ${red("error")}`, block.source)
      for (const error of block.errors) {
        testLog([red(error)])
      }
      break
    }
    case "testRunFinished": {
      const results = state.results
      const status = results.status

      testLog([
        {
          text: `\nTest run finished: ${status === "todo" ? "passed with todo tests" : status}`,
          bold: true,
          color:
            status === "passed"
              ? MessageColor.Green
              : status === "failed"
              ? MessageColor.Red
              : status === "todo"
              ? MessageColor.Purple
              : MessageColor.White,
        },
      ])
      testLog(m`${state.profiler!}${state.reloaded ? " since last reload" : ""}`)

      const runSummary: MessagePart[] = []

      if (results.describeBlockErrors > 0) {
        runSummary.push({
          text: `${results.describeBlockErrors} describe block errors\n`,
          color: MessageColor.Red,
          bold: true,
        })
      }
      runSummary.push(bold(`Ran ${results.ran} tests total\n`))
      if (results.failed > 0) {
        runSummary.push(red(`${results.failed} failed\n`))
      }
      if (results.skipped > 0) {
        runSummary.push(yellow(`${results.skipped} skipped\n`))
      }
      if (results.todo > 0) {
        runSummary.push(purple(`${results.todo} todo\n`))
      }
      if (results.passed > 0) {
        runSummary.push(green(`${results.passed} passed\n`))
      }
      testLog(runSummary)
      break
    }
    case "loadError": {
      testLog([
        {
          text: "There was an load error:",
          bold: true,
          color: MessageColor.Red,
        },
      ])
      testLog([red(state.rootBlock.errors[0]!)])
      break
    }
  }
}
