import type { ReactNode } from 'react'
import type { ZodType } from 'zod'
import type { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/messages/messages'
import type { Message } from '../../types/message.js'
import type { PermissionResult, ToolPermissionContext } from '../permissions/types.js'

export type { ToolResultBlockParam }

// ---------------------------------------------------------------------------
// Render options
// ---------------------------------------------------------------------------

export interface ToolRenderOptions {
  verbose: boolean
}

export interface ToolResultRenderOptions {
  verbose: boolean
  style?: 'condensed'
}

export interface ToolProgressRenderOptions {
  verbose: boolean
  /** Terminal width in columns — used to constrain output width. */
  columns?: number
  /** How many tools are running in parallel right now (for compact rendering). */
  inProgressToolCount?: number
}

// ---------------------------------------------------------------------------
// ProgressMessage — UI-only progress event tied to a specific tool_use_id
//
// Each tool defines its own `data` shape (e.g., BashProgress carries
// stdout/stderr buffers). Progress messages are surfaced in the UI while
// the tool is running and discarded once the tool result arrives — they
// are NEVER serialized to the API.
// ---------------------------------------------------------------------------

export interface ProgressMessage<Data = unknown> {
  type: 'progress'
  toolUseId: string
  toolName: string
  data: Data
  timestamp: string
}

// ---------------------------------------------------------------------------
// Permission & Validation results
// ---------------------------------------------------------------------------

export type { PermissionResult }

export type ValidationResult =
  | { result: true }
  | { result: false; message: string }

// ---------------------------------------------------------------------------
// ToolUseContext — the execution environment a tool sees
// ---------------------------------------------------------------------------

export interface ToolUseContext {
  abortController: AbortController
  messages: Message[]
  options: {
    tools: Tool<unknown, unknown>[]
    debug: boolean
    verbose: boolean
  }
  /**
   * Optional progress emitter — invoked by tools to stream UI-only progress
   * data (e.g., live shell output) while the tool is executing. The execution
   * layer wires this to a queue that yields `progress` events on the tool
   * generator. Tools may call this any number of times before returning;
   * each call's `data` is rendered by the tool's `renderToolUseProgressMessage`.
   * Never sent to the API.
   */
  onProgress?: (data: unknown) => void
  /**
   * Read the current permission context. Used by tools that need to inspect
   * permission state (e.g., plan mode tools reading the current mode).
   */
  getPermissionContext?: () => ToolPermissionContext
  /**
   * Update the permission context via an updater function. Used by tools
   * that need to modify permission state (e.g., plan mode tools changing
   * the active mode). The update takes effect on the next agent turn.
   */
  setPermissionContext?: (
    updater: (ctx: ToolPermissionContext) => ToolPermissionContext,
  ) => void
}

// ---------------------------------------------------------------------------
// ToolResult — what a tool.call() returns
// ---------------------------------------------------------------------------

export interface ToolResult<T> {
  data: T
  newMessages?: Message[]
  contextModifier?: (ctx: ToolUseContext) => ToolUseContext
}

// ---------------------------------------------------------------------------
// Tool — the full contract every tool must satisfy
// ---------------------------------------------------------------------------

export interface Tool<Input = unknown, Output = unknown> {
  name: string
  inputSchema: ZodType<Input>
  maxResultSizeChars: number

  // Core execution
  call(input: Input, context: ToolUseContext): Promise<ToolResult<Output>>

  // API description
  prompt(): Promise<string>
  description(input: Input): Promise<string>

  // Safety metadata
  isReadOnly(input: Input): boolean
  isConcurrencySafe(input: Input): boolean
  isEnabled(): boolean

  // Permission checking
  checkPermissions(input: Input, context: ToolUseContext): Promise<PermissionResult>

  // Input validation (optional, runs before permissions)
  validateInput?(input: Input, context: ToolUseContext): Promise<ValidationResult>

  // Display
  userFacingName(input: Partial<Input>): string

  // Result serialization
  mapToolResultToToolResultBlockParam(output: Output, toolUseID: string): ToolResultBlockParam

  // UI rendering (optional — rendering pipeline provides fallbacks)
  renderToolUseMessage?(input: Partial<Input>, options: ToolRenderOptions): ReactNode
  renderToolResultMessage?(output: Output, options: ToolResultRenderOptions): ReactNode
  renderToolUseErrorMessage?(errorText: string, options: ToolRenderOptions): ReactNode
  /**
   * Live progress UI shown while the tool is executing. Receives every
   * progress event emitted so far for this tool_use_id (most recent last).
   * Returning null disables progress rendering for this tool.
   */
  renderToolUseProgressMessage?(
    progressMessages: ProgressMessage[],
    options: ToolProgressRenderOptions,
  ): ReactNode
  getToolUseSummary?(input?: Partial<Input>): string | null
  getActivityDescription?(input?: Partial<Input>): string | null
  isResultTruncated?(output: Output): boolean
}

// ---------------------------------------------------------------------------
// ToolDef — what you pass to buildTool() (omit fields that have defaults)
// ---------------------------------------------------------------------------

export interface ToolDef<Input = unknown, Output = unknown> {
  name: string
  inputSchema: ZodType<Input>
  maxResultSizeChars: number

  call(input: Input, context: ToolUseContext): Promise<ToolResult<Output>>
  prompt(): Promise<string>
  description(input: Input): Promise<string>
  mapToolResultToToolResultBlockParam(output: Output, toolUseID: string): ToolResultBlockParam

  // Optional — buildTool provides fail-closed defaults
  isReadOnly?(input: Input): boolean
  isConcurrencySafe?(input: Input): boolean
  isEnabled?(): boolean
  checkPermissions?(input: Input, context: ToolUseContext): Promise<PermissionResult>
  validateInput?(input: Input, context: ToolUseContext): Promise<ValidationResult>
  userFacingName?(input: Partial<Input>): string

  // UI rendering (all optional)
  renderToolUseMessage?(input: Partial<Input>, options: ToolRenderOptions): ReactNode
  renderToolResultMessage?(output: Output, options: ToolResultRenderOptions): ReactNode
  renderToolUseErrorMessage?(errorText: string, options: ToolRenderOptions): ReactNode
  renderToolUseProgressMessage?(
    progressMessages: ProgressMessage[],
    options: ToolProgressRenderOptions,
  ): ReactNode
  getToolUseSummary?(input?: Partial<Input>): string | null
  getActivityDescription?(input?: Partial<Input>): string | null
  isResultTruncated?(output: Output): boolean
}
