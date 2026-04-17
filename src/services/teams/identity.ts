import { sanitizeName } from './paths.js'

// Resolution priority for "who am I?":
//   1. Explicitly set via setTeammateIdentity (parsed from CLI args)
//   2. Environment variables (PA_AGENT_ID, PA_AGENT_NAME, PA_TEAM_NAME)
// Leader sessions have no identity set; isTeammate() returns false.

export interface TeammateIdentity {
  agentId: string
  agentName: string
  teamName: string
}

let currentIdentity: TeammateIdentity | null = null
let activeTeamName: string | null = null

export function setTeammateIdentity(identity: TeammateIdentity): void {
  currentIdentity = {
    agentId: identity.agentId,
    agentName: sanitizeName(identity.agentName),
    teamName: sanitizeName(identity.teamName),
  }
}

export function clearTeammateIdentity(): void {
  currentIdentity = null
}

/** Leader-side: TeamCreate calls this so tools like SendMessage can find
 *  the team without the leader being registered as a teammate. */
export function setActiveTeamName(name: string | null): void {
  activeTeamName = name === null ? null : sanitizeName(name)
}

function readFromEnv(): TeammateIdentity | null {
  const agentId = process.env['PA_AGENT_ID']
  const agentName = process.env['PA_AGENT_NAME']
  const teamName = process.env['PA_TEAM_NAME']
  if (!agentId || !agentName || !teamName) return null
  return { agentId, agentName: sanitizeName(agentName), teamName: sanitizeName(teamName) }
}

export function getTeammateIdentity(): TeammateIdentity | null {
  return currentIdentity ?? readFromEnv()
}

export function isTeammate(): boolean {
  return getTeammateIdentity() !== null
}

export function getAgentId(): string | undefined {
  return getTeammateIdentity()?.agentId
}

export function getAgentName(): string | undefined {
  return getTeammateIdentity()?.agentName
}

export function getTeamName(): string | undefined {
  return getTeammateIdentity()?.teamName ?? activeTeamName ?? undefined
}
