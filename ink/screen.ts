export interface CellStyle {
  color?: string
  backgroundColor?: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strikethrough?: boolean
  inverse?: boolean
  dimColor?: boolean
}

export interface Cell {
  char: string
  style: CellStyle
}

export interface ScreenBuffer {
  cells: Cell[][]
  width: number
  height: number
}

const EMPTY_STYLE: CellStyle = {}

export function createScreenBuffer(width: number, height: number): ScreenBuffer {
  const cells: Cell[][] = []
  for (let row = 0; row < height; row++) {
    const line: Cell[] = []
    for (let col = 0; col < width; col++) {
      line.push({ char: ' ', style: EMPTY_STYLE })
    }
    cells.push(line)
  }
  return { cells, width, height }
}

export function clearScreenBuffer(buffer: ScreenBuffer): void {
  for (let row = 0; row < buffer.height; row++) {
    for (let col = 0; col < buffer.width; col++) {
      const cell = buffer.cells[row]![col]!
      cell.char = ' '
      cell.style = EMPTY_STYLE
    }
  }
}

// Caller must not mutate `style` after writing — the cell holds a reference.
export function writeCell(
  buffer: ScreenBuffer,
  col: number,
  row: number,
  char: string,
  style: CellStyle,
): void {
  if (row < 0 || row >= buffer.height || col < 0 || col >= buffer.width) return
  const cell = buffer.cells[row]![col]!
  cell.char = char
  cell.style = style
}

export function cellsEqual(a: Cell, b: Cell): boolean {
  if (a.style === b.style) return a.char === b.char
  return a.char === b.char
    && a.style.color === b.style.color
    && a.style.backgroundColor === b.style.backgroundColor
    && a.style.bold === b.style.bold
    && a.style.italic === b.style.italic
    && a.style.underline === b.style.underline
    && a.style.strikethrough === b.style.strikethrough
    && a.style.inverse === b.style.inverse
    && a.style.dimColor === b.style.dimColor
}
