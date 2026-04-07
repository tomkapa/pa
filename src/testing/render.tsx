import { EventEmitter } from 'node:events'
import { render as inkRender } from '../../ink/index.js'
import type { ReactNode } from 'react'

class FakeStdout extends EventEmitter {
  get columns() { return 100 }
  get rows() { return 24 }
  _lastFrame: string | undefined
  write = (frame: string) => { this._lastFrame = frame }
  lastFrame = () => this._lastFrame
}

class FakeStderr extends EventEmitter {
  write = (_frame: string) => {}
}

class FakeStdin extends EventEmitter {
  isTTY = true
  data: string | null = null

  write = (data: string) => {
    this.data = data
    this.emit('readable')
    this.emit('data', data)
  }

  setEncoding() {}
  setRawMode() {}
  resume() {}
  pause() {}
  ref() {}
  unref() {}
  read = () => {
    const { data } = this
    this.data = null
    return data
  }
}

export function renderTest(tree: ReactNode) {
  const stdout = new FakeStdout()
  const stderr = new FakeStderr()
  const stdin = new FakeStdin()

  const instance = inkRender(tree, {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stderr: stderr as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    debug: true,
    exitOnCtrlC: false,
    patchConsole: false,
  })

  return {
    rerender: instance.rerender,
    unmount: instance.unmount,
    stdin,
    lastFrame: stdout.lastFrame,
  }
}
