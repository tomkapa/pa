import { Text } from '../ink.js'
import type { PermissionMode } from '../services/permissions/types.js'
import { permissionModeConfig } from '../services/permissions/mode-cycling.js'

// ---------------------------------------------------------------------------
// ModeIndicator — footer display of the current permission mode
// ---------------------------------------------------------------------------

interface ModeIndicatorProps {
  mode: PermissionMode
}

/**
 * Shows the current permission mode in the footer area.
 * Returns null for 'default' mode (implicit, no indicator needed).
 */
export function ModeIndicator({ mode }: ModeIndicatorProps) {
  if (mode === 'default') return null

  const config = permissionModeConfig[mode]

  return (
    <Text color={config.color}>
      {config.symbol} {config.title} on
      <Text color="gray"> (shift+tab to cycle)</Text>
    </Text>
  )
}
