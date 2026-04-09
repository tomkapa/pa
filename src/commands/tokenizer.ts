/**
 * Returns the partial slash-command token at the cursor, or null if the
 * cursor is not inside a slash-command position.
 *
 * A slash command is only valid when `/` is the very first character of
 * the input (no leading whitespace, no text before it). This keeps
 * regular messages containing `/` from triggering the picker.
 */
export function slashCommandAtCursor(text: string, cursor: number): string | null {
  if (text.length === 0 || text[0] !== '/' || cursor === 0) return null

  // Only match when cursor is within the first "word" (no spaces yet).
  const before = text.slice(0, cursor)
  if (/\s/.test(before)) return null

  // Return everything after the `/` up to the cursor.
  return before.slice(1)
}
