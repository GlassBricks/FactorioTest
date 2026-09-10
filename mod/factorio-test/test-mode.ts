import { DescribeBlock, TestMode, TestSuite } from "./tests"

type FocusTracker = Pick<TestSuite, "hasFocusedTests">

export function propagateTestMode(state: FocusTracker, block: DescribeBlock, parentMode: TestMode): void {
  if (parentMode === "skip") {
    applyModeToAllChildren(block, "skip")
    return
  }

  if (parentMode === "only") {
    state.hasFocusedTests = true
    const hasNestedOnly = block.children.some((child) => child.declaredMode === "only")
    if (hasNestedOnly) {
      markChildrenWithFocus(state, block)
    } else {
      applyModeToAllChildren(block, "only")
    }
    return
  }

  markChildrenWithFocus(state, block)
}

function applyModeToAllChildren(block: DescribeBlock, mode: TestMode): void {
  for (const child of block.children) {
    if (child.declaredMode === "skip") continue

    if (mode === "only" && child.declaredMode !== undefined) {
      child.mode = child.declaredMode
    } else {
      child.mode = mode
    }

    if (child.type === "describeBlock") {
      applyModeToAllChildren(child, mode)
    }
  }
}

function markChildrenWithFocus(state: FocusTracker, block: DescribeBlock): void {
  for (const child of block.children) {
    if (child.declaredMode === "only") {
      state.hasFocusedTests = true
    }
  }
}
