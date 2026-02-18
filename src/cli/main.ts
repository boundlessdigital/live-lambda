import {
  BootstrapEnvironments,
  DeployResult,
  ICloudAssemblySource,
  Toolkit,
  StackSelectionStrategy
} from '@aws-cdk/toolkit-lib'
import { serve } from '../server/index.js'
import { Command } from 'commander'
import * as fs from 'fs'
import * as path from 'path'
import chokidar from 'chokidar'
import { CustomIoHost } from '../cdk/toolkit/iohost.js'
import { SpinnerDisplay, KeypressListener } from '../lib/display/index.js'
import { logger } from '../lib/logger.js'
import {
  APPSYNC_STACK_NAME,
  LAYER_STACK_NAME,
  INTERNAL_STACK_NAMES,
  OUTPUT_LIVE_LAMBDA_PROXY_LAYER_ARN,
  OUTPUT_EVENT_API_HTTP_HOST,
  OUTPUT_EVENT_API_REALTIME_HOST
} from '../lib/constants.js'
import { clean_lambda_functions, extract_region_from_arn } from './lambda_cleanup.js'

const CDK_OUTPUTS_FILE = 'cdk.out/outputs.json'
const MAX_CONCURRENCY = 5

export async function main(command: Command) {
  // Suppress npm warnings from CDK bundling picking up pnpm-specific .npmrc settings
  process.env.NPM_CONFIG_LOGLEVEL ??= 'error'

  const parent_opts = command.parent?.opts() ?? {}
  const display = new SpinnerDisplay()
  const custom_io_host = new CustomIoHost({
    verbose: parent_opts.verbose ?? false,
    display
  })
  const keypress = new KeypressListener({
    on_toggle_verbose: () => custom_io_host.toggle_verbose()
  })
  const cdk = new Toolkit({
    ioHost: custom_io_host
  })

  const cleanup_tasks = async () => {
    keypress.stop()
    custom_io_host.cleanup()
  }

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    await cleanup_tasks()
    process.exit(0)
  })
  process.on('SIGTERM', async () => {
    await cleanup_tasks()
    process.exit(0)
  })

  try {
    if (process.stdin.isTTY && !parent_opts.verbose) {
      display.info('Press v to toggle verbose output')
    }
    keypress.start()

    const command_name = command.name()

    const { app: entrypoint, watch: watch_config } = JSON.parse(
      fs.readFileSync('cdk.json', 'utf-8')
    )

    const assembly = await cdk.fromCdkApp(entrypoint)

    if (command_name === 'bootstrap') {
      await run_bootstrap(cdk, assembly)
    }

    if (command_name === 'dev') {
      await run_dev(cdk, assembly, watch_config)
    }

    if (command_name === 'destroy') {
      await run_destroy(cdk, assembly)
    }

    if (command_name === 'uninstall') {
      const skip_cleanup = command.opts().skipCleanup ?? false
      await run_uninstall(cdk, assembly, skip_cleanup)
    }
  } catch (error) {
    logger.error('An unexpected error occurred:', error)
  } finally {
    await cleanup_tasks()
  }
}

async function bootstrap_cdk_environment(cdk: Toolkit, assembly: ICloudAssemblySource) {
  logger.info('Bootstrapping CDK environment...')
  const stacks = await cdk.list(assembly, {
    stacks: { strategy: StackSelectionStrategy.ALL_STACKS }
  })
  const unique_envs = [...new Set(
    stacks.map(s => `aws://${s.environment.account}/${s.environment.region}`)
  )]
  const environments = BootstrapEnvironments.fromList(unique_envs)
  await cdk.bootstrap(environments)
}

async function run_bootstrap(cdk: Toolkit, assembly: ICloudAssemblySource) {
  await bootstrap_cdk_environment(cdk, assembly)
  logger.info('Deploying live-lambda infrastructure stacks...')
  await deploy_internal_stacks(cdk, assembly)
  logger.info('Bootstrap complete. AppSync and Layer stacks deployed.')
}

async function run_dev(
  cdk: Toolkit,
  assembly: ICloudAssemblySource,
  watch_config: any
): Promise<void> {
  await bootstrap_cdk_environment(cdk, assembly)

  // Deploy ALL stacks to populate outputs.json with function ARNs, handlers, and asset paths.
  // The server needs these outputs to resolve which local handler to execute for each Lambda.
  const deployment = await deploy_all_stacks(cdk, assembly)

  const config = extract_server_config(deployment)
  await serve(config)
  await watch_file_changes(cdk, assembly)
  // CDK watch monitors for file changes and redeploys affected stacks
  await watch_stacks(cdk, assembly, watch_config)
}

async function run_destroy(cdk: Toolkit, assembly: ICloudAssemblySource) {
  const internal = new Set<string>(INTERNAL_STACK_NAMES)

  // List all stacks in the assembly to find consumer stacks
  const all_stacks = await cdk.list(assembly, {
    stacks: { strategy: StackSelectionStrategy.ALL_STACKS }
  })
  const consumer_stacks = all_stacks
    .map((s) => s.name)
    .filter((name) => !internal.has(name))

  if (consumer_stacks.length === 0) {
    logger.info('No consumer stacks to destroy.')
    return
  }

  logger.info(`Destroying consumer stacks: ${consumer_stacks.join(', ')}`)
  await cdk.destroy(assembly, {
    stacks: {
      strategy: StackSelectionStrategy.PATTERN_MATCH,
      patterns: consumer_stacks
    }
  })
}

async function run_uninstall(
  cdk: Toolkit,
  assembly: ICloudAssemblySource,
  skip_cleanup: boolean
) {
  if (!skip_cleanup) {
    logger.info('Cleaning live-lambda configuration from Lambda functions...')

    const layer_arn = resolve_layer_arn()
    if (layer_arn) {
      const region = extract_region_from_arn(layer_arn)
      await clean_lambda_functions(region, layer_arn)
    } else {
      // Fallback: try to determine region from AWS SDK defaults and scan by env var marker
      logger.warn(
        'Could not determine layer ARN from outputs. Scanning by env var marker instead.'
      )
      const region = process.env.AWS_DEFAULT_REGION ?? process.env.AWS_REGION
      if (region) {
        await clean_lambda_functions(region)
      } else {
        logger.error(
          'Could not determine AWS region. Set AWS_REGION or AWS_DEFAULT_REGION, ' +
            'or run "live-lambda dev" first to generate outputs.json.'
        )
      }
    }
  }

  // Destroy consumer stacks first — internal stacks have CloudFormation exports
  // that consumer stacks reference, so they must be removed first
  await run_destroy(cdk, assembly)

  logger.info('Destroying live-lambda infrastructure stacks...')
  await destroy_internal_stacks(cdk, assembly)
  logger.info('Uninstall complete.')
}

// --- Internal helpers ---

async function deploy_internal_stacks(cdk: Toolkit, assembly: ICloudAssemblySource) {
  return cdk.deploy(assembly, {
    stacks: {
      strategy: StackSelectionStrategy.PATTERN_MATCH,
      patterns: [...INTERNAL_STACK_NAMES]
    },
    outputsFile: CDK_OUTPUTS_FILE,
    concurrency: MAX_CONCURRENCY,
    deploymentMethod: {
      method: 'change-set'
    }
  })
}

async function deploy_all_stacks(cdk: Toolkit, assembly: ICloudAssemblySource) {
  return cdk.deploy(assembly, {
    stacks: {
      strategy: StackSelectionStrategy.ALL_STACKS
    },
    outputsFile: CDK_OUTPUTS_FILE,
    concurrency: MAX_CONCURRENCY,
    deploymentMethod: {
      method: 'change-set'
    }
  })
}

async function destroy_internal_stacks(cdk: Toolkit, assembly: ICloudAssemblySource) {
  await cdk.destroy(assembly, {
    stacks: {
      strategy: StackSelectionStrategy.PATTERN_MATCH,
      patterns: [...INTERNAL_STACK_NAMES]
    }
  })
}

async function watch_file_changes(
  cdk: Toolkit,
  assembly: ICloudAssemblySource
) {
  const watcher = chokidar.watch('.', {
    followSymlinks: false,
    ignored: (path, stats) => {
      if (path.includes('node_modules') || path.includes('worktrees') || path.includes('.git')) return true
      return !path.endsWith('.ts') && !path.startsWith('cdk.out')
    }
  })
  watcher.on('error', (error: unknown) => {
    logger.debug(`File watcher error (non-fatal): ${error}`)
  })
  watcher.on('change', async (path: string) => {
    logger.info(`File ${path} changes detected, redeploying...`)
    // await deploy_stacks(cdk, assembly)
  })
}

async function watch_stacks(
  cdk: Toolkit,
  assembly: ICloudAssemblySource,
  watch_config: any
) {
  return await cdk.watch(assembly, {
    concurrency: MAX_CONCURRENCY,
    deploymentMethod: {
      method: 'change-set'
    },
    outputsFile: CDK_OUTPUTS_FILE,
    ...watch_config
  })
}

function resolve_layer_arn(): string | undefined {
  try {
    const outputs_path = path.join(process.cwd(), CDK_OUTPUTS_FILE)
    if (fs.existsSync(outputs_path)) {
      const outputs = JSON.parse(fs.readFileSync(outputs_path, 'utf-8'))
      const layer_stack = outputs[LAYER_STACK_NAME]
      if (layer_stack?.[OUTPUT_LIVE_LAMBDA_PROXY_LAYER_ARN]) {
        return layer_stack[OUTPUT_LIVE_LAMBDA_PROXY_LAYER_ARN]
      }
    }
  } catch {
    logger.debug('Could not read layer ARN from outputs.json')
  }
  return undefined
}

export class ServerConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ServerConfigError'
  }
}

function extract_server_config(deployment: DeployResult) {
  const events = deployment.stacks.find(
    (stack) => stack.stackName === APPSYNC_STACK_NAME
  )

  const layer = deployment.stacks.find(
    (stack) => stack.stackName === LAYER_STACK_NAME
  )

  // Validate required stacks exist - use direct check for TypeScript narrowing
  if (!events || !layer) {
    const missing_stacks: string[] = []
    if (!events) missing_stacks.push(APPSYNC_STACK_NAME)
    if (!layer) missing_stacks.push(LAYER_STACK_NAME)
    throw new ServerConfigError(
      `Missing required stacks: ${missing_stacks.join(', ')}. ` +
        `Ensure 'LiveLambda.install(app)' is called in your CDK app and all stacks deployed successfully.`
    )
  }

  // Extract values - events and layer are now guaranteed to be defined
  const region = events.environment?.region
  const http = events.outputs[OUTPUT_EVENT_API_HTTP_HOST]
  const realtime = events.outputs[OUTPUT_EVENT_API_REALTIME_HOST]
  const layer_arn = layer.outputs[OUTPUT_LIVE_LAMBDA_PROXY_LAYER_ARN]

  // Validate required outputs exist
  const missing_outputs: string[] = []
  if (!region) missing_outputs.push('region (from AppSync stack environment)')
  if (!http) missing_outputs.push(OUTPUT_EVENT_API_HTTP_HOST)
  if (!realtime) missing_outputs.push(OUTPUT_EVENT_API_REALTIME_HOST)
  if (!layer_arn) missing_outputs.push(OUTPUT_LIVE_LAMBDA_PROXY_LAYER_ARN)

  if (missing_outputs.length > 0) {
    throw new ServerConfigError(
      `Missing required stack outputs: ${missing_outputs.join(', ')}. ` +
        `This may indicate a partial deployment. Run 'live-lambda destroy' then 'live-lambda dev' to redeploy.`
    )
  }

  return {
    region,
    http,
    realtime,
    layer_arn
  }
}
