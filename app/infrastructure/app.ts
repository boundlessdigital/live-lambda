#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib'

import { WebLambdaStack } from './stacks/web.lambda.stack'
import { ListenerLambdaStack } from './stacks/listener.lambda.stack'
import { QueueStack } from './stacks/queue.stack'

const app = new cdk.App()

const env = {
  account: '942189704687',
  region: 'us-west-1'
}

const queue_stack = new QueueStack(app, 'QueueStack', { env })

new ListenerLambdaStack(app, 'ListenerLambda', {
  env,
  queue: queue_stack.queue
})

new WebLambdaStack(app, 'WebLambda', {
  env,
  queue: queue_stack.queue
})
