// ---------------------------------------------------------------------------
// @include Directive Extraction
//
// CLAUDE.md files can reference other files via `@path`. We extract these
// references from text portions of the markdown only — references inside
// fenced code blocks (```) or inline code (`...`) are NOT followed, so that
// example syntax in documentation doesn't accidentally include real files.
//
// Syntax:
//   @path                — relative to the including file's directory
//   @./relative/path     — same as above
//   @~/path              — relative to home directory
//   @/absolute/path      — absolute filesystem path
//   @path\ with\ spaces  — backslash-escaped spaces
//   @file.md#section     — fragment identifier is stripped before loading
// ---------------------------------------------------------------------------

import { Lexer, type Token, type Tokens } from 'marked'

/**
 * Match `@<path>` where `<path>` is a sequence of non-space characters with
 * optional backslash-escaped spaces. Anchored to start-of-string or whitespace
 * so we don't match the `@` in `user@host`.
 */
const INCLUDE_RE = /(?:^|\s)@((?:[^\s\\]|\\ )+)/g

/**
 * Extract all `@path` includes from a markdown document, preserving the
 * order they appear in. Code blocks and inline code are skipped.
 *
 * The returned strings are the raw paths as written in the markdown
 * (with escape sequences resolved and fragment identifiers stripped) —
 * resolution to absolute filesystem paths happens in the loader.
 */
export function extractIncludes(markdown: string): string[] {
  // Cheap pre-check: most CLAUDE.md files have no `@` at all. Skip the
  // marked lexer entirely in that case.
  if (!markdown.includes('@')) return []

  const lexer = new Lexer()
  const tokens = lexer.lex(markdown)
  const results: string[] = []
  walkTokens(tokens, results)
  return results
}

function walkTokens(tokens: Token[], out: string[]): void {
  for (const token of tokens) {
    visit(token, out)
  }
}

function visit(token: Token, out: string[]): void {
  switch (token.type) {
    // Skip anything that contains literal code — those @paths are examples,
    // not real includes.
    case 'code':
    case 'codespan':
    case 'html':
      return

    // Pure text — scan for @paths.
    case 'text': {
      const text = token as Tokens.Text
      // If the text token has nested inline tokens (e.g. it contains
      // a `code` span), recurse so we skip the codespan but still scan
      // surrounding text.
      if (text.tokens && text.tokens.length > 0) {
        walkTokens(text.tokens, out)
      } else {
        scanText(text.text ?? text.raw ?? '', out)
      }
      return
    }

    // Container tokens — recurse into children.
    default: {
      const anyToken = token as Token & {
        tokens?: Token[]
        items?: Tokens.ListItem[]
      }
      if (anyToken.tokens && anyToken.tokens.length > 0) {
        walkTokens(anyToken.tokens, out)
      }
      if (anyToken.items && anyToken.items.length > 0) {
        for (const item of anyToken.items) {
          if (item.tokens) walkTokens(item.tokens, out)
        }
      }
      return
    }
  }
}

function scanText(text: string, out: string[]): void {
  // Reset stateful regex between calls.
  INCLUDE_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = INCLUDE_RE.exec(text)) !== null) {
    const raw = match[1]
    if (!raw) continue
    out.push(normalizeIncludePath(raw))
  }
}

/**
 * Resolve backslash-escapes and strip fragment identifiers.
 *
 *   `path\ with\ spaces`  → `path with spaces`
 *   `file.md#anchor`      → `file.md`
 */
export function normalizeIncludePath(raw: string): string {
  // Resolve backslash-escapes.
  const unescaped = raw.replace(/\\ /g, ' ')
  // Strip URL-style fragment identifier (everything from the first '#').
  const hashIndex = unescaped.indexOf('#')
  return hashIndex === -1 ? unescaped : unescaped.slice(0, hashIndex)
}
