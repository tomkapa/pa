import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { loadSkillsFromDirectory } from '../services/skills/loader.js'

describe('loadSkillsFromDirectory', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = path.join(
      tmpdir(),
      `pa-skill-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    )
    mkdirSync(tempDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  test('loads a skill from subdirectory with SKILL.md', async () => {
    const skillDir = path.join(tempDir, 'my-skill')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      `---
description: "Review code for quality"
---

Review the code in $ARGUMENTS`,
    )

    const skills = await loadSkillsFromDirectory(tempDir, 'user')
    expect(skills).toHaveLength(1)
    expect(skills[0]!.name).toBe('my-skill')
    expect(skills[0]!.description).toBe('Review code for quality')
    expect(skills[0]!.loadedFrom).toBe('skills')
    expect(skills[0]!.source).toBe('user')
    expect(skills[0]!.userInvocable).toBe(true)
    expect(skills[0]!.disableModelInvocation).toBe(false)
    expect(skills[0]!.hasUserSpecifiedDescription).toBe(true)
    expect(skills[0]!.contentLength).toBeGreaterThan(0)
    expect(skills[0]!.skillRoot).toBe(skillDir)
  })

  test('uses directory name as skill name when no name override', async () => {
    const skillDir = path.join(tempDir, 'deploy-prod')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(path.join(skillDir, 'SKILL.md'), 'Deploy to production')

    const skills = await loadSkillsFromDirectory(tempDir, 'project')
    expect(skills[0]!.name).toBe('deploy-prod')
  })

  test('uses name override from frontmatter', async () => {
    const skillDir = path.join(tempDir, 'deploy-prod')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      `---
name: "deploy"
description: "Deploy to production"
---

Deploy now`,
    )

    const skills = await loadSkillsFromDirectory(tempDir, 'project')
    expect(skills[0]!.name).toBe('deploy')
  })

  test('parses when_to_use field', async () => {
    const skillDir = path.join(tempDir, 'review')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      `---
description: "Code review"
when_to_use: "When the user mentions review or asks to check code quality"
---

Review the code`,
    )

    const skills = await loadSkillsFromDirectory(tempDir, 'user')
    expect(skills[0]!.whenToUse).toBe(
      'When the user mentions review or asks to check code quality',
    )
  })

  test('parses when-to-use field (hyphenated)', async () => {
    const skillDir = path.join(tempDir, 'review')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      `---
description: "Code review"
when-to-use: "When reviewing PRs"
---

Review the code`,
    )

    const skills = await loadSkillsFromDirectory(tempDir, 'user')
    expect(skills[0]!.whenToUse).toBe('When reviewing PRs')
  })

  test('parses user-invocable: false', async () => {
    const skillDir = path.join(tempDir, 'internal')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      `---
description: "Internal skill"
user-invocable: "false"
---

Internal logic`,
    )

    const skills = await loadSkillsFromDirectory(tempDir, 'user')
    expect(skills[0]!.userInvocable).toBe(false)
  })

  test('parses disable-model-invocation: true', async () => {
    const skillDir = path.join(tempDir, 'manual-only')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      `---
description: "Manual only skill"
disable-model-invocation: "true"
---

Manual operation`,
    )

    const skills = await loadSkillsFromDirectory(tempDir, 'user')
    expect(skills[0]!.disableModelInvocation).toBe(true)
  })

  test('parses effort field', async () => {
    const skillDir = path.join(tempDir, 'complex')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      `---
description: "Complex task"
effort: "high"
---

Do complex things`,
    )

    const skills = await loadSkillsFromDirectory(tempDir, 'user')
    expect(skills[0]!.effort).toBe('high')
  })

  test('parses version field', async () => {
    const skillDir = path.join(tempDir, 'versioned')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      `---
description: "Versioned"
version: "1.2.3"
---

Content`,
    )

    const skills = await loadSkillsFromDirectory(tempDir, 'user')
    expect(skills[0]!.version).toBe('1.2.3')
  })

  test('parses allowed-tools from frontmatter', async () => {
    const skillDir = path.join(tempDir, 'limited')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      `---
description: "Limited tools"
allowed-tools: "Read, Grep, Glob"
---

Search only`,
    )

    const skills = await loadSkillsFromDirectory(tempDir, 'user')
    expect(skills[0]!.allowedTools).toEqual(['Read', 'Grep', 'Glob'])
  })

  test('parses model override from frontmatter', async () => {
    const skillDir = path.join(tempDir, 'fast')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      `---
description: "Fast task"
model: "haiku"
---

Quick work`,
    )

    const skills = await loadSkillsFromDirectory(tempDir, 'user')
    expect(skills[0]!.model).toBe('haiku')
  })

  test('ignores non-directory entries', async () => {
    writeFileSync(path.join(tempDir, 'loose-file.md'), 'Not a skill')
    writeFileSync(path.join(tempDir, 'config.yaml'), 'not: a skill')

    const skills = await loadSkillsFromDirectory(tempDir, 'user')
    expect(skills).toHaveLength(0)
  })

  test('ignores directories without SKILL.md', async () => {
    const skillDir = path.join(tempDir, 'no-skill')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(path.join(skillDir, 'README.md'), 'Not a skill')

    const skills = await loadSkillsFromDirectory(tempDir, 'user')
    expect(skills).toHaveLength(0)
  })

  test('handles non-existent directory gracefully', async () => {
    const skills = await loadSkillsFromDirectory(
      path.join(tempDir, 'nonexistent'),
      'user',
    )
    expect(skills).toHaveLength(0)
  })

  test('loads multiple skills', async () => {
    for (const name of ['alpha', 'beta', 'gamma']) {
      const dir = path.join(tempDir, name)
      mkdirSync(dir, { recursive: true })
      writeFileSync(
        path.join(dir, 'SKILL.md'),
        `---
description: "${name} skill"
---

${name} content`,
      )
    }

    const skills = await loadSkillsFromDirectory(tempDir, 'project')
    expect(skills).toHaveLength(3)
    const names = skills.map(s => s.name).sort()
    expect(names).toEqual(['alpha', 'beta', 'gamma'])
  })

  test('getPrompt substitutes $ARGUMENTS', async () => {
    const skillDir = path.join(tempDir, 'review')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      `---
description: "Review"
---

Review this: $ARGUMENTS`,
    )

    const skills = await loadSkillsFromDirectory(tempDir, 'user')
    const prompt = await skills[0]!.getPrompt('src/main.ts')
    expect(prompt).toBe('Review this: src/main.ts')
  })

  test('getPrompt substitutes ${CLAUDE_SKILL_DIR}', async () => {
    const skillDir = path.join(tempDir, 'templated')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      `---
description: "Templated"
---

Read the template at \${CLAUDE_SKILL_DIR}/template.json`,
    )

    const skills = await loadSkillsFromDirectory(tempDir, 'user')
    const prompt = await skills[0]!.getPrompt('')
    expect(prompt).toBe(`Read the template at ${skillDir}/template.json`)
  })

  test('getPrompt substitutes ${CLAUDE_SESSION_ID}', async () => {
    const skillDir = path.join(tempDir, 'session')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      `---
description: "Session"
---

Session: \${CLAUDE_SESSION_ID}`,
    )

    const skills = await loadSkillsFromDirectory(tempDir, 'user')
    const prompt = await skills[0]!.getPrompt('')
    // Session ID should be substituted (not remain as placeholder)
    expect(prompt).not.toContain('${CLAUDE_SESSION_ID}')
  })

  test('uses directory name as description when none specified', async () => {
    const skillDir = path.join(tempDir, 'auto-desc')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(path.join(skillDir, 'SKILL.md'), 'Just content')

    const skills = await loadSkillsFromDirectory(tempDir, 'user')
    expect(skills[0]!.description).toBe('auto-desc')
    expect(skills[0]!.hasUserSpecifiedDescription).toBe(false)
  })

  test('parses named arguments', async () => {
    const skillDir = path.join(tempDir, 'with-args')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      `---
description: "With args"
arguments: "file branch"
argument-hint: "<file> <branch>"
---

Deploy $file to $branch`,
    )

    const skills = await loadSkillsFromDirectory(tempDir, 'user')
    expect(skills[0]!.argNames).toEqual(['file', 'branch'])
    expect(skills[0]!.argumentHint).toBe('<file> <branch>')
    const prompt = await skills[0]!.getPrompt('main.ts production')
    expect(prompt).toBe('Deploy main.ts to production')
  })
})
