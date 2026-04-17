import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import {
  isInsideTmux,
  createTeammateWindow,
  sendCommandToWindow,
  trackWindow,
  killTeammateWindow,
  __setTmuxEnvForTests,
  __setTmuxExecForTests,
  __resetTmuxForTests,
  __getTrackedWindowForTests,
  type TmuxExec,
} from '../services/teams/tmuxPanes.js'

interface Call {
  args: string[]
}

function makeExec(handler: (args: string[]) => { stdout?: string } | Error): {
  exec: TmuxExec
  calls: Call[]
} {
  const calls: Call[] = []
  const exec: TmuxExec = async (args) => {
    calls.push({ args })
    const r = handler(args)
    if (r instanceof Error) throw r
    return { stdout: r.stdout ?? '', stderr: '' }
  }
  return { exec, calls }
}

beforeEach(() => {
  __resetTmuxForTests()
})

afterEach(() => {
  __resetTmuxForTests()
})

describe('tmuxPanes detection', () => {
  test('isInsideTmux reflects captured env', () => {
    expect(isInsideTmux()).toBe(false)
    __setTmuxEnvForTests({ tmux: '/tmp/tmux-501/default,1234,0' })
    expect(isInsideTmux()).toBe(true)
  })
})

describe('createTeammateWindow', () => {
  test('invokes new-window -d -n <name> -P -F #{window_id} and returns the window id', async () => {
    const { exec, calls } = makeExec((args) => {
      if (args[0] === 'new-window') return { stdout: '@7\n' }
      return {}
    })
    __setTmuxExecForTests(exec)

    const windowId = await createTeammateWindow('alice')

    expect(windowId).toBe('@7')
    expect(calls).toHaveLength(1)
    expect(calls[0]!.args).toEqual(['new-window', '-d', '-n', 'alice', '-P', '-F', '#{window_id}'])
  })

  test('throws when new-window rejects', async () => {
    const { exec } = makeExec(() => new Error('nope'))
    __setTmuxExecForTests(exec)
    await expect(createTeammateWindow('alice')).rejects.toThrow(/tmux new-window failed/)
  })

  test('throws when new-window returns empty id', async () => {
    const { exec } = makeExec((args) => {
      if (args[0] === 'new-window') return { stdout: '  \n' }
      return {}
    })
    __setTmuxExecForTests(exec)
    await expect(createTeammateWindow('alice')).rejects.toThrow(/empty window id/)
  })

  test('concurrent creations do not serialize (windows are independent)', async () => {
    let active = 0
    let maxActive = 0
    let counter = 0
    const exec: TmuxExec = async (args) => {
      if (args[0] !== 'new-window') return { stdout: '', stderr: '' }
      active++
      maxActive = Math.max(maxActive, active)
      await new Promise((r) => setTimeout(r, 10))
      active--
      return { stdout: `@${++counter}`, stderr: '' }
    }
    __setTmuxExecForTests(exec)

    await Promise.all([
      createTeammateWindow('a'),
      createTeammateWindow('b'),
      createTeammateWindow('c'),
    ])

    expect(maxActive).toBeGreaterThan(1)
  })
})

describe('sendCommandToWindow', () => {
  test('forwards the command and presses Enter', async () => {
    const { exec, calls } = makeExec(() => ({}))
    __setTmuxExecForTests(exec)
    await sendCommandToWindow('@3', 'echo hi')
    expect(calls[0]!.args).toEqual(['send-keys', '-t', '@3', 'echo hi', 'Enter'])
  })

  test('throws when exec rejects', async () => {
    const { exec } = makeExec(() => new Error('bad target'))
    __setTmuxExecForTests(exec)
    await expect(sendCommandToWindow('@3', 'echo hi')).rejects.toThrow(
      /send-keys to @3 failed/,
    )
  })
})

describe('window tracking', () => {
  test('trackWindow + __getTrackedWindowForTests round-trip', () => {
    trackWindow('alice@team', '@5')
    expect(__getTrackedWindowForTests('alice@team')).toBe('@5')
    expect(__getTrackedWindowForTests('nobody')).toBeUndefined()
  })

  test('killTeammateWindow issues kill-window and forgets the mapping', async () => {
    const { exec, calls } = makeExec(() => ({}))
    __setTmuxExecForTests(exec)
    trackWindow('bob@team', '@8')

    const ok = await killTeammateWindow('bob@team')
    expect(ok).toBe(true)
    expect(calls[0]!.args).toEqual(['kill-window', '-t', '@8'])
    expect(__getTrackedWindowForTests('bob@team')).toBeUndefined()
  })

  test('killTeammateWindow returns false for unknown agent ids', async () => {
    const { exec, calls } = makeExec(() => ({}))
    __setTmuxExecForTests(exec)
    const ok = await killTeammateWindow('ghost@team')
    expect(ok).toBe(false)
    expect(calls).toHaveLength(0)
  })

  test('killTeammateWindow reports false when exec rejects', async () => {
    const { exec } = makeExec(() => new Error('no such window'))
    __setTmuxExecForTests(exec)
    trackWindow('bob@team', '@8')
    const ok = await killTeammateWindow('bob@team')
    expect(ok).toBe(false)
    expect(__getTrackedWindowForTests('bob@team')).toBeUndefined()
  })
})
