import * as fs from "fs"
import { minimatch } from "minimatch"

export interface WatchOptions {
  patterns: string[]
  debounceMs?: number
}

export function matchesPattern(filename: string, patterns: string[]): boolean {
  const normalizedFilename = filename.replace(/\\/g, "/")
  return patterns.some((pattern) => minimatch(normalizedFilename, pattern))
}

export function watchDirectory(dir: string, onChange: () => void, options: WatchOptions): fs.FSWatcher {
  const debounceMs = options.debounceMs ?? 300
  let timeout: ReturnType<typeof setTimeout> | undefined

  const debouncedOnChange = () => {
    if (timeout) clearTimeout(timeout)
    timeout = setTimeout(onChange, debounceMs)
  }

  const watcher = fs.watch(dir, { recursive: true }, (_, filename) => {
    if (!filename) return
    if (matchesPattern(filename, options.patterns)) {
      debouncedOnChange()
    }
  })

  return watcher
}

export function watchFile(filePath: string, onChange: () => void, options?: { debounceMs?: number }): fs.FSWatcher {
  const debounceMs = options?.debounceMs ?? 300
  let timeout: ReturnType<typeof setTimeout> | undefined

  const debouncedOnChange = () => {
    if (timeout) clearTimeout(timeout)
    timeout = setTimeout(onChange, debounceMs)
  }

  const watcher = fs.watch(filePath, () => {
    debouncedOnChange()
  })

  return watcher
}
