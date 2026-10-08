import {
  ButtonGuiElement,
  FlowGuiElement,
  FrameGuiElement,
  LabelGuiElement,
  LocalisedString,
  LuaGuiElement,
  LuaPlayer,
  ProgressBarGuiElement,
  ScrollPaneGuiElement,
} from "factorio:runtime"
import { Locale, Misc, Prototypes } from "../constants"
import { getPlayer } from "./shared/util"
import { MessageHandler } from "./output"
import { TestRunResults } from "./results"
import { testStorage } from "./storage"
import { StepAction, TestEventContext, TestEventListener } from "./test-events"
import { countActiveTests } from "./tests"
import ProgressGui = Locale.ProgressGui
import ConfigGui = Locale.ConfigGui

export interface TestGui {
  player: LuaPlayer
  mainFrame: FrameGuiElement
  statusText: LabelGuiElement
  lastRunCaption?: LocalisedString
  nextRow: FlowGuiElement
  nextKindLabel: LabelGuiElement
  nextLabel: LabelGuiElement
  progressBar: ProgressBarGuiElement
  progressLabel: LabelGuiElement
  testSummary: LabelGuiElement
  stepControls: FlowGuiElement
  stepButtons: FlowGuiElement
  output: ScrollPaneGuiElement
  actionButton: ButtonGuiElement

  totalTests: number
}

function StatusText(parent: LuaGuiElement): LabelGuiElement {
  const statusText = parent.add({ type: "label" })
  statusText.style.font = "default-large"
  return statusText
}

function NextRow(parent: LuaGuiElement): {
  nextRow: FlowGuiElement
  nextKindLabel: LabelGuiElement
  nextLabel: LabelGuiElement
} {
  const nextRow = parent.add({ type: "flow", direction: "horizontal" })
  nextRow.visible = false
  // keeps the row's height while its labels are blank, so the progress bar doesn't shift
  nextRow.style.minimal_height = 20

  const nextKindLabel = nextRow.add({ type: "label", style: "caption_label" })
  const nextLabel = nextRow.add({ type: "label" })
  const nextStyle = nextLabel.style
  nextStyle.single_line = false
  nextStyle.maximal_width = 500
  return { nextRow, nextKindLabel, nextLabel }
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

function TestSummary(parent: LuaGuiElement): LabelGuiElement {
  const label = parent.add({ type: "label" })
  label.style.font = "default-bold"
  return label
}

function stepButton(parent: LuaGuiElement, caption: ProgressGui, action: StepAction, style = "dialog_button"): void {
  parent.add({
    type: "button",
    caption: [caption],
    style,
    tags: { modName: "factorio-test", on_gui_click: Misc.StepAction, stepAction: action },
  })
}

function StepControls(parent: LuaGuiElement): { stepControls: FlowGuiElement; stepButtons: FlowGuiElement } {
  const stepControls = parent.add({ type: "flow", direction: "vertical" })
  stepControls.visible = false
  // matches the top frame's bottom padding, so the buttons sit centered between line and frame edge
  stepControls.style.vertical_spacing = 12
  stepControls.add({ type: "line", direction: "horizontal", style: "inside_shallow_frame_with_padding_line" })

  const stepButtons = stepControls.add({ type: "flow", direction: "horizontal" })
  const buttonsStyle = stepButtons.style
  buttonsStyle.horizontally_stretchable = true
  buttonsStyle.horizontal_align = "right"
  buttonsStyle.vertical_align = "center"

  stepButton(stepButtons, ProgressGui.StepSkipTest, "skipTest")
  stepButton(stepButtons, ProgressGui.StepRunRest, "runRest")
  stepButton(stepButtons, ProgressGui.StepContinue, "continue", "confirm_button")
  return { stepControls, stepButtons }
}

function TestOutput(parent: LuaGuiElement): ScrollPaneGuiElement {
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

function bottomButtonsBar(parent: LuaGuiElement) {
  const flow = parent.add({
    type: "flow",
    direction: "horizontal",
  })
  const spacer = flow.add({
    type: "empty-widget",
  })
  spacer.style.horizontally_stretchable = true

  const actionButton = flow.add({
    type: "button",
    caption: [ProgressGui.Cancel],
    tags: {
      modName: "factorio-test",
      on_gui_click: Misc.CancelTestRun,
    },
  })
  return {
    actionButton,
  }
}

function createTestProgressGui(state: TestEventContext): TestGui {
  const player = getPlayer()

  const screen = player.gui.screen
  screen[Misc.TestGui]?.destroy()

  const mainFrame = screen.add<"frame">({
    type: "frame",
    name: Misc.TestGui,
    direction: "vertical",
  })
  mainFrame.auto_center = true
  mainFrame.style.width = 1000

  const titleBar = mainFrame.add({
    type: "flow",
    direction: "horizontal",
  })
  titleBar.drag_target = mainFrame

  const style = titleBar.style
  style.horizontal_spacing = 8
  style.height = 28
  const targetName = script.mod_name === "level" ? script.level.level_name : script.mod_name
  titleBar.add({
    type: "label",
    caption: state.suite.hasFocusedTests
      ? ["", [ProgressGui.Title, targetName], " (.only)"]
      : [ProgressGui.Title, targetName],
    style: "frame_title",
    ignored_by_interaction: true,
  })
  // drag handle
  {
    const element = titleBar.add({
      type: "empty-widget",
      ignored_by_interaction: true,
      style: "draggable_space",
    })
    const style = element.style
    style.horizontally_stretchable = true
    style.height = 24
  }

  titleBar.add({
    type: "sprite-button",
    style: "frame_action_button",
    sprite: "utility/close",
    hovered_sprite: "utility/close_black",
    clicked_sprite: "utility/close_black",
    tooltip: ["gui.close"],
    mouse_button_filter: ["left"],
    tags: {
      modName: "factorio-test",
      on_gui_click: Misc.CloseTestGui,
    },
  })

  const contentFlow = mainFrame.add({
    type: "flow",
    direction: "vertical",
  })
  contentFlow.style.vertical_spacing = 15
  const topFrame = contentFlow.add({
    type: "frame",
    style: "inside_shallow_frame_with_padding",
    direction: "vertical",
  })
  const gui: TestGui = {
    player,
    mainFrame,
    totalTests: countActiveTests(state),
    statusText: StatusText(topFrame),
    ...NextRow(topFrame),
    ...ProgressBar(topFrame),
    testSummary: TestSummary(topFrame),
    ...StepControls(topFrame),
    output: TestOutput(contentFlow),
    ...bottomButtonsBar(contentFlow),
  }

  updateTestCounts(gui, state.report.results)
  return gui
}

function getTestProgressGui() {
  const gui = testStorage().gui
  if (!gui?.mainFrame.valid) {
    testStorage().gui = undefined
    return undefined
  }
  return gui
}

function buildTestSummary(results: TestRunResults): LocalisedString {
  const parts: LocalisedString[] = []
  if (results.passed > 0) parts.push([ProgressGui.NPassed, results.passed])
  if (results.failed > 0) parts.push([ProgressGui.NFailed, results.failed])
  if (results.describeBlockErrors > 0) parts.push([ProgressGui.NErrors, results.describeBlockErrors])
  if (results.skipped > 0) parts.push([ProgressGui.NSkipped, results.skipped])
  if (results.todo > 0) parts.push([ProgressGui.NTodo, results.todo])
  if (parts.length === 0) return ""
  const result: LocalisedString = [""]
  for (const [i, part] of ipairs(parts)) {
    if (i > 1) result.push(", ")
    result.push(part)
  }
  return result
}

function updateTestCounts(gui: TestGui, results: TestRunResults) {
  gui.progressBar.value = gui.totalTests === 0 ? 1 : results.ran / gui.totalTests
  gui.progressLabel.caption = ["", results.ran, "/", gui.totalTests]
  gui.testSummary.caption = buildTestSummary(results)
}

export const progressGuiListener: TestEventListener = (event, state) => {
  if (event.type === "testRunStarted") {
    testStorage().gui = createTestProgressGui(state)
    return
  }
  const gui = getTestProgressGui()
  if (!gui) return
  switch (event.type) {
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
    case "testFailed":
    case "testPassed":
    case "testSkipped":
    case "testTodo": {
      updateTestCounts(gui, state.report.results)
      gui.statusText.caption = [ProgressGui.RunningTest, event.test.parent.path]
      break
    }
    case "testSkippedByUser": {
      gui.totalTests--
      updateTestCounts(gui, state.report.results)
      gui.statusText.caption = [ProgressGui.RunningTest, event.test.parent.path]
      break
    }
    case "testStarted":
      showRunning(gui, [ProgressGui.RunningTest, event.test.path])
      break
    case "stepStarted":
      showRunning(gui, [ProgressGui.RunningStep, event.test.path, event.step])
      break
    case "stepPaused": {
      const { test, step } = event
      gui.statusText.caption = gui.lastRunCaption ?? [ProgressGui.RunningTest, test.parent.path]
      gui.nextKindLabel.caption = [step ? ProgressGui.StepNextStep : ProgressGui.StepNextTest]
      gui.nextLabel.caption = step ?? test.path
      setStepControlsVisible(gui, true)
      setStepButtonsEnabled(gui, true)
      break
    }
    case "stepResumed":
      gui.nextKindLabel.caption = ""
      gui.nextLabel.caption = ""
      if (event.action === "runRest" || event.action === "cancel") setStepControlsVisible(gui, false)
      break
    case "describeBlockFinished": {
      const { block } = event
      if (block.parent) gui.statusText.caption = [ProgressGui.RunningTest, block.parent.path]
      break
    }
    case "describeBlockFailed": {
      updateTestCounts(gui, state.report.results)
      const { block } = event
      if (block.parent) gui.statusText.caption = [ProgressGui.RunningTest, block.parent.path]
      break
    }
    case "testRunFinished": {
      const statusLocale =
        state.report.results.status == "passed"
          ? ProgressGui.TestsPassed
          : state.report.results.status == "todo"
            ? ProgressGui.TestsPassedWithTodo
            : ProgressGui.TestsFailed

      showRunEnded(gui, statusLocale)
      break
    }
    case "testRunCancelled":
      showRunEnded(gui, ProgressGui.TestsCancelled)
      break
    case "loadError":
      showRunEnded(gui, ProgressGui.LoadError)
      break
  }
}

function setStepControlsVisible(gui: TestGui, visible: boolean): void {
  gui.nextRow.visible = visible
  gui.stepControls.visible = visible
}

function showRunning(gui: TestGui, caption: LocalisedString): void {
  gui.statusText.caption = caption
  gui.lastRunCaption = caption
}

// Toggling `enabled` drops a button's hover state until the mouse moves, so skip no-op writes.
function setStepButtonsEnabled(gui: TestGui, enabled: boolean): void {
  for (const button of gui.stepButtons.children) {
    if (button.enabled !== enabled) button.enabled = enabled
  }
}

/** Called after each runner tick that ends unpaused: a step that re-pauses within its tick never disables buttons. */
export function showStepRunning(): void {
  const gui = getTestProgressGui()
  if (gui?.stepControls.visible) setStepButtonsEnabled(gui, false)
}

function showRunEnded(gui: TestGui, statusLocale: ProgressGui): void {
  setStepControlsVisible(gui, false)
  gui.statusText.caption = [statusLocale]
  gui.actionButton.caption = [ConfigGui.RerunTests]
  gui.actionButton.tags = { modName: "factorio-test", on_gui_click: Misc.RunTests }
}

export function hideStepControls(): void {
  const gui = getTestProgressGui()
  if (gui) setStepControlsVisible(gui, false)
}

const profilerLength = "(Duration: 0.082400ms)".length - "(<Profiler>)".length
export const progressGuiLogger: MessageHandler = (message) => {
  const gui = testStorage().gui
  if (!gui || !gui.progressBar.valid) return
  const output = gui.output
  const textBox = output.add({
    type: "text-box",
    style: Prototypes.TestOutputBoxStyle,
  })
  textBox.read_only = true
  textBox.word_wrap = true
  let lines = 0
  let isFirstLine = true
  for (const line of message.plainText.split("\n")) {
    const lineLength = line.length + (isFirstLine ? profilerLength : 0)
    if (lineLength > 110) {
      lines += math.ceil(lineLength / 105)
    } else {
      lines++
    }
    isFirstLine = false
  }
  textBox.style.height = 20 * lines
  textBox.caption = message.richText
}
