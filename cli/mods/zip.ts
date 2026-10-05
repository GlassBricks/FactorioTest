import { text } from "stream/consumers"
import * as yauzl from "yauzl"

const INFO_JSON_ENTRY = /^[^/]+\/info\.json$/

function findEntry(zip: yauzl.ZipFile, pattern: RegExp): Promise<yauzl.Entry | undefined> {
  return new Promise((resolve, reject) => {
    zip.on("entry", (entry: yauzl.Entry) => (pattern.test(entry.fileName) ? resolve(entry) : zip.readEntry()))
    zip.on("end", () => resolve(undefined))
    zip.on("error", reject)
    zip.readEntry()
  })
}

/** Reads `<folder>/info.json` from a mod zip. */
export async function readZipInfoJson(zipPath: string): Promise<unknown> {
  const zip = await yauzl.openPromise(zipPath, { lazyEntries: true })
  try {
    const entry = await findEntry(zip, INFO_JSON_ENTRY)
    if (!entry) throw new Error(`no info.json in ${zipPath}`)
    const stream = await zip.openReadStreamPromise(entry)
    return JSON.parse(await text(stream))
  } finally {
    zip.close()
  }
}
