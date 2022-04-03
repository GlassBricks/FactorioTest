import { Locale, Prototypes } from "../shared-constants"
import { Colors, joinToRichText, LogHandler, MessageColor } from "./output"
import { RunResults } from "./result"
import { TestState } from "./state"
import { TestListener } from "./testEvents"
import { countActiveTests } from "./tests"
import ProgressGui = Locale.ProgressGui

interface TestProgressGui {
  player: LuaPlayer
  statusText: LabelGuiElement
  progressBar: ProgressBarGuiElement
  progressLabel: LabelGuiElement
  testCounts: TableGuiElement
  testOutput: LuaGuiElement

  totalTests: number
}

declare const global: {
  __testProgressGui: TestProgressGui
}

const TestProgressName = "testorio:test-progress"

function StatusText(parent: LuaGuiElement) {
  const statusText = parent.add({ type: "label" })
  statusText.style.font = "default-large"
  return statusText
}

function ProgressBar(parent: LuaGuiElement): {
  progressBar: ProgressBarGuiElement
  progressLabel: LabelGuiElement
} {
  const progressFlow = parent.add<"flow">({
    type: "flow",
    direction: "horizontal",
  })
  progressFlow.style.horizontally_stretchable = true
  progressFlow.style.vertical_align = "center"

  const progressBar = progressFlow.add({
    type: "progressbar",
  })
  progressBar.style.horizontally_stretchable = true

  const progressLabel = progressFlow.add({
    type: "label",
  })
  const plStyle = progressLabel.style
  plStyle.width = 80
  plStyle.horizontal_align = "center"

  return {
    progressBar,
    progressLabel,
  }
}

function TestCount(parent: LuaGuiElement) {
  const table = parent.add<"table">({
    type: "table",
    column_count: 5,
    style: "bordered_table",
  })

  function addLabel() {
    const result = table.add({
      type: "label",
    })
    const style = result.style
    style.horizontally_stretchable = true
    style.horizontal_align = "center"
    return result
  }
  const colors = [MessageColor.Red, MessageColor.Red, MessageColor.Yellow, MessageColor.Purple, MessageColor.Green]
  for (const color of colors) {
    const label = addLabel()
    label.style.font_color = Colors[color]
  }
  return table
}

function TestOutput(parent: LuaGuiElement) {
  const frame = parent.add({
    type: "frame",
    style: "inside_shallow_frame",
    direction: "vertical",
  })

  const pane = frame.add({
    type: "scroll-pane",
    style: "scroll_pane_in_shallow_frame",
  })
  pane.style.height = 600
  pane.style.horizontally_stretchable = true
  return pane
}

function getPlayer(): LuaPlayer {
  // noinspection LoopStatementThatDoesntLoopJS
  for (const [, player] of pairs(game.players)) {
    return player
  }
  error("Could not find any players!")
}

function createTestProgressGui(state: TestState): TestProgressGui {
  const player = getPlayer()
  const totalTests = countActiveTests(state.rootBlock, state)

  const screen = player.gui.screen
  screen[TestProgressName]?.destroy()

  const titleLocale = !state.isRerun ? ProgressGui.Title : ProgressGui.TitleRerun
  const mainFrame = screen.add<"frame">({
    type: "frame",
    caption: [titleLocale, script.mod_name],
    name: TestProgressName,
    direction: "vertical",
  })
  mainFrame.auto_center = true
  mainFrame.style.width = 1000
  const contentFrame = mainFrame.add({
    type: "frame",
    style: "inside_shallow_frame_with_padding",
    direction: "vertical",
  })
  const gui: TestProgressGui = {
    player,
    totalTests,
    statusText: StatusText(contentFrame),
    ...ProgressBar(contentFrame),
    testCounts: TestCount(contentFrame),
    testOutput: TestOutput(contentFrame),
  }

  updateGuiStatus(gui, state.results)
  return gui
}

function updateGuiStatus(gui: TestProgressGui, results: RunResults) {
  gui.progressBar.value = gui.totalTests === 0 ? 1 : results.ran / gui.totalTests
  gui.progressLabel.caption = ["", results.ran, "/", gui.totalTests]

  const testCounts = gui.testCounts.children

  if (results.failed > 0) testCounts[0].caption = [ProgressGui.NFailed, results.failed]
  if (results.describeBlockErrors > 0) testCounts[1].caption = [ProgressGui.NErrors, results.describeBlockErrors]
  if (results.skipped > 0) testCounts[2].caption = [ProgressGui.NSkipped, results.skipped]
  if (results.todo > 0) testCounts[3].caption = [ProgressGui.NTodo, results.todo]
  if (results.passed > 0) testCounts[4].caption = [ProgressGui.NPassed, results.passed]
}

export const progressGuiListener: TestListener = (event, state) => {
  const gui = global.__testProgressGui
  switch (event.type) {
    case "testRunStarted": {
      global.__testProgressGui = createTestProgressGui(state)
      break
    }
    case "describeBlockEntered": {
      const { block } = event
      gui.statusText.caption = [ProgressGui.RunningTest, block.path]
      break
    }
    case "testEntered": {
      const { test } = event
      gui.statusText.caption = [ProgressGui.RunningTest, test.path]
      break
    }
    case "testFailed": {
      updateGuiStatus(gui, state.results)
      gui.statusText.caption = [ProgressGui.RunningTest, event.test.parent.path]
      break
    }
    case "testPassed": {
      updateGuiStatus(gui, state.results)
      gui.statusText.caption = [ProgressGui.RunningTest, event.test.parent.path]
      break
    }
    case "testSkipped": {
      updateGuiStatus(gui, state.results)
      gui.statusText.caption = [ProgressGui.RunningTest, event.test.parent.path]
      break
    }
    case "testTodo": {
      updateGuiStatus(gui, state.results)
      gui.statusText.caption = [ProgressGui.RunningTest, event.test.parent.path]
      break
    }
    case "describeBlockFinished": {
      const { block } = event
      if (block.parent) gui.statusText.caption = [ProgressGui.RunningTest, block.parent.path]
      break
    }
    case "describeBlockFailed": {
      updateGuiStatus(gui, state.results)
      const { block } = event
      if (block.parent) gui.statusText.caption = [ProgressGui.RunningTest, block.parent.path]
      break
    }
    case "testRunFinished": {
      gui.statusText.caption = [!state.isRerun ? ProgressGui.TestsFinished : ProgressGui.TestsFinishedRerun]
      break
    }
    case "loadError": {
      gui.statusText.caption = [ProgressGui.LoadError]
      break
    }
  }
}

export const progressGuiLogger: LogHandler = (message) => {
  const gui = global.__testProgressGui
  if (!gui || !gui.progressBar.valid) return
  const textBox = gui.testOutput.add({
    type: "text-box",
    style: Prototypes.TestOutputBoxStyle,
  })
  textBox.read_only = true
  const caption = joinToRichText(message)
  let newLineCount: number
  if (typeof caption === "string") {
    ;[, newLineCount] = string.gsub(caption, "\n", "")
  } else {
    newLineCount = 0
  }
  textBox.style.height = (newLineCount + 1) * 20
  textBox.caption = caption
}
