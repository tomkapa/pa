import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { CustomCommandRegistry } from '../../services/custom-commands/registry.js'

describe('CustomCommandRegistry integration', () => {
  let tempDir: string
  let userCmdDir: string
  let projectCmdDir: string

  beforeEach(() => {
    tempDir = path.join(tmpdir(), `pa-integ-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    userCmdDir = path.join(tempDir, 'user-commands')
    projectCmdDir = path.join(tempDir, 'project-commands')
    mkdirSync(userCmdDir, { recursive: true })
    mkdirSync(projectCmdDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  test('end-to-end: discover, register, expand command', async () => {
    writeFileSync(
      path.join(projectCmdDir, 'review.md'),
      `---
description: "Review code for quality"
argument-hint: "[file]"
---

Please review this file carefully for bugs and quality: $ARGUMENTS`,
    )

    const registry = new CustomCommandRegistry()
    await registry.loadFromDirectories({
      userDirs: [],
      projectDirs: [projectCmdDir],
    })

    // Discovery
    const all = registry.getAllCommands()
    expect(all).toHaveLength(1)
    expect(all[0]!.name).toBe('review')
    expect(all[0]!.description).toBe('Review code for quality')
    expect(all[0]!.argumentHint).toBe('[file]')

    // Expansion
    const prompt = await all[0]!.getPrompt('src/main.ts')
    expect(prompt).toBe('Please review this file carefully for bugs and quality: src/main.ts')

    // Autocomplete
    const completions = registry.getCompletions('rev')
    expect(completions).toHaveLength(1)
    expect(completions[0]!.name).toBe('review')

    // SlashCommand conversion
    const slashCmds = registry.toSlashCommands()
    expect(slashCmds).toHaveLength(1)
    expect(slashCmds[0]!.name).toBe('review')
  })

  test('end-to-end: namespaced commands in subdirectories', async () => {
    mkdirSync(path.join(projectCmdDir, 'frontend'), { recursive: true })
    mkdirSync(path.join(projectCmdDir, 'backend'), { recursive: true })

    writeFileSync(
      path.join(projectCmdDir, 'frontend', 'component.md'),
      `---
description: "Create a React component"
arguments: "name"
---

Create a React component called $name`,
    )
    writeFileSync(
      path.join(projectCmdDir, 'frontend', 'test.md'),
      `---
description: "Write frontend tests"
---

Write tests for: $ARGUMENTS`,
    )
    writeFileSync(
      path.join(projectCmdDir, 'backend', 'api.md'),
      `---
description: "Create an API endpoint"
---

Create API endpoint: $ARGUMENTS`,
    )

    const registry = new CustomCommandRegistry()
    await registry.loadFromDirectories({
      userDirs: [],
      projectDirs: [projectCmdDir],
    })

    const all = registry.getAllCommands()
    expect(all).toHaveLength(3)

    // Namespaced names
    expect(registry.findCommand('frontend:component')).toBeDefined()
    expect(registry.findCommand('frontend:test')).toBeDefined()
    expect(registry.findCommand('backend:api')).toBeDefined()

    // Named argument substitution
    const cmd = registry.findCommand('frontend:component')!
    const prompt = await cmd.getPrompt('Button')
    expect(prompt).toBe('Create a React component called Button')

    // Prefix completion
    const frontendCmds = registry.getCompletions('frontend:')
    expect(frontendCmds).toHaveLength(2)
  })

  test('end-to-end: user commands shadow project commands', async () => {
    writeFileSync(
      path.join(projectCmdDir, 'deploy.md'),
      `---
description: "Deploy (project)"
---

Deploy project version: $ARGUMENTS`,
    )
    writeFileSync(
      path.join(userCmdDir, 'deploy.md'),
      `---
description: "Deploy (user)"
---

Deploy with my custom config: $ARGUMENTS`,
    )

    const registry = new CustomCommandRegistry()
    await registry.loadFromDirectories({
      userDirs: [userCmdDir],
      projectDirs: [projectCmdDir],
    })

    const cmd = registry.findCommand('deploy')!
    expect(cmd.source).toBe('user')
    expect(cmd.description).toBe('Deploy (user)')

    const prompt = await cmd.getPrompt('v2.0')
    expect(prompt).toBe('Deploy with my custom config: v2.0')
  })

  test('end-to-end: allowed-tools and model from frontmatter', async () => {
    writeFileSync(
      path.join(projectCmdDir, 'quick-review.md'),
      `---
description: "Quick review"
allowed-tools: "Read, Grep, Glob"
model: "haiku"
---

Quickly review: $ARGUMENTS`,
    )

    const registry = new CustomCommandRegistry()
    await registry.loadFromDirectories({
      userDirs: [],
      projectDirs: [projectCmdDir],
    })

    const cmd = registry.findCommand('quick-review')!
    expect(cmd.allowedTools).toEqual(['Read', 'Grep', 'Glob'])
    expect(cmd.model).toBe('haiku')
  })

  test('end-to-end: command with no frontmatter works as plain prompt', async () => {
    writeFileSync(
      path.join(projectCmdDir, 'simple.md'),
      'Just do the thing with $ARGUMENTS please',
    )

    const registry = new CustomCommandRegistry()
    await registry.loadFromDirectories({
      userDirs: [],
      projectDirs: [projectCmdDir],
    })

    const cmd = registry.findCommand('simple')!
    expect(cmd.description).toBe('')
    const prompt = await cmd.getPrompt('this file')
    expect(prompt).toBe('Just do the thing with this file please')
  })
})
