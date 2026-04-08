import { useState, useEffect } from 'react'
import { Box, Text, useInput } from '../ink.js'

interface TextInputProps {
  value: string
  onChange: (value: string) => void
  onSubmit?: (value: string) => void
  isActive?: boolean
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

export function TextInput({ value, onChange, onSubmit, isActive = true }: TextInputProps) {
  const [cursor, setCursor] = useState(value.length)

  useEffect(() => {
    if (cursor > value.length) {
      setCursor(value.length)
    }
  }, [value, cursor])

  useInput((ch, key) => {
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
    </Box>
  )
}
