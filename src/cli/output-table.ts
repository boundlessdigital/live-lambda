import Table from 'cli-table3'
import type { DeployResult } from '@aws-cdk/toolkit-lib'

// Stack name patterns to exclude from output (live-lambda infrastructure only)
const INFRA_STACK_PATTERNS = ['AppSyncStack', 'LiveLambda-LayerStack']

/**
 * Simplify CfnOutput key names by removing common prefixes/suffixes
 */
function simplify_output_key(key: string): string {
  // Remove common CDK-generated prefixes like "ExportsOutputFnGetAtt", "ExportsOutputRef"
  let simplified = key
    .replace(/^ExportsOutputFnGetAtt/, '')
    .replace(/^ExportsOutputRef/, '')
    .replace(/[A-F0-9]{8}$/, '') // Remove hash suffixes

  // Convert PascalCase to readable format
  simplified = simplified
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')

  return simplified || key
}

/**
 * Truncate long values with ellipsis in the middle
 */
function truncate_value(value: string, max_length: number): string {
  if (value.length <= max_length) return value

  const half = Math.floor((max_length - 3) / 2)
  return `${value.slice(0, half)}...${value.slice(-half)}`
}

/**
 * Check if a stack is live-lambda infrastructure (should be hidden from output)
 */
function is_infra_stack(stack_name: string): boolean {
  return INFRA_STACK_PATTERNS.some((pattern) => stack_name.includes(pattern))
}

/**
 * Format project stack outputs using cli-table3
 * Only shows outputs from user project stacks, not live-lambda infrastructure
 */
export function format_project_outputs(result: DeployResult): string {
  const project_stacks = result.stacks.filter(
    (stack) => !is_infra_stack(stack.stackName)
  )

  if (project_stacks.length === 0) {
    return 'No project stack outputs to display.'
  }

  const table = new Table({
    head: ['Output', 'Value'],
    colWidths: [25, 60],
    wordWrap: true,
    style: {
      head: ['cyan'],
      border: ['gray']
    }
  })

  for (const stack of project_stacks) {
    const outputs = Object.entries(stack.outputs || {})

    if (outputs.length === 0) continue

    // Add stack name as header row
    table.push([
      {
        colSpan: 2,
        content: `\x1b[1m${stack.stackName}\x1b[0m`,
        hAlign: 'left'
      }
    ])

    // Add outputs, truncating long values
    for (const [key, value] of outputs) {
      const short_key = simplify_output_key(key)
      const short_value = truncate_value(String(value), 55)
      table.push([`  ${short_key}`, short_value])
    }
  }

  return table.toString()
}

/**
 * Get a summary of stacks that were deployed
 */
export function get_deployment_summary(result: DeployResult): {
  total: number
  project: number
  infra: number
} {
  const project_count = result.stacks.filter(
    (s) => !is_infra_stack(s.stackName)
  ).length
  return {
    total: result.stacks.length,
    project: project_count,
    infra: result.stacks.length - project_count
  }
}
