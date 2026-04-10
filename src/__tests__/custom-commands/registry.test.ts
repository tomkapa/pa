import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import {
  CustomCommandRegistry,
} from '../../services/custom-commands/registry.js'

describe('CustomCommandRegistry', () => {
  let tempDir: string
  let userCmdDir: string
  let projectCmdDir: string

  beforeEach(() => {
    tempDir = path.join(tmpdir(), `pa-reg-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    userCmdDir = path.join(tempDir, 'user-commands')
    projectCmdDir = path.join(tempDir, 'project-commands')
    mkdirSync(userCmdDir, { recursive: true })
    mkdirSync(projectCmdDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  test('discovers and registers commands from directories', async () => {
    writeFileSync(
      path.join(projectCmdDir, 'review.md'),
      `---
description: "Review code"
---

Review this: $ARGUMENTS`,
    )

    const registry = new CustomCommandRegistry()
    await registry.loadFromDirectories({
      userDirs: [],
      projectDirs: [projectCmdDir],
    })

    const cmd = registry.findCommand('review')
    expect(cmd).toBeDefined()
    expect(cmd!.name).toBe('review')
    expect(cmd!.description).toBe('Review code')
  })

  test('user commands shadow project commands with same name', async () => {
    writeFileSync(
      path.join(projectCmdDir, 'review.md'),
      `---
description: "Project review"
---

Project review: $ARGUMENTS`,
    )
    writeFileSync(
      path.join(userCmdDir, 'review.md'),
      `---
description: "User review"
---

User review: $ARGUMENTS`,
    )

    const registry = new CustomCommandRegistry()
    await registry.loadFromDirectories({
      userDirs: [userCmdDir],
      projectDirs: [projectCmdDir],
    })

    const cmd = registry.findCommand('review')
    expect(cmd).toBeDefined()
    expect(cmd!.description).toBe('User review')
    expect(cmd!.source).toBe('user')
  })

  test('findCommand is case-insensitive', async () => {
    writeFileSync(
      path.join(projectCmdDir, 'Review.md'),
      `---
description: "Review"
---

Review`,
    )

    const registry = new CustomCommandRegistry()
    await registry.loadFromDirectories({
      userDirs: [],
      projectDirs: [projectCmdDir],
    })

    expect(registry.findCommand('review')).toBeDefined()
    expect(registry.findCommand('REVIEW')).toBeDefined()
    expect(registry.findCommand('Review')).toBeDefined()
  })

  test('findCommand returns undefined for unknown command', async () => {
    const registry = new CustomCommandRegistry()
    await registry.loadFromDirectories({
      userDirs: [],
      projectDirs: [],
    })

    expect(registry.findCommand('nonexistent')).toBeUndefined()
  })

  test('getPrompt expands $ARGUMENTS', async () => {
    writeFileSync(
      path.join(projectCmdDir, 'review.md'),
      `---
description: "Review"
---

Review this file: $ARGUMENTS`,
    )

    const registry = new CustomCommandRegistry()
    await registry.loadFromDirectories({
      userDirs: [],
      projectDirs: [projectCmdDir],
    })

    const cmd = registry.findCommand('review')!
    const prompt = await cmd.getPrompt('src/main.ts')
    expect(prompt).toBe('Review this file: src/main.ts')
  })

  test('getPrompt expands named arguments', async () => {
    writeFileSync(
      path.join(projectCmdDir, 'copy.md'),
      `---
description: "Copy files"
arguments: "source dest"
---

Copy $source to $dest`,
    )

    const registry = new CustomCommandRegistry()
    await registry.loadFromDirectories({
      userDirs: [],
      projectDirs: [projectCmdDir],
    })

    const cmd = registry.findCommand('copy')!
    const prompt = await cmd.getPrompt('foo.ts bar.ts')
    expect(prompt).toBe('Copy foo.ts to bar.ts')
  })

  test('getCompletions returns matching commands', async () => {
    writeFileSync(
      path.join(projectCmdDir, 'review.md'),
      `---
description: "Review code"
---

Review`,
    )
    writeFileSync(
      path.join(projectCmdDir, 'refactor.md'),
      `---
description: "Refactor code"
---

Refactor`,
    )
    writeFileSync(
      path.join(projectCmdDir, 'deploy.md'),
      `---
description: "Deploy"
---

Deploy`,
    )

    const registry = new CustomCommandRegistry()
    await registry.loadFromDirectories({
      userDirs: [],
      projectDirs: [projectCmdDir],
    })

    const matches = registry.getCompletions('re')
    expect(matches).toHaveLength(2)
    const names = matches.map(c => c.name).sort()
    expect(names).toEqual(['refactor', 'review'])
  })

  test('getCompletions returns all commands for empty prefix', async () => {
    writeFileSync(path.join(projectCmdDir, 'a.md'), 'A')
    writeFileSync(path.join(projectCmdDir, 'b.md'), 'B')

    const registry = new CustomCommandRegistry()
    await registry.loadFromDirectories({
      userDirs: [],
      projectDirs: [projectCmdDir],
    })

    const matches = registry.getCompletions('')
    expect(matches).toHaveLength(2)
  })

  test('exposes argumentHint from frontmatter', async () => {
    writeFileSync(
      path.join(projectCmdDir, 'deploy.md'),
      `---
description: "Deploy"
argument-hint: "[branch] [env]"
---

Deploy $ARGUMENTS`,
    )

    const registry = new CustomCommandRegistry()
    await registry.loadFromDirectories({
      userDirs: [],
      projectDirs: [projectCmdDir],
    })

    const cmd = registry.findCommand('deploy')!
    expect(cmd.argumentHint).toBe('[branch] [env]')
  })

  test('exposes allowedTools from frontmatter (comma-separated string)', async () => {
    writeFileSync(
      path.join(projectCmdDir, 'limited.md'),
      `---
description: "Limited"
allowed-tools: "bash, write, edit"
---

Do something`,
    )

    const registry = new CustomCommandRegistry()
    await registry.loadFromDirectories({
      userDirs: [],
      projectDirs: [projectCmdDir],
    })

    const cmd = registry.findCommand('limited')!
    expect(cmd.allowedTools).toEqual(['bash', 'write', 'edit'])
  })

  test('exposes allowedTools from frontmatter (YAML list)', async () => {
    writeFileSync(
      path.join(projectCmdDir, 'limited.md'),
      `---
description: "Limited"
allowed-tools:
  - bash
  - write
---

Do something`,
    )

    const registry = new CustomCommandRegistry()
    await registry.loadFromDirectories({
      userDirs: [],
      projectDirs: [projectCmdDir],
    })

    const cmd = registry.findCommand('limited')!
    expect(cmd.allowedTools).toEqual(['bash', 'write'])
  })

  test('exposes model override from frontmatter', async () => {
    writeFileSync(
      path.join(projectCmdDir, 'quick.md'),
      `---
description: "Quick task"
model: "haiku"
---

Do something quickly`,
    )

    const registry = new CustomCommandRegistry()
    await registry.loadFromDirectories({
      userDirs: [],
      projectDirs: [projectCmdDir],
    })

    const cmd = registry.findCommand('quick')!
    expect(cmd.model).toBe('haiku')
  })

  test('handles invalid YAML without crashing', async () => {
    writeFileSync(
      path.join(projectCmdDir, 'broken.md'),
      `---
: invalid: [yaml
---

Still works as a prompt`,
    )

    const registry = new CustomCommandRegistry()
    await registry.loadFromDirectories({
      userDirs: [],
      projectDirs: [projectCmdDir],
    })

    const cmd = registry.findCommand('broken')
    expect(cmd).toBeDefined()
    const prompt = await cmd!.getPrompt('')
    // With invalid YAML, the entire file is treated as content
    expect(prompt).toContain('Still works')
  })

  test('toSlashCommands converts to SlashCommand format', async () => {
    writeFileSync(
      path.join(projectCmdDir, 'review.md'),
      `---
description: "Review code"
---

Review: $ARGUMENTS`,
    )

    const registry = new CustomCommandRegistry()
    await registry.loadFromDirectories({
      userDirs: [],
      projectDirs: [projectCmdDir],
    })

    const slashCommands = registry.toSlashCommands()
    expect(slashCommands).toHaveLength(1)
    expect(slashCommands[0]!.name).toBe('review')
    expect(slashCommands[0]!.description).toBe('Review code')
    expect(typeof slashCommands[0]!.execute).toBe('function')
  })
})
