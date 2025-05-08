#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib'
import { AppSyncStack } from './stacks/appsync.stack'
import { LambdaStubStack } from './stacks/lambda.stack'

const app = new cdk.App()

const env = {
  account: '942189704687',
  region: 'us-west-1'
}

const event_api_stack = new AppSyncStack(app, 'AppSyncStack', { env })

new LambdaStubStack(app, 'LambdaStubStack', {
  env,
  live_lambda_enabled: true,
  api: event_api_stack.api
})
