import { DescribeBlock, Test, TestSelection } from "./tests"
import { getFailedTestsSet, hasFailedTests } from "./failed-test-storage"

type TestNode = Test | DescribeBlock

export function shouldReorderFailedFirst(state: TestSelection): boolean {
  return state.config.reorder_failed_first !== false && hasFailedTests()
}

export function reorderFailedFirst(root: DescribeBlock): void {
  const prioritized = new LuaSet<TestNode>()
  markPrioritized(root, getFailedTestsSet(), prioritized)
  sortRecursive(root, prioritized)
}

function markPrioritized(block: DescribeBlock, failedPaths: LuaSet<string>, prioritized: LuaSet<TestNode>): boolean {
  let anyFailed = false

  for (const child of block.children) {
    const failed =
      child.type === "test" ? failedPaths.has(child.path) : markPrioritized(child, failedPaths, prioritized)
    if (failed) {
      prioritized.add(child)
      anyFailed = true
    }
  }

  return anyFailed
}

function sortRecursive(block: DescribeBlock, prioritized: LuaSet<TestNode>): void {
  table.sort(block.children, (a, b) => {
    const aPriority = prioritized.has(a)
    if (aPriority !== prioritized.has(b)) return aPriority
    return a.indexInParent < b.indexInParent
  })

  for (const [i, child] of ipairs(block.children)) {
    child.indexInParent = i - 1
    if (child.type === "describeBlock") sortRecursive(child, prioritized)
  }
}
