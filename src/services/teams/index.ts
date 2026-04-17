export type { TeamConfig, TeamMember, TeammateMessage } from './types.js'
export { TEAM_LEADER_NAME } from './types.js'
export {
  getTeamsRoot,
  getTeamDir,
  getTeamConfigPath,
  getInboxesDir,
  getInboxPath,
  sanitizeName,
  buildAgentId,
} from './paths.js'
export {
  createTeam,
  readTeamFile,
  teamExists,
  allocateUniqueTeamName,
  addMember,
  setMemberActive,
  deleteTeam,
} from './team-file.js'
export { writeToMailbox, readMailbox, markRead } from './mailbox.js'
export {
  setTeammateIdentity,
  clearTeammateIdentity,
  setActiveTeamName,
  getTeammateIdentity,
  isTeammate,
  getAgentId,
  getAgentName,
  getTeamName,
} from './identity.js'
export type { TeammateIdentity } from './identity.js'
export { spawnTeammate } from './spawn.js'
export type { SpawnTeammateParams, SpawnTeammateResult } from './spawn.js'
