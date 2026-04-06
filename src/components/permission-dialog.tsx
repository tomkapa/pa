import { Box, Text } from 'ink'
import { Select, type SelectOption } from './select.js'
import type { ToolUseConfirm } from '../services/permissions/confirm.js'
import type { PermissionUpdate } from '../services/permissions/types.js'

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
    <Box flexDirection="column" borderStyle="round" borderColor={color} paddingX={1}>
      <Text color={color} bold>{title}</Text>
      {subtitle && <Text color="gray">{subtitle}</Text>}
      <Box marginTop={1}>
        {children}
      </Box>
    </Box>
  )
}

// ---------------------------------------------------------------------------
// FallbackPermissionRequest — default dialog for any tool
// ---------------------------------------------------------------------------

type PermissionChoice = 'yes' | 'yes-dont-ask-again' | 'no'

interface FallbackPermissionRequestProps {
  confirm: ToolUseConfirm
  onDone: () => void
}

export function FallbackPermissionRequest({ confirm, onDone }: FallbackPermissionRequestProps) {
  const options: SelectOption<PermissionChoice>[] = [
    { value: 'yes', label: 'Yes' },
    { value: 'yes-dont-ask-again', label: "Yes, don't ask again" },
    { value: 'no', label: 'No' },
  ]

  function handleSelect(choice: PermissionChoice) {
    switch (choice) {
      case 'yes':
        confirm.onAllow(confirm.input, [])
        break
      case 'yes-dont-ask-again': {
        const update: PermissionUpdate = {
          type: 'addRules',
          source: 'localSettings',
          allow: [confirm.tool.name],
        }
        confirm.onAllow(confirm.input, [update])
        break
      }
      case 'no':
        confirm.onReject()
        break
    }
    onDone()
  }

  return (
    <PermissionDialog
      title={`Allow Tool: ${confirm.tool.name}`}
      subtitle={confirm.message}
    >
      <Select options={options} onSelect={handleSelect} />
    </PermissionDialog>
  )
}

// ---------------------------------------------------------------------------
// PermissionRequest — router that picks the right dialog
// ---------------------------------------------------------------------------

interface PermissionRequestProps {
  confirm: ToolUseConfirm
  onDone: () => void
}

export function PermissionRequest({ confirm, onDone }: PermissionRequestProps) {
  // For v1, everything uses FallbackPermissionRequest.
  // Future: route to tool-specific dialogs based on confirm.tool.name
  return <FallbackPermissionRequest confirm={confirm} onDone={onDone} />
}
