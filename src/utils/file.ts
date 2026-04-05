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

export function stripLineNumberPrefix(line: string): string {
  const match = LINE_NUMBER_PREFIX.exec(line)
  return match ? match[1]! : line
}
