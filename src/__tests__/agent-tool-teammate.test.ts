import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { buildTool } from '../services/tools/build-tool.js'
import { agentToolDef } from '../tools/agentTool.js'
import { createTeam, readTeamFile, readMailbox } from '../services/teams/index.js'
import { spawnTeammate } from '../services/teams/spawn.js'
import { __resetTmuxForTests } from '../services/teams/tmuxPanes.js'
import type { QueryDeps } from '../services/agent/types.js'
import { makeContext } from '../testing/make-context.js'

let tempHome: string
let prevHome: string | undefined

beforeEach(async () => {
  tempHome = await mkdtemp(path.join(tmpdir(), 'pa-agenttool-'))
  prevHome = process.env['PA_HOME']
  process.env['PA_HOME'] = tempHome
  __resetTmuxForTests()
})

afterEach(async () => {
  __resetTmuxForTests()
  if (prevHome === undefined) delete process.env['PA_HOME']
  else process.env['PA_HOME'] = prevHome
  await rm(tempHome, { recursive: true, force: true })
})

function makeDeps() {
  return {
    tools: [],
    createChildQueryDeps: (): QueryDeps => ({
      callModel: async function* () {},
      executeToolBatch: async function* () {},
      uuid: () => 'fake-uuid',
    }),
  }
}

describe('Agent tool teammate routing', () => {
  test('spawnTeammate writes member + seed message without executing a real process', async () => {
    await createTeam({ teamName: 'alpha', description: '', leadAgentId: 'team-lead@alpha' })
    // Use a noop entry (process.execPath + /dev/null exits immediately).
    await spawnTeammate({
      teamName: 'alpha',
      name: 'researcher',
      initialPrompt: 'look at file X',
      permissionMode: 'default',
      entry: '/dev/null',
      stdio: 'ignore',
    })
    const config = await readTeamFile('alpha')
    expect(config.members.map(m => m.name)).toContain('researcher')
    const inbox = await readMailbox('alpha', 'researcher')
    expect(inbox).toHaveLength(1)
    expect(inbox[0]!.text).toBe('look at file X')
    expect(inbox[0]!.from).toBe('team-lead')
  })

  test('plan permission mode downgrades to default for teammates', async () => {
    await createTeam({ teamName: 'alpha', description: '', leadAgentId: 'team-lead@alpha' })
    await spawnTeammate({
      teamName: 'alpha',
      name: 'scout',
      initialPrompt: 'x',
      permissionMode: 'plan',
      entry: '/dev/null',
      stdio: 'ignore',
    })
    const config = await readTeamFile('alpha')
    const scout = config.members.find(m => m.name === 'scout')!
    expect(scout.mode).toBe('default')
  })

  test('Agent tool errors when only one of name/team_name is supplied', async () => {
    const tool = buildTool(agentToolDef(makeDeps()))
    const result = await tool.call(
      { prompt: 'x', description: 'd', name: 'researcher' },
      makeContext(),
    )
    expect(result.data.status).toBe('error')
    expect(result.data.content).toContain('both `name` and `team_name`')
  })
})
