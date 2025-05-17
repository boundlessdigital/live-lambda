import { serve } from '../server/server.js'
import { DeployResult, Toolkit } from '@aws-cdk/toolkit-lib'
import * as fs from 'fs'

async function main() {
  const cdk = new Toolkit()

  const { app: entrypoint, watch: watch_config } = JSON.parse(
    fs.readFileSync('cdk.json', 'utf-8')
  )

  const assembly = await cdk.fromCdkApp(entrypoint)

  const deployment = await cdk.deploy(assembly, {
    deploymentMethod: {
      method: 'direct'
    }
  })

  const config = extract_server_config(deployment)
  await serve(config)

  const watcher = await cdk.watch(assembly, {
    deploymentMethod: {
      method: 'direct'
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

  // NASTY REGION HACK
  const stack_artifact = deployment.stacks[0]
  const region = stack_artifact.environment?.region

  return {
    region,
    http: events?.outputs['LiveLambdaEventApiHttpHost'] as string,
    realtime: events?.outputs['LiveLambdaEventApiRealtimeHost'] as string,
    layer_arn: layer?.outputs['LiveLambdaProxyLayerArn'] as string
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
