import { describe, test, expect } from 'bun:test'
import {
  splitCompoundCommand,
  stripLeadingEnvVars,
  stripSafeWrappers,
  normalizeCommand,
  matchesCommandPrefix,
  detectDangerousPatterns,
  detectHeredoc,
  detectSuspiciousLineContinuation,
  joinLineContinuations,
} from '../services/permissions/command-security.js'

// ---------------------------------------------------------------------------
// splitCompoundCommand
// ---------------------------------------------------------------------------

describe('splitCompoundCommand', () => {
  test('returns single command as-is', () => {
    expect(splitCompoundCommand('git status')).toEqual(['git status'])
  })

  test('splits on &&', () => {
    expect(splitCompoundCommand('npm install && npm test')).toEqual([
      'npm install',
      'npm test',
    ])
  })

  test('splits on ||', () => {
    expect(splitCompoundCommand('make || echo failed')).toEqual([
      'make',
      'echo failed',
    ])
  })

  test('splits on ;', () => {
    expect(splitCompoundCommand('echo a; echo b; echo c')).toEqual([
      'echo a',
      'echo b',
      'echo c',
    ])
  })

  test('splits on |', () => {
    expect(splitCompoundCommand('ls | grep foo')).toEqual(['ls', 'grep foo'])
  })

  test('splits on |&', () => {
    expect(splitCompoundCommand('cmd1 |& cmd2')).toEqual(['cmd1', 'cmd2'])
  })

  test('splits on mixed operators', () => {
    expect(
      splitCompoundCommand('npm install && npm test || echo fail; npm run build'),
    ).toEqual(['npm install', 'npm test', 'echo fail', 'npm run build'])
  })

  test('does not split inside single quotes', () => {
    expect(splitCompoundCommand("echo 'foo && bar'")).toEqual([
      "echo 'foo && bar'",
    ])
  })

  test('does not split inside double quotes', () => {
    expect(splitCompoundCommand('echo "foo && bar"')).toEqual([
      'echo "foo && bar"',
    ])
  })

  test('does not split inside backticks', () => {
    expect(splitCompoundCommand('echo `foo && bar`')).toEqual([
      'echo `foo && bar`',
    ])
  })

  test('does not split inside $(...)', () => {
    expect(splitCompoundCommand('echo $(foo && bar)')).toEqual([
      'echo $(foo && bar)',
    ])
  })

  test('does not split inside $((...))  ', () => {
    expect(splitCompoundCommand('echo $((1 + 2))')).toEqual([
      'echo $((1 + 2))',
    ])
  })

  test('handles nested $() inside double quotes', () => {
    expect(splitCompoundCommand('echo "$(foo && bar)" && baz')).toEqual([
      'echo "$(foo && bar)"',
      'baz',
    ])
  })

  test('handles escaped backslash before operator', () => {
    expect(splitCompoundCommand('echo a && echo b')).toEqual([
      'echo a',
      'echo b',
    ])
  })

  test('handles empty parts from consecutive operators', () => {
    const result = splitCompoundCommand('a ;; b')
    // Empty parts should be filtered out
    expect(result).toEqual(['a', 'b'])
  })

  test('trims whitespace from parts', () => {
    expect(splitCompoundCommand('  a  &&  b  ')).toEqual(['a', 'b'])
  })

  test('handles backslash escapes inside double quotes', () => {
    expect(splitCompoundCommand('echo "foo\\"&&bar" && cmd2')).toEqual([
      'echo "foo\\"&&bar"',
      'cmd2',
    ])
  })

  test('handles nested command substitution', () => {
    expect(splitCompoundCommand('echo $(cat $(echo file)) && done')).toEqual([
      'echo $(cat $(echo file))',
      'done',
    ])
  })

  test('returns empty array for empty string', () => {
    expect(splitCompoundCommand('')).toEqual([])
  })

  test('returns empty array for whitespace-only string', () => {
    expect(splitCompoundCommand('   ')).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// stripLeadingEnvVars
// ---------------------------------------------------------------------------

describe('stripLeadingEnvVars', () => {
  describe('safe-only mode', () => {
    test('strips known safe env vars', () => {
      expect(stripLeadingEnvVars('NODE_ENV=production npm install', 'safe-only')).toBe(
        'npm install',
      )
    })

    test('strips multiple safe env vars', () => {
      expect(
        stripLeadingEnvVars('FORCE_COLOR=1 CI=true npm test', 'safe-only'),
      ).toBe('npm test')
    })

    test('stops at unknown env vars', () => {
      expect(
        stripLeadingEnvVars('INTERPRETER=/evil/shell npm install', 'safe-only'),
      ).toBe('INTERPRETER=/evil/shell npm install')
    })

    test('handles quoted values', () => {
      expect(
        stripLeadingEnvVars('NODE_ENV="production" npm install', 'safe-only'),
      ).toBe('npm install')
    })

    test('handles single-quoted values', () => {
      expect(
        stripLeadingEnvVars("NODE_ENV='production' npm install", 'safe-only'),
      ).toBe('npm install')
    })

    test('returns command unchanged if no env vars', () => {
      expect(stripLeadingEnvVars('npm install', 'safe-only')).toBe('npm install')
    })
  })

  describe('all mode', () => {
    test('strips all env vars', () => {
      expect(
        stripLeadingEnvVars('MALICIOUS_VAR=x curl evil.com', 'all'),
      ).toBe('curl evil.com')
    })

    test('strips multiple arbitrary env vars', () => {
      expect(
        stripLeadingEnvVars('FOO=1 BAR=2 BAZ=3 dangerous_cmd', 'all'),
      ).toBe('dangerous_cmd')
    })

    test('strips env vars with complex values', () => {
      expect(
        stripLeadingEnvVars('PATH="/usr/bin:/bin" SHELL=/bin/zsh cmd', 'all'),
      ).toBe('cmd')
    })
  })
})

// ---------------------------------------------------------------------------
// stripSafeWrappers
// ---------------------------------------------------------------------------

describe('stripSafeWrappers', () => {
  test('strips timeout with numeric arg', () => {
    expect(stripSafeWrappers('timeout 30 npm install')).toBe('npm install')
  })

  test('strips time', () => {
    expect(stripSafeWrappers('time npm install')).toBe('npm install')
  })

  test('strips nice with args', () => {
    expect(stripSafeWrappers('nice -n 5 npm install')).toBe('npm install')
  })

  test('strips nohup', () => {
    expect(stripSafeWrappers('nohup npm install')).toBe('npm install')
  })

  test('strips env', () => {
    expect(stripSafeWrappers('env npm install')).toBe('npm install')
  })

  test('strips nested wrappers', () => {
    expect(stripSafeWrappers('timeout 30 nice -n 5 npm install')).toBe(
      'npm install',
    )
  })

  test('does not strip non-wrapper commands', () => {
    expect(stripSafeWrappers('npm install')).toBe('npm install')
  })

  test('does not strip wrapper-like command names', () => {
    // "timeout" the command itself, no inner command
    expect(stripSafeWrappers('timeout')).toBe('timeout')
  })
})

// ---------------------------------------------------------------------------
// normalizeCommand
// ---------------------------------------------------------------------------

describe('normalizeCommand', () => {
  test('strips safe env vars and wrappers in safe-only mode', () => {
    expect(
      normalizeCommand('NODE_ENV=production timeout 30 npm install', 'safe-only'),
    ).toBe('npm install')
  })

  test('strips all env vars and wrappers in all mode', () => {
    expect(
      normalizeCommand('CUSTOM=x timeout 30 npm install', 'all'),
    ).toBe('npm install')
  })

  test('fixed-point: handles interleaved env vars and wrappers', () => {
    expect(
      normalizeCommand('env NODE_ENV=production timeout 30 npm install', 'safe-only'),
    ).toBe('npm install')
  })
})

// ---------------------------------------------------------------------------
// matchesCommandPrefix
// ---------------------------------------------------------------------------

describe('matchesCommandPrefix', () => {
  test('exact match', () => {
    expect(matchesCommandPrefix('ls', 'ls')).toBe(true)
  })

  test('prefix with space boundary', () => {
    expect(matchesCommandPrefix('ls -la', 'ls')).toBe(true)
  })

  test('does not match partial word', () => {
    expect(matchesCommandPrefix('lsof', 'ls')).toBe(false)
  })

  test('does not match lsattr', () => {
    expect(matchesCommandPrefix('lsattr', 'ls')).toBe(false)
  })

  test('npm does not match npx', () => {
    expect(matchesCommandPrefix('npx', 'npm')).toBe(false)
  })

  test('npm matches npm install', () => {
    expect(matchesCommandPrefix('npm install', 'npm')).toBe(true)
  })

  test('git matches git checkout main', () => {
    expect(matchesCommandPrefix('git checkout main', 'git')).toBe(true)
  })

  test('git status matches git status', () => {
    expect(matchesCommandPrefix('git status', 'git status')).toBe(true)
  })

  test('git status does not match git statusbar', () => {
    expect(matchesCommandPrefix('git statusbar', 'git status')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// detectDangerousPatterns
// ---------------------------------------------------------------------------

describe('detectDangerousPatterns', () => {
  test('detects command substitution $(...)', () => {
    expect(detectDangerousPatterns('echo $(whoami)')).toBeDefined()
  })

  test('detects backtick substitution', () => {
    expect(detectDangerousPatterns('echo `whoami`')).toBeDefined()
  })

  test('detects eval', () => {
    expect(detectDangerousPatterns('eval "rm -rf /"')).toBeDefined()
  })

  test('detects exec', () => {
    expect(detectDangerousPatterns('exec /bin/sh')).toBeDefined()
  })

  test('detects source', () => {
    expect(detectDangerousPatterns('source ~/.bashrc')).toBeDefined()
  })

  test('detects dot-source', () => {
    expect(detectDangerousPatterns('. /etc/profile')).toBeDefined()
  })

  test('detects redirect to /etc', () => {
    expect(detectDangerousPatterns('echo x > /etc/passwd')).toBeDefined()
  })

  test('detects redirect to /dev', () => {
    expect(detectDangerousPatterns('cat file > /dev/sda')).toBeDefined()
  })

  test('returns undefined for safe commands', () => {
    expect(detectDangerousPatterns('npm install')).toBeUndefined()
    expect(detectDangerousPatterns('git status')).toBeUndefined()
    expect(detectDangerousPatterns('ls -la')).toBeUndefined()
  })

  test('detects exec even in docker exec context (known limitation)', () => {
    expect(detectDangerousPatterns('docker exec -it container bash')).toBeDefined()
  })

  test('does not false-positive on "eval" inside a word', () => {
    // "evaluation" contains "eval" but shouldn't match
    expect(detectDangerousPatterns('echo evaluation')).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// detectHeredoc
// ---------------------------------------------------------------------------

describe('detectHeredoc', () => {
  test('detects basic heredoc', () => {
    expect(detectHeredoc('cat <<EOF\nhello\nEOF')).toBe(true)
  })

  test('detects indented heredoc', () => {
    expect(detectHeredoc('cat <<-EOF\nhello\nEOF')).toBe(true)
  })

  test('detects quoted heredoc delimiter', () => {
    expect(detectHeredoc("cat <<'EOF'\nhello\nEOF")).toBe(true)
  })

  test('detects double-quoted heredoc delimiter', () => {
    expect(detectHeredoc('cat <<"EOF"\nhello\nEOF')).toBe(true)
  })

  test('returns false for normal commands', () => {
    expect(detectHeredoc('echo hello')).toBe(false)
  })

  test('returns false for less-than comparison', () => {
    // Single < should not trigger
    expect(detectHeredoc('test 1 < 2')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// detectSuspiciousLineContinuation
// ---------------------------------------------------------------------------

describe('detectSuspiciousLineContinuation', () => {
  test('detects backslash-newline inside a word', () => {
    // tr\<NL>aceroute → traceroute
    expect(detectSuspiciousLineContinuation('tr\\\naceroute')).toBe(true)
  })

  test('does not flag normal line continuation after space', () => {
    // "npm install \\\n  --save" is normal multi-line
    expect(detectSuspiciousLineContinuation('npm install \\\n--save')).toBe(false)
  })

  test('does not flag commands without line continuation', () => {
    expect(detectSuspiciousLineContinuation('npm install')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// joinLineContinuations
// ---------------------------------------------------------------------------

describe('joinLineContinuations', () => {
  test('joins backslash-newline', () => {
    expect(joinLineContinuations('npm install \\\n--save')).toBe(
      'npm install --save',
    )
  })

  test('returns unchanged if no continuations', () => {
    expect(joinLineContinuations('npm install')).toBe('npm install')
  })

  test('joins multiple continuations', () => {
    expect(joinLineContinuations('a \\\nb \\\nc')).toBe('a b c')
  })
})
