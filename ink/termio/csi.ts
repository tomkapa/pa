export const ESC = '\x1b'
export const CSI = `${ESC}[`

export const cursorTo = (col: number, row: number): string =>
  `${CSI}${row + 1};${col + 1}H`

export const cursorHide = (): string => `${CSI}?25l`
export const cursorShow = (): string => `${CSI}?25h`

export const eraseDown = (): string => `${CSI}J`
export const eraseScreen = (): string => `${CSI}2J`
export const cursorHome = (): string => `${CSI}H`
export const eraseToEndOfLine = (): string => `${CSI}K`

export const setStyle = (codes: number[]): string =>
  `${CSI}${codes.join(';')}m`

export const resetStyle = (): string => `${CSI}0m`

export const bracketedPasteEnable = (): string => `${CSI}?2004h`
export const bracketedPasteDisable = (): string => `${CSI}?2004l`

// Kitty keyboard protocol — enables distinct sequences for modifier+key combos
// (e.g. Shift+Enter → \x1b[13;2u instead of plain \r).
// Push on entry, pop on exit to restore the terminal's previous keyboard state.
export const kittyKeyboardPush = (): string => `${CSI}>1u`
export const kittyKeyboardPop  = (): string => `${CSI}<u`

// DECSCUSR cursor shape: 0 = terminal default, 6 = steady I-beam (text input).
export const cursorDefault = (): string => `${CSI}0 q`
export const cursorIBeam   = (): string => `${CSI}6 q`
