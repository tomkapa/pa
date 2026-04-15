import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { normalizeToolList } from '../memory/frontmatter.js'
import {
  parseFrontmatter,
  parseSkillFields,
  type CommandFrontmatter,
} from '../custom-commands/frontmatter.js'
import {
  substituteArguments,
  parseArgNames,
} from '../custom-commands/arguments.js'
import { SKILL_FILE } from '../custom-commands/scanner.js'
import type { RegisteredCustomCommand } from '../custom-commands/registry.js'
import { getSessionId } from '../observability/state.js'

/**
 * Load skills from a directory containing skill subdirectories.
 *
 * Each subdirectory must contain a `SKILL.md` file with optional YAML
 * frontmatter. Loose `.md` files and directories without `SKILL.md`
 * are silently skipped.
 *
 * Returns an array of `RegisteredCustomCommand` with `loadedFrom: 'skills'`
 * and all skill-specific fields populated.
 */
export async function loadSkillsFromDirectory(
  dirPath: string,
  source: 'user' | 'project',
): Promise<RegisteredCustomCommand[]> {
  let entries: import('node:fs').Dirent[]
  try {
    const raw = await readdir(dirPath, { withFileTypes: true })
    entries = raw as unknown as import('node:fs').Dirent[]
  } catch {
    return []
  }

  const results = await Promise.all(
    entries
      .filter(entry => entry.isDirectory())
      .map(entry => loadSingleSkill(dirPath, String(entry.name), source)),
  )

  return results.filter((s): s is RegisteredCustomCommand => s !== null)
}

async function loadSingleSkill(
  dirPath: string,
  dirName: string,
  source: 'user' | 'project',
): Promise<RegisteredCustomCommand | null> {
  const skillMdPath = path.join(dirPath, dirName, SKILL_FILE)
  let raw: string
  try {
    raw = await readFile(skillMdPath, 'utf-8')
  } catch {
    return null
  }

  const parsed = parseFrontmatter(raw)
  const fm = parsed.frontmatter as CommandFrontmatter
  const skillFields = parseSkillFields(fm)
  const argNames = parseArgNames(fm.arguments)
  const skillRoot = path.join(dirPath, dirName)
  const skillName = skillFields.nameOverride ?? dirName
  const body = parsed.content

  return {
    name: skillName,
    description: fm.description ?? dirName,
    argumentHint: fm['argument-hint'],
    allowedTools: normalizeToolList(fm['allowed-tools']),
    model: fm.model,
    argNames,
    source,
    loadedFrom: 'skills',
    whenToUse: skillFields.whenToUse,
    userInvocable: skillFields.userInvocable,
    disableModelInvocation: skillFields.disableModelInvocation,
    effort: skillFields.effort,
    version: skillFields.version,
    skillRoot,
    hasUserSpecifiedDescription: !!fm.description,
    contentLength: body.length,
    getPrompt: async (args: string): Promise<string> => {
      const freshRaw = await readFile(skillMdPath, 'utf-8')
      const freshParsed = parseFrontmatter(freshRaw)
      const freshArgNames = parseArgNames(
        (freshParsed.frontmatter as CommandFrontmatter).arguments,
      )
      let expanded = substituteArguments(freshParsed.content, args, freshArgNames)
      expanded = expanded.replaceAll('${CLAUDE_SKILL_DIR}', skillRoot)
      expanded = expanded.replaceAll('${CLAUDE_SESSION_ID}', getSessionId())
      return expanded
    },
  }
}
