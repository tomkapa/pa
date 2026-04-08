import { Command, Option } from 'commander'
import { createRoot } from '../ink.js'
import { App, type SessionBoot } from '../app.js'
import type { REPLSessionBinding } from '../repl.js'
import { getErrorMessage } from '../utils/error.js'

function parseBoot(options: { continue?: boolean; resume?: string | boolean }): SessionBoot {
  const hasContinue = options.continue === true
  const hasResume = options.resume !== undefined && options.resume !== false
  if (hasContinue && hasResume) {
    throw new Error('Cannot use --continue and --resume together.')
  }
  if (hasContinue) return { kind: 'continue' }
  if (hasResume) {
    // commander passes a string when `--resume <id>` and `true` for a bare
    // `--resume`. Bare means "show the picker".
    return typeof options.resume === 'string'
      ? { kind: 'resume-id', sessionId: options.resume }
      : { kind: 'resume-pick' }
  }
  return { kind: 'fresh' }
}

// React's unmount hook is synchronous, so we track the writer binding here
// and drain it on every exit path (normal return, SIGINT, SIGTERM) to avoid
// losing the last buffered messages.
let activeBinding: REPLSessionBinding | null = null

process.on('exit', () => {
  process.stdout.write('\n')
})

async function drainAndExit(code: number): Promise<void> {
  const writer = activeBinding?.writer
  if (writer) {
    try { await writer.close() } catch (error) {
      process.stderr.write(`pa: failed to flush session — ${getErrorMessage(error)}\n`)
    }
  }
  process.exit(code)
}

process.on('SIGINT', () => { void drainAndExit(130) })
process.on('SIGTERM', () => { void drainAndExit(143) })

const program = new Command()
  .name('pa')
  .version('0.1.0')
  .description('An AI coding agent')
  .option('-c, --continue', 'Resume the most recent session in this project')
  .addOption(
    new Option('-r, --resume [session-id]', 'Resume a session (interactive picker if no id given)'),
  )
  .action(async (options: { continue?: boolean; resume?: string | boolean }) => {
    let boot: SessionBoot
    try {
      boot = parseBoot(options)
    } catch (error: unknown) {
      process.stderr.write(`pa: ${getErrorMessage(error)}\n`)
      process.exit(2)
    }

    process.stdout.write('\x1b[2J\x1b[H')
    const instance = createRoot(
      <App
        cwd={process.cwd()}
        boot={boot}
        onWriterReady={(binding) => { activeBinding = binding }}
      />,
    )
    await instance.waitUntilExit()
    if (activeBinding) {
      try { await activeBinding.writer.close() } catch (error) {
        process.stderr.write(`pa: failed to flush session — ${getErrorMessage(error)}\n`)
      }
    }
  })

program.parse()
