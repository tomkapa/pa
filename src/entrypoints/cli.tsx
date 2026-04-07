import { Command } from 'commander'
import { createRoot } from '../ink.js'
import { App } from '../app.js'

process.on('exit', () => {
  process.stdout.write('\n')
})

const program = new Command()
  .name('pa')
  .version('0.1.0')
  .description('An AI coding agent')
  .action(async () => {
    // Clear screen and move cursor to top before rendering TUI
    process.stdout.write('\x1b[2J\x1b[H')
    const instance = createRoot(<App />)
    await instance.waitUntilExit()
  })

program.parse()
