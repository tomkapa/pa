import type { PermissionMode } from '../permissions/types.js'

// ---------------------------------------------------------------------------
// Team model — disk-persisted coordination point for multi-agent sessions.
// ---------------------------------------------------------------------------

export interface TeamMember {
  /** Deterministic ID: `{name}@{teamName}`. */
  agentId: string
  name: string
  /** Role hint used when prompting the teammate. */
  agentType?: string
  model?: string
  joinedAt: string
  cwd: string
  isActive: boolean
  mode: PermissionMode
}

export interface TeamConfig {
  teamName: string
  description: string
  createdAt: string
  /** Deterministic ID of the leader: `team-lead@{teamName}`. */
  leadAgentId: string
  members: TeamMember[]
}

export interface TeammateMessage {
  /** Sender's name (not full agentId). */
  from: string
  text: string
  /** ISO timestamp — also acts as the per-inbox identifier. */
  timestamp: string
  read: boolean
  /** 5–10 word preview for UI rendering. */
  summary?: string
}

export const TEAM_LEADER_NAME = 'team-lead'
