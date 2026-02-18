# Command Line Interface (CLI)

The `live-lambda` CLI manages AWS infrastructure and the local development server. It is built with `commander` and provides four commands for the full lifecycle of a live-lambda project.

## Usage

When installed as a dependency, run via your package manager:

```bash
pnpm exec live-lambda <command> [options]
```

Or add scripts to your `package.json`:

```json
{
  "scripts": {
    "bootstrap": "AWS_PROFILE=my-profile live-lambda bootstrap",
    "dev": "AWS_PROFILE=my-profile live-lambda dev",
    "destroy": "AWS_PROFILE=my-profile live-lambda destroy",
    "uninstall": "AWS_PROFILE=my-profile live-lambda uninstall"
  }
}
```

## Global Options

| Option | Description |
|--------|-------------|
| `-v, --verbose` | Enable debug-level logging |
| `-q, --quiet` | Suppress most output (warn level only) |

## Commands

### `bootstrap`

Deploy only the internal live-lambda infrastructure stacks (AppSync Event API + Lambda Layer).

```bash
live-lambda bootstrap [--profile <profile>]
```

This is a fast deployment that sets up the AppSync WebSocket API and the Lambda extension layer. Consumer stacks are not deployed.

Use this when you want to provision the live-lambda infrastructure without deploying your application stacks.

### `dev`

Deploy all stacks, start the local development server, and watch for changes.

```bash
live-lambda dev [--profile <profile>]
```

This is the primary development command. It:

1. Deploys **all** CDK stacks (internal + consumer) to populate `cdk.out/outputs.json`
2. Extracts server configuration (AppSync endpoints, layer ARN, region) from deployment outputs
3. Starts the local development server, which connects to the AppSync WebSocket API
4. Watches for file changes and redeploys affected stacks via CDK watch mode

The server listens for Lambda invocation events proxied through AppSync. When an event arrives, it resolves the matching local handler from stack outputs, executes it with assumed Lambda role credentials, and sends the response back through the WebSocket.

### `destroy`

Destroy only consumer stacks. Live-lambda infrastructure (AppSync + Layer) is preserved.

```bash
live-lambda destroy [--profile <profile>]
```

This command enumerates all stacks in the CDK assembly, filters out the internal live-lambda stacks, and destroys the remaining consumer stacks. The AppSync and Layer stacks are left intact so you can quickly redeploy with `dev`.

### `uninstall`

Fully remove live-lambda from your AWS account.

```bash
live-lambda uninstall [--profile <profile>] [--skip-cleanup]
```

| Option | Description |
|--------|-------------|
| `--skip-cleanup` | Skip Lambda function cleanup, only destroy stacks |

This command performs a complete teardown:

1. **Lambda cleanup** (unless `--skip-cleanup`): Scans all Lambda functions in the region and removes live-lambda artifacts from any affected function:
   - Removes the live-lambda layer
   - Removes 6 live-lambda environment variables (`AWS_LAMBDA_EXEC_WRAPPER`, `LRAP_LISTENER_PORT`, `AWS_LAMBDA_EXTENSION_NAME`, `LIVE_LAMBDA_APPSYNC_REGION`, `LIVE_LAMBDA_APPSYNC_REALTIME_HOST`, `LIVE_LAMBDA_APPSYNC_HTTP_HOST`)
   - Identifies affected functions by layer ARN prefix match or `AWS_LAMBDA_EXEC_WRAPPER` env var marker
2. **Destroy consumer stacks**: Same as the `destroy` command
3. **Destroy internal stacks**: Removes the AppSync and Layer stacks

Consumer stacks must be destroyed before internal stacks because they reference CloudFormation exports from the AppSync stack.

**Required IAM permissions** for Lambda cleanup: `lambda:ListFunctions`, `lambda:GetFunctionConfiguration`, `lambda:UpdateFunctionConfiguration`.

## Configuration

The CLI reads `cdk.json` from the current working directory to determine:

- **`app`**: The CDK app entry point
- **`watch`**: File watch configuration passed to CDK watch mode

After deployment, stack outputs are written to `cdk.out/outputs.json`. The `uninstall` command reads the layer ARN from this file to identify which Lambda functions to clean. If the file is missing, it falls back to scanning by environment variable marker.

## CLI Implementation

- **`src/cli/index.ts`**: Commander.js command definitions and option parsing
- **`src/cli/main.ts`**: Core logic for each command (`run_bootstrap`, `run_dev`, `run_destroy`, `run_uninstall`)
- **`src/cli/lambda_cleanup.ts`**: Lambda function scanning and cleanup logic for `uninstall`
