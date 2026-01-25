import { DescribeBlock, Test } from "./tests"
import { TestState } from "./state"
import { getFailedTestsSet, hasFailedTests } from "./failed-test-storage"

export function shouldReorderFailedFirst(state: TestState): boolean {
  return state.config.reorder_failed_first !== false && hasFailedTests()
}

export function markFailedTestsAndDescendants(block: DescribeBlock): void {
  markRecursive(block, getFailedTestsSet())
}

function markRecursive(block: DescribeBlock, failedPaths: LuaSet<string>): boolean {
  let hasFailedDescendant = false

  for (const child of block.children) {
    if (child.type === "test") {
      if (failedPaths.has(child.path)) {
        child._previouslyFailed = true
        hasFailedDescendant = true
      }
    } else {
      if (markRecursive(child, failedPaths)) {
        child._hasFailedDescendant = true
        hasFailedDescendant = true
      }
    }
  }

  return hasFailedDescendant
}

export function reorderChildren(block: DescribeBlock): void {
  if (block._reordered) return
  block._reordered = true

  table.sort(block.children, (a, b) => {
    const aPriority = hasPriority(a)
    const bPriority = hasPriority(b)
    if (aPriority && !bPriority) return true
    if (!aPriority && bPriority) return false
    return a.indexInParent < b.indexInParent
  })

  for (const [i, child] of ipairs(block.children)) {
    child.indexInParent = i - 1
  }
}

function hasPriority(node: Test | DescribeBlock): boolean {
  if (node.type === "test") {
    return node._previouslyFailed === true
  }
  return node._hasFailedDescendant === true
}
