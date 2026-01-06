import { Listr } from 'listr2'
import { EventEmitter } from 'events'
import type { DeployResult } from '@aws-cdk/toolkit-lib'

export interface StackEvent {
  stack_name: string
  message: string
  status?: 'pending' | 'deploying' | 'complete' | 'failed' | 'no_changes'
  timestamp?: Date
}

export interface DeployContext {
  result?: DeployResult
  error?: Error
}

interface StackState {
  status: StackEvent['status']
  messages: string[]
  resolver?: (value: void) => void
  task_output_fn?: (output: string) => void
  task_title_fn?: (title: string) => void
}

/**
 * EventEmitter that bridges CDK IoMessages to Listr2 tasks
 */
export class DeployEventEmitter extends EventEmitter {
  private stack_states: Map<string, StackState> = new Map()

  emit_stack_event(event: StackEvent): boolean {
    const state = this.stack_states.get(event.stack_name) || {
      status: 'pending',
      messages: []
    }

    state.messages.push(event.message)
    if (event.status) {
      state.status = event.status
    }
    this.stack_states.set(event.stack_name, state)

    // Update task output if handler is set
    if (state.task_output_fn) {
      state.task_output_fn(event.message)
    }

    // Update task title for status changes
    if (state.task_title_fn) {
      if (event.status === 'no_changes') {
        state.task_title_fn(`${event.stack_name} (no changes)`)
      }
    }

    return this.emit('stack', event)
  }

  complete_stack(stack_name: string, success: boolean): void {
    const state = this.stack_states.get(stack_name)
    if (state) {
      state.status = success ? 'complete' : 'failed'
      if (state.resolver) {
        state.resolver()
      }
    }
    this.emit('stack_complete', { stack_name, success })
  }

  complete_all(): void {
    // Resolve all pending stacks
    for (const [, state] of this.stack_states) {
      if (state.resolver) {
        state.resolver()
      }
    }
    this.emit('all_complete')
  }

  get_stack_state(stack_name: string): StackState | undefined {
    return this.stack_states.get(stack_name)
  }

  get_known_stacks(): string[] {
    return Array.from(this.stack_states.keys())
  }

  register_stack(
    stack_name: string,
    handlers: {
      resolver: (value: void) => void
      output_fn: (output: string) => void
      title_fn: (title: string) => void
    }
  ): void {
    const existing = this.stack_states.get(stack_name) || {
      status: 'pending',
      messages: []
    }
    existing.resolver = handlers.resolver
    existing.task_output_fn = handlers.output_fn
    existing.task_title_fn = handlers.title_fn
    this.stack_states.set(stack_name, existing)
  }
}

/**
 * Parse CDK IoMessage to extract stack information
 * Returns null if message doesn't relate to a specific stack
 */
export function parse_cdk_message(msg: { message?: string; level?: string }): StackEvent | null {
  const message = msg.message || ''

  // Pattern: "StackName | 0/4 | 9:53:05 PM | STATUS | ResourceType | ResourceName"
  const cf_event_match = message.match(
    /^(\S+)\s+\|\s+\d+\/\d+\s+\|\s+[\d:]+\s+[AP]M\s+\|\s+(\S+)\s+\|\s+(\S+)\s+\|\s+(.+)$/
  )
  if (cf_event_match) {
    const [, stack_name, status, resource_type, resource_name] = cf_event_match
    return {
      stack_name,
      message: `${status}: ${resource_name}`,
      status: status.includes('COMPLETE') ? 'complete' : 'deploying'
    }
  }

  // Pattern: "StackName: deploying..."
  const deploying_match = message.match(/^(\S+):\s+deploying\.\.\./)
  if (deploying_match) {
    return {
      stack_name: deploying_match[1],
      message: 'Deploying...',
      status: 'deploying'
    }
  }

  // Pattern: "StackName: creating CloudFormation changeset..."
  const changeset_match = message.match(
    /^(\S+):\s+creating CloudFormation changeset/
  )
  if (changeset_match) {
    return {
      stack_name: changeset_match[1],
      message: 'Creating changeset...',
      status: 'deploying'
    }
  }

  // Pattern: " ✅  StackName (no changes)"
  const no_changes_match = message.match(/✅\s+(\S+)\s+\(no changes\)/)
  if (no_changes_match) {
    return {
      stack_name: no_changes_match[1],
      message: 'No changes',
      status: 'no_changes'
    }
  }

  // Pattern: " ✅  StackName"
  const success_match = message.match(/✅\s+(\S+)$/)
  if (success_match) {
    return {
      stack_name: success_match[1],
      message: 'Complete',
      status: 'complete'
    }
  }

  return null
}

/**
 * Create the main deployment Listr2 instance with dynamic stack discovery
 */
export function create_deploy_listr(
  stack_names: string[],
  emitter: DeployEventEmitter
): Listr<DeployContext> {
  const tasks = stack_names.map((stack_name) => ({
    title: stack_name,
    task: async (_ctx: DeployContext, task: { output: string; title: string }) => {
      // Create a promise that resolves when this stack completes
      await new Promise<void>((resolve) => {
        emitter.register_stack(stack_name, {
          resolver: resolve,
          output_fn: (output) => {
            task.output = output
          },
          title_fn: (title) => {
            task.title = title
          }
        })
      })

      // Check final status
      const state = emitter.get_stack_state(stack_name)
      if (state?.status === 'failed') {
        throw new Error(`Stack ${stack_name} deployment failed`)
      }
    },
    rendererOptions: {
      persistentOutput: false,
      outputBar: 5
    }
  }))

  return new Listr<DeployContext>(tasks, {
    concurrent: true,
    collectErrors: 'minimal',
    exitOnError: false,
    rendererOptions: {
      collapseSubtasks: true,
      collapseErrors: false,
      showErrorMessage: true
    }
  })
}

/**
 * Orchestrate deployment with Listr2 UI
 */
export async function run_deploy_with_ui(
  stack_names: string[],
  emitter: DeployEventEmitter,
  deploy_fn: () => Promise<DeployResult>
): Promise<DeployResult> {
  const listr = create_deploy_listr(stack_names, emitter)
  const ctx: DeployContext = {}

  // Start Listr UI (don't await yet)
  const listr_promise = listr.run(ctx)

  // Run the actual deployment
  const result = await deploy_fn()

  // Signal completion to all tasks
  emitter.complete_all()

  // Wait for Listr UI to finish
  await listr_promise.catch(() => {
    // Ignore Listr errors, we'll check the actual deployment result
  })

  return result
}
