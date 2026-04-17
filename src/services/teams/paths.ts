import path from 'node:path'
import { getObservabilityHome } from '../observability/state.js'

// Filesystem layout:
//   <PA_HOME>/teams/<team-name>/config.json
//   <PA_HOME>/teams/<team-name>/inboxes/<agent-name>.json

export function getTeamsRoot(): string {
  return path.join(getObservabilityHome(), 'teams')
}

export function getTeamDir(teamName: string): string {
  return path.join(getTeamsRoot(), teamName)
}

export function getTeamConfigPath(teamName: string): string {
  return path.join(getTeamDir(teamName), 'config.json')
}

export function getInboxesDir(teamName: string): string {
  return path.join(getTeamDir(teamName), 'inboxes')
}

export function getInboxPath(teamName: string, agentName: string): string {
  return path.join(getInboxesDir(teamName), `${agentName}.json`)
}

/**
 * Make a string safe as a filesystem name. Returns `'unnamed'` if the
 * input reduces to empty so callers never see a blank filename.
 */
export function sanitizeName(raw: string): string {
  const cleaned = raw
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
  return cleaned.length > 0 ? cleaned : 'unnamed'
}

export function buildAgentId(name: string, teamName: string): string {
  return `${sanitizeName(name)}@${sanitizeName(teamName)}`
}
