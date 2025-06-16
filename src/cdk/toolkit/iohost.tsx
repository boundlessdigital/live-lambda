import 'colors'
import React from 'react'
import { render, Instance } from 'ink'
import {
  IoMessage,
  IoRequest,
  NonInteractiveIoHost,
  NonInteractiveIoHostProps,
} from '@aws-cdk/toolkit-lib'
import App, { AppProps } from './ui/App.js' // Assuming App.tsx is in a 'ui' subdirectory
import { StackPanelProps } from './ui/StackPanel.js' // For StackUIData type

// Re-define or import NotificationHandler and HandlingResult if they are still needed for parsing logic
// For now, we'll simplify and integrate parsing logic directly or create a new system.

const SECURITY_PROMPT_REQUIRED_APPROVALS_CODE = 'CDK_TOOLKIT_I5060'
const SECURITY_PROMPT_KEYWORDS = ['security', 'iam', 'auth', 'permissions']

// This type will hold the UI state for each stack
export interface StackUIData extends StackPanelProps {
  start_time?: number;
  is_completed?: boolean;
  operation?: 'deploying' | 'destroying';
}

export class CustomIoHost extends NonInteractiveIoHost {
  private stacks_data: Map<string, StackUIData>
  private ink_instance: Instance

  constructor(props?: NonInteractiveIoHostProps) {
    super(props)
    this.stacks_data = new Map<string, StackUIData>()
    this.ink_instance = render(
      <App stacks_data={Array.from(this.stacks_data.values())} />
    )
  }

  private get_or_create_stack_data(stack_name: string, operation: 'deploying' | 'destroying' = 'deploying'): StackUIData {
    if (this.stacks_data.has(stack_name)) {
      const data = this.stacks_data.get(stack_name)!
      // If operation changes (e.g. from deploying to destroying or vice-versa due to re-entrant messages)
      if (data.operation !== operation) {
        data.operation = operation;
        data.status = `${operation === 'deploying' ? 'Deploying' : 'Destroying'}...`;
        data.is_completed = false; // Reset completion status
        data.start_time = Date.now(); // Reset start time for new operation
      }
      return data;
    }
    const new_stack_data: StackUIData = {
      stack_name,
      status: `${operation === 'deploying' ? 'Deploying' : 'Destroying'}...`,
      logs: [],
      is_initially_expanded: true, // Expand new stacks by default
      start_time: Date.now(),
      is_completed: false,
      operation,
    }
    this.stacks_data.set(stack_name, new_stack_data)
    return new_stack_data
  }

  private update_stack_data(stack_name: string, updates: Partial<StackUIData>) {
    const existing_data = this.get_or_create_stack_data(stack_name, updates.operation)
    const new_data = { ...existing_data, ...updates }
    this.stacks_data.set(stack_name, new_data)
    this.rerender_ui()
  }

  private append_log(stack_name: string, log_message: string, operation?: 'deploying' | 'destroying') {
    const stack_data = this.get_or_create_stack_data(stack_name, operation)
    this.update_stack_data(stack_name, { logs: [...stack_data.logs, log_message] })
  }

  private rerender_ui() {
    this.ink_instance.rerender(
      <App stacks_data={Array.from(this.stacks_data.values())} />
    )
  }

  public async notify(msg: IoMessage<unknown>): Promise<void> {
    if (typeof msg.message !== 'string' || msg.message.trim() === '') {
      // Potentially log to a general log panel in the future, or super.notify(msg)
      return
    }

    const message = msg.message

    // --- Synthesis time (always suppress) ---
    if (message.includes('Synthesis time:')) {
      return // Handled by suppression
    }

    // --- Failure ---
    const failure_match = message.match(/^✖ (Deployment|Destroy) failed for stack (.*?)\.?$/)
    if (failure_match) {
      const stack_name = failure_match[2]
      this.update_stack_data(stack_name, {
        status: `✖ ${failure_match[1]} failed for stack ${stack_name}`,
        is_completed: true, // Mark as completed, albeit failed
        logs: [...(this.stacks_data.get(stack_name)?.logs || []), message],
      })
      return
    }

    // --- Destroy Success ---
    const destroy_success_match = message.match(/^✅\s+(.*?): destroyed$/)
    if (destroy_success_match) {
      const stack_name = destroy_success_match[1]
      const progress = this.stacks_data.get(stack_name)
      if (progress && progress.start_time) {
        const duration = ((Date.now() - progress.start_time) / 1000).toFixed(2)
        this.update_stack_data(stack_name, {
          status: `✅ Stack ${stack_name} destroyed in ${duration}s.`,
          is_completed: true,
        })
      } else {
        this.update_stack_data(stack_name, {
          status: `✅ Stack ${stack_name} destroyed.`,
          is_completed: true,
        })
      }
      return
    }

    // --- No changes ---
    const no_changes_match = message.match(/^✅\s+(.*?)\s+\(no changes\)$/)
    if (no_changes_match) {
      const stack_name = no_changes_match[1]
      this.get_or_create_stack_data(stack_name) // Ensure stack data exists
      this.update_stack_data(stack_name, {
        status: `✅ No changes to stack ${stack_name}.`,
        is_completed: true,
      })
      return
    }

    // --- Standard format: "StackName: event" (also handles Asset Bundling) ---
    const standard_match = message.match(/^([A-Z][\w-]+): (.*)$/)
    if (standard_match) {
      const stack_name = standard_match[1]
      const event_details = standard_match[2]
      const is_destroy_op = event_details.toLowerCase().includes('destroying')
      const operation = is_destroy_op ? 'destroying' : 'deploying'
      
      this.get_or_create_stack_data(stack_name, operation) // Ensures stack data exists with correct operation

      if (event_details.startsWith('✅  Stack ARN:')) { // Deployment Success
        const progress = this.stacks_data.get(stack_name)
        if (progress && progress.start_time) {
          const duration = ((Date.now() - progress.start_time) / 1000).toFixed(2)
          this.update_stack_data(stack_name, {
            status: `✅ Stack ${stack_name} deployed successfully in ${duration}s.`,
            is_completed: true,
            logs: [...progress.logs, event_details],
          })
        } else {
          this.update_stack_data(stack_name, {
            status: `✅ Stack ${stack_name} deployed successfully.`,
            is_completed: true,
            logs: [...(this.stacks_data.get(stack_name)?.logs || []), event_details],
          })
        }
      } else { // Regular progress update or asset bundling message
        this.update_stack_data(stack_name, { 
          status: event_details, // Update status with the latest event detail
          logs: [...(this.stacks_data.get(stack_name)?.logs || []), event_details],
         })
      }
      return
    }

    // --- Outputs ---
    // Example: MyStack.MyOutput = somevalue
    // Example: MyStack.ExportsOutputFnGetAttMyLambdaArnXYZ = arn:aws:lambda...
    const output_match = message.match(/^([A-Z][\w-]+)\.([A-Za-z0-9._-]+)\s*=\s*(.*)$/)
    if (output_match) {
      const stack_name = output_match[1]
      const output_key_full = output_match[2]
      const output_value = output_match[3]
      
      this.get_or_create_stack_data(stack_name) // Ensure stack data exists
      
      // Clean up the output key for display
      let display_key = output_key_full.replace('ExportsOutputFnGetAtt', '').replace('Outputs.', '')
      // Remove potential CloudFormation-generated hash from lambda ARN outputs etc.
      display_key = display_key.replace(/[A-Z0-9]{8}$/, '') 
      // Further common prefix removal if necessary, e.g., if the stack name is part of the key
      if (display_key.startsWith(stack_name)) {
        display_key = display_key.substring(stack_name.length).replace(/^[._-]/, '');
      }

      const log_message = `↪ Output: ${display_key}: ${output_value}`
      this.append_log(stack_name, log_message)
      // Optionally update status to 'Processing outputs...' if desired
      // this.update_stack_data(stack_name, { status: 'Processing outputs...' });
      return
    }

    // --- Initial Stack Name Announcement (often followed by other messages) ---
    const stack_name_only_match = message.match(/^([A-Z][\w-]*)$/)
    if (stack_name_only_match) {
      const stack_name = stack_name_only_match[1]
      this.get_or_create_stack_data(stack_name) // Ensures stack is initialized
      // Don't set status here as a more specific status usually follows immediately.
      return
    }

    // Fallback: If a message is for an existing stack but not caught by specific regex, add to its logs
    for (const [stack_name_key, stack_item] of this.stacks_data) {
      if (!stack_item.is_completed && message.includes(stack_name_key)) {
        this.append_log(stack_name_key, message);
        return;
      }
    }
    
    // If still unhandled, could log to a general panel or ignore
    // console.log(`Unhandled CDK message: ${message}`);
    // await super.notify(msg) // Or pass to default handler if desired
  }

  public async requestResponse<DataType, ResponseType>(
    request: IoRequest<DataType, ResponseType>
  ): Promise<ResponseType> {
    if (request.code === SECURITY_PROMPT_REQUIRED_APPROVALS_CODE) {
      return request.defaultResponse
    }

    const messageContent = request.message.toLowerCase()
    const isSecurityPrompt = SECURITY_PROMPT_KEYWORDS.some((keyword) =>
      messageContent.includes(keyword.toLowerCase())
    )

    if (isSecurityPrompt) {
      const approvalLogMessage = `Auto-approving security sensitive changes: ${
        request.message.split('\n')[0]
      }`
      console.log(`ℹ️  ${approvalLogMessage}`.blue) // Log to console directly
      return true as unknown as ResponseType
    }

    return super.requestResponse(request)
  }

  public cleanup() {
    this.ink_instance.unmount()
  }
}
