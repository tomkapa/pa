import type { ReactNode } from 'react'
import type { ZodType } from 'zod'
import type { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/messages/messages'
import type { Message } from '../../types/message.js'
import type { PermissionResult } from '../permissions/types.js'

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
  getToolUseSummary?(input?: Partial<Input>): string | null
  getActivityDescription?(input?: Partial<Input>): string | null
  isResultTruncated?(output: Output): boolean
}
