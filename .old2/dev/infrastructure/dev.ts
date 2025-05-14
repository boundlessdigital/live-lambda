#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib'
import * as path from 'path'
import { LambdaManifestGeneratorAspect } from './aspects/lambda-manifest-generator-aspect'
import { AppSyncStack } from './stacks/appsync.stack'
import { LambdaStubStack } from './stacks/lambda.stack'
import { AutoLiveLambdaLayerAspect } from './aspects/live-lambda-aspect'

const app = new cdk.App()

const env = {
  account: '942189704687',
  region: 'us-west-1'
}

const manifestOutputPath = path.resolve(__dirname, '../dist/lambda-manifest.json')
const manifestGenerator = new LambdaManifestGeneratorAspect(manifestOutputPath)
cdk.Aspects.of(app).add(manifestGenerator)

const event_api_stack = new AppSyncStack(app, 'AppSyncStack', { env })

const autoLiveLambdaLayerAspect = new AutoLiveLambdaLayerAspect({
  liveLambdaForwarderLayer: event_api_stack.liveLambdaForwarderLayer,
  appSyncApiId: event_api_stack.api.apiId,
  appSyncChannelNamespace: event_api_stack.appSyncChannelNamespace,
})

const lambdaStubStack = new LambdaStubStack(app, 'LambdaStubStack', {
  env,
  live_lambda_enabled: true,
  api: event_api_stack.api
})

cdk.Aspects.of(lambdaStubStack).add(autoLiveLambdaLayerAspect)

app.node.addValidation({
  validate: () => {
    manifestGenerator.writeManifest()
    return [] 
  }
})
