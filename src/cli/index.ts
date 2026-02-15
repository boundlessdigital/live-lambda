import dotenv from 'dotenv'
import { Command } from 'commander'
import { main } from './main.js'
import { set_log_level, LOG_LEVELS } from '../lib/logger.js'

// Load .env before anything else so CDK app subprocesses inherit the vars
dotenv.config()

const program = new Command()

program
  .name('live-lambda')
  .version('1.0.0')
  .description('Live Lambda CLI for serverless development')
  .option('-v, --verbose', 'Enable verbose logging (debug level)')
  .option('-q, --quiet', 'Suppress most output (warn level only)')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts()
    if (opts.verbose) {
      set_log_level(LOG_LEVELS.debug)
    } else if (opts.quiet) {
      set_log_level(LOG_LEVELS.warn)
    }
  })

program
  .command('start')
  .description('Starts the development server')
  .action(async function (this: Command) {
    await main(this)
  })

program
  .command('destroy')
  .description('Destroys the development stacks')
  .action(async function (this: Command) {
    await main(this)
  })

program.parse(process.argv)
