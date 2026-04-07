// ---------------------------------------------------------------------------
// Memory Service — Public API
//
// Loads CLAUDE.md and rule files from Managed / User / Project / Local
// scopes, supports @include directives, and exposes conditional rules
// (those with `paths:` frontmatter) for the agent to inject when it
// touches matching files.
// ---------------------------------------------------------------------------

export type { MemoryFileInfo, MemoryType } from './types.js'

export {
  loadMemory,
  getMemory,
  invalidateMemoryCache,
  getManagedRoot,
  type LoadMemoryOptions,
  type LoadedMemory,
} from './loader.js'

export {
  matchesConditionalRule,
  filterConditionalMatches,
} from './conditional-match.js'

export { formatMemoryForPrompt } from './formatter.js'
