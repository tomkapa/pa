import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnTeammate } from '../services/teams/spawn.js'
import { createTeam, readTeamFile, readMailbox } from '../services/teams/index.js'
import { TEAM_LEADER_NAME } from '../services/teams/types.js'
import {
  __setTmuxEnvForTests,
  __setTmuxExecForTests,
  __resetTmuxForTests,
  __getTrackedWindowForTests,
  type TmuxExec,
} from '../services/teams/tmuxPanes.js'

let tempHome: string
let prevHome: string | undefined

beforeEach(async () => {
  tempHome = await mkdtemp(path.join(tmpdir(), 'pa-spawn-tmux-'))
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

describe('spawnTeammate — tmux integration', () => {
  test('routes to a new tmux window when isInsideTmux() is true', async () => {
    __setTmuxEnvForTests({ tmux: '/tmp/tmux-501/default,1,0' })

    const calls: string[][] = []
    const exec: TmuxExec = async (args) => {
      calls.push(args)
      if (args[0] === 'new-window') return { stdout: '@42', stderr: '' }
      return { stdout: '', stderr: '' }
    }
    __setTmuxExecForTests(exec)

    await createTeam({
      teamName: 'alpha',
      description: '',
      leadAgentId: `${TEAM_LEADER_NAME}@alpha`,
    })

    const result = await spawnTeammate({
      teamName: 'alpha',
      name: 'scribe',
      initialPrompt: 'take notes',
      permissionMode: 'default',
      entry: '/dev/null',
    })

    expect(result.agentId).toBe('scribe@alpha')
    expect(result.pid).toBeUndefined()
    expect(result.windowId).toBe('@42')
    expect(__getTrackedWindowForTests('scribe@alpha')).toBe('@42')

    const subcmds = calls.map((c) => c[0])
    expect(subcmds).toContain('new-window')
    expect(subcmds).toContain('send-keys')

    const newWindow = calls.find((c) => c[0] === 'new-window')!
    expect(newWindow).toContain('-d')
    expect(newWindow).toContain('-n')
    expect(newWindow).toContain('scribe')

    const sendKeys = calls.find((c) => c[0] === 'send-keys')!
    expect(sendKeys).toContain('-t')
    expect(sendKeys).toContain('@42')
    expect(sendKeys[sendKeys.length - 1]).toBe('Enter')

    const sent = sendKeys[sendKeys.length - 2] ?? ''
    expect(sent).toContain('--agent-id')
    expect(sent).toContain('--agent-name')
    expect(sent).toContain('--team-name')
    expect(sent).toContain('scribe@alpha')

    const inbox = await readMailbox('alpha', 'scribe')
    expect(inbox).toHaveLength(1)
    expect(inbox[0]!.text).toBe('take notes')

    const config = await readTeamFile('alpha')
    expect(config.members.filter((m) => m.name === 'scribe')).toHaveLength(1)
  })

  test('tmux command failures propagate instead of silently falling back', async () => {
    __setTmuxEnvForTests({ tmux: '/tmp/tmux-501/default,1,0' })
    __setTmuxExecForTests(async () => {
      throw new Error('boom')
    })

    await createTeam({
      teamName: 'beta',
      description: '',
      leadAgentId: `${TEAM_LEADER_NAME}@beta`,
    })

    await expect(
      spawnTeammate({
        teamName: 'beta',
        name: 'runner',
        initialPrompt: 'go',
        permissionMode: 'default',
        entry: '/dev/null',
        stdio: 'ignore',
      }),
    ).rejects.toThrow(/tmux new-window failed/)
    expect(__getTrackedWindowForTests('runner@beta')).toBeUndefined()
  })

  test('no tmux env → subprocess path, no tmux commands fired', async () => {
    const calls: string[][] = []
    __setTmuxExecForTests(async (args) => {
      calls.push(args)
      return { stdout: '@1', stderr: '' }
    })

    await createTeam({
      teamName: 'gamma',
      description: '',
      leadAgentId: `${TEAM_LEADER_NAME}@gamma`,
    })

    const result = await spawnTeammate({
      teamName: 'gamma',
      name: 'solo',
      initialPrompt: 'hi',
      permissionMode: 'default',
      entry: '/dev/null',
      stdio: 'ignore',
    })

    expect(result.windowId).toBeUndefined()
    expect(typeof result.pid).toBe('number')
    expect(calls).toHaveLength(0)
  })
})
