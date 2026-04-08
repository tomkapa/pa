// Public surface of the session persistence module.

export {
  getConfigHomeDir,
  getProjectsDir,
  getProjectDir,
  getSessionFilePath,
  sanitizePath,
} from './paths.js'

export {
  SESSION_SCHEMA_VERSION,
  wrapMessage,
  unwrapMessage,
  getGitBranch,
  type EnvelopeContext,
  type EnvelopeMeta,
  type SerializedMessage,
} from './envelope.js'

export {
  createSessionWriter,
  type SessionWriter,
  type SessionWriterOptions,
} from './writer.js'

export { loadSession } from './reader.js'

export {
  listProjectSessions,
  findMostRecentSession,
  findSessionById,
  summarizeSessions,
  type SessionInfo,
  type SessionSummary,
} from './discover.js'
