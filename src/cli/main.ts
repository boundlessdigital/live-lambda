import {
  DeployResult,
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
    // Potentially add other cleanup tasks here if needed
    // For example, ensuring any child processes are terminated
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

    const { app: entrypoint, watch: watch_config } = JSON.parse(
      fs.readFileSync('cdk.json', 'utf-8')
    )

    const assembly = await cdk.fromCdkApp(entrypoint)

    if (command_name === 'start') {
      try {
        await run_server(cdk, assembly, watch_config)
      } catch (error) {
        // Attempt to destroy stacks on error during start, then re-run server
        // This might be specific to your workflow, adjust as needed
        logger.error(
          'Error during initial server run, attempting cleanup and restart:',
          error
        )
        await destroy_stacks(cdk, assembly)
        await run_server(cdk, assembly, watch_config)
      }
    }

    if (command_name === 'destroy') {
      logger.info('Destroying development stacks...')
      await destroy_stacks(cdk, assembly)
    }
  } catch (error) {
    logger.error('An unexpected error occurred:', error)
    // Ensure cleanup is called even for unhandled top-level errors
  } finally {
    await cleanup_tasks()
  }
}

async function run_server(
  cdk: Toolkit,
  assembly: ICloudAssemblySource,
  watch_config: any
): Promise<void> {
  const deployment = await deploy_stacks(cdk, assembly)

  const config = extract_server_config(deployment)
  await serve(config)
  await watch_file_changes(cdk, assembly)
  await watch_stacks(cdk, assembly, watch_config)

  // watcher.on('change', async (path: string) => {
  //   logger.info(`File ${path} changes detected, redeploying...`)
  //   // await deploy_stacks(cdk, assembly)
  // })
}

async function watch_file_changes(
  cdk: Toolkit,
  assembly: ICloudAssemblySource
) {
  const watcher = chokidar.watch('.', {
    ignored: (path, stats) => {
      return !path.endsWith('.ts') && !path.startsWith('cdk.out')
    }
  })
  watcher.on('change', async (path: string) => {
    logger.info(`File ${path} changes detected, redeploying...`)
    // await deploy_stacks(cdk, assembly)
  })
}
async function deploy_stacks(cdk: Toolkit, assembly: ICloudAssemblySource) {
  return cdk.deploy(assembly, {
    outputsFile: CDK_OUTPUTS_FILE,
    concurrency: MAX_CONCURRENCY,
    deploymentMethod: {
      method: 'change-set'
    }
  })
}

async function destroy_stacks(cdk: Toolkit, assembly: ICloudAssemblySource) {
  await cdk.destroy(assembly, {
    stacks: {
      strategy: StackSelectionStrategy.PATTERN_MATCH,
      patterns: ['*Lambda', '*Layer*']
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

function extract_server_config(deployment: DeployResult) {
  const events = deployment.stacks.find(
    (stack) => stack.stackName === 'AppSyncStack'
  )

  const layer = deployment.stacks.find(
    (stack) => stack.stackName === 'LiveLambda-LayerStack'
  )

  const region = events?.environment?.region as string

  return {
    region,
    http: events?.outputs['LiveLambdaEventApiHttpHost'] as string,
    realtime: events?.outputs['LiveLambdaEventApiRealtimeHost'] as string,
    layer_arn: layer?.outputs['LiveLambdaProxyLayerArn'] as string
  }
}
