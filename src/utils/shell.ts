/**
 * ANSI-C quote a single shell argument. Safe for arbitrary bytes including
 * embedded quotes and backslashes, and round-trips through bash / zsh / sh.
 */
export function shellQuote(s: string): string {
  return "$'" + s.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'"
}
