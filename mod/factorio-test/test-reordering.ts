import { DescribeBlock, Test } from "./tests"
import { getAutoStartConfig } from "./auto-start-config"
import { TestState } from "./state"

export function shouldReorderFailedFirst(state: TestState): boolean {
  const config = getAutoStartConfig()
  return state.config.reorder_failed_first !== false && (config.last_failed_tests?.length ?? 0) > 0
}

export function markFailedTestsAndDescendants(block: DescribeBlock): void {
  const failedPaths = new LuaSet<string>()
  for (const path of getAutoStartConfig().last_failed_tests ?? []) {
    failedPaths.add(path)
  }
  markRecursive(block, failedPaths)
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
}

function hasPriority(node: Test | DescribeBlock): boolean {
  if (node.type === "test") {
    return node._previouslyFailed === true
  }
  return node._hasFailedDescendant === true
}
