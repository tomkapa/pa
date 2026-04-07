// ---------------------------------------------------------------------------
// Memory → System Prompt Formatter
//
// Converts loaded `MemoryFileInfo` records into a single labeled string
// that can be inlined into the agent's system prompt. Each file becomes a
// labeled block; the whole thing is prefixed with an instruction telling
// the model to follow these instructions and that they override defaults.
//
// Labels are intentionally short and descriptive so the model can tell
// which level a given instruction came from.
// ---------------------------------------------------------------------------

import type { MemoryFileInfo, MemoryType } from './types.js'

const PROMPT_PREFIX =
  'Codebase and user instructions are shown below. Be sure to adhere to these instructions. ' +
  'IMPORTANT: These instructions OVERRIDE any default behavior and you MUST follow them exactly as written.'

/**
 * Human-readable label appended after the file path in each block header.
 * Managed files have no label — they're admin policy and shouldn't be
 * called out as "user-controlled".
 */
function labelForType(type: MemoryType): string {
  switch (type) {
    case 'Project':
      return ' (project instructions, checked into the codebase)'
    case 'Local':
      return " (user's private project instructions, not checked in)"
    case 'User':
      return " (user's private global instructions for all projects)"
    case 'Managed':
      return ''
  }
}

/**
 * Format a single file as a labeled block:
 *
 *   Contents of /path/to/CLAUDE.md (project instructions, checked into the codebase):
 *
 *   <file content>
 */
export function formatMemoryFile(file: MemoryFileInfo): string {
  const label = labelForType(file.type)
  const header = `Contents of ${file.path}${label}:`
  return `${header}\n\n${file.content.trimEnd()}`
}

/**
 * Format a list of memory files into a single block ready for the system
 * prompt. Returns an empty string when there are no files (callers can
 * test for emptiness without special-casing).
 */
export function formatMemoryForPrompt(files: MemoryFileInfo[]): string {
  if (files.length === 0) return ''
  const blocks = files.map(formatMemoryFile)
  return `${PROMPT_PREFIX}\n\n${blocks.join('\n\n')}`
}
