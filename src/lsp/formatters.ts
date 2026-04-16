// ---------------------------------------------------------------------------
// LSP Result Formatters
//
// Convert LSP protocol types into human-readable text the model can use.
// All positions are converted from 0-based (LSP) to 1-based (display).
// File URIs are converted to relative paths when shorter.
// ---------------------------------------------------------------------------

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type {
  Location,
  LocationLink,
  Hover,
  MarkupContent,
  MarkedString,
} from 'vscode-languageserver-protocol'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function uriToDisplayPath(uri: string, cwd: string): string {
  let filePath: string
  try {
    filePath = fileURLToPath(uri)
  } catch {
    return uri // Malformed URI — return as-is
  }

  const relative = path.relative(cwd, filePath)
  // If the relative path escapes too far, use absolute
  if (relative.startsWith('../../')) return filePath
  return relative
}

function formatLocation(loc: Location, cwd: string): string {
  const file = uriToDisplayPath(loc.uri, cwd)
  // Convert 0-based to 1-based
  const line = loc.range.start.line + 1
  const char = loc.range.start.character + 1
  return `${file}:${line}:${char}`
}

/**
 * Normalize LocationLink to Location for uniform formatting.
 * LocationLink has targetUri + targetRange; Location has uri + range.
 */
function normalizeToLocations(
  result: Location | Location[] | LocationLink | LocationLink[] | null,
): Location[] {
  if (!result) return []
  const items = Array.isArray(result) ? result : [result]
  return items.map(item => {
    if ('targetUri' in item) {
      // LocationLink → Location
      return {
        uri: item.targetUri,
        range: item.targetSelectionRange ?? item.targetRange,
      }
    }
    return item as Location
  })
}

// ---------------------------------------------------------------------------
// goToDefinition
// ---------------------------------------------------------------------------

export function formatDefinitionResult(
  result: Location | Location[] | LocationLink | LocationLink[] | null,
  cwd: string,
): string {
  const locations = normalizeToLocations(result)

  if (locations.length === 0) {
    return (
      'No definition found. This may occur if the cursor is not on a symbol, ' +
      'the language server is still indexing, or the symbol is defined in an external package.'
    )
  }

  if (locations.length === 1) {
    return `Defined in ${formatLocation(locations[0]!, cwd)}`
  }

  const formatted = locations
    .map(loc => `  ${formatLocation(loc, cwd)}`)
    .join('\n')
  return `Found ${locations.length} definitions:\n${formatted}`
}

// ---------------------------------------------------------------------------
// findReferences — grouped by file
// ---------------------------------------------------------------------------

export function formatReferencesResult(
  result: Location[] | null,
  cwd: string,
): string {
  if (!result || result.length === 0) {
    return (
      'No references found. This may occur if the cursor is not on a symbol, ' +
      'or the language server is still indexing.'
    )
  }

  // Group by file
  const byFile = new Map<string, { line: number; char: number }[]>()
  for (const loc of result) {
    const file = uriToDisplayPath(loc.uri, cwd)
    let entries = byFile.get(file)
    if (!entries) {
      entries = []
      byFile.set(file, entries)
    }
    entries.push({
      line: loc.range.start.line + 1,
      char: loc.range.start.character + 1,
    })
  }

  const fileCount = byFile.size
  const lines: string[] = [
    `Found ${result.length} reference${result.length === 1 ? '' : 's'} across ${fileCount} file${fileCount === 1 ? '' : 's'}:`,
  ]

  for (const [file, refs] of byFile) {
    lines.push('')
    lines.push(`${file}:`)
    for (const ref of refs) {
      lines.push(`  Line ${ref.line}:${ref.char}`)
    }
  }

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// hover
// ---------------------------------------------------------------------------

function extractHoverText(
  contents: MarkupContent | MarkedString | MarkedString[],
): string {
  // MarkupContent: { kind: 'markdown' | 'plaintext', value: string }
  if (typeof contents === 'object' && 'kind' in contents) {
    return contents.value
  }
  // MarkedString: string | { language: string, value: string }
  if (typeof contents === 'string') {
    return contents
  }
  if (Array.isArray(contents)) {
    return contents
      .map(c => (typeof c === 'string' ? c : c.value))
      .join('\n\n')
  }
  // { language, value } shape
  if ('value' in contents) {
    return contents.value
  }
  return String(contents)
}

export function formatHoverResult(
  result: Hover | null,
  line: number,
  character: number,
): string {
  if (!result) {
    return (
      'No hover information available. This may occur if the cursor is not on a symbol, ' +
      'or the language server is still indexing.'
    )
  }

  const text = extractHoverText(result.contents)
  // Display using the 1-based line/character the model originally provided
  return `Hover info at ${line}:${character}:\n\n${text}`
}
