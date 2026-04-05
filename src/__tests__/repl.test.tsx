import { describe, test, expect } from 'bun:test'
import { renderTest } from '../testing/render.js'
import { App } from '../app.js'

const TICK = 100

describe('REPL', () => {
  test('renders the prompt', () => {
    const { lastFrame } = renderTest(<App />)
    expect(lastFrame()).toContain('❯')
  })

  test('echoes user input on submit', async () => {
    const { lastFrame, stdin } = renderTest(<App />)

    stdin.write('hello')
    await new Promise(resolve => setTimeout(resolve, TICK))
    stdin.write('\r')
    await new Promise(resolve => setTimeout(resolve, TICK))

    const frame = lastFrame()!
    expect(frame).toContain('> hello')
    expect(frame).toContain('Echo: hello')
  })

  test('clears input after submit', async () => {
    const { lastFrame, stdin } = renderTest(<App />)

    stdin.write('test input')
    await new Promise(resolve => setTimeout(resolve, TICK))
    stdin.write('\r')
    await new Promise(resolve => setTimeout(resolve, TICK))

    const frame = lastFrame()!
    expect(frame).toContain('> test input')
    const lines = frame.split('\n')
    const promptLine = lines[lines.length - 1]!
    expect(promptLine).not.toContain('test input')
  })

  test('ignores empty input', async () => {
    const { lastFrame, stdin } = renderTest(<App />)

    stdin.write('\r')
    await new Promise(resolve => setTimeout(resolve, TICK))

    const frame = lastFrame()!
    expect(frame).not.toContain('Echo:')
  })

  test('accumulates multiple messages', async () => {
    const { lastFrame, stdin } = renderTest(<App />)

    stdin.write('first')
    await new Promise(resolve => setTimeout(resolve, TICK))
    stdin.write('\r')
    await new Promise(resolve => setTimeout(resolve, TICK))

    stdin.write('second')
    await new Promise(resolve => setTimeout(resolve, TICK))
    stdin.write('\r')
    await new Promise(resolve => setTimeout(resolve, TICK))

    const frame = lastFrame()!
    expect(frame).toContain('> first')
    expect(frame).toContain('Echo: first')
    expect(frame).toContain('> second')
    expect(frame).toContain('Echo: second')
  })
})
