// ---------------------------------------------------------------------------
// Memory Types
//
// CLAUDE.md and rule files are loaded from multiple filesystem levels and
// merged into the system prompt. This file defines the data model that
// represents a single loaded memory file.
// ---------------------------------------------------------------------------

/**
 * Where a memory file came from. Determines its labeling in the system
 * prompt and how its conditional rule patterns are anchored.
 *
 * Loaded in priority order (lowest first; later wins more model attention):
 *   Managed → User → Project → Local
 */
export type MemoryType = 'Managed' | 'User' | 'Project' | 'Local'

/**
 * A single loaded memory file (CLAUDE.md, rule file, or @included child).
 */
export interface MemoryFileInfo {
  /** Absolute path to the file on disk. */
  path: string
  /** Which memory level this file came from. */
  type: MemoryType
  /**
   * Processed file content with frontmatter stripped.
   * This is the content that will be injected into the system prompt.
   */
  content: string
  /**
   * Path of the file that @included this one (undefined for top-level files).
   * Lets the formatter group includes after their parent.
   */
  parent?: string
  /**
   * Glob patterns from `paths:` frontmatter — when set, the file is a
   * conditional rule that only activates if the agent touches a matching path.
   * `undefined` means the file is unconditional (always loaded).
   */
  globs?: string[]
}
