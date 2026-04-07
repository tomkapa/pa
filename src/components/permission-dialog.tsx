import { useMemo } from 'react'
import { readFileSync } from 'node:fs'
import { relative, basename } from 'node:path'
import { structuredPatch, type StructuredPatch } from 'diff'
import { Box, Text } from '../ink.js'
import { Select, type SelectOption } from './select.js'
import type { ToolUseConfirm } from '../services/permissions/confirm.js'
import type { PermissionUpdate } from '../services/permissions/types.js'
import { expandPath } from '../utils/expandPath.js'
import { truncateCommand } from '../tools/bashToolUI.js'

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

interface PermissionRequestProps {
  confirm: ToolUseConfirm
  onDone: () => void
}

interface PermissionOption {
  readonly label: string
  readonly onSelect: () => void
}

// ---------------------------------------------------------------------------
// PermissionDialog — bordered container for permission prompts
// ---------------------------------------------------------------------------

interface PermissionDialogProps {
  title: string
  subtitle?: string
  color?: string
  children: React.ReactNode
}

export function PermissionDialog({ title, subtitle, color = 'yellow', children }: PermissionDialogProps) {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={color} paddingX={1} paddingBottom={1}>
      <Text color={color} bold>{title}</Text>
      {subtitle && <Text color="gray">{subtitle}</Text>}
      <Box flexDirection="column" marginTop={1}>
        {children}
      </Box>
    </Box>
  )
}

// ---------------------------------------------------------------------------
// PermissionPrompt — reusable option picker
// ---------------------------------------------------------------------------

function PermissionPrompt({ options }: { options: readonly PermissionOption[] }) {
  const selectOptions: SelectOption<number>[] = options.map((opt, i) => ({
    value: i,
    label: `${i + 1}. ${opt.label}`,
  }))

  function handleSelect(index: number) {
    options[index]?.onSelect()
  }

  return <Select options={selectOptions} onSelect={handleSelect} />
}

// ---------------------------------------------------------------------------
// FallbackPermissionRequest — default dialog for any tool
// ---------------------------------------------------------------------------

export function FallbackPermissionRequest({ confirm, onDone }: PermissionRequestProps) {
  const options: PermissionOption[] = [
    {
      label: 'Yes',
      onSelect: () => { confirm.onAllow(confirm.input, []); onDone() },
    },
    {
      label: "Yes, don't ask again",
      onSelect: () => {
        const update: PermissionUpdate = {
          type: 'addRules',
          source: 'session',
          allow: [confirm.tool.name],
        }
        confirm.onAllow(confirm.input, [update])
        onDone()
      },
    },
    {
      label: 'No',
      onSelect: () => { confirm.onReject(); onDone() },
    },
  ]

  return (
    <PermissionDialog title={`Allow Tool: ${confirm.tool.name}`} subtitle={confirm.message}>
      <PermissionPrompt options={options} />
    </PermissionDialog>
  )
}

// ---------------------------------------------------------------------------
// BashPermissionRequest
// ---------------------------------------------------------------------------

const DESTRUCTIVE_PATTERNS: ReadonlyArray<{ pattern: RegExp; warning: string }> = [
  { pattern: /\brm\s+-[rf]/, warning: 'This command will permanently delete files' },
  { pattern: /\bgit\s+reset\s+--hard/, warning: 'This command will discard uncommitted changes' },
  { pattern: /\bgit\s+clean\s+-[df]/, warning: 'This command will delete untracked files' },
  { pattern: /\bgit\s+push\s+.*--force/, warning: 'Force-push overwrites remote history' },
  { pattern: /\bdrop\s+table\b/i, warning: 'This command will drop a database table' },
  { pattern: /\btruncate\s+table\b/i, warning: 'This command will truncate a database table' },
  { pattern: /\bchmod\s+-R\s+777/, warning: 'Setting 777 permissions is insecure' },
  { pattern: /\bdd\s+if=/, warning: 'This command may overwrite raw device data' },
]

function getDestructiveCommandWarning(command: string): string | null {
  for (const { pattern, warning } of DESTRUCTIVE_PATTERNS) {
    if (pattern.test(command)) return warning
  }
  return null
}

function getCommandPrefixes(command: string): { simple: string; firstWord: string } {
  const words = command.trim().split(/\s+/)
  const firstWord = words[0] ?? command
  const simple = words.length >= 2 ? `${firstWord} ${words[1]}*` : `${firstWord}*`
  return { simple, firstWord: `${firstWord}*` }
}

function BashPermissionRequest({ confirm, onDone }: PermissionRequestProps) {
  const input = confirm.input as { command?: string; description?: string }
  const command = input.command ?? ''
  const displayCommand = truncateCommand(command)
  const description = input.description
  const warning = getDestructiveCommandWarning(command)
  const { simple: simplePrefix, firstWord: firstWordPrefix } = getCommandPrefixes(command)

  function allow(updates: PermissionUpdate[]): void {
    confirm.onAllow(confirm.input, updates)
    onDone()
  }

  const alwaysAllowOptions: PermissionOption[] = simplePrefix === firstWordPrefix
    ? [{
        label: `Yes, and don't ask again for: ${simplePrefix}`,
        onSelect: () => allow([{ type: 'addRules', source: 'session', allow: [`Bash(${simplePrefix})`] }]),
      }]
    : [
        {
          label: `Yes, and don't ask again for: ${simplePrefix}`,
          onSelect: () => allow([{ type: 'addRules', source: 'session', allow: [`Bash(${simplePrefix})`] }]),
        },
        {
          label: `Yes, and don't ask again for: ${firstWordPrefix}`,
          onSelect: () => allow([{ type: 'addRules', source: 'session', allow: [`Bash(${firstWordPrefix})`] }]),
        },
      ]

  const options: PermissionOption[] = [
    { label: 'Yes', onSelect: () => allow([]) },
    ...alwaysAllowOptions,
    { label: 'No', onSelect: () => { confirm.onReject(); onDone() } },
  ]

  return (
    <Box flexDirection="column">
      <Box borderStyle="single" borderTop={false} borderLeft={false} borderRight={false} paddingX={1}>
        <Text bold color="yellow">Bash command</Text>
      </Box>
      <Box flexDirection="column" paddingLeft={2} paddingTop={1}>
        <Text>{displayCommand}</Text>
        {description && <Text color="gray">{description}</Text>}
        {warning && <Text color="red">{warning}</Text>}
      </Box>
      <Box flexDirection="column" marginTop={1}>
        <Text>Do you want to proceed?</Text>
        <PermissionPrompt options={options} />
      </Box>
    </Box>
  )
}

// ---------------------------------------------------------------------------
// DiffView — render a structured patch inline with colors
// ---------------------------------------------------------------------------

const MAX_DIFF_DISPLAY_LINES = 25

function DiffView({ patch }: { patch: StructuredPatch }) {
  const allLines = patch.hunks.flatMap(hunk => hunk.lines)

  if (allLines.length === 0) {
    return <Text color="gray">(no changes)</Text>
  }

  const displayLines = allLines.slice(0, MAX_DIFF_DISPLAY_LINES)
  const remaining = allLines.length - displayLines.length

  return (
    <Box flexDirection="column">
      {displayLines.map((line, i) => {
        const prefix = line[0]
        const content = line.slice(1)
        if (prefix === '+') return <Text key={i} color="green">+{content}</Text>
        if (prefix === '-') return <Text key={i} color="red">-{content}</Text>
        return <Text key={i} color="gray"> {content}</Text>
      })}
      {remaining > 0 && <Text color="gray">...{remaining} more lines</Text>}
    </Box>
  )
}

// ---------------------------------------------------------------------------
// FileEditPermissionRequest
// ---------------------------------------------------------------------------

function FileEditPermissionRequest({ confirm, onDone }: PermissionRequestProps) {
  const input = confirm.input as {
    file_path?: string
    old_string?: string
    new_string?: string
    replace_all?: boolean
  }
  const rawPath = input.file_path ?? ''
  const oldString = input.old_string ?? ''
  const newString = input.new_string ?? ''

  const absolutePath = expandPath(rawPath)
  const displayPath = relative(process.cwd(), absolutePath)
  const fileName = basename(absolutePath)

  const patch = useMemo(() => {
    try {
      const content = readFileSync(absolutePath, 'utf-8')
      const newContent = input.replace_all
        ? content.replaceAll(oldString, newString)
        : content.replace(oldString, newString)
      return structuredPatch(displayPath, displayPath, content, newContent, '', '', { context: 3 })
    } catch {
      return null
    }
  }, [absolutePath, displayPath, oldString, newString, input.replace_all])

  function allow(updates: PermissionUpdate[]): void {
    confirm.onAllow(confirm.input, updates)
    onDone()
  }

  const options: PermissionOption[] = [
    { label: 'Yes', onSelect: () => allow([]) },
    {
      label: `Yes, always allow edits to ${displayPath}`,
      onSelect: () => allow([{ type: 'addRules', source: 'session', allow: [`Edit(${displayPath})`] }]),
    },
    { label: 'No', onSelect: () => { confirm.onReject(); onDone() } },
  ]

  return (
    <PermissionDialog title={`Edit ${fileName}`} subtitle={displayPath} color="cyan">
      {patch && <DiffView patch={patch} />}
      <Box marginTop={1}>
        <PermissionPrompt options={options} />
      </Box>
    </PermissionDialog>
  )
}

// ---------------------------------------------------------------------------
// FileWritePermissionRequest
// ---------------------------------------------------------------------------

const MAX_WRITE_PREVIEW_LINES = 20

function FileWritePermissionRequest({ confirm, onDone }: PermissionRequestProps) {
  const input = confirm.input as { file_path?: string; content?: string }
  const rawPath = input.file_path ?? ''
  const newContent = input.content ?? ''

  const absolutePath = expandPath(rawPath)
  const displayPath = relative(process.cwd(), absolutePath)
  const fileName = basename(absolutePath)

  const { isNewFile, patch, contentPreview } = useMemo(() => {
    try {
      const oldContent = readFileSync(absolutePath, 'utf-8')
      return {
        isNewFile: false,
        patch: structuredPatch(displayPath, displayPath, oldContent, newContent, '', '', { context: 3 }),
        contentPreview: null,
      }
    } catch {
      const lines = newContent.split('\n')
      const preview = lines.slice(0, MAX_WRITE_PREVIEW_LINES)
      if (lines.length > MAX_WRITE_PREVIEW_LINES) {
        preview.push(`...${lines.length - MAX_WRITE_PREVIEW_LINES} more lines`)
      }
      return { isNewFile: true, patch: null, contentPreview: preview }
    }
  }, [absolutePath, displayPath, newContent])

  function allow(updates: PermissionUpdate[]): void {
    confirm.onAllow(confirm.input, updates)
    onDone()
  }

  const options: PermissionOption[] = [
    { label: 'Yes', onSelect: () => allow([]) },
    {
      label: `Yes, always allow writes to ${displayPath}`,
      onSelect: () => allow([{ type: 'addRules', source: 'session', allow: [`Write(${displayPath})`] }]),
    },
    { label: 'No', onSelect: () => { confirm.onReject(); onDone() } },
  ]

  return (
    <PermissionDialog
      title={isNewFile ? `Create ${fileName}` : `Overwrite ${fileName}`}
      subtitle={displayPath}
      color="cyan"
    >
      {patch && <DiffView patch={patch} />}
      {contentPreview && (
        <Box flexDirection="column">
          {contentPreview.map((line, i) => (
            <Text key={i} color="green">+{line}</Text>
          ))}
        </Box>
      )}
      <Box marginTop={1}>
        <PermissionPrompt options={options} />
      </Box>
    </PermissionDialog>
  )
}

// ---------------------------------------------------------------------------
// WebFetchPermissionRequest
// ---------------------------------------------------------------------------

function WebFetchPermissionRequest({ confirm, onDone }: PermissionRequestProps) {
  const input = confirm.input as { url?: string }
  const url = input.url ?? confirm.message

  let hostname: string
  try {
    hostname = new URL(url).hostname
  } catch {
    hostname = url
  }

  function allow(updates: PermissionUpdate[]): void {
    confirm.onAllow(confirm.input, updates)
    onDone()
  }

  const options: PermissionOption[] = [
    { label: 'Yes', onSelect: () => allow([]) },
    {
      label: `Yes, always allow fetching from ${hostname}`,
      onSelect: () => allow([{ type: 'addRules', source: 'session', allow: [`WebFetch(domain:${hostname})`] }]),
    },
    { label: 'No', onSelect: () => { confirm.onReject(); onDone() } },
  ]

  return (
    <PermissionDialog title="Allow WebFetch" color="blue">
      <Box flexDirection="column" marginBottom={1}>
        <Text>{url}</Text>
        <Text>Domain: <Text bold>{hostname}</Text></Text>
      </Box>
      <PermissionPrompt options={options} />
    </PermissionDialog>
  )
}

// ---------------------------------------------------------------------------
// FilesystemPermissionRequest — for read-only tools (Glob, Grep, Read)
// ---------------------------------------------------------------------------

function FilesystemPermissionRequest({ confirm, onDone }: PermissionRequestProps) {
  const options: PermissionOption[] = [
    {
      label: 'Yes',
      onSelect: () => { confirm.onAllow(confirm.input, []); onDone() },
    },
    {
      label: `Yes, always allow ${confirm.tool.name}`,
      onSelect: () => {
        const update: PermissionUpdate = {
          type: 'addRules',
          source: 'session',
          allow: [confirm.tool.name],
        }
        confirm.onAllow(confirm.input, [update])
        onDone()
      },
    },
    {
      label: 'No',
      onSelect: () => { confirm.onReject(); onDone() },
    },
  ]

  return (
    <PermissionDialog title={`Allow ${confirm.tool.name}`} color="gray">
      <Box marginBottom={1}>
        <Text>{confirm.message}</Text>
      </Box>
      <PermissionPrompt options={options} />
    </PermissionDialog>
  )
}

// ---------------------------------------------------------------------------
// PermissionRequest — router that dispatches by tool name
// ---------------------------------------------------------------------------

export function PermissionRequest({ confirm, onDone }: PermissionRequestProps) {
  switch (confirm.tool.name) {
    case 'Bash':
      return <BashPermissionRequest confirm={confirm} onDone={onDone} />
    case 'Edit':
      return <FileEditPermissionRequest confirm={confirm} onDone={onDone} />
    case 'Write':
      return <FileWritePermissionRequest confirm={confirm} onDone={onDone} />
    case 'WebFetch':
      return <WebFetchPermissionRequest confirm={confirm} onDone={onDone} />
    case 'Glob':
    case 'Grep':
    case 'Read':
      return <FilesystemPermissionRequest confirm={confirm} onDone={onDone} />
    default:
      return <FallbackPermissionRequest confirm={confirm} onDone={onDone} />
  }
}
