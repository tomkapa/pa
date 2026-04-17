import { Command, Option } from 'commander'
import { createRoot } from '../ink.js'
import { App, type SessionBoot } from '../app.js'
import type { REPLSessionBinding } from '../repl.js'
import { shutdownAllMcpServers } from '../services/mcp/index.js'
import { getErrorMessage } from '../utils/error.js'
import { PA_VERSION } from '../version.js'
import { setTeammateIdentity } from '../services/teams/index.js'
import type { PermissionMode } from '../services/permissions/types.js'
import { PERMISSION_MODES } from '../services/permissions/types.js'

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

interface TeammateFlags {
  agentId?: string
  agentName?: string
  teamName?: string
  permissionMode?: string
  model?: string
}

function applyTeammateIdentity(flags: TeammateFlags): void {
  if (!flags.agentId && !flags.agentName && !flags.teamName) return
  if (!flags.agentId || !flags.agentName || !flags.teamName) {
    throw new Error(
      'Teammate mode requires all of --agent-id, --agent-name, and --team-name.',
    )
  }
  setTeammateIdentity({
    agentId: flags.agentId,
    agentName: flags.agentName,
    teamName: flags.teamName,
  })
}

function validatePermissionMode(mode: string | undefined): PermissionMode | undefined {
  if (!mode) return undefined
  if (!(PERMISSION_MODES as readonly string[]).includes(mode)) {
    throw new Error(
      `Invalid --permission-mode '${mode}'. Allowed: ${PERMISSION_MODES.join(', ')}.`,
    )
  }
  return mode as PermissionMode
}

// React's unmount hook is synchronous, so we track the writer binding here
// and drain it on every exit path (normal return, SIGINT, SIGTERM) to avoid
// losing the last buffered messages.
let activeBinding: REPLSessionBinding | null = null

process.on('exit', () => {
  process.stdout.write('\n')
})

async function drainAndExit(code: number): Promise<void> {
  // Shut down MCP servers first to avoid zombie subprocesses.
  await shutdownAllMcpServers().catch(() => {})

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

interface CliOptions {
  continue?: boolean
  resume?: string | boolean
  agentId?: string
  agentName?: string
  teamName?: string
  permissionMode?: string
  model?: string
}

const program = new Command()
  .name('pa')
  .version(PA_VERSION)
  .description('An AI coding agent')
  .option('-c, --continue', 'Resume the most recent session in this project')
  .addOption(
    new Option('-r, --resume [session-id]', 'Resume a session (interactive picker if no id given)'),
  )
  .option('--agent-id <id>', 'Internal: teammate identity (use with --agent-name, --team-name)')
  .option('--agent-name <name>', 'Internal: teammate name within its team')
  .option('--team-name <name>', 'Internal: team this teammate belongs to')
  .option('--permission-mode <mode>', 'Initial permission mode for this session')
  .option('--model <model>', 'Model override for this session')
  .action(async (options: CliOptions) => {
    let boot: SessionBoot
    let initialPermissionMode: PermissionMode | undefined
    try {
      boot = parseBoot(options)
      applyTeammateIdentity({
        agentId: options.agentId,
        agentName: options.agentName,
        teamName: options.teamName,
      })
      initialPermissionMode = validatePermissionMode(options.permissionMode)
    } catch (error: unknown) {
      process.stderr.write(`pa: ${getErrorMessage(error)}\n`)
      process.exit(2)
    }

    process.stdout.write('\x1b[2J\x1b[H')
    const instance = createRoot(
      <App
        cwd={process.cwd()}
        boot={boot}
        initialPermissionMode={initialPermissionMode}
        onWriterReady={(binding) => { activeBinding = binding }}
      />,
    )
    await instance.waitUntilExit()
    // MCP shutdown is handled here for normal exit; drainAndExit handles signal exits.
    // shutdownAllMcpServers is idempotent (clears the pool first) so double-calls are safe.
    await shutdownAllMcpServers().catch(() => {})
    if (activeBinding) {
      try { await activeBinding.writer.close() } catch (error) {
        process.stderr.write(`pa: failed to flush session — ${getErrorMessage(error)}\n`)
      }
    }
  })

program.parse()
