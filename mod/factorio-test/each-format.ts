function getNestedProperty(obj: object, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) => {
    if (current != null && typeof current === "object") {
      return (current as Record<string, unknown>)[key]
    }
    return undefined
  }, obj)
}

function formatValue(value: unknown): string {
  if (value == null) return String(value)
  if (typeof value === "object") return serpent.line(value)
  return String(value)
}

export function formatTestName(template: string, row: unknown[], index: number): string {
  let result = template

  result = string.gsub(result, "%%#", String(index))[0]
  result = string.gsub(result, "%%%$", String(index + 1))[0]

  if (row.length === 1 && typeof row[0] === "object" && row[0] !== null) {
    const obj = row[0] as object
    result = string.gsub(result, "%$([%w_][%w_%.]*)", (path: string) => {
      const value = path.includes(".") ? getNestedProperty(obj, path) : (obj as Record<string, unknown>)[path]
      return formatValue(value)
    })[0]
  }

  let valueIndex = 0
  result = string.gsub(result, "%%p", () => {
    const value = row[valueIndex++]
    return typeof value === "object" && value !== null ? serpent.block(value) : String(value ?? "nil")
  })[0]

  if (string.match(result, "%%[disfoxXeEgGc]")[0]) {
    const rowValues = row.map((v) => (typeof v === "object" ? serpent.line(v) : v))
    result = string.format(result, ...rowValues)
  }

  return result
}

export interface EachItem {
  name: string
  row: unknown[]
}

export function createEachItems(values: unknown[], name: string): EachItem[] {
  if (values.length === 0) error(".each called with no data")

  const valuesAsRows: unknown[][] = values.every((v): v is any[] => Array.isArray(v)) ? values : values.map((v) => [v])
  return valuesAsRows.map((row, index) => ({
    name: formatTestName(name, row, index),
    row,
  }))
}
