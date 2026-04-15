// ---------------------------------------------------------------------------
// System Prompt Assembly
//
// Composes the static and dynamic sections into a single `string[]` ready
// for the API layer. The assembled array always has the shape:
//
//   [...static sections, DYNAMIC_BOUNDARY, ...dynamic sections]
//
// Sections that resolve to `null` are filtered out so the array stays
// dense. The boundary marker is preserved even if the dynamic zone is
// empty so the API layer's split logic can rely on its position.
// ---------------------------------------------------------------------------

import {
  cachedSection,
  resolveSections,
  uncachedSection,
} from './registry.js'
import {
  computeEnvironmentInfo,
  getAutoMemorySection,
  getEnvironmentInfoSection,
  getLanguageSection,
  getMcpInstructionsSection,
  getMemorySection,
  getOutputStyleSection,
  getPlanModeSection,
  getSessionGuidanceSection,
  type MCPServerInfo,
  type SkillSummary,
} from './dynamic-sections.js'
import type { ToolPermissionContext } from '../permissions/types.js'
import {
  getActionsSection,
  getDoingTasksSection,
  getIntroSection,
  getOutputEfficiencySection,
  getSystemSection,
  getToneSection,
  getToolGuidanceSection,
} from './static-sections.js'
import { DYNAMIC_BOUNDARY, type EffectiveSystemPromptInputs, type Section } from './types.js'

export interface SystemPromptAssemblyOptions {
  /** Names of the tools currently enabled in this session. */
  enabledTools: ReadonlySet<string>
  /** Model id (e.g. `claude-opus-4-6`). */
  modelId: string
  /** Optional human-friendly model name. */
  modelName?: string
  /** Connected MCP servers — used for the (uncached) instructions section. */
  mcpClients?: ReadonlyArray<MCPServerInfo>
  /** Loaded skill summaries for the session-guidance section. */
  skills?: ReadonlyArray<SkillSummary>
  /** Current permission context — used for plan-mode system prompt injection. */
  permissionContext?: ToolPermissionContext
  /** Optional language preference (e.g. "French"). */
  language?: string
  /** Optional output-style configuration string. */
  outputStyle?: string
  /**
   * Override the dynamic-section registry. Used by tests so they can
   * isolate the assembly logic from real I/O. When provided, this
   * replaces the default registry entirely.
   */
  dynamicSections?: Section[]
}

/**
 * Assemble the standard system prompt as a string array. The first half
 * (up to `DYNAMIC_BOUNDARY`) is intended to be cached for the entire
 * user base; the second half is intended to be cached per session.
 *
 * Adding or removing a section does not require touching this function:
 * static sections are listed inline (because they are short and pure),
 * dynamic sections come from the registry. To add a new dynamic section,
 * push another `cachedSection(...)` / `uncachedSection(...)` into the
 * array below.
 */
export async function getSystemPrompt(
  options: SystemPromptAssemblyOptions,
): Promise<string[]> {
  const {
    enabledTools,
    modelId,
    modelName,
    mcpClients,
    skills = [],
    language,
    outputStyle,
    permissionContext,
  } = options

  // Pre-compute env info synchronously so it can be embedded in a cached
  // section closure without a `Promise.all` round-trip.
  const envInfo = computeEnvironmentInfo(modelId, modelName)

  const dynamicRegistry: Section[] =
    options.dynamicSections ?? [
      cachedSection('session_guidance', () => getSessionGuidanceSection(enabledTools, skills)),
      cachedSection('memory', () => getMemorySection()),
      cachedSection('auto_memory', () => getAutoMemorySection()),
      cachedSection('env_info', () => getEnvironmentInfoSection(envInfo)),
      cachedSection('language', () => getLanguageSection(language)),
      cachedSection('output_style', () => getOutputStyleSection(outputStyle)),
      uncachedSection(
        'mcp_instructions',
        () => getMcpInstructionsSection(mcpClients),
        'MCP servers connect/disconnect between turns',
      ),
      uncachedSection(
        'plan_mode',
        () => getPlanModeSection(permissionContext),
        'Permission mode changes between turns',
      ),
    ]

  const resolvedDynamic = await resolveSections(dynamicRegistry)

  const sections: Array<string | null> = [
    // Static zone
    getIntroSection(),
    getSystemSection(),
    getDoingTasksSection(),
    getActionsSection(),
    getToolGuidanceSection(enabledTools),
    getToneSection(),
    getOutputEfficiencySection(),
    // Boundary marker — preserved even when the dynamic zone is empty
    // so the API layer's split logic can rely on its position.
    DYNAMIC_BOUNDARY,
    // Dynamic zone
    ...resolvedDynamic,
  ]

  return sections.filter((s): s is string => s !== null)
}

/**
 * Priority-based selector for the effective system prompt. The agent
 * loop calls this with the standard prompt + any overrides; whatever
 * comes out goes straight to the API.
 *
 *   1. `overrideSystemPrompt` — replaces everything (loop / one-shot mode)
 *   2. `agentSystemPrompt`    — set when running as a subagent
 *   3. `customSystemPrompt`   — user-provided via `--system-prompt`
 *   4. `defaultSystemPrompt`  — the full standard prompt
 *
 * `appendSystemPrompt` is concatenated at the end EXCEPT when
 * `overrideSystemPrompt` is set — override implies "this is the entire
 * prompt and nothing else, including append, should sneak in".
 */
export function buildEffectiveSystemPrompt(
  inputs: EffectiveSystemPromptInputs,
): string[] {
  const {
    defaultSystemPrompt,
    customSystemPrompt,
    agentSystemPrompt,
    overrideSystemPrompt,
    appendSystemPrompt,
  } = inputs

  if (overrideSystemPrompt) {
    return [overrideSystemPrompt]
  }

  const base = agentSystemPrompt
    ? [agentSystemPrompt]
    : customSystemPrompt
      ? [customSystemPrompt]
      : defaultSystemPrompt

  if (appendSystemPrompt && appendSystemPrompt.trim().length > 0) {
    return [...base, appendSystemPrompt]
  }
  return [...base]
}
