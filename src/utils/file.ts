export function formatFileContentWithLineNumbers(
  content: string,
  offset: number = 1,
): string {
  if (content === '') return ''

  const lines = content.split('\n')
  return lines
    .map((line, i) => `${offset + i}\t${line}`)
    .join('\n')
}

const LINE_NUMBER_PREFIX = /^\s*\d+\t(.*)/
const DIGITS_ONLY = /^\d+$/

export function stripLineNumberPrefix(line: string): string {
  const match = LINE_NUMBER_PREFIX.exec(line)
  return match ? match[1]! : line
}

/**
 * Strip "N\t" line number prefixes from a multi-line string
 * formatted by the Read tool.
 */
export function stripLineNumbers(formatted: string): string {
  if (formatted === '') return ''
  return formatted
    .split('\n')
    .map(line => {
      const tabIndex = line.indexOf('\t')
      if (tabIndex === -1) return line
      const prefix = line.slice(0, tabIndex)
      if (DIGITS_ONLY.test(prefix)) {
        return line.slice(tabIndex + 1)
      }
      return line
    })
    .join('\n')
}
