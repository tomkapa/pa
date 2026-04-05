import { useState, useCallback } from 'react'
import { Box, Text, useInput, useApp } from 'ink'
import { TextInput } from './components/text-input.js'

export function REPL() {
  const { exit } = useApp()
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<string[]>([])

  const handleSubmit = useCallback((value: string) => {
    if (value.trim() === '') return
    setMessages(prev => [...prev, `> ${value}`, `Echo: ${value}`])
    setInput('')
  }, [])

  useInput((_ch, key) => {
    if (key.ctrl && _ch === 'd') exit()
  })

  return (
    <Box flexDirection="column">
      {messages.map((msg, i) => (
        <Text key={i}>{msg}</Text>
      ))}
      <Box>
        <Text color="cyan">{'❯ '}</Text>
        <TextInput value={input} onChange={setInput} onSubmit={handleSubmit} />
      </Box>
    </Box>
  )
}
