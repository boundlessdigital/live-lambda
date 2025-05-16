import { serve } from '../server/server.js'
import { Toolkit } from '@aws-cdk/toolkit-lib'
import * as path from 'node:path'

async function main() {
  const cdk = new Toolkit()

  const assembly = await cdk.fromCdkApp('tsx app.ts')

  const deployment = await cdk.deploy(assembly, {
    deploymentMethod: {
      method: 'direct'
    }
  })

  const events = deployment.stacks.find(
    (stack) => stack.stackName === 'AppSyncStack'
  )

  const layer = deployment.stacks.find(
    (stack) => stack.stackName === 'LiveLambda-LayerStack'
  )

  // NASTY REGION HACK
  const stack_artifact = deployment.stacks[0]
  const region = stack_artifact.environment?.region

  const server_parameters = {
    region,
    http: events?.outputs['LiveLambdaEventApiHttpHost'] as string,
    realtime: events?.outputs['LiveLambdaEventApiRealtimeHost'] as string,
    layer_arn: layer?.outputs['LiveLambdaProxyLayerArn'] as string
  }

  await serve(server_parameters)

  const watched_deploy = await cdk.watch(assembly, {
    deploymentMethod: {
      method: 'direct'
    },
    include: ['**/*'],
    exclude: ['**/node_modules/**']
  })
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
