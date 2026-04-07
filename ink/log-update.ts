import type { ScreenBuffer, Cell, CellStyle } from './screen.js'
import { cellsEqual } from './screen.js'
import { cursorTo, eraseDown, resetStyle, setStyle } from './termio/csi.js'
import { buildSgrCodes } from './color.js'

// ---------------------------------------------------------------------------
// Patch — a single terminal write operation
// ---------------------------------------------------------------------------

export interface Patch {
  col: number
  row: number
  content: string
}

// ---------------------------------------------------------------------------
// Diff two screen buffers → minimal patches
// ---------------------------------------------------------------------------

export function diffBuffers(prev: ScreenBuffer, next: ScreenBuffer): Patch[] {
  const patches: Patch[] = []
  const rows = Math.min(prev.height, next.height)
  const cols = Math.min(prev.width, next.width)

  for (let row = 0; row < rows; row++) {
    let runStart = -1
    let runChars = ''

    for (let col = 0; col < cols; col++) {
      const prevCell = prev.cells[row]![col]!
      const nextCell = next.cells[row]![col]!

      if (!cellsEqual(prevCell, nextCell)) {
        if (runStart < 0) runStart = col
        runChars += styledChar(nextCell)
      } else {
        if (runStart >= 0) {
          patches.push({ col: runStart, row, content: runChars })
          runStart = -1
          runChars = ''
        }
      }
    }

    // Flush trailing run
    if (runStart >= 0) {
      patches.push({ col: runStart, row, content: runChars })
    }
  }

  // Handle height difference: if next is shorter, erase all rows below new height
  // in one operation instead of per-row to avoid leaving stale content.
  if (next.height < prev.height) {
    patches.push({ col: 0, row: next.height, content: eraseDown() })
  }

  return patches
}

// ---------------------------------------------------------------------------
// Serialize a cell as styled character
// ---------------------------------------------------------------------------

function styledChar(cell: Cell): string {
  const codes = buildSgrCodes(cell.style)
  if (codes.length === 0) {
    return `${resetStyle()}${cell.char}`
  }
  return `${setStyle(codes)}${cell.char}${resetStyle()}`
}

// ---------------------------------------------------------------------------
// Serialize patches to terminal output string
// ---------------------------------------------------------------------------

export function serializePatches(patches: Patch[]): string {
  if (patches.length === 0) return ''

  let output = ''
  for (const patch of patches) {
    output += cursorTo(patch.col, patch.row)
    output += patch.content
  }
  return output
}

// ---------------------------------------------------------------------------
// Full-frame render (no diff — used for first frame or after resize)
// ---------------------------------------------------------------------------

export function serializeFullFrame(buffer: ScreenBuffer): string {
  let output = ''

  for (let row = 0; row < buffer.height; row++) {
    output += cursorTo(0, row)
    for (let col = 0; col < buffer.width; col++) {
      const cell = buffer.cells[row]![col]!
      output += styledChar(cell)
    }
  }

  return output
}
