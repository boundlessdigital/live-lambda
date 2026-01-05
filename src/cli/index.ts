import { Command } from 'commander'
import { main } from './main.js'

const program = new Command()

program
  .name('live-lambda')
  .version('1.0.0')
  .description('Live Lambda CLI for serverless development')

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
