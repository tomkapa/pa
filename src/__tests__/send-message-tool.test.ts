import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { buildTool } from '../services/tools/build-tool.js'
import { sendMessageToolDef } from '../tools/sendMessageTool.js'
import { teamCreateToolDef } from '../tools/teamCreateTool.js'
import {
  createTeam,
  addMember,
  readMailbox,
  setTeammateIdentity,
  clearTeammateIdentity,
  setActiveTeamName,
} from '../services/teams/index.js'
import { makeContext } from '../testing/make-context.js'

let tempHome: string
let prevHome: string | undefined

beforeEach(async () => {
  tempHome = await mkdtemp(path.join(tmpdir(), 'pa-sendmsg-'))
  prevHome = process.env['PA_HOME']
  process.env['PA_HOME'] = tempHome
})

afterEach(async () => {
  if (prevHome === undefined) delete process.env['PA_HOME']
  else process.env['PA_HOME'] = prevHome
  await rm(tempHome, { recursive: true, force: true })
  clearTeammateIdentity()
  setActiveTeamName(null)
  for (const k of ['PA_AGENT_ID', 'PA_AGENT_NAME', 'PA_TEAM_NAME']) delete process.env[k]
})

async function setupTeam(): Promise<void> {
  await createTeam({ teamName: 'alpha', description: '', leadAgentId: 'team-lead@alpha' })
  await addMember('alpha', {
    agentId: 'researcher@alpha',
    name: 'researcher',
    joinedAt: new Date().toISOString(),
    cwd: '/tmp',
    isActive: true,
    mode: 'default',
  })
  await addMember('alpha', {
    agentId: 'scout@alpha',
    name: 'scout',
    joinedAt: new Date().toISOString(),
    cwd: '/tmp',
    isActive: true,
    mode: 'default',
  })
}

function asLeaderOfAlpha() {
  setActiveTeamName('alpha')
}

function asTeammate(name: string) {
  setTeammateIdentity({ agentId: `${name}@alpha`, agentName: name, teamName: 'alpha' })
}

describe('SendMessage tool', () => {
  test('delivers to a specific recipient', async () => {
    await setupTeam()
    asLeaderOfAlpha()
    const tool = buildTool(sendMessageToolDef())
    const result = await tool.call(
      { to: 'researcher', message: 'go research X' },
      makeContext(),
    )
    expect(result.data.to).toEqual(['researcher'])
    const inbox = await readMailbox('alpha', 'researcher')
    expect(inbox).toHaveLength(1)
    expect(inbox[0]!.text).toBe('go research X')
    expect(inbox[0]!.from).toBe('team-lead')
    expect(inbox[0]!.read).toBe(false)
  })

  test('broadcast "*" from leader skips leader self-delivery', async () => {
    await setupTeam()
    asLeaderOfAlpha()
    const tool = buildTool(sendMessageToolDef())
    const result = await tool.call(
      { to: '*', message: 'standup now' },
      makeContext(),
    )
    expect(result.data.to.sort()).toEqual(['researcher', 'scout'])
    const leaderInbox = await readMailbox('alpha', 'team-lead')
    expect(leaderInbox).toHaveLength(0)
  })

  test('broadcast from teammate reaches other teammates AND leader', async () => {
    await setupTeam()
    asTeammate('researcher')
    const tool = buildTool(sendMessageToolDef())
    const result = await tool.call({ to: '*', message: 'done' }, makeContext())
    expect(result.data.to.sort()).toEqual(['scout', 'team-lead'])
  })

  test('rejects self-addressed messages', async () => {
    await setupTeam()
    asLeaderOfAlpha()
    const tool = buildTool(sendMessageToolDef())
    await expect(
      tool.call({ to: 'team-lead', message: 'self' }, makeContext()),
    ).rejects.toThrow('Cannot SendMessage to yourself')
  })

  test('rejects unknown recipient', async () => {
    await setupTeam()
    asLeaderOfAlpha()
    const tool = buildTool(sendMessageToolDef())
    await expect(
      tool.call({ to: 'ghost', message: 'hi' }, makeContext()),
    ).rejects.toThrow("Recipient 'ghost' not found")
  })

  test('rejects when no team is active', async () => {
    const tool = buildTool(sendMessageToolDef())
    await expect(
      tool.call({ to: 'researcher', message: 'hi' }, makeContext()),
    ).rejects.toThrow('SendMessage requires an active team')
  })
})

describe('TeamCreate tool', () => {
  test('creates team and deduplicates names', async () => {
    const tool = buildTool(teamCreateToolDef())
    const r1 = await tool.call({ team_name: 'My Team' }, makeContext())
    expect(r1.data.team_name).toBe('my-team')
    expect(r1.data.lead_agent_id).toBe('team-lead@my-team')
    const r2 = await tool.call({ team_name: 'my team' }, makeContext())
    expect(r2.data.team_name).toBe('my-team-2')
  })
})
