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

const CDK_OUTPUTS_FILE = 'cdk.out/outputs.json'
export async function main(command: Command) {
  const cdk = new Toolkit({
    ioHost: new CustomIoHost()
  })

  const command_name = command.name()

  const { app: entrypoint, watch: watch_config } = JSON.parse(
    fs.readFileSync('cdk.json', 'utf-8')
  )

  const assembly = await cdk.fromCdkApp(entrypoint)

  if (command_name === 'start') {
    try {
      await run_server(cdk, assembly, watch_config)
    } catch (error) {
      await destroy_stacks(cdk, assembly)
      await run_server(cdk, assembly, watch_config)
    }
  }

  if (command_name === 'destroy') {
    console.log('Destroying development stacks...'.yellow)
    await destroy_stacks(cdk, assembly)
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
    console.log(`File ${path} changes detected, redeploying...`.yellow)
    // await deploy_stacks(cdk, assembly)
  })
}
async function deploy_stacks(cdk: Toolkit, assembly: ICloudAssemblySource) {
  return cdk.deploy(assembly, {
    outputsFile: CDK_OUTPUTS_FILE,
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
  await cdk.watch(assembly, {
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
