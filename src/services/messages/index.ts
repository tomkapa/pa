export {
  createUserMessage,
  createAssistantMessage,
  createSystemMessage,
  createCompactBoundaryMessage,
  toContentBlocks,
  type CreateUserMessageParams,
  type CreateAssistantMessageParams,
  type CreateSystemMessageParams,
  type CreateCompactBoundaryParams,
} from './factory.js'

export {
  isHumanTurn,
  isApiMessage,
  isCompactBoundary,
  getMessagesAfterCompactBoundary,
} from './predicates.js'

export { normalizeMessagesForAPI } from './normalize.js'

export { createConversationStore, type ConversationStore } from './store.js'
