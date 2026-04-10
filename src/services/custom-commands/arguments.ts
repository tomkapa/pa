import { parse as shellParse } from 'shell-quote'

/**
 * Parse a raw argument string into individual arguments using shell-style
 * quoting rules. Falls back to whitespace splitting if shell parsing fails.
 */
function parseShellArgs(args: string): string[] {
  if (!args.trim()) return []
  try {
    const parsed = shellParse(args)
    return parsed
      .filter((entry): entry is string => typeof entry === 'string')
  } catch {
    return args.trim().split(/\s+/)
  }
}

/**
 * Parse argument names from the frontmatter `arguments` field.
 *
 * Accepts either a space-separated string or a YAML list. Rejects purely
 * numeric names (e.g. "0", "1") to avoid collisions with the `$0` shorthand.
 */
export function parseArgNames(
  input: string | string[] | undefined,
): string[] {
  if (input === undefined) return []

  const names = Array.isArray(input)
    ? input
    : input.trim().split(/\s+/).filter(Boolean)

  return names.filter(name => !/^\d+$/.test(name))
}

/**
 * Substitute argument placeholders in a command's prompt content.
 *
 * Supports three substitution patterns:
 * - `$ARGUMENTS` — full args string as-is
 * - `$ARGUMENTS[N]` / `$N` — indexed arguments (0-based)
 * - `$name` — named arguments (from frontmatter `arguments` field)
 *
 * If no placeholder is found and the user provided arguments, appends them
 * as a fallback to ensure arguments are never silently lost.
 */
export function substituteArguments(
  content: string,
  args: string,
  argNames: string[],
): string {
  const parsed = parseShellArgs(args)
  let result = content

  // Named args: $name → value (must happen BEFORE indexed to avoid partial matches)
  for (let i = 0; i < argNames.length; i++) {
    result = result.replaceAll(`$${argNames[i]}`, parsed[i] ?? '')
  }

  // Indexed: $ARGUMENTS[N] and $N shorthand
  for (let i = 0; i < parsed.length; i++) {
    result = result.replaceAll(`$ARGUMENTS[${i}]`, parsed[i]!)
    result = result.replaceAll(`$${i}`, parsed[i]!)
  }

  // Full: $ARGUMENTS
  result = result.replaceAll('$ARGUMENTS', args)

  // Fallback: append if no substitution occurred
  if (result === content && args.trim()) {
    result += `\n\nARGUMENTS: ${args}`
  }

  return result
}
