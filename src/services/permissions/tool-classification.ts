// ---------------------------------------------------------------------------
// Tool Classification — shared constants for matching strategy selection
// ---------------------------------------------------------------------------

/** Tools that use gitignore-style file path pattern matching */
export const FILE_PATTERN_TOOLS = new Set(['Read', 'Write', 'Edit', 'Glob'])

/** Tools that support :* legacy prefix and wildcard patterns */
export const BASH_PREFIX_TOOLS = new Set(['Bash', 'PowerShell'])
