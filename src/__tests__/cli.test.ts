import { describe, test, expect } from 'bun:test'

describe('CLI entry point', () => {
  test('--version prints version and exits', async () => {
    const proc = Bun.spawn(['bun', 'run', 'src/entrypoints/cli.tsx', '--version'], {
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const output = await new Response(proc.stdout).text()
    await proc.exited
    expect(proc.exitCode).toBe(0)
    expect(output.trim()).toBe('0.1.0')
  })

  test('--help shows usage information', async () => {
    const proc = Bun.spawn(['bun', 'run', 'src/entrypoints/cli.tsx', '--help'], {
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const output = await new Response(proc.stdout).text()
    await proc.exited
    expect(proc.exitCode).toBe(0)
    expect(output).toContain('An AI coding agent')
    expect(output).toContain('--version')
    expect(output).toContain('--help')
  })
})
