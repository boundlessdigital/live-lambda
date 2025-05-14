import * as cdk from 'aws-cdk-lib'
import { Construct } from 'constructs'
import * as sqs from 'aws-cdk-lib/aws-sqs'

export interface QueueStackProps extends cdk.StackProps {}

export class QueueStack extends cdk.Stack {
  readonly queue: sqs.Queue

  constructor(scope: Construct, id: string, props?: QueueStackProps) {
    super(scope, id, props)

    this.queue = new sqs.Queue(this, 'Queue', {
      queueName: 'live-lambda-queue'
    })

    new cdk.CfnOutput(this, 'QueueUrl', {
      value: this.queue.queueUrl
    })
  }
}
