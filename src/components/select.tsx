import { useState } from 'react'
import { Box, Text, useInput } from '../ink.js'

// ---------------------------------------------------------------------------
// SelectOption — a single option in the selector
// ---------------------------------------------------------------------------

export interface SelectOption<T> {
  readonly value: T
  readonly label: string
}

// ---------------------------------------------------------------------------
// Select — keyboard-navigated option selector
// ---------------------------------------------------------------------------

interface SelectProps<T> {
  options: readonly SelectOption<T>[]
  onSelect: (value: T) => void
}

export function Select<T>({ options, onSelect }: SelectProps<T>) {
  const [selectedIndex, setSelectedIndex] = useState(0)

  useInput((_ch, key) => {
    if (key.upArrow) {
      setSelectedIndex(prev => (prev > 0 ? prev - 1 : options.length - 1))
      return
    }

    if (key.downArrow) {
      setSelectedIndex(prev => (prev < options.length - 1 ? prev + 1 : 0))
      return
    }

    if (key.return) {
      const option = options[selectedIndex]
      if (option) {
        onSelect(option.value)
      }
    }
  })

  return (
    <Box flexDirection="column">
      {options.map((option, index) => (
        <Text key={String(option.value)}>
          {index === selectedIndex ? '> ' : '  '}
          {option.label}
        </Text>
      ))}
    </Box>
  )
}
