// ---------------------------------------------------------------------------
// Color name → ANSI SGR code mapping
// ---------------------------------------------------------------------------

const colorCodes: Record<string, number> = {
  black: 30,
  red: 31,
  green: 32,
  yellow: 33,
  blue: 34,
  magenta: 35,
  cyan: 36,
  white: 37,
  gray: 90,
  grey: 90,
  blackBright: 90,
  redBright: 91,
  greenBright: 92,
  yellowBright: 93,
  blueBright: 94,
  magentaBright: 95,
  cyanBright: 96,
  whiteBright: 97,
}

const bgColorCodes: Record<string, number> = {
  black: 40,
  red: 41,
  green: 42,
  yellow: 43,
  blue: 44,
  magenta: 45,
  cyan: 46,
  white: 47,
  gray: 100,
  grey: 100,
  blackBright: 100,
  redBright: 101,
  greenBright: 102,
  yellowBright: 103,
  blueBright: 104,
  magentaBright: 105,
  cyanBright: 106,
  whiteBright: 107,
}

export function fgColorCode(color: string | undefined): number | undefined {
  if (!color) return undefined
  return colorCodes[color]
}

export function bgColorCode(color: string | undefined): number | undefined {
  if (!color) return undefined
  return bgColorCodes[color]
}

export function buildSgrCodes(style: {
  color?: string
  backgroundColor?: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strikethrough?: boolean
  inverse?: boolean
  dimColor?: boolean
}): number[] {
  const codes: number[] = []

  if (style.bold) codes.push(1)
  if (style.dimColor) codes.push(2)
  if (style.italic) codes.push(3)
  if (style.underline) codes.push(4)
  if (style.inverse) codes.push(7)
  if (style.strikethrough) codes.push(9)

  const fg = fgColorCode(style.color)
  if (fg !== undefined) codes.push(fg)

  const bg = bgColorCode(style.backgroundColor)
  if (bg !== undefined) codes.push(bg)

  return codes
}
