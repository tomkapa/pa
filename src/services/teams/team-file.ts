import { promises as fs } from 'node:fs'
import {
  withFileLock,
  readJsonOrNull,
  writeJson,
} from './lock.js'
import { isNodeError } from '../../utils/error.js'
import {
  getTeamConfigPath,
  getTeamDir,
  getInboxesDir,
  sanitizeName,
} from './paths.js'
import type { TeamConfig, TeamMember } from './types.js'

export async function readTeamFile(teamName: string): Promise<TeamConfig> {
  const config = await readJsonOrNull<TeamConfig>(getTeamConfigPath(teamName))
  if (!config) throw new Error(`Team not found: ${teamName}`)
  return config
}

export async function teamExists(teamName: string): Promise<boolean> {
  const config = await readJsonOrNull<TeamConfig>(getTeamConfigPath(teamName))
  return config !== null
}

export async function allocateUniqueTeamName(raw: string): Promise<string> {
  const base = sanitizeName(raw)
  if (!(await teamExists(base))) return base
  let suffix = 2
  while (await teamExists(`${base}-${suffix}`)) suffix++
  return `${base}-${suffix}`
}

export interface CreateTeamParams {
  teamName: string
  description: string
  leadAgentId: string
}

export async function createTeam(params: CreateTeamParams): Promise<TeamConfig> {
  const { teamName, description, leadAgentId } = params
  const configPath = getTeamConfigPath(teamName)
  await fs.mkdir(getTeamDir(teamName), { recursive: true })
  await fs.mkdir(getInboxesDir(teamName), { recursive: true })

  return withFileLock(configPath, async () => {
    // Lock-scoped duplicate check: allocateUniqueTeamName is a pre-check so
    // callers can surface the final name; this guards against two leaders
    // racing on the same raw name.
    const existing = await readJsonOrNull<TeamConfig>(configPath)
    if (existing) throw new Error(`Team already exists: ${teamName}`)
    const config: TeamConfig = {
      teamName,
      description,
      createdAt: new Date().toISOString(),
      leadAgentId,
      members: [],
    }
    await writeJson(configPath, config)
    return config
  })
}

/**
 * Register a member. Replaces any existing record with the same name so
 * re-spawns don't accumulate stale entries.
 */
export async function addMember(
  teamName: string,
  member: TeamMember,
): Promise<void> {
  await withFileLock(getTeamConfigPath(teamName), async () => {
    const config = await readJsonOrNull<TeamConfig>(getTeamConfigPath(teamName))
    if (!config) throw new Error(`Team not found: ${teamName}`)
    const filtered = config.members.filter(m => m.name !== member.name)
    filtered.push(member)
    config.members = filtered
    await writeJson(getTeamConfigPath(teamName), config)
  })
}

export async function setMemberActive(
  teamName: string,
  agentName: string,
  active: boolean,
): Promise<void> {
  await withFileLock(getTeamConfigPath(teamName), async () => {
    const config = await readJsonOrNull<TeamConfig>(getTeamConfigPath(teamName))
    if (!config) return
    const member = config.members.find(m => m.name === agentName)
    if (!member || member.isActive === active) return
    member.isActive = active
    await writeJson(getTeamConfigPath(teamName), config)
  })
}

export async function deleteTeam(teamName: string): Promise<void> {
  try {
    await fs.rm(getTeamDir(teamName), { recursive: true, force: true })
  } catch (error: unknown) {
    if (isNodeError(error) && error.code === 'ENOENT') return
    throw error
  }
}
