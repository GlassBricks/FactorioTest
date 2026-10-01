import { DescribeBlock, Test } from "./tests"
import Config = FactorioTest.Config

type TestNode = Test | DescribeBlock

export function shouldReorderFailedFirst(
  config: Config,
  failedPaths: LuaSet<string> | undefined,
): failedPaths is LuaSet<string> {
  return config.reorder_failed_first !== false && failedPaths !== undefined && next(failedPaths)[0] !== undefined
}

export function reorderFailedFirst(root: DescribeBlock, failedPaths: LuaSet<string>): void {
  const prioritized = new LuaSet<TestNode>()
  markPrioritized(root, failedPaths, prioritized)
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
