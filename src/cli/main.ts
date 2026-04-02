import {
  BootstrapEnvironments,
  DeployResult,
  ICloudAssemblySource,
  Toolkit,
  StackSelectionStrategy
} from '@aws-cdk/toolkit-lib'
import { serve } from '../server/index.js'
import { Command } from 'commander'
import { execSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import chokidar from 'chokidar'
import ignore from 'ignore'
import { CustomIoHost } from '../cdk/toolkit/iohost.js'
import { SpinnerDisplay, KeypressListener, type TerminalDisplay } from '../lib/display/index.js'
import { logger } from '../lib/logger.js'
import {
  CONTEXT_APP_NAME,
  CONTEXT_ENVIRONMENT,
  CONTEXT_APP_ID,
  INTERNAL_STACK_BASE_NAMES,
  OUTPUT_LIVE_LAMBDA_PROXY_LAYER_ARN,
  OUTPUT_EVENT_API_HTTP_HOST,
  OUTPUT_EVENT_API_REALTIME_HOST,
  compute_prefix,
  prefixed_stack_names,
  APPSYNC_STACK_NAME,
  LAYER_STACK_NAME,
} from '../lib/constants.js'
import type { RegionalServerConfig } from '../server/types.js'
import {
  CloudFormationClient,
  DescribeStacksCommand,
  ListStacksCommand,
} from '@aws-sdk/client-cloudformation'
import { clean_lambda_functions, extract_region_from_arn } from './lambda_cleanup.js'
import { set_live_lambda_enabled, type LayerArnByRegion } from './toggle.js'

const CDK_OUTPUTS_FILE = 'cdk.out/outputs.json'
const MAX_CONCURRENCY = 5

export async function main(command: Command) {
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

  let active_layer_arns: LayerArnByRegion | undefined

  const cleanup_tasks = async () => {
    keypress.stop()
    custom_io_host.cleanup()

    if (active_layer_arns && active_layer_arns.size > 0) {
      logger.info('Disabling LiveLambda on all functions...')
      try {
        await set_live_lambda_enabled(active_layer_arns, false)
      } catch (error) {
        logger.error(`Failed to disable LiveLambda during cleanup: ${error}`)
      }
      active_layer_arns = undefined
    }
  }

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

    // Commands that don't need CDK
    if (command_name === 'serve') {
      active_layer_arns = await run_serve(display)
    } else if (command_name === 'enable' || command_name === 'disable') {
      const { layer_arns } = resolve_all_server_configs_from_outputs()
      await set_live_lambda_enabled(layer_arns, command_name === 'enable')
    } else {
      // Commands that need CDK context and assembly
      const cdk_json = JSON.parse(
        fs.readFileSync('cdk.json', 'utf-8')
      )
      const { app: entrypoint, watch: watch_config, context } = cdk_json

      const prefix = resolve_prefix_from_context(context ?? {})
      const additional_regions = resolve_additional_regions(context ?? {})
      const stack_names = prefixed_stack_names(prefix, additional_regions)

      const assembly = await cdk.fromCdkApp(entrypoint)

      if (command_name === 'bootstrap') {
        await run_bootstrap(cdk, assembly, stack_names)
      }

      if (command_name === 'dev') {
        active_layer_arns = await run_dev(cdk, assembly, watch_config, stack_names, display)
      }

      if (command_name === 'destroy') {
        await run_destroy(cdk, assembly, stack_names)
      }

      if (command_name === 'uninstall') {
        const skip_cleanup = command.opts().skipCleanup ?? false
        await run_uninstall(cdk, assembly, skip_cleanup, stack_names)
      }
    }
  } catch (error) {
    if (error instanceof ConfigError) {
      logger.error(error.message)
    } else {
      logger.error('An unexpected error occurred:', error)
    }
  } finally {
    await cleanup_tasks()
  }
}

interface StackNames {
  appsync: string
  layer: string
  all: string[]
  patterns: string[]
  regional: Map<string, { appsync: string; layer: string }>
}

function resolve_prefix_from_context(context: Record<string, string>): string {
  const app_name = context[CONTEXT_APP_NAME]
  const environment = context[CONTEXT_ENVIRONMENT]
  const app_id = context[CONTEXT_APP_ID]

  const missing: string[] = []
  if (!app_name) missing.push(CONTEXT_APP_NAME)
  if (!environment) missing.push(CONTEXT_ENVIRONMENT)

  if (missing.length > 0) {
    const example = JSON.stringify({
      context: {
        [CONTEXT_APP_NAME]: app_name || 'my-app',
        [CONTEXT_ENVIRONMENT]: environment || 'development',
        ...(app_id ? { [CONTEXT_APP_ID]: app_id } : {})
      }
    }, null, 2)

    throw new ConfigError(
      `Missing required context in cdk.json: ${missing.join(', ')}\n\n` +
      `Add the following to your cdk.json:\n\n${example}\n\n` +
      `"${CONTEXT_APP_ID}" is optional — use it to isolate personal dev stacks (e.g. "sidney").`
    )
  }

  return compute_prefix(app_name, environment, app_id)
}

function resolve_additional_regions(context: Record<string, unknown>): string[] {
  const regions = context['live_lambda_additional_regions']
  if (Array.isArray(regions)) return regions as string[]
  return []
}

async function is_environment_bootstrapped(region: string): Promise<boolean> {
  try {
    const cfn = new CloudFormationClient({ region })
    const result = await cfn.send(
      new DescribeStacksCommand({ StackName: 'CDKToolkit' })
    )
    const status = result.Stacks?.[0]?.StackStatus
    return !!status && !status.includes('DELETE')
  } catch {
    return false
  }
}

async function bootstrap_cdk_environment(cdk: Toolkit, assembly: ICloudAssemblySource) {
  const stacks = await cdk.list(assembly, {
    stacks: { strategy: StackSelectionStrategy.ALL_STACKS }
  })
  const unique_envs = [...new Set(
    stacks.map(s => `aws://${s.environment.account}/${s.environment.region}`)
  )]

  const regions = [...new Set(stacks.map(s => s.environment.region))]
  const checks = await Promise.all(regions.map(is_environment_bootstrapped))
  if (checks.every(Boolean)) {
    logger.info('CDK environment already bootstrapped, skipping.')
    return
  }

  logger.info('Bootstrapping CDK environment...')
  const environments = BootstrapEnvironments.fromList(unique_envs)
  await cdk.bootstrap(environments)
}

async function run_bootstrap(cdk: Toolkit, assembly: ICloudAssemblySource, stack_names: StackNames) {
  await bootstrap_cdk_environment(cdk, assembly)
  logger.info('Deploying live-lambda infrastructure stacks...')
  await deploy_internal_stacks(cdk, assembly, stack_names)
  logger.info('Bootstrap complete. AppSync and Layer stacks deployed.')
}

async function run_dev(
  cdk: Toolkit,
  assembly: ICloudAssemblySource,
  watch_config: unknown,
  stack_names: StackNames,
  display?: TerminalDisplay
): Promise<LayerArnByRegion> {
  await bootstrap_cdk_environment(cdk, assembly)

  const deployment = await deploy_all_stacks(cdk, assembly)

  const { configs, layer_arns } = extract_all_server_configs(deployment, stack_names)

  logger.info('Enabling LiveLambda on all functions...')
  await set_live_lambda_enabled(layer_arns, true)

  await serve({ configs, layer_arns, display })
  await watch_and_deploy(cdk, assembly, watch_config)

  return layer_arns
}

async function run_serve(
  display?: TerminalDisplay
): Promise<LayerArnByRegion> {
  let result = resolve_all_server_configs_from_outputs()

  if (result.configs.length === 0) {
    logger.info('No outputs.json found — fetching LiveLambda stack outputs from CloudFormation...')
    await fetch_outputs_from_cloudformation()
    result = resolve_all_server_configs_from_outputs()
  }

  // Synth to generate compiled handler assets on disk
  run_cdk_synth()

  const { configs, layer_arns } = result

  logger.info('Enabling LiveLambda on all functions...')
  await set_live_lambda_enabled(layer_arns, true)

  await serve({ configs, layer_arns, display })

  // Watch for source changes and re-synth
  watch_and_synth()

  // Keep the process alive until SIGINT/SIGTERM
  await new Promise<void>((resolve) => {
    process.once('SIGINT', resolve)
    process.once('SIGTERM', resolve)
  })

  return layer_arns
}

function get_cdk_app_entrypoint(): string | undefined {
  try {
    const cdk_json = JSON.parse(fs.readFileSync('cdk.json', 'utf-8'))
    return cdk_json.app as string | undefined
  } catch {
    return undefined
  }
}

function get_cdk_watch_config(): { exclude?: string[]; gitignore?: boolean } | undefined {
  try {
    const cdk_json = JSON.parse(fs.readFileSync('cdk.json', 'utf-8'))
    return cdk_json.watch as { exclude?: string[]; gitignore?: boolean } | undefined
  } catch {
    return undefined
  }
}

function run_cdk_synth(): void {
  const entrypoint = get_cdk_app_entrypoint()
  if (!entrypoint) {
    logger.warn('No cdk.json found — skipping synth. Handler assets may not be available.')
    return
  }

  logger.info('Running CDK synth to generate handler assets...')
  try {
    execSync(
      `npx cdk synth --all --quiet --output cdk.out/application --app '${entrypoint}'`,
      { stdio: 'inherit', env: { ...process.env, NPM_CONFIG_LOGLEVEL: 'error' } }
    )
    logger.info('CDK synth complete — handler assets ready.')
  } catch (error) {
    logger.error(`CDK synth failed: ${error}`)
    logger.warn('Handler assets may be missing. Local handler execution will fail for uncompiled functions.')
  }
}

function watch_and_synth(): void {
  const watch_config = get_cdk_watch_config()
  const wc = watch_config as { exclude?: string[]; gitignore?: boolean } | undefined
  let latch: 'open' | 'syncing' | 'queued' = 'open'

  const synth = () => {
    latch = 'syncing'
    try {
      run_cdk_synth()
    } catch {
      // Error already logged inside run_cdk_synth
    }
    while ((latch as string) === 'queued') {
      latch = 'syncing'
      logger.info('Changes detected during synth, re-synthesizing...')
      try {
        run_cdk_synth()
      } catch {
        // Error already logged
      }
    }
    latch = 'open'
  }

  const exclude_dirs = new Set(['node_modules', '.git', 'cdk.out', 'dist'])
  const exclude_extensions = new Set(wc?.exclude
    ?.filter((p: string) => p.startsWith('**/*.'))
    ?.map((p: string) => p.replace('**/*', '')) ?? [])

  for (const entry of wc?.exclude ?? []) {
    if (!entry.includes('*') && !entry.includes('/')) exclude_dirs.add(entry)
  }

  const use_gitignore = wc?.gitignore !== false
  const ig = ignore()
  if (use_gitignore) {
    try {
      ig.add(fs.readFileSync('.gitignore', 'utf-8'))
    } catch {
      // no .gitignore — fine
    }
  }

  const watcher = chokidar.watch('.', {
    followSymlinks: false,
    ignored: (file_path: string) => {
      if (file_path === '.') return false
      const parts = file_path.split(path.sep)
      if (parts.some(p => exclude_dirs.has(p) || (p.length > 1 && p.startsWith('.')))) return true
      const ext = path.extname(file_path)
      if (ext && exclude_extensions.has(ext)) return true
      if (use_gitignore && ig.ignores(file_path)) return true
      return false
    },
    ignoreInitial: true
  })

  watcher.on('error', (error: unknown) => {
    logger.debug(`File watcher error (non-fatal): ${error}`)
  })

  watcher.on('all', (event: string, file_path: string) => {
    if (latch === 'open') {
      logger.info(`Detected change to '${file_path}' (${event}). Re-synthesizing...`)
      synth()
    } else {
      latch = 'queued'
      logger.debug(`Detected change to '${file_path}' (${event}) while syncing. Queued.`)
    }
  })

  logger.info('Watching for file changes (will re-synth on change).')
}

async function fetch_outputs_from_cloudformation(): Promise<void> {
  const outputs: Record<string, Record<string, string>> = {}
  const common_regions = ['us-east-1', 'us-east-2', 'eu-west-1', 'eu-central-1', 'us-west-2', 'ca-central-1']
  const active_regions: string[] = []

  for (const region of common_regions) {
    try {
      const cfn = new CloudFormationClient({ region })
      const result = await cfn.send(new ListStacksCommand({
        StackStatusFilter: ['CREATE_COMPLETE', 'UPDATE_COMPLETE', 'UPDATE_ROLLBACK_COMPLETE'],
      }))

      const stacks_with_outputs = (result.StackSummaries ?? [])
        .filter(s => s.StackName && !s.StackName.includes('CDKToolkit'))

      if (stacks_with_outputs.length === 0) continue
      active_regions.push(region)

      logger.info(`[${region}] Fetching outputs from ${stacks_with_outputs.length} stacks...`)

      const batch_size = 10
      for (let i = 0; i < stacks_with_outputs.length; i += batch_size) {
        const batch = stacks_with_outputs.slice(i, i + batch_size)
        const results = await Promise.allSettled(
          batch.map(async (stack) => {
            const detail = await cfn.send(new DescribeStacksCommand({ StackName: stack.StackName }))
            const stack_outputs: Record<string, string> = {}
            for (const o of detail.Stacks?.[0]?.Outputs ?? []) {
              if (o.OutputKey && o.OutputValue) stack_outputs[o.OutputKey] = o.OutputValue
            }
            if (Object.keys(stack_outputs).length > 0) {
              outputs[stack.StackName!] = stack_outputs
            }
          })
        )

        for (const r of results) {
          if (r.status === 'rejected') {
            logger.debug(`  Failed to fetch stack outputs: ${r.reason}`)
          }
        }
      }
    } catch {
      // Region not accessible — skip
    }
  }

  if (Object.keys(outputs).length === 0) {
    throw new ServerConfigError(
      'No stacks found in any region. Deploy with "live-lambda dev" or "cdk deploy" first.'
    )
  }

  const outputs_path = path.join(process.cwd(), CDK_OUTPUTS_FILE)
  fs.mkdirSync(path.dirname(outputs_path), { recursive: true })
  fs.writeFileSync(outputs_path, JSON.stringify(outputs, null, 2))
  logger.info(`Wrote outputs from ${Object.keys(outputs).length} stacks across ${active_regions.length} region(s)`)
}

async function run_destroy(cdk: Toolkit, assembly: ICloudAssemblySource, stack_names: StackNames) {
  const internal = new Set<string>(stack_names.all)

  const all_stacks = await cdk.list(assembly, {
    stacks: { strategy: StackSelectionStrategy.ALL_STACKS }
  })

  const consumer_patterns = all_stacks
    .filter((s) => !internal.has(s.name))
    .map((s) => extract_hierarchical_id(s.id))

  if (consumer_patterns.length === 0) {
    logger.info('No consumer stacks to destroy.')
    return
  }

  logger.info(`Destroying consumer stacks: ${consumer_patterns.join(', ')}`)
  await cdk.destroy(assembly, {
    stacks: {
      strategy: StackSelectionStrategy.PATTERN_MATCH,
      patterns: consumer_patterns
    }
  })
}

function extract_hierarchical_id(display_name: string): string {
  const paren_index = display_name.indexOf(' (')
  return paren_index >= 0 ? display_name.slice(0, paren_index) : display_name
}

async function run_uninstall(
  cdk: Toolkit,
  assembly: ICloudAssemblySource,
  skip_cleanup: boolean,
  stack_names: StackNames
) {
  if (!skip_cleanup) {
    logger.info('Cleaning live-lambda configuration from Lambda functions...')

    const layer_arns = resolve_all_layer_arns(stack_names)
    if (layer_arns.size > 0) {
      for (const [region, layer_arn] of layer_arns) {
        await clean_lambda_functions(region, layer_arn)
      }
    } else {
      logger.warn(
        'Could not determine layer ARN from outputs.json. ' +
          'Skipping Lambda cleanup. Run "live-lambda dev" first to generate outputs.json, ' +
          'or use --skip-cleanup to skip this step.'
      )
    }
  }

  logger.info('Destroying live-lambda infrastructure stacks...')
  await destroy_internal_stacks(cdk, assembly, stack_names)
  logger.info('Uninstall complete.')
}

// --- Internal helpers ---

async function deploy_internal_stacks(cdk: Toolkit, assembly: ICloudAssemblySource, stack_names: StackNames) {
  return cdk.deploy(assembly, {
    stacks: {
      strategy: StackSelectionStrategy.PATTERN_MATCH,
      patterns: stack_names.patterns
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

async function destroy_internal_stacks(cdk: Toolkit, assembly: ICloudAssemblySource, stack_names: StackNames) {
  await cdk.destroy(assembly, {
    stacks: {
      strategy: StackSelectionStrategy.PATTERN_MATCH,
      patterns: stack_names.patterns
    }
  })
}

async function watch_and_deploy(
  cdk: Toolkit,
  assembly: ICloudAssemblySource,
  watch_config: unknown
) {
  let latch: 'open' | 'deploying' | 'queued' = 'open'
  const wc = watch_config as { exclude?: string[]; gitignore?: boolean } | undefined

  const deploy = async () => {
    latch = 'deploying'
    try {
      await deploy_all_stacks(cdk, assembly)
    } catch (error: unknown) {
      logger.error('Deploy failed:', error)
    }
    while ((latch as string) === 'queued') {
      latch = 'deploying'
      logger.info('Changes detected during deploy, redeploying...')
      try {
        await deploy_all_stacks(cdk, assembly)
      } catch (error: unknown) {
        logger.error('Deploy failed:', error)
      }
    }
    latch = 'open'
  }

  const exclude_dirs = new Set(['node_modules', '.git', 'cdk.out', 'dist'])
  const exclude_extensions = new Set(wc?.exclude
    ?.filter((p: string) => p.startsWith('**/*.'))
    ?.map((p: string) => p.replace('**/*', '')) ?? [])

  for (const entry of wc?.exclude ?? []) {
    if (!entry.includes('*') && !entry.includes('/')) exclude_dirs.add(entry)
  }

  const use_gitignore = wc?.gitignore !== false
  const ig = ignore()
  if (use_gitignore) {
    try {
      ig.add(fs.readFileSync('.gitignore', 'utf-8'))
    } catch {
      // no .gitignore — fine
    }
  }

  const watcher = chokidar.watch('.', {
    followSymlinks: false,
    ignored: (file_path: string) => {
      if (file_path === '.') return false
      const parts = file_path.split(path.sep)
      if (parts.some(p => exclude_dirs.has(p) || (p.length > 1 && p.startsWith('.')))) return true
      const ext = path.extname(file_path)
      if (ext && exclude_extensions.has(ext)) return true
      if (use_gitignore && ig.ignores(file_path)) return true
      return false
    },
    ignoreInitial: true
  })

  watcher.on('error', (error: unknown) => {
    logger.debug(`File watcher error (non-fatal): ${error}`)
  })

  watcher.on('all', async (event: string, file_path: string) => {
    if (latch === 'open') {
      logger.info(`Detected change to '${file_path}' (${event}). Deploying...`)
      await deploy()
    } else {
      latch = 'queued'
      logger.debug(`Detected change to '${file_path}' (${event}) while deploying. Queued.`)
    }
  })
}

function resolve_all_server_configs_from_outputs(): ExtractedServerConfigs {
  const outputs_path = path.join(process.cwd(), CDK_OUTPUTS_FILE)

  if (fs.existsSync(outputs_path)) {
    return parse_outputs_file(outputs_path)
  }

  return { configs: [], layer_arns: new Map() }
}

function parse_outputs_file(outputs_path: string): ExtractedServerConfigs {
  const outputs = JSON.parse(fs.readFileSync(outputs_path, 'utf-8'))
  const configs: RegionalServerConfig[] = []
  const layer_arns: LayerArnByRegion = new Map()

  for (const stack_name of Object.keys(outputs)) {
    if (!stack_name.includes(APPSYNC_STACK_NAME)) continue

    const stack_outputs = outputs[stack_name]
    const http = stack_outputs?.[OUTPUT_EVENT_API_HTTP_HOST]
    const realtime = stack_outputs?.[OUTPUT_EVENT_API_REALTIME_HOST]
    if (!http || !realtime) continue

    const layer_stack_name = stack_name.replace(APPSYNC_STACK_NAME, LAYER_STACK_NAME)
    const layer_arn = outputs[layer_stack_name]?.[OUTPUT_LIVE_LAMBDA_PROXY_LAYER_ARN]
    if (!layer_arn) continue

    const region = extract_region_from_arn(layer_arn)
    configs.push({ region, http, realtime })
    layer_arns.set(region, layer_arn)
  }

  if (configs.length > 0) {
    logger.info(`Resolved ${configs.length} region(s) from outputs: ${configs.map(c => c.region).join(', ')}`)
  }

  return { configs, layer_arns }
}

function resolve_all_layer_arns(stack_names: StackNames): LayerArnByRegion {
  const layer_arns: LayerArnByRegion = new Map()

  try {
    const outputs_path = path.join(process.cwd(), CDK_OUTPUTS_FILE)
    if (!fs.existsSync(outputs_path)) return layer_arns

    const outputs = JSON.parse(fs.readFileSync(outputs_path, 'utf-8'))

    // Scan all stacks in outputs for layer ARNs (handles both primary and regional)
    for (const stack_name of Object.keys(outputs)) {
      if (!stack_name.includes(LAYER_STACK_NAME)) continue

      const arn = outputs[stack_name]?.[OUTPUT_LIVE_LAMBDA_PROXY_LAYER_ARN]
      if (arn) {
        const region = extract_region_from_arn(arn)
        layer_arns.set(region, arn)
      }
    }
  } catch {
    logger.debug('Could not read layer ARNs from outputs.json')
  }

  return layer_arns
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

export class ServerConfigError extends ConfigError {
  constructor(message: string) {
    super(message)
    this.name = 'ServerConfigError'
  }
}

interface ExtractedServerConfigs {
  configs: RegionalServerConfig[]
  layer_arns: LayerArnByRegion
}

function extract_region_config(
  deployment: DeployResult,
  appsync_stack_name: string,
  layer_stack_name: string,
): { config: RegionalServerConfig; layer_arn: string } | undefined {
  const events = deployment.stacks.find(
    (stack) => stack.stackName === appsync_stack_name
  )
  const layer = deployment.stacks.find(
    (stack) => stack.stackName === layer_stack_name
  )

  if (!events || !layer) return undefined

  const region = events.environment?.region
  const http = events.outputs[OUTPUT_EVENT_API_HTTP_HOST]
  const realtime = events.outputs[OUTPUT_EVENT_API_REALTIME_HOST]
  const layer_arn = layer.outputs[OUTPUT_LIVE_LAMBDA_PROXY_LAYER_ARN]

  if (!region || !http || !realtime || !layer_arn) return undefined

  return {
    config: { region, http, realtime },
    layer_arn,
  }
}

function extract_all_server_configs(
  deployment: DeployResult,
  stack_names: StackNames
): ExtractedServerConfigs {
  const configs: RegionalServerConfig[] = []
  const layer_arns: LayerArnByRegion = new Map()

  // Primary region
  const primary = extract_region_config(
    deployment,
    stack_names.appsync,
    stack_names.layer,
  )

  if (!primary) {
    throw new ServerConfigError(
      `Missing required primary stacks (${stack_names.appsync}, ${stack_names.layer}). ` +
      `Ensure 'LiveLambda.install(app)' is called in your CDK app and all stacks deployed successfully.`
    )
  }

  configs.push(primary.config)
  layer_arns.set(primary.config.region, primary.layer_arn)

  // Discover additional regional stacks from deployment result.
  // Regional stacks follow the naming pattern: {prefix}-LiveLambda-AppSyncStack-{regionshort}
  const appsync_prefix = stack_names.appsync // e.g. "main-development-LiveLambda-AppSyncStack"
  const layer_prefix = stack_names.layer     // e.g. "main-development-LiveLambda-LayerStack"

  for (const stack of deployment.stacks) {
    if (stack.stackName.startsWith(appsync_prefix + '-') && stack.stackName !== appsync_prefix) {
      const region_suffix = stack.stackName.slice(appsync_prefix.length + 1)
      const matching_layer_name = `${layer_prefix}-${region_suffix}`
      const regional = extract_region_config(deployment, stack.stackName, matching_layer_name)

      if (regional && !layer_arns.has(regional.config.region)) {
        configs.push(regional.config)
        layer_arns.set(regional.config.region, regional.layer_arn)
        logger.info(`[${regional.config.region}] Additional region configured`)
      }
    }
  }

  // Also check explicitly configured regional stacks
  for (const [region, names] of stack_names.regional) {
    if (layer_arns.has(region)) continue
    const regional = extract_region_config(deployment, names.appsync, names.layer)
    if (regional) {
      configs.push(regional.config)
      layer_arns.set(region, regional.layer_arn)
      logger.info(`[${region}] Additional region configured`)
    }
  }

  logger.info(`Server will connect to ${configs.length} region(s): ${configs.map(c => c.region).join(', ')}`)

  return { configs, layer_arns }
}
