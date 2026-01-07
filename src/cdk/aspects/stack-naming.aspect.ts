import * as cdk from 'aws-cdk-lib'
import { IConstruct } from 'constructs'

export interface StackNamingAspectProps {
  /**
   * The prefix to add to all stack names.
   * Pattern: {app_name}-{stage}-
   */
  prefix: string
}

/**
 * CDK Aspect that prefixes all stack names with a given prefix.
 *
 * This ensures all stacks in the CDK app follow the naming convention:
 * {app_name}-{stage}-{StackName}
 *
 * For example, with prefix 'my-app-dev-':
 * - 'ApiStack' becomes 'my-app-dev-ApiStack'
 * - 'WorkerStack' becomes 'my-app-dev-WorkerStack'
 */
export class StackNamingAspect implements cdk.IAspect {
  private readonly prefix: string
  private readonly processed_stacks = new Set<string>()

  constructor(props: StackNamingAspectProps) {
    this.prefix = props.prefix
  }

  public visit(node: IConstruct): void {
    // Only process Stack nodes
    if (!(node instanceof cdk.Stack)) {
      return
    }

    const stack = node

    // Skip if already processed (aspects can visit nodes multiple times)
    if (this.processed_stacks.has(stack.node.path)) {
      return
    }

    // Skip if the stack name already has the prefix
    const current_name = stack.stackName
    if (current_name.startsWith(this.prefix)) {
      this.processed_stacks.add(stack.node.path)
      return
    }

    // Apply the prefix to the stack name
    const new_name = `${this.prefix}${current_name}`

    // Use the internal property to update the stack name
    // This is the same approach CDK uses for stack naming
    ;(stack as any)._stackName = new_name

    this.processed_stacks.add(stack.node.path)
  }
}
