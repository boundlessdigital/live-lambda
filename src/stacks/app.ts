#!/usr/bin/env node
import 'colors'
import * as cdk from 'aws-cdk-lib'
import { AppSyncStack } from './appsync.stack'
import { LiveLambdaLayerStack } from './layer.stack'
import { Toolkit } from '@aws-cdk/toolkit-lib'
import * as core from 'aws-cdk-lib/core'

export async function deploy_live_lambda_stacks(env: cdk.Environment) {
  console.log(`Starting deployment of Live Lambda infrastructure`.cyan)
  const cdk = new Toolkit()

  const cloud_assembly_source = await cdk.fromAssemblyBuilder(async () => {
    const app = new core.App()

    new AppSyncStack(app, 'AppSyncStack', { env })

    new LiveLambdaLayerStack(app, 'LiveLambda-LayerStack', {
      env
      // api: event_api_stack.api
    })

    return app.synth()
  })

  const result = await cdk.deploy(cloud_assembly_source, {
    deploymentMethod: { method: 'direct' }
  })

  const events = result.stacks.find(
    (stack) => stack.stackName === 'AppSyncStack'
  )
  const server_parameters = {
    region: env.region as string,
    http: events?.outputs['LiveLambdaEventApiHttpHost'] as string,
    realtime: events?.outputs['LiveLambdaEventApiRealtimeHost'] as string
  }
  return { result, server_parameters }
}
