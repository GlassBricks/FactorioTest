import { describe, expect, it } from "vitest"
import { createRerunLoop } from "./rerun-loop.js"

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((r) => (resolve = r))
  return { promise, resolve }
}

describe("createRerunLoop", () => {
  it("aborts the in-flight run and starts the next only after it finishes", async () => {
    const events: string[] = []
    const firstCanFinish = deferred()
    let runCount = 0
    const loop = createRerunLoop(async (signal) => {
      const id = ++runCount
      events.push(`start ${id}`)
      signal.addEventListener("abort", () => events.push(`abort ${id}`))
      if (id === 1) await firstCanFinish.promise
      events.push(`end ${id}`)
    })

    const first = loop.trigger()
    const second = loop.trigger()
    await Promise.resolve()
    expect(events).toEqual(["start 1", "abort 1"])

    firstCanFinish.resolve()
    await Promise.all([first, second])
    expect(events).toEqual(["start 1", "abort 1", "end 1", "start 2", "end 2"])
  })

  it("skips runs superseded before they start", async () => {
    const started: number[] = []
    const firstCanFinish = deferred()
    let runCount = 0
    const loop = createRerunLoop(async () => {
      const id = ++runCount
      started.push(id)
      if (id === 1) await firstCanFinish.promise
    })

    const triggers = [loop.trigger(), loop.trigger(), loop.trigger()]
    firstCanFinish.resolve()
    await Promise.all(triggers)
    expect(started).toEqual([1, 2])
  })

  it("aborts the latest run after an earlier aborted run settles", async () => {
    const aborted: number[] = []
    const secondStarted = deferred()
    const gates = [deferred(), deferred()]
    let runCount = 0
    const loop = createRerunLoop(async (signal) => {
      const id = ++runCount
      signal.addEventListener("abort", () => aborted.push(id))
      if (id === 2) secondStarted.resolve()
      await gates[id - 1]?.promise
    })

    const first = loop.trigger()
    const second = loop.trigger()
    gates[0]!.resolve()
    await first
    await secondStarted.promise
    const third = loop.trigger()
    expect(aborted).toEqual([1, 2])

    gates[1]!.resolve()
    await Promise.all([second, third])
  })

  it("does not propagate a failed run into the next one", async () => {
    let runCount = 0
    const loop = createRerunLoop(async () => {
      if (++runCount === 1) throw new Error("boom")
    })

    const first = loop.trigger()
    const second = loop.trigger()
    await expect(first).rejects.toThrow("boom")
    await expect(second).resolves.toBeUndefined()
  })
})
