import { useState, useEffect } from 'react'
import { Text, useInput } from 'ink'

interface TextInputProps {
  value: string
  onChange: (value: string) => void
  onSubmit?: (value: string) => void
}

export function TextInput({ value, onChange, onSubmit }: TextInputProps) {
  const [cursor, setCursor] = useState(value.length)

  useEffect(() => {
    if (cursor > value.length) {
      setCursor(value.length)
    }
  }, [value, cursor])

  useInput((ch, key) => {
    if (key.return) {
      onSubmit?.(value)
      return
    }

    if (key.backspace || key.delete) {
      if (cursor > 0) {
        onChange(value.slice(0, cursor - 1) + value.slice(cursor))
        setCursor(prev => prev - 1)
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

    if (key.upArrow || key.downArrow || key.tab || (key.ctrl && ch === 'c')) {
      return
    }

    if (ch) {
      onChange(value.slice(0, cursor) + ch + value.slice(cursor))
      setCursor(prev => prev + ch.length)
    }
  })

  const before = value.slice(0, cursor)
  const at = value[cursor] ?? ' '
  const after = value.slice(cursor + 1)

  return (
    <Text>
      {before}
      <Text inverse>{at}</Text>
      {after}
    </Text>
  )
}
