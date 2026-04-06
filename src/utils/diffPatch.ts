import { structuredPatch, type StructuredPatch } from 'diff'

export interface PatchResult {
  patch: StructuredPatch
  linesAdded: number
  linesRemoved: number
}

/**
 * Convert leading tabs to 2-space indentation for display consistency.
 * Tabs render inconsistently across terminals.
 */
function tabsToSpaces(text: string): string {
  return text.replace(/^\t+/gm, match => '  '.repeat(match.length))
}

/**
 * Generate a structured diff patch between old and new file content.
 * Returns the patch hunks plus line-level add/remove counts.
 */
export function generatePatch(
  filePath: string,
  oldContent: string,
  newContent: string,
): PatchResult {
  const displayOld = tabsToSpaces(oldContent)
  const displayNew = tabsToSpaces(newContent)

  const patch = structuredPatch(filePath, filePath, displayOld, displayNew, '', '', {
    context: 3,
  })

  let linesAdded = 0
  let linesRemoved = 0
  for (const hunk of patch.hunks) {
    for (const line of hunk.lines) {
      if (line.startsWith('+')) linesAdded++
      else if (line.startsWith('-')) linesRemoved++
    }
  }

  return { patch, linesAdded, linesRemoved }
}
