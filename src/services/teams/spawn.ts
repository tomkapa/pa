import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { PermissionMode } from '../permissions/types.js'
import { addMember } from './team-file.js'
import { buildAgentId, sanitizeName } from './paths.js'
import { writeToMailbox } from './mailbox.js'
import { TEAM_LEADER_NAME } from './types.js'

export interface SpawnTeammateParams {
  teamName: string
  name: string
  agentType?: string
  model?: string
  initialPrompt: string
  cwd?: string
  permissionMode: PermissionMode
  /** Override the CLI entry point — mostly for tests. */
  entry?: string
  /** Override child stdio — tests use 'ignore' to keep output quiet. */
  stdio?: 'inherit' | 'ignore' | 'pipe'
}

export interface SpawnTeammateResult {
  agentId: string
  pid: number | undefined
}

function resolveDefaultEntry(): string {
  const here = fileURLToPath(import.meta.url)
  return path.resolve(path.dirname(here), '..', '..', 'entrypoints', 'cli.tsx')
}

// Plan mode is safety-critical: dropping to default here prevents a leader
// in plan mode from leaking plan-mode constraints into an isolated
// teammate process that can't correctly honor them.
function sanitizePermissionMode(mode: PermissionMode): PermissionMode {
  return mode === 'plan' ? 'default' : mode
}

/**
 * Spawn a teammate process and seed its inbox with the initial prompt.
 * Returns immediately — the caller does not wait for the teammate to finish.
 */
export async function spawnTeammate(
  params: SpawnTeammateParams,
): Promise<SpawnTeammateResult> {
  const teamName = sanitizeName(params.teamName)
  const agentName = sanitizeName(params.name)
  if (agentName === TEAM_LEADER_NAME) {
    throw new Error(`Agent name '${TEAM_LEADER_NAME}' is reserved for the leader`)
  }
  const agentId = buildAgentId(agentName, teamName)
  const cwd = params.cwd ?? process.cwd()
  const mode = sanitizePermissionMode(params.permissionMode)

  await addMember(teamName, {
    agentId,
    name: agentName,
    agentType: params.agentType,
    model: params.model,
    joinedAt: new Date().toISOString(),
    cwd,
    isActive: true,
    mode,
  })

  await writeToMailbox(teamName, agentName, {
    from: TEAM_LEADER_NAME,
    text: params.initialPrompt,
    timestamp: new Date().toISOString(),
    read: false,
    summary: 'initial assignment',
  })

  const entry = params.entry ?? resolveDefaultEntry()
  const args = [
    entry,
    '--agent-id', agentId,
    '--agent-name', agentName,
    '--team-name', teamName,
    '--permission-mode', mode,
  ]
  if (params.model) args.push('--model', params.model)

  // Detached + unref so the teammate survives leader death and doesn't
  // keep the leader's event loop open when otherwise ready to exit.
  const child = spawn(process.execPath, args, {
    cwd,
    detached: true,
    stdio: params.stdio ?? 'ignore',
    env: {
      ...process.env,
      PA_AGENT_ID: agentId,
      PA_AGENT_NAME: agentName,
      PA_TEAM_NAME: teamName,
    },
  })
  child.unref()

  return { agentId, pid: child.pid }
}
