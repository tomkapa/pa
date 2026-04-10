import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { scanCommandDirectories, deriveCommandName } from '../../services/custom-commands/scanner.js'

describe('deriveCommandName', () => {
  test('derives name from simple filename', () => {
    expect(deriveCommandName('review.md', '/')).toBe('review')
  })

  test('derives namespaced name from subdirectory', () => {
    expect(deriveCommandName('frontend/component.md', '/')).toBe('frontend:component')
  })

  test('derives deeply nested name', () => {
    expect(deriveCommandName('a/b/c.md', '/')).toBe('a:b:c')
  })

  test('lowercases the result', () => {
    expect(deriveCommandName('Frontend/Component.md', '/')).toBe('frontend:component')
  })

  test('derives name from directory-based pattern (SKILL.md)', () => {
    expect(deriveCommandName('my-command/SKILL.md', '/')).toBe('my-command')
  })

  test('handles platform path separators', () => {
    // Always normalize to colons regardless of OS
    expect(deriveCommandName(path.join('frontend', 'component.md'), path.sep)).toBe(
      'frontend:component',
    )
  })
})

describe('scanCommandDirectories', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = path.join(tmpdir(), `pa-cmd-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(tempDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  test('discovers .md files in a directory', async () => {
    const cmdDir = path.join(tempDir, '.pa', 'commands')
    mkdirSync(cmdDir, { recursive: true })
    writeFileSync(path.join(cmdDir, 'review.md'), 'Review: $ARGUMENTS')
    writeFileSync(path.join(cmdDir, 'deploy.md'), 'Deploy: $ARGUMENTS')

    const commands = await scanCommandDirectories([cmdDir], 'project')
    expect(commands).toHaveLength(2)
    const names = commands.map(c => c.name).sort()
    expect(names).toEqual(['deploy', 'review'])
  })

  test('discovers commands in subdirectories', async () => {
    const cmdDir = path.join(tempDir, '.pa', 'commands')
    mkdirSync(path.join(cmdDir, 'frontend'), { recursive: true })
    writeFileSync(path.join(cmdDir, 'frontend', 'component.md'), 'Create component')

    const commands = await scanCommandDirectories([cmdDir], 'project')
    expect(commands).toHaveLength(1)
    expect(commands[0]!.name).toBe('frontend:component')
  })

  test('discovers SKILL.md directory-based commands', async () => {
    const cmdDir = path.join(tempDir, '.pa', 'commands')
    mkdirSync(path.join(cmdDir, 'my-command'), { recursive: true })
    writeFileSync(path.join(cmdDir, 'my-command', 'SKILL.md'), 'My command prompt')

    const commands = await scanCommandDirectories([cmdDir], 'project')
    expect(commands).toHaveLength(1)
    expect(commands[0]!.name).toBe('my-command')
  })

  test('returns empty array for non-existent directory', async () => {
    const commands = await scanCommandDirectories(
      [path.join(tempDir, 'nonexistent')],
      'project',
    )
    expect(commands).toEqual([])
  })

  test('ignores non-.md files', async () => {
    const cmdDir = path.join(tempDir, '.pa', 'commands')
    mkdirSync(cmdDir, { recursive: true })
    writeFileSync(path.join(cmdDir, 'review.md'), 'Review prompt')
    writeFileSync(path.join(cmdDir, 'notes.txt'), 'Not a command')
    writeFileSync(path.join(cmdDir, 'config.json'), '{}')

    const commands = await scanCommandDirectories([cmdDir], 'project')
    expect(commands).toHaveLength(1)
    expect(commands[0]!.name).toBe('review')
  })

  test('deduplicates by realpath (symlinks)', async () => {
    const cmdDir = path.join(tempDir, '.pa', 'commands')
    mkdirSync(cmdDir, { recursive: true })
    const original = path.join(cmdDir, 'review.md')
    writeFileSync(original, 'Review prompt')
    symlinkSync(original, path.join(cmdDir, 'review-link.md'))

    const commands = await scanCommandDirectories([cmdDir], 'project')
    // Both point to the same realpath — deduplicated to 1
    expect(commands).toHaveLength(1)
    expect(commands[0]!.name).toBe('review')
  })

  test('assigns correct source', async () => {
    const cmdDir = path.join(tempDir, '.pa', 'commands')
    mkdirSync(cmdDir, { recursive: true })
    writeFileSync(path.join(cmdDir, 'review.md'), 'Review prompt')

    const userCommands = await scanCommandDirectories([cmdDir], 'user')
    const projectCommands = await scanCommandDirectories([cmdDir], 'project')

    expect(userCommands[0]!.source).toBe('user')
    expect(projectCommands[0]!.source).toBe('project')
  })
})
