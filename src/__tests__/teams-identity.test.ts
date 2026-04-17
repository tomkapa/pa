import { describe, test, expect, afterEach } from 'bun:test'
import {
  setTeammateIdentity,
  clearTeammateIdentity,
  isTeammate,
  getAgentId,
  getAgentName,
  getTeamName,
} from '../services/teams/identity.js'

const envKeys = ['PA_AGENT_ID', 'PA_AGENT_NAME', 'PA_TEAM_NAME'] as const
const savedEnv: Partial<Record<typeof envKeys[number], string | undefined>> = {}

afterEach(() => {
  for (const key of envKeys) {
    const saved = savedEnv[key]
    if (saved === undefined) delete process.env[key]
    else process.env[key] = saved
    delete savedEnv[key]
  }
  clearTeammateIdentity()
})

function stashEnv(key: typeof envKeys[number]): void {
  savedEnv[key] = process.env[key]
}

describe('teammate identity', () => {
  test('defaults to not a teammate', () => {
    expect(isTeammate()).toBe(false)
    expect(getAgentId()).toBeUndefined()
  })

  test('setTeammateIdentity sanitizes names', () => {
    setTeammateIdentity({
      agentId: 'Researcher@My Team',
      agentName: 'Researcher',
      teamName: 'My Team',
    })
    expect(isTeammate()).toBe(true)
    expect(getAgentId()).toBe('Researcher@My Team')
    expect(getAgentName()).toBe('researcher')
    expect(getTeamName()).toBe('my-team')
  })

  test('reads identity from env vars when unset', () => {
    for (const key of envKeys) stashEnv(key)
    process.env['PA_AGENT_ID'] = 'scout@ops'
    process.env['PA_AGENT_NAME'] = 'Scout'
    process.env['PA_TEAM_NAME'] = 'ops'
    expect(isTeammate()).toBe(true)
    expect(getAgentName()).toBe('scout')
    expect(getTeamName()).toBe('ops')
  })

  test('prefers explicit identity over env vars', () => {
    for (const key of envKeys) stashEnv(key)
    process.env['PA_AGENT_ID'] = 'env@team'
    process.env['PA_AGENT_NAME'] = 'env'
    process.env['PA_TEAM_NAME'] = 'team'
    setTeammateIdentity({ agentId: 'explicit@alpha', agentName: 'explicit', teamName: 'alpha' })
    expect(getAgentName()).toBe('explicit')
    expect(getTeamName()).toBe('alpha')
  })

  test('clearTeammateIdentity falls back to env', () => {
    for (const key of envKeys) stashEnv(key)
    setTeammateIdentity({ agentId: 'a@b', agentName: 'a', teamName: 'b' })
    clearTeammateIdentity()
    expect(isTeammate()).toBe(false)
  })
})
