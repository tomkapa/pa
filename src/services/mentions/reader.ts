import { readFile } from 'node:fs/promises'
import { formatFileContentWithLineNumbers } from '../../utils/file.js'

export interface ReadTruncatedResult {
  /** Line-numbered content, ready to drop into a tool_result block. */
  text: string
  /** Lines actually included (after truncation). */
  numLines: number
  /** Lines in the source file (before truncation). */
  totalLines: number
  truncated: boolean
}

export interface ReadTruncatedOptions {
  maxLines: number
}

/**
 * Reads a file and truncates by line count, formatting the result the same
 * way the Read tool does (1-based line-number prefixes). Line-based (not
 * byte-based) so the model can quote "line 47" accurately.
 */
export async function readFileWithTruncation(
  path: string,
  opts: ReadTruncatedOptions,
): Promise<ReadTruncatedResult> {
  const raw = await readFile(path, 'utf8')
  const allLines = raw.split('\n')
  // Drop a trailing empty line from a final '\n' — matches readTool.ts so
  // line counts agree between real and synthesized Read traces.
  if (allLines[allLines.length - 1] === '') allLines.pop()
  const totalLines = allLines.length
  const truncated = totalLines > opts.maxLines
  const slicedLines = truncated ? allLines.slice(0, opts.maxLines) : allLines
  const text = formatFileContentWithLineNumbers(slicedLines.join('\n'), 1)
  return { text, numLines: slicedLines.length, totalLines, truncated }
}
