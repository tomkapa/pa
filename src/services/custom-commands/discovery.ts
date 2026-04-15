import { execFile } from 'node:child_process'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { getConfigHomeDir } from '../session/paths.js'

/**
 * Find the git root for a given directory. Returns `undefined` if not in a
 * git repo or if git is not installed. Uses async exec to avoid blocking
 * the event loop during REPL startup.
 */
async function findGitRoot(cwd: string): Promise<string | undefined> {
  return new Promise(resolve => {
    execFile('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' }, (err, stdout) => {
      if (err) {
        resolve(undefined)
        return
      }
      const trimmed = stdout.trim()
      resolve(trimmed.length > 0 ? trimmed : undefined)
    })
  })
}

/**
 * Walk upward from `cwd` to the git root (or filesystem root), collecting
 * every `.pa/commands/` directory that exists along the way.
 *
 * Returns directories in bottom-up order (cwd first, parents later).
 */
async function findProjectCommandDirs(cwd: string): Promise<string[]> {
  const dirs: string[] = []
  const gitRoot = await findGitRoot(cwd)
  const stopAt = gitRoot ? path.resolve(gitRoot) : path.parse(cwd).root

  let current = path.resolve(cwd)

  while (true) {
    const cmdDir = path.join(current, '.pa', 'commands')
    try {
      const s = await stat(cmdDir)
      if (s.isDirectory()) {
        dirs.push(cmdDir)
      }
    } catch {
      // Directory doesn't exist — skip
    }

    if (current === stopAt) break
    const parent = path.dirname(current)
    if (parent === current) break // filesystem root
    current = parent
  }

  return dirs
}

export interface CommandDirectories {
  userDirs: string[]
  projectDirs: string[]
  /** User skill directory: `~/.pa/skills/` */
  userSkillDir: string
  /** Project skill directory: `.pa/skills/` in the project root (cwd). */
  projectSkillDir: string
}

/**
 * Discover all command and skill directories for the current session.
 *
 * Priority order (highest wins):
 *   1. User skills:    `~/.pa/skills/`
 *   2. Project skills: `.pa/skills/` (cwd only — no walk-up)
 *   3. User commands:  `~/.pa/commands/`
 *   4. Project commands: `.pa/commands/` (walk upward from cwd to git root)
 */
export async function discoverCommandDirectories(
  cwd: string,
): Promise<CommandDirectories> {
  const configHome = getConfigHomeDir()
  const userDir = path.join(configHome, 'commands')
  const projectDirs = await findProjectCommandDirs(cwd)

  return {
    userDirs: [userDir],
    projectDirs,
    userSkillDir: path.join(configHome, 'skills'),
    projectSkillDir: path.join(cwd, '.pa', 'skills'),
  }
}
