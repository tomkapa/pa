import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  createTeam,
  readTeamFile,
  addMember,
  setMemberActive,
  deleteTeam,
  teamExists,
  allocateUniqueTeamName,
} from '../services/teams/team-file.js'
import {
  getTeamDir,
  getTeamConfigPath,
  getInboxesDir,
} from '../services/teams/paths.js'
import type { TeamMember } from '../services/teams/types.js'

let tempHome: string
let prevHome: string | undefined

beforeEach(async () => {
  tempHome = await mkdtemp(path.join(tmpdir(), 'pa-teams-'))
  prevHome = process.env['PA_HOME']
  process.env['PA_HOME'] = tempHome
})

afterEach(async () => {
  if (prevHome === undefined) delete process.env['PA_HOME']
  else process.env['PA_HOME'] = prevHome
  await rm(tempHome, { recursive: true, force: true })
})

function makeMember(overrides: Partial<TeamMember> = {}): TeamMember {
  return {
    agentId: 'researcher@alpha',
    name: 'researcher',
    joinedAt: new Date().toISOString(),
    cwd: '/tmp',
    isActive: true,
    mode: 'default',
    ...overrides,
  }
}

describe('team file CRUD', () => {
  test('createTeam writes config and inbox dir', async () => {
    const config = await createTeam({
      teamName: 'alpha',
      description: 'test',
      leadAgentId: 'team-lead@alpha',
    })
    expect(config.teamName).toBe('alpha')
    expect(config.members).toEqual([])
    const dirContents = await readFile(getTeamConfigPath('alpha'), 'utf8')
    expect(JSON.parse(dirContents).leadAgentId).toBe('team-lead@alpha')
    expect(getInboxesDir('alpha').startsWith(getTeamDir('alpha'))).toBe(true)
  })

  test('readTeamFile throws when missing', async () => {
    await expect(readTeamFile('does-not-exist')).rejects.toThrow('Team not found')
  })

  test('addMember registers and replaces entries by name', async () => {
    await createTeam({ teamName: 'alpha', description: '', leadAgentId: 'team-lead@alpha' })
    await addMember('alpha', makeMember({ agentType: 'researcher' }))
    let cfg = await readTeamFile('alpha')
    expect(cfg.members).toHaveLength(1)
    expect(cfg.members[0]!.agentType).toBe('researcher')

    // Re-registering the same name replaces the record.
    await addMember('alpha', makeMember({ agentType: 'updated' }))
    cfg = await readTeamFile('alpha')
    expect(cfg.members).toHaveLength(1)
    expect(cfg.members[0]!.agentType).toBe('updated')
  })

  test('setMemberActive flips the flag', async () => {
    await createTeam({ teamName: 'alpha', description: '', leadAgentId: 'team-lead@alpha' })
    await addMember('alpha', makeMember())
    await setMemberActive('alpha', 'researcher', false)
    const cfg = await readTeamFile('alpha')
    expect(cfg.members[0]!.isActive).toBe(false)
  })

  test('setMemberActive no-ops when team or member missing', async () => {
    await setMemberActive('missing', 'x', false)
    await createTeam({ teamName: 'alpha', description: '', leadAgentId: 'team-lead@alpha' })
    await setMemberActive('alpha', 'not-there', false)
    const cfg = await readTeamFile('alpha')
    expect(cfg.members).toEqual([])
  })

  test('deleteTeam removes directory (idempotent)', async () => {
    await createTeam({ teamName: 'alpha', description: '', leadAgentId: 'team-lead@alpha' })
    expect(await teamExists('alpha')).toBe(true)
    await deleteTeam('alpha')
    expect(await teamExists('alpha')).toBe(false)
    await deleteTeam('alpha')
  })

  test('allocateUniqueTeamName appends numeric suffix on collision', async () => {
    expect(await allocateUniqueTeamName('Alpha Team')).toBe('alpha-team')
    await createTeam({ teamName: 'alpha-team', description: '', leadAgentId: 'team-lead@alpha-team' })
    expect(await allocateUniqueTeamName('alpha-team')).toBe('alpha-team-2')
    await createTeam({ teamName: 'alpha-team-2', description: '', leadAgentId: 'team-lead@alpha-team-2' })
    expect(await allocateUniqueTeamName('alpha team')).toBe('alpha-team-3')
  })

  test('createTeam rejects duplicates', async () => {
    await createTeam({ teamName: 'alpha', description: '', leadAgentId: 'team-lead@alpha' })
    await expect(
      createTeam({ teamName: 'alpha', description: '', leadAgentId: 'team-lead@alpha' }),
    ).rejects.toThrow('already exists')
  })
})
