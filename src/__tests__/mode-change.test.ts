import { describe, test, expect } from 'bun:test'
import { getModeChangeMessage } from '../services/agent/mode-change.js'
import type { PermissionMode } from '../services/permissions/types.js'

describe('getModeChangeMessage', () => {
  test('returns null when mode has not changed', () => {
    expect(getModeChangeMessage('default', 'default')).toBeNull()
    expect(getModeChangeMessage('plan', 'plan')).toBeNull()
    expect(getModeChangeMessage('acceptEdits', 'acceptEdits')).toBeNull()
  })

  test('returns plan-mode entry message when switching to plan', () => {
    const msg = getModeChangeMessage('default', 'plan')
    expect(msg).not.toBeNull()
    expect(msg!.type).toBe('user')
    expect(msg!.isMeta).toBe(true)

    const content = msg!.message.content
    expect(Array.isArray(content)).toBe(true)
    if (!Array.isArray(content)) return

    const text = content
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map(b => b.text)
      .join('')
    expect(text).toContain('PLAN MODE')
    expect(text).toContain('system-reminder')
    expect(text).toContain('plan file')
    expect(text).toContain('ExitPlanMode')
  })

  test('returns plan-mode entry message from acceptEdits', () => {
    const msg = getModeChangeMessage('acceptEdits', 'plan')
    expect(msg).not.toBeNull()

    const content = msg!.message.content
    if (!Array.isArray(content)) return
    const text = content
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map(b => b.text)
      .join('')
    expect(text).toContain('PLAN MODE')
  })

  test('returns exit-plan message when leaving plan mode', () => {
    const msg = getModeChangeMessage('plan', 'default')
    expect(msg).not.toBeNull()
    expect(msg!.type).toBe('user')
    expect(msg!.isMeta).toBe(true)

    const content = msg!.message.content
    expect(Array.isArray(content)).toBe(true)
    if (!Array.isArray(content)) return

    const text = content
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map(b => b.text)
      .join('')
    expect(text).toContain('exited PLAN MODE')
    expect(text).toContain('system-reminder')
    expect(text).toContain('preserved on disk')
  })

  test('returns exit-plan message when leaving plan to acceptEdits', () => {
    const msg = getModeChangeMessage('plan', 'acceptEdits')
    expect(msg).not.toBeNull()

    const content = msg!.message.content
    if (!Array.isArray(content)) return
    const text = content
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map(b => b.text)
      .join('')
    expect(text).toContain('exited PLAN MODE')
  })

  test('returns null for non-plan mode transitions', () => {
    // default → acceptEdits (no plan involvement)
    expect(getModeChangeMessage('default', 'acceptEdits')).toBeNull()
    // acceptEdits → default (no plan involvement)
    expect(getModeChangeMessage('acceptEdits', 'default')).toBeNull()
    // acceptEdits → bypassPermissions
    expect(getModeChangeMessage('acceptEdits', 'bypassPermissions')).toBeNull()
  })
})
