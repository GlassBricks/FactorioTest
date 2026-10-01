export interface RerunLoop {
  trigger(): Promise<void>
}

interface PendingRun {
  controller: AbortController
  done: Promise<void>
}

export function createRerunLoop(run: (signal: AbortSignal) => Promise<void>): RerunLoop {
  let current: PendingRun | undefined

  async function runAfter(previous: PendingRun | undefined, signal: AbortSignal): Promise<void> {
    if (previous) {
      await previous.done.catch(() => {})
      if (signal.aborted) return
    }
    await run(signal)
  }

  return {
    async trigger() {
      const previous = current
      previous?.controller.abort()
      const controller = new AbortController()
      const pending: PendingRun = { controller, done: runAfter(previous, controller.signal) }
      current = pending
      try {
        await pending.done
      } finally {
        if (current === pending) current = undefined
      }
    },
  }
}
