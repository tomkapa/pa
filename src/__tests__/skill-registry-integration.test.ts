import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { CustomCommandRegistry } from '../services/custom-commands/registry.js'

describe('CustomCommandRegistry skill integration', () => {
  let tempDir: string
  let userCmdDir: string
  let projectCmdDir: string
  let userSkillDir: string
  let projectSkillDir: string

  beforeEach(() => {
    tempDir = path.join(
      tmpdir(),
      `pa-skillreg-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    )
    userCmdDir = path.join(tempDir, 'user-commands')
    projectCmdDir = path.join(tempDir, 'project-commands')
    userSkillDir = path.join(tempDir, 'user-skills')
    projectSkillDir = path.join(tempDir, 'project-skills')
    mkdirSync(userCmdDir, { recursive: true })
    mkdirSync(projectCmdDir, { recursive: true })
    mkdirSync(userSkillDir, { recursive: true })
    mkdirSync(projectSkillDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  test('skills shadow commands with the same name', async () => {
    // Command in project
    writeFileSync(
      path.join(projectCmdDir, 'review.md'),
      `---
description: "Command review"
---

Command review: $ARGUMENTS`,
    )

    // Skill in project
    const skillDir = path.join(projectSkillDir, 'review')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      `---
description: "Skill review"
---

Skill review: $ARGUMENTS`,
    )

    const registry = new CustomCommandRegistry()
    await registry.loadFromDirectories({
      userDirs: [userCmdDir],
      projectDirs: [projectCmdDir],
      userSkillDir,
      projectSkillDir,
    })

    const cmd = registry.findCommand('review')
    expect(cmd).toBeDefined()
    expect(cmd!.description).toBe('Skill review')
    expect(cmd!.loadedFrom).toBe('skills')
  })

  test('user skills shadow project skills', async () => {
    // Project skill
    const projSkill = path.join(projectSkillDir, 'deploy')
    mkdirSync(projSkill, { recursive: true })
    writeFileSync(
      path.join(projSkill, 'SKILL.md'),
      `---
description: "Project deploy"
---

Project deploy`,
    )

    // User skill with same name
    const userSkill = path.join(userSkillDir, 'deploy')
    mkdirSync(userSkill, { recursive: true })
    writeFileSync(
      path.join(userSkill, 'SKILL.md'),
      `---
description: "User deploy"
---

User deploy`,
    )

    const registry = new CustomCommandRegistry()
    await registry.loadFromDirectories({
      userDirs: [userCmdDir],
      projectDirs: [projectCmdDir],
      userSkillDir,
      projectSkillDir,
    })

    const cmd = registry.findCommand('deploy')
    expect(cmd).toBeDefined()
    expect(cmd!.description).toBe('User deploy')
    expect(cmd!.source).toBe('user')
  })

  test('skills and commands coexist when names differ', async () => {
    writeFileSync(
      path.join(projectCmdDir, 'cmd-only.md'),
      `---
description: "Command"
---

Command content`,
    )

    const skillDir = path.join(projectSkillDir, 'skill-only')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      `---
description: "Skill"
---

Skill content`,
    )

    const registry = new CustomCommandRegistry()
    await registry.loadFromDirectories({
      userDirs: [],
      projectDirs: [projectCmdDir],
      userSkillDir,
      projectSkillDir,
    })

    expect(registry.findCommand('cmd-only')).toBeDefined()
    expect(registry.findCommand('skill-only')).toBeDefined()
    expect(registry.getAllCommands()).toHaveLength(2)
  })

  test('toSlashCommands excludes user-invocable: false skills', async () => {
    const visibleSkill = path.join(projectSkillDir, 'visible')
    mkdirSync(visibleSkill, { recursive: true })
    writeFileSync(
      path.join(visibleSkill, 'SKILL.md'),
      `---
description: "Visible"
---

Content`,
    )

    const hiddenSkill = path.join(projectSkillDir, 'hidden')
    mkdirSync(hiddenSkill, { recursive: true })
    writeFileSync(
      path.join(hiddenSkill, 'SKILL.md'),
      `---
description: "Hidden"
user-invocable: "false"
---

Content`,
    )

    const registry = new CustomCommandRegistry()
    await registry.loadFromDirectories({
      userDirs: [],
      projectDirs: [],
      userSkillDir,
      projectSkillDir,
    })

    const slashCommands = registry.toSlashCommands()
    const names = slashCommands.map(c => c.name)
    expect(names).toContain('visible')
    expect(names).not.toContain('hidden')
  })

  test('getModelInvocableCommands excludes disabled skills', async () => {
    const normalSkill = path.join(projectSkillDir, 'normal')
    mkdirSync(normalSkill, { recursive: true })
    writeFileSync(
      path.join(normalSkill, 'SKILL.md'),
      `---
description: "Normal"
---

Content`,
    )

    const disabledSkill = path.join(projectSkillDir, 'disabled')
    mkdirSync(disabledSkill, { recursive: true })
    writeFileSync(
      path.join(disabledSkill, 'SKILL.md'),
      `---
description: "Disabled"
disable-model-invocation: "true"
---

Content`,
    )

    const registry = new CustomCommandRegistry()
    await registry.loadFromDirectories({
      userDirs: [],
      projectDirs: [],
      userSkillDir,
      projectSkillDir,
    })

    const invocable = registry.getModelInvocableCommands()
    const names = invocable.map(c => c.name)
    expect(names).toContain('normal')
    expect(names).not.toContain('disabled')
  })

  test('loads with no skill dirs (backward compat)', async () => {
    writeFileSync(
      path.join(projectCmdDir, 'review.md'),
      `---
description: "Review"
---

Review`,
    )

    const registry = new CustomCommandRegistry()
    await registry.loadFromDirectories({
      userDirs: [userCmdDir],
      projectDirs: [projectCmdDir],
      // No skill dirs — backward-compatible call
    })

    expect(registry.findCommand('review')).toBeDefined()
    expect(registry.findCommand('review')!.loadedFrom).toBe('commands')
  })
})
