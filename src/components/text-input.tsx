import { useState, useEffect, useCallback, useRef } from 'react'
import { Box, Text, useInput } from '../ink.js'
import { atMentionAtCursor } from '../services/mentions/tokenizer.js'
import { slashCommandAtCursor } from '../commands/tokenizer.js'
import { filterCommands } from '../commands/registry.js'
import type { SlashCommand } from '../commands/registry.js'

interface TextInputProps {
  value: string
  onChange: (value: string) => void
  onSubmit?: (value: string) => void
  isActive?: boolean
  /**
   * When provided, typing `@` at a whitespace-anchored position activates a
   * file-mention typeahead submode. The callback returns candidate files for
   * the current partial token. Leaving `suggest` unset keeps the input a
   * plain text field.
   */
  suggest?: (token: string) => Promise<readonly string[]>
  /**
   * When provided, typing `/` at the start of the input activates a
   * slash-command picker. The array defines all available commands.
   */
  commands?: readonly SlashCommand[]
}

type Suggestion =
  | { kind: 'off' }
  | { kind: 'picking'; token: string; items: readonly string[]; selectedIndex: number }
  | { kind: 'command_picking'; token: string; items: readonly SlashCommand[]; selectedIndex: number }

/** Dismiss only the given picker kind, leaving other kinds untouched. */
function dismissPicker(kind: 'picking' | 'command_picking') {
  return (prev: Suggestion): Suggestion =>
    prev.kind === kind ? { kind: 'off' } : prev
}

function cursorToLineCol(lines: string[], cursor: number): { lineIndex: number; col: number } {
  let rem = cursor
  for (let i = 0; i < lines.length; i++) {
    if (rem <= lines[i]!.length) return { lineIndex: i, col: rem }
    rem -= lines[i]!.length + 1
  }
  return { lineIndex: lines.length - 1, col: lines[lines.length - 1]!.length }
}

function lineColToCursor(lines: string[], lineIndex: number, col: number): number {
  let offset = 0
  for (let i = 0; i < lineIndex; i++) {
    offset += lines[i]!.length + 1
  }
  return offset + col
}

export function TextInput({ value, onChange, onSubmit, isActive = true, suggest, commands }: TextInputProps) {
  const [cursor, setCursor] = useState(value.length)
  const [suggestion, setSuggestion] = useState<Suggestion>({ kind: 'off' })

  // Latest-write-wins guard: an older fetch response must not overwrite a
  // newer one if the user kept typing.
  const fetchGenerationRef = useRef(0)

  useEffect(() => {
    if (cursor > value.length) {
      setCursor(value.length)
    }
  }, [value, cursor])

  useEffect(() => {
    if (!suggest) return
    const token = atMentionAtCursor(value, cursor)
    if (token === null) {
      setSuggestion(dismissPicker('picking'))
      return
    }
    const generation = ++fetchGenerationRef.current
    void suggest(token).then(items => {
      if (generation !== fetchGenerationRef.current) return
      // Empty results dismiss the picker so Enter still submits.
      if (items.length === 0) {
        setSuggestion(dismissPicker('picking'))
        return
      }
      setSuggestion({ kind: 'picking', token, items, selectedIndex: 0 })
    })
  }, [value, cursor, suggest])

  // Commands are filtered synchronously from the static registry — no
  // generation guard needed because there is no async operation to race.
  useEffect(() => {
    if (!commands || commands.length === 0) return
    const token = slashCommandAtCursor(value, cursor)
    if (token === null) {
      setSuggestion(dismissPicker('command_picking'))
      return
    }
    const matches = filterCommands(commands, token)
    if (matches.length === 0) {
      setSuggestion(dismissPicker('command_picking'))
      return
    }
    setSuggestion(prev => {
      // Preserve arrow-key selection when the filtered list hasn't changed.
      const sameList =
        prev.kind === 'command_picking' &&
        prev.items.length === matches.length &&
        prev.items.every((c, i) => c === matches[i])
      return {
        kind: 'command_picking',
        token,
        items: matches,
        selectedIndex: sameList ? prev.selectedIndex : 0,
      }
    })
  }, [value, cursor, commands])

  const completeMention = useCallback(
    (picked: string) => {
      const before = value.slice(0, cursor)
      const atIdx = before.lastIndexOf('@')
      if (atIdx === -1) return
      const insertion = `${picked} `
      const newText = value.slice(0, atIdx + 1) + insertion + value.slice(cursor)
      onChange(newText)
      setCursor(atIdx + 1 + insertion.length)
      setSuggestion({ kind: 'off' })
      // Invalidate any in-flight fetch so the picker doesn't flicker back on.
      fetchGenerationRef.current++
    },
    [value, cursor, onChange],
  )

  const completeCommand = useCallback(
    (picked: SlashCommand) => {
      const newText = `/${picked.name} `
      onChange(newText)
      setCursor(newText.length)
      setSuggestion({ kind: 'off' })
    },
    [onChange],
  )

  const movePickerSelection = useCallback((delta: number) => {
    setSuggestion(prev => {
      if (prev.kind === 'off') return prev
      const n = prev.items.length
      const next = (prev.selectedIndex + delta + n) % n
      return { ...prev, selectedIndex: next }
    })
  }, [])

  useInput((ch, key) => {
    // Unified picker keyboard handling — both mention and command pickers
    // share the same navigation keys; only the completion action differs.
    if (suggestion.kind === 'picking' || suggestion.kind === 'command_picking') {
      if (key.upArrow) { movePickerSelection(-1); return }
      if (key.downArrow) { movePickerSelection(1); return }
      if (key.escape) { setSuggestion({ kind: 'off' }); return }
      if (key.return || key.tab) {
        if (suggestion.kind === 'picking') {
          const picked = suggestion.items[suggestion.selectedIndex]
          if (picked !== undefined) completeMention(picked)
        } else {
          const picked = suggestion.items[suggestion.selectedIndex]
          if (picked !== undefined) completeCommand(picked)
        }
        // Swallow Enter regardless so an open picker never submits the prompt.
        return
      }
    }

    // Shift+Enter or backslash immediately before Enter → insert newline
    if (key.return) {
      const trailingBackslash = cursor > 0 && value[cursor - 1] === '\\'
      if (key.shift || trailingBackslash) {
        const base = trailingBackslash
          ? value.slice(0, cursor - 1) + value.slice(cursor)
          : value
        const insertAt = trailingBackslash ? cursor - 1 : cursor
        onChange(base.slice(0, insertAt) + '\n' + base.slice(insertAt))
        setCursor(insertAt + 1)
        return
      }
      onSubmit?.(value)
      return
    }

    if (key.backspace) {
      if (cursor > 0) {
        onChange(value.slice(0, cursor - 1) + value.slice(cursor))
        setCursor(prev => prev - 1)
      }
      return
    }

    if (key.delete) {
      if (cursor < value.length) {
        onChange(value.slice(0, cursor) + value.slice(cursor + 1))
      }
      return
    }

    if (key.leftArrow) {
      setCursor(prev => Math.max(0, prev - 1))
      return
    }

    if (key.rightArrow) {
      setCursor(prev => Math.min(value.length, prev + 1))
      return
    }

    if (key.upArrow) {
      const lines = value.split('\n')
      const { lineIndex, col } = cursorToLineCol(lines, cursor)
      if (lineIndex > 0) {
        const targetCol = Math.min(col, lines[lineIndex - 1]!.length)
        setCursor(lineColToCursor(lines, lineIndex - 1, targetCol))
      }
      return
    }

    if (key.downArrow) {
      const lines = value.split('\n')
      const { lineIndex, col } = cursorToLineCol(lines, cursor)
      if (lineIndex < lines.length - 1) {
        const targetCol = Math.min(col, lines[lineIndex + 1]!.length)
        setCursor(lineColToCursor(lines, lineIndex + 1, targetCol))
      }
      return
    }

    if (key.tab || (key.ctrl && ch === 'c')) {
      return
    }

    if (ch) {
      onChange(value.slice(0, cursor) + ch + value.slice(cursor))
      setCursor(prev => prev + ch.length)
    }
  }, { isActive })

  const lines = value.split('\n')
  const { lineIndex: cursorLine, col: cursorCol } = cursorToLineCol(lines, cursor)

  return (
    <Box flexDirection="column">
      {lines.map((line, i) => (
        <Box key={i}>
          {i === cursorLine ? (
            <>
              <Text>{line.slice(0, cursorCol)}</Text>
              <Text inverse>{line[cursorCol] ?? ' '}</Text>
              <Text>{line.slice(cursorCol + 1)}</Text>
            </>
          ) : (
            <Text>{line || ' '}</Text>
          )}
        </Box>
      ))}
      {(suggestion.kind === 'picking' || suggestion.kind === 'command_picking') &&
        suggestion.items.length > 0 && (
          <Box flexDirection="column">
            {suggestion.items.map((item, i) => {
              const label = suggestion.kind === 'picking'
                ? (item as string)
                : `/${(item as SlashCommand).name}`
              const desc = suggestion.kind === 'command_picking'
                ? (item as SlashCommand).description
                : undefined
              const itemKey = suggestion.kind === 'picking'
                ? (item as string)
                : (item as SlashCommand).name
              return (
                <Text
                  key={itemKey}
                  color={i === suggestion.selectedIndex ? 'cyan' : undefined}
                  inverse={i === suggestion.selectedIndex}
                >
                  {i === suggestion.selectedIndex ? '> ' : '  '}
                  {label}
                  {desc && <Text color="gray">{`  ${desc}`}</Text>}
                </Text>
              )
            })}
          </Box>
        )}
    </Box>
  )
}
