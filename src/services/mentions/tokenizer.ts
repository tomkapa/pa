// Whitespace-anchored regex: `@` must sit at start-of-string or after
// whitespace, which is what keeps `alice@example.com` from matching.
const AT_MENTION_RE = /(^|\s)@([^\s]+)/g

/** Returns every @-mentioned path in a prompt, in the order they appear. */
export function extractAtMentions(prompt: string): string[] {
  const mentions: string[] = []
  for (const match of prompt.matchAll(AT_MENTION_RE)) {
    const token = match[2]
    if (token !== undefined) mentions.push(token)
  }
  return mentions
}

/**
 * Returns the partial @-token at the cursor, or null if the cursor is not
 * currently inside one. Drives the typeahead submode.
 */
export function atMentionAtCursor(text: string, cursor: number): string | null {
  const before = text.slice(0, cursor)
  const atIdx = before.lastIndexOf('@')
  if (atIdx === -1) return null

  // Mirror AT_MENTION_RE's whitespace anchor so email-style `@` inside a
  // non-whitespace token does not open the picker.
  if (atIdx > 0) {
    const prev = before[atIdx - 1]
    if (prev === undefined || !/\s/.test(prev)) return null
  }

  const token = before.slice(atIdx + 1)
  if (/\s/.test(token)) return null

  return token
}
