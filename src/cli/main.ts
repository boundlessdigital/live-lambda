import {
  ICloudAssemblySource,
  Toolkit,
  StackSelectionStrategy
} from '@aws-cdk/toolkit-lib'
import { serve } from '../server/index.js'
import { Command } from 'commander'
import * as fs from 'fs'
import chokidar from 'chokidar'
import { CustomIoHost } from '../cdk/toolkit/iohost.js'
import { logger } from '../lib/logger.js'
import {
  check_bootstrap_status,
  get_bootstrap_config,
  bootstrap,
  BootstrapConfig
} from './bootstrap.js'
import {
  format_app_name_for_ssm,
  format_app_name_for_stack
} from '../lib/constants.js'

const CDK_OUTPUTS_FILE = 'cdk.out/outputs.json'
const MAX_CONCURRENCY = 5

/**
 * Get app_name from command options or cdk.json context
 */
function get_app_name(options: { app?: string }): string {
  if (options.app) {
    return options.app
  }

  // Try to read from cdk.json context
  try {
    const cdk_json = JSON.parse(fs.readFileSync('cdk.json', 'utf-8'))
    const app_name = cdk_json.context?.['live-lambda:app-name']
    if (app_name) {
      return app_name
    }
  } catch {
    // Ignore - cdk.json may not exist or be readable
  }

  throw new Error(
    'App name is required. Provide --app <name> or set "live-lambda:app-name" in cdk.json context.'
  )
}

/**
 * Get formatted namespaces from app_name
 */
function get_namespaces(app_name: string): {
  ssm_namespace: string
  stack_namespace: string
} {
  const ssm_namespace = format_app_name_for_ssm(app_name)
  const stack_namespace = format_app_name_for_stack(app_name)

  if (!ssm_namespace) {
    throw new Error(
      `Invalid app name: "${app_name}". Must contain at least one alphanumeric character.`
    )
  }

  return { ssm_namespace, stack_namespace }
}

export async function main(command: Command) {
  const custom_io_host = new CustomIoHost()
  const cdk = new Toolkit({
    ioHost: custom_io_host
  })

  const cleanup_tasks = async () => {
    logger.info('Cleaning up UI and CDK resources...')
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
    const command_name = command.name()
    const options = command.opts()

    const { app: entrypoint, watch: watch_config } = JSON.parse(
      fs.readFileSync('cdk.json', 'utf-8')
    )

    const assembly = await cdk.fromCdkApp(entrypoint)

    if (command_name === 'start') {
      // Get app name and namespaces
      const app_name = get_app_name(options)
      const { ssm_namespace, stack_namespace } = get_namespaces(app_name)

      logger.info(`Starting LiveLambda for app "${app_name}"`)

      // Extract all unique regions from the assembly stacks
      const regions = await get_regions_from_assembly(assembly)
      logger.info(`Detected regions from stacks: ${regions.join(', ')}`)

      // Check and bootstrap each region as needed
      for (const region of regions) {
        const status = await check_bootstrap_status(region, ssm_namespace)

        if (!status.is_bootstrapped) {
          if (options.autoBootstrap) {
            logger.info(
              `LiveLambda not bootstrapped for "${app_name}" in ${region}. Running bootstrap...`
            )
            await bootstrap({ region, ssm_namespace, stack_namespace })
          } else {
            throw new Error(
              `LiveLambda not bootstrapped for "${app_name}" in ${region}. ` +
                `Run 'live-lambda bootstrap --app ${app_name} --region ${region}' first.`
            )
          }
        } else if (status.needs_upgrade) {
          logger.warn(
            `LiveLambda bootstrap version ${status.version} for "${app_name}" in ${region} is outdated. ` +
              `Consider running 'live-lambda bootstrap --app ${app_name} --region ${region} --force' to upgrade.`
          )
        }
      }

      // Get bootstrap configuration from the primary region for server connection
      const primary_region = get_primary_region(regions)
      const bootstrap_config = await get_bootstrap_config(primary_region, ssm_namespace)

      try {
        await run_server(cdk, assembly, watch_config, bootstrap_config)
      } catch (error) {
        logger.error(
          'Error during initial server run, attempting cleanup and restart:',
          error
        )
        await destroy_user_stacks(cdk, assembly)
        await run_server(cdk, assembly, watch_config, bootstrap_config)
      }
    }

    if (command_name === 'destroy') {
      logger.info('Destroying user development stacks...')
      await destroy_user_stacks(cdk, assembly)
    }
  } catch (error) {
    logger.error('An unexpected error occurred:', error)
  } finally {
    await cleanup_tasks()
  }
}

/**
 * Extract unique regions from stacks in the CDK assembly
 */
async function get_regions_from_assembly(
  assembly: ICloudAssemblySource
): Promise<string[]> {
  const readable = await assembly.produce()
  try {
    const stacks = readable.cloudAssembly.stacksRecursively
    const regions = new Set<string>()

    for (const stack of stacks) {
      const region = stack.environment.region
      // Skip stacks with unresolved region (e.g., from CDK_DEFAULT_REGION token)
      if (region && region !== 'unknown-region' && !region.includes('${')) {
        regions.add(region)
      }
    }

    // If no concrete regions found, fall back to env var or default
    if (regions.size === 0) {
      const fallback =
        process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1'
      logger.warn(
        `No concrete regions found in stacks. Using fallback: ${fallback}`
      )
      return [fallback]
    }

    return Array.from(regions)
  } finally {
    await readable.dispose()
  }
}

/**
 * Get the primary region for server connection
 * Uses env var if set, otherwise first region from assembly
 */
function get_primary_region(regions: string[]): string {
  // Prefer env var if set
  if (process.env.AWS_REGION) {
    return process.env.AWS_REGION
  }
  if (process.env.AWS_DEFAULT_REGION) {
    return process.env.AWS_DEFAULT_REGION
  }
  // Otherwise use first region from assembly
  return regions[0]
}

async function run_server(
  cdk: Toolkit,
  assembly: ICloudAssemblySource,
  watch_config: any,
  bootstrap_config: BootstrapConfig
): Promise<void> {
  // Deploy user stacks only
  await deploy_user_stacks(cdk, assembly)

  // Use bootstrap config from SSM for server configuration
  const server_config = {
    region: bootstrap_config.region,
    http: bootstrap_config.http_host,
    realtime: bootstrap_config.realtime_host,
    layer_arn: bootstrap_config.layer_arn
  }

  await serve(server_config)
  await watch_file_changes()
  await watch_stacks(cdk, assembly, watch_config)
}

async function watch_file_changes() {
  const watcher = chokidar.watch('.', {
    ignored: (path) => {
      return !path.endsWith('.ts') && !path.startsWith('cdk.out')
    }
  })
  watcher.on('change', async (path: string) => {
    logger.info(`File ${path} changes detected...`)
  })
}

async function deploy_user_stacks(
  cdk: Toolkit,
  assembly: ICloudAssemblySource
) {
  return cdk.deploy(assembly, {
    outputsFile: CDK_OUTPUTS_FILE,
    concurrency: MAX_CONCURRENCY,
    deploymentMethod: {
      method: 'change-set'
    }
  })
}

async function destroy_user_stacks(
  cdk: Toolkit,
  assembly: ICloudAssemblySource
) {
  // Only destroy user stacks, not bootstrap infrastructure
  // Bootstrap stacks are: LiveLambdaAppSyncStack, LiveLambdaLayerStack
  await cdk.destroy(assembly, {
    stacks: {
      strategy: StackSelectionStrategy.PATTERN_MATCH,
      // Match any stack that doesn't start with LiveLambda
      patterns: ['*']
    }
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
    ...watch_config
  })
}

export class ServerConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ServerConfigError'
  }
}
