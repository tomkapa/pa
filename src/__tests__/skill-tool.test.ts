import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { buildTool } from '../services/tools/build-tool.js'
import { skillToolDef, type SkillToolOutput } from '../tools/skillTool.js'
import { CustomCommandRegistry } from '../services/custom-commands/registry.js'
import { clearInvokedSkills, hasSkillBeenInvoked } from '../services/skills/invocation-tracking.js'
import type { ToolUseContext } from '../services/tools/types.js'

function makeContext(): ToolUseContext {
  return {
    abortController: new AbortController(),
    messages: [],
    options: { tools: [], debug: false, verbose: false },
  }
}

describe('SkillTool', () => {
  let tempDir: string
  let skillDir: string
  let registry: CustomCommandRegistry

  beforeEach(async () => {
    tempDir = path.join(
      tmpdir(),
      `pa-skilltool-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    )
    skillDir = path.join(tempDir, 'skills')
    mkdirSync(skillDir, { recursive: true })
    clearInvokedSkills()
    registry = new CustomCommandRegistry()
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
    clearInvokedSkills()
  })

  async function loadSkills() {
    await registry.loadFromDirectories({
      userDirs: [],
      projectDirs: [],
      projectSkillDir: skillDir,
    })
  }

  test('invokes a skill by name and returns expanded content', async () => {
    const sd = path.join(skillDir, 'greet')
    mkdirSync(sd, { recursive: true })
    writeFileSync(
      path.join(sd, 'SKILL.md'),
      `---
description: "Greet someone"
---

Hello, $ARGUMENTS!`,
    )
    await loadSkills()

    const tool = buildTool(skillToolDef({ registry }))
    const result = await tool.call({ skill: 'greet', args: 'World' }, makeContext())
    const data = result.data as SkillToolOutput
    expect(data.success).toBe(true)
    expect(data.commandName).toBe('greet')
    expect(data.content).toBe('Hello, World!')
  })

  test('strips leading slash from skill name', async () => {
    const sd = path.join(skillDir, 'review')
    mkdirSync(sd, { recursive: true })
    writeFileSync(
      path.join(sd, 'SKILL.md'),
      `---
description: "Review"
---

Review code`,
    )
    await loadSkills()

    const tool = buildTool(skillToolDef({ registry }))
    const result = await tool.call({ skill: '/review' }, makeContext())
    const data = result.data as SkillToolOutput
    expect(data.success).toBe(true)
    expect(data.commandName).toBe('review')
  })

  test('returns error for unknown skill', async () => {
    await loadSkills()
    const tool = buildTool(skillToolDef({ registry }))
    const result = await tool.call({ skill: 'nonexistent' }, makeContext())
    const data = result.data as SkillToolOutput
    expect(data.success).toBe(false)
  })

  test('validateInput rejects unknown skill', async () => {
    await loadSkills()
    const tool = buildTool(skillToolDef({ registry }))
    const validation = await tool.validateInput!({ skill: 'nonexistent' }, makeContext())
    expect(validation.result).toBe(false)
  })

  test('validateInput rejects model-disabled skill', async () => {
    const sd = path.join(skillDir, 'manual')
    mkdirSync(sd, { recursive: true })
    writeFileSync(
      path.join(sd, 'SKILL.md'),
      `---
description: "Manual only"
disable-model-invocation: "true"
---

Manual content`,
    )
    await loadSkills()

    const tool = buildTool(skillToolDef({ registry }))
    const validation = await tool.validateInput!({ skill: 'manual' }, makeContext())
    expect(validation.result).toBe(false)
    if (!validation.result) {
      expect(validation.message).toContain('cannot be invoked by model')
    }
  })

  test('validateInput accepts valid skill', async () => {
    const sd = path.join(skillDir, 'valid')
    mkdirSync(sd, { recursive: true })
    writeFileSync(
      path.join(sd, 'SKILL.md'),
      `---
description: "Valid"
---

Content`,
    )
    await loadSkills()

    const tool = buildTool(skillToolDef({ registry }))
    const validation = await tool.validateInput!({ skill: 'valid' }, makeContext())
    expect(validation.result).toBe(true)
  })

  test('tracks invocation for re-injection prevention', async () => {
    const sd = path.join(skillDir, 'tracked')
    mkdirSync(sd, { recursive: true })
    writeFileSync(
      path.join(sd, 'SKILL.md'),
      `---
description: "Tracked"
---

Content`,
    )
    await loadSkills()

    expect(hasSkillBeenInvoked('tracked')).toBe(false)

    const tool = buildTool(skillToolDef({ registry }))
    await tool.call({ skill: 'tracked' }, makeContext())

    expect(hasSkillBeenInvoked('tracked')).toBe(true)
  })

  test('returns allowedTools and model from skill metadata', async () => {
    const sd = path.join(skillDir, 'limited')
    mkdirSync(sd, { recursive: true })
    writeFileSync(
      path.join(sd, 'SKILL.md'),
      `---
description: "Limited"
allowed-tools: "Read, Grep"
model: "haiku"
---

Content`,
    )
    await loadSkills()

    const tool = buildTool(skillToolDef({ registry }))
    const result = await tool.call({ skill: 'limited' }, makeContext())
    const data = result.data as SkillToolOutput
    expect(data.allowedTools).toEqual(['Read', 'Grep'])
    expect(data.model).toBe('haiku')
  })

  test('mapToolResultToToolResultBlockParam formats success', async () => {
    const def = skillToolDef({ registry })
    const param = def.mapToolResultToToolResultBlockParam(
      {
        success: true,
        commandName: 'test',
        status: 'inline',
        content: 'expanded content',
      },
      'tool-123',
    )
    expect(param.type).toBe('tool_result')
    expect(param.tool_use_id).toBe('tool-123')
    expect(param.content).toBe('expanded content')
    expect(param.is_error).toBeUndefined()
  })

  test('mapToolResultToToolResultBlockParam formats error', async () => {
    const def = skillToolDef({ registry })
    const param = def.mapToolResultToToolResultBlockParam(
      {
        success: false,
        commandName: 'unknown',
        status: 'inline',
        content: 'Unknown skill: unknown',
      },
      'tool-456',
    )
    expect(param.is_error).toBe(true)
  })

  test('userFacingName includes skill name', async () => {
    const def = skillToolDef({ registry })
    expect(def.userFacingName!({ skill: 'commit' })).toBe('Skill(commit)')
    expect(def.userFacingName!({})).toBe('Skill')
  })

  test('defaults to empty args when none provided', async () => {
    const sd = path.join(skillDir, 'noargs')
    mkdirSync(sd, { recursive: true })
    writeFileSync(
      path.join(sd, 'SKILL.md'),
      `---
description: "No args"
---

Static content`,
    )
    await loadSkills()

    const tool = buildTool(skillToolDef({ registry }))
    const result = await tool.call({ skill: 'noargs' }, makeContext())
    const data = result.data as SkillToolOutput
    expect(data.success).toBe(true)
    expect(data.content).toBe('Static content')
  })
})
