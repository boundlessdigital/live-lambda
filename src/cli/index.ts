import { Command } from 'commander'
import { main } from './main.js'
import { set_log_level, LOG_LEVELS } from '../lib/logger.js'

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
  .command('bootstrap')
  .description('Deploy the live-lambda infrastructure stacks (AppSync + Layer)')
  .option('-p, --profile <profile>', 'AWS profile to use (sets AWS_PROFILE)')
  .action(async function (this: Command) {
    const profile = this.opts().profile
    if (profile) process.env.AWS_PROFILE = profile
    await main(this)
  })

program
  .command('dev')
  .description('Deploy all stacks, start the local development server, and watch for changes')
  .option('-p, --profile <profile>', 'AWS profile to use (sets AWS_PROFILE)')
  .action(async function (this: Command) {
    const profile = this.opts().profile
    if (profile) process.env.AWS_PROFILE = profile
    await main(this)
  })

program
  .command('destroy')
  .description('Destroy consumer stacks (preserves live-lambda infrastructure)')
  .option('-p, --profile <profile>', 'AWS profile to use (sets AWS_PROFILE)')
  .action(async function (this: Command) {
    const profile = this.opts().profile
    if (profile) process.env.AWS_PROFILE = profile
    await main(this)
  })

program
  .command('uninstall')
  .description('Remove live-lambda layer and env vars from Lambda functions, then destroy infrastructure stacks')
  .option('-p, --profile <profile>', 'AWS profile to use (sets AWS_PROFILE)')
  .option('--skip-cleanup', 'Skip Lambda function cleanup, only destroy stacks')
  .action(async function (this: Command) {
    const profile = this.opts().profile
    if (profile) process.env.AWS_PROFILE = profile
    await main(this)
  })

program.parse(process.argv)
