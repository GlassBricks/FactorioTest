import { ColorArray, LocalisedString, LuaProfiler } from "factorio:runtime"
import { debugAdapterEnabled } from "./_util"
import { TestEventListener } from "./test-events"
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
  [MessageColor.Red]: [230, 60, 60],
  [MessageColor.Purple]: [177, 156, 220],
}
const ColorFormat: Record<MessageColor, string> = {} as any
for (const [code, color] of pairs(Colors)) {
  ColorFormat[code] = `[color=${color.join()}]`
}

interface MessagePart {
  text: string | LuaProfiler
  color?: MessageColor
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

interface RichAndPlainText {
  richText: LocalisedString
  plainText: string
  firstColor?: MessageColor | undefined
}

function formatError(text: string): RichAndPlainText {
  // replace tabs with 4 spaces in rich text
  const withSpaces = string.gsub(text, "\t", "    ")[0]
  // indent all lines by 4 spaces
  const withIndent = string.gsub(withSpaces, "\n", "\n    ")[0]
  return {
    richText: "    " + withIndent,
    plainText: text,
    firstColor: MessageColor.Red,
  }
}

function m(strings: TemplateStringsArray, ...substitutions: (string | LuaProfiler | MessagePart)[]): RichAndPlainText {
  const plainResult: string[] = []
  let richResult: ["", ...(string | LuaProfiler)[]] = [""]
  let firstColor: MessageColor | undefined = undefined

  let isString = true

  for (const i of $range(1, strings.length * 2 - 1)) {
    const element = i % 2 === 0 ? strings[i / 2] : substitutions[(i - 1) / 2]
    if (element === undefined) continue

    let color: MessageColor | undefined
    let part: string | LuaProfiler
    if (typeof element === "object") {
      if ("object_name" in element) {
        part = element
      } else {
        part = element.text
        color = element.color
        firstColor ??= color
      }
    } else {
      part = element
    }

    if (color) richResult.push(ColorFormat[color])
    const partIsStr = typeof part === "string"
    if (!partIsStr && isString) {
      richResult = ["", table.concat(richResult as string[])]
      isString = false
    }
    plainResult.push(partIsStr ? (part as string) : "<Profiler>")
    richResult.push(part)
    if (color) richResult.push("[/color]")
  }

  return {
    richText: richResult,
    plainText: table.concat(plainResult),
    firstColor,
  }
}

export type MessageHandler = (message: RichAndPlainText, source: Source | undefined) => void

const messageHandlers: MessageHandler[] = []

export function addMessageHandler(handler: MessageHandler): void {
  messageHandlers.push(handler)
}

function output(message: RichAndPlainText, source?: Source): void {
  for (const logHandler of messageHandlers) {
    logHandler(message, source)
  }
}

let daOutputEvent: typeof import("__debugadapter__/print").outputEvent | undefined
if (debugAdapterEnabled) {
  __DebugAdapter ??= {
    stepIgnore: (f: any) => f,
    stepIgnoreAll: (f: any) => f,
  } as any
  daOutputEvent = require("@NoResolution:__debugadapter__/print").outputEvent
}

type MessageCategory = "console" | "important" | "stdout" | "stderr"
const DebugAdapterCategories: Record<MessageColor, MessageCategory> = {
  [MessageColor.White]: "stdout",
  [MessageColor.Green]: "stdout",
  [MessageColor.Yellow]: "console",
  [MessageColor.Red]: "stderr",
  [MessageColor.Purple]: "console",
}

function printDebugAdapterText(text: string, source: Source | undefined, category: MessageCategory) {
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
    daOutputEvent!({
      category,
      output: line,
    })
    daOutputEvent!(
      { category, output: "\n" },
      sourceFile !== undefined
        ? {
            source: sourceFile,
            currentline: sourceLine ?? 1,
          }
        : undefined,
    )
  }
}

export const debugAdapterLogger: MessageHandler = (message, source) => {
  const color = message.firstColor ?? MessageColor.White
  const category = DebugAdapterCategories[color]
  printDebugAdapterText(message.plainText, source, category)
}

export const logLogger: MessageHandler = (message) => {
  print("FACTORIO-TEST-MESSAGE-START")
  log(message.plainText)
  print("FACTORIO-TEST-MESSAGE-END")
}

export const logListener: TestEventListener = (event, state) => {
  switch (event.type) {
    case "testRunStarted": {
      output(m`Starting test run...`)
      break
    }
    case "testPassed": {
      if (state.config.log_passed_tests) {
        const { test } = event
        output(
          m`${green("PASS")} ${test.path} (${test.profiler!}${
            test.tags.has("after_reload_mods") || test.tags.has("after_reload_script") ? " after reload" : ""
          })`,
          test.source,
        )
      }
      break
    }
    case "testFailed": {
      const { test } = event
      output(m`${red("FAIL")} ${test.path}`, test.source)
      for (const error of test.errors) {
        output(formatError(error))
      }
      break
    }
    case "testTodo": {
      const { test } = event
      output(m`${purple("TODO")} ${test.path}`, test.source)
      break
    }
    case "testSkipped": {
      if (state.config.log_skipped_tests) {
        const { test } = event
        output(m`${yellow("SKIP")} ${test.path}`, test.source)
      }
      break
    }
    case "describeBlockFailed": {
      const { block } = event
      output(m`${red("ERROR")} ${block.path}`, block.source)
      for (const error of block.errors) {
        output(formatError(error))
      }
      break
    }
    case "testRunFinished": {
      const results = state.results
      const status = results.status

      output(
        m`${{
          text: `Test run finished: ${status === "todo" ? "passed with todo tests" : status}`,
          color:
            status === "passed"
              ? MessageColor.Green
              : status === "failed"
              ? MessageColor.Red
              : status === "todo"
              ? MessageColor.Purple
              : MessageColor.White,
        }}`,
      )
      output(m`${state.profiler!}${state.reloaded ? " since last reload" : ""}`)
      break
    }
    case "loadError": {
      output(m`${red("ERROR")} There was an load error:`)
      output(formatError(state.rootBlock.errors[0]!))
      break
    }
  }
}
