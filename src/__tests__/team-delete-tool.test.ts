import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { buildTool } from '../services/tools/build-tool.js'
import { teamDeleteToolDef } from '../tools/teamDeleteTool.js'
import {
  addMember,
  createTeam,
  teamExists,
} from '../services/teams/index.js'
import { makeContext } from '../testing/make-context.js'

let tempHome: string
let prevHome: string | undefined

beforeEach(async () => {
  tempHome = await mkdtemp(path.join(tmpdir(), 'pa-teamdel-'))
  prevHome = process.env['PA_HOME']
  process.env['PA_HOME'] = tempHome
})

afterEach(async () => {
  if (prevHome === undefined) delete process.env['PA_HOME']
  else process.env['PA_HOME'] = prevHome
  await rm(tempHome, { recursive: true, force: true })
})

describe('TeamDelete tool', () => {
  test('deletes an inactive team', async () => {
    await createTeam({ teamName: 'alpha', description: '', leadAgentId: 'team-lead@alpha' })
    const tool = buildTool(teamDeleteToolDef())
    const result = await tool.call({ team_name: 'alpha' }, makeContext())
    expect(result.data.deleted).toBe(true)
    expect(await teamExists('alpha')).toBe(false)
  })

  test('refuses deletion when an active teammate exists', async () => {
    await createTeam({ teamName: 'alpha', description: '', leadAgentId: 'team-lead@alpha' })
    await addMember('alpha', {
      agentId: 'r@alpha',
      name: 'r',
      joinedAt: new Date().toISOString(),
      cwd: '/tmp',
      isActive: true,
      mode: 'default',
    })
    const tool = buildTool(teamDeleteToolDef())
    const result = await tool.call({ team_name: 'alpha' }, makeContext())
    expect(result.data.deleted).toBe(false)
    expect(result.data.activeMembers).toEqual(['r'])
    expect(await teamExists('alpha')).toBe(true)
  })

  test('force deletion removes the team even with active members', async () => {
    await createTeam({ teamName: 'alpha', description: '', leadAgentId: 'team-lead@alpha' })
    await addMember('alpha', {
      agentId: 'r@alpha',
      name: 'r',
      joinedAt: new Date().toISOString(),
      cwd: '/tmp',
      isActive: true,
      mode: 'default',
    })
    const tool = buildTool(teamDeleteToolDef())
    const result = await tool.call({ team_name: 'alpha', force: true }, makeContext())
    expect(result.data.deleted).toBe(true)
    expect(await teamExists('alpha')).toBe(false)
  })

  test('deletion is idempotent for missing teams', async () => {
    const tool = buildTool(teamDeleteToolDef())
    const result = await tool.call({ team_name: 'ghost' }, makeContext())
    expect(result.data.deleted).toBe(true)
  })
})
