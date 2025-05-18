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
  .action(async (command: Command) => {
    await main(command)
  })

program
  .command('destroy')
  .description('Destroys the development stacks')
  .action(async (command: Command) => {
    await main(command)
  })

program.parse(process.argv)
