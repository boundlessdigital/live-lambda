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
import { load_cdk_app_config } from './load_config.js'

const CDK_OUTPUTS_FILE = 'cdk.out/outputs.json'
const MAX_CONCURRENCY = 5

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

    // Load CDK app to get LiveLambda configuration from LiveLambda.configure()
    const config = await load_cdk_app_config(entrypoint)
    const { app_name, stage, formatted_app_name, formatted_stage, resolved_ssm_prefix } = config

    // Get assembly for deployment/destruction
    const assembly = await cdk.fromCdkApp(entrypoint)

    if (command_name === 'start') {
      logger.info(`Starting LiveLambda for "${formatted_app_name}-${formatted_stage}"`)

      // Extract all unique regions from the assembly stacks
      const regions = await get_regions_from_assembly(assembly)
      logger.info(`Detected regions from stacks: ${regions.join(', ')}`)

      // Check and bootstrap each region as needed
      for (const region of regions) {
        const status = await check_bootstrap_status(region, resolved_ssm_prefix)

        if (!status.is_bootstrapped) {
          if (options.autoBootstrap) {
            logger.info(
              `LiveLambda not bootstrapped for "${formatted_app_name}-${formatted_stage}" in ${region}. Running bootstrap...`
            )
            await bootstrap({ region, app_name, stage, ssm_prefix: resolved_ssm_prefix })
          } else {
            throw new Error(
              `LiveLambda not bootstrapped for "${formatted_app_name}-${formatted_stage}" in ${region}. ` +
                `Run 'live-lambda bootstrap --app ${app_name} --stage ${stage} --region ${region}' first.`
            )
          }
        } else if (status.needs_upgrade) {
          logger.warn(
            `LiveLambda bootstrap version ${status.version} for "${formatted_app_name}-${formatted_stage}" in ${region} is outdated. ` +
              `Consider running 'live-lambda bootstrap --app ${app_name} --stage ${stage} --region ${region} --force' to upgrade.`
          )
        }
      }

      // Get bootstrap configuration from the primary region for server connection
      const primary_region = get_primary_region(regions)
      const bootstrap_config = await get_bootstrap_config(primary_region, resolved_ssm_prefix)

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
      logger.info(`Destroying user development stacks for "${formatted_app_name}-${formatted_stage}"...`)
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
