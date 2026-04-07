const ESC = '\x1b'
const CSI = `${ESC}[`

export const cursorTo = (col: number, row: number): string =>
  `${CSI}${row + 1};${col + 1}H`

export const cursorHide = (): string => `${CSI}?25l`
export const cursorShow = (): string => `${CSI}?25h`

export const eraseDown = (): string => `${CSI}J`
export const eraseToEndOfLine = (): string => `${CSI}K`

export const setStyle = (codes: number[]): string =>
  `${CSI}${codes.join(';')}m`

export const resetStyle = (): string => `${CSI}0m`

export const bracketedPasteEnable = (): string => `${CSI}?2004h`
export const bracketedPasteDisable = (): string => `${CSI}?2004l`
