# CLI Output Improvements

## Overview

Improve the CLI output during `live-lambda server` startup to show clean, scannable deployment progress with interactive expand/collapse functionality.

## Problem

The current CLI output shows:
1. Verbose CDK deployment progress - Every CloudFormation resource update is logged line-by-line
2. Cluttered stack outputs - Long export names and ARNs are hard to scan

## Solution

Use **Listr2** for interactive task lists with collapsible subtasks and **cli-table3** for formatted output tables.

### Expected Output

```
Deploying stacks...

✔ QueueStack (no changes)
✔ AppSyncStack (no changes)
▼ LiveLambda-LayerStack
  │ Creating CloudFormation changeset...
  │ UPDATE_IN_PROGRESS: LiveLambdaProxyLayer
  │ UPDATE_COMPLETE: LiveLambdaProxyLayer
✔ ListenerLambda
✔ WebLambda

Your Stack Outputs:
┌──────────────────┬────────────────────────────────────────────────────┐
│ Output           │ Value                                              │
├──────────────────┼────────────────────────────────────────────────────┤
│ ListenerLambda   │                                                    │
│   Function ARN   │ arn:aws:lambda:us-west-1:...:function:Listener...  │
│   Handler        │ index.handler                                      │
├──────────────────┼────────────────────────────────────────────────────┤
│ WebLambda        │                                                    │
│   Function ARN   │ arn:aws:lambda:us-west-1:...:function:WebLambda... │
│   Lambda URL     │ https://xrxnhu...lambda-url.us-west-1.on.aws/      │
└──────────────────┴────────────────────────────────────────────────────┘
```

## Implementation Tasks

- [x] Add listr2 and cli-table3 dependencies
- [x] Create output-table.ts - cli-table3 output formatter
- [x] Create listr-deploy.ts - Listr2 task orchestration
- [ ] Modify iohost.ts - Route CDK messages to Listr2
- [ ] Modify main.ts - Integrate Listr2 into deploy flow
- [ ] Test the implementation

## Files Modified/Created

| File | Action | Description |
|------|--------|-------------|
| `package.json` | Modified | Added listr2, cli-table3 dependencies |
| `src/cli/listr-deploy.ts` | Created | Listr2 task orchestration |
| `src/cli/output-table.ts` | Created | cli-table3 output formatter |
| `src/cdk/toolkit/iohost.ts` | To modify | Route CDK messages to Listr2 |
| `src/cli/main.ts` | To modify | Integrate Listr2 into deploy flow |

## Key Implementation Details

### Listr2 Configuration
- `concurrent: true` - Deploy stacks in parallel (matches existing behavior)
- `collapseSubtasks: true` - Auto-collapse completed tasks
- `collapseErrors: false` - Keep failed tasks expanded for debugging

### Output Filtering
- Infrastructure stacks (AppSyncStack, LiveLambda-LayerStack) hidden from output table
- Project stacks (QueueStack, ListenerLambda, WebLambda, etc.) shown with their outputs
- Long ARNs truncated with ellipsis

### Message Routing
- Parse `IoMessage` to identify stack name from message content
- Route to corresponding Listr2 task for live updates
- Non-stack messages (synthesis, general info) shown normally

## Dependencies

- `listr2` - Task list UI with collapsible subtasks
- `cli-table3` - Table formatting for terminal output
