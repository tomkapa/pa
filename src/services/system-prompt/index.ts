// ---------------------------------------------------------------------------
// System Prompt Service — Public API
//
// Composes the standard system prompt from a set of cached/uncached
// sections, exposes the priority-based selector for agent/custom/override
// modes, and provides the user/system context loaders that travel
// alongside the prompt as separate cache blocks.
// ---------------------------------------------------------------------------

export {
  buildEffectiveSystemPrompt,
  getSystemPrompt,
  type SystemPromptAssemblyOptions,
} from './assemble.js'

export {
  cachedSection,
  getCachedSectionNames,
  resetSectionCache,
  resolveSections,
  resolveSectionsDetailed,
  uncachedSection,
} from './registry.js'

export {
  computeEnvironmentInfo,
  getEnvironmentInfoSection,
  getLanguageSection,
  getMcpInstructionsSection,
  getMemorySection,
  getOutputStyleSection,
  getPlanModeSection,
  getSessionGuidanceSection,
  getTeammateModeSection,
  type EnvironmentInfo,
  type MCPServerInfo,
  type SkillSummary,
} from './dynamic-sections.js'

export {
  getActionsSection,
  getDoingTasksSection,
  getIntroSection,
  getOutputEfficiencySection,
  getSystemSection,
  getToneSection,
  getToolGuidanceSection,
} from './static-sections.js'

export {
  buildGitStatus,
  getSystemContext,
  getUserContext,
  resetSystemContextCache,
  resetUserContextCache,
  type ContextOptions,
} from './context.js'

export {
  DYNAMIC_BOUNDARY,
  type EffectiveSystemPromptInputs,
  type ResolvedSection,
  type Section,
  type SystemContext,
  type UserContext,
} from './types.js'
