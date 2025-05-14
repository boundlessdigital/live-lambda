import * as cdk from 'aws-cdk-lib'
import { Construct } from 'constructs'
import * as appsync from 'aws-cdk-lib/aws-appsync'
import * as iam from 'aws-cdk-lib/aws-iam'

export interface AppSyncStackProps extends cdk.StackProps {
  readonly live_lambda_enabled?: boolean
}

export class AppSyncStack extends cdk.Stack {
  readonly api: appsync.EventApi
  readonly api_policy: iam.Policy

  constructor(scope: Construct, id: string, props?: AppSyncStackProps) {
    super(scope, id, props)

    this.api = new appsync.EventApi(this, 'LiveLambdaEventApi', {
      apiName: `live-lambda-events-${this.stackName}`,
      authorizationConfig: {
        authProviders: [
          { authorizationType: appsync.AppSyncAuthorizationType.IAM }
        ]
      }
    })

    this.api.addChannelNamespace('live-lambda')

    this.api_policy = new iam.Policy(this, 'LiveLambdaEventApiPolicy', {
      policyName: `live-lambda-events-${this.stackName}`,
      statements: [
        new iam.PolicyStatement({
          actions: [
            'appsync:EventConnect',
            'appsync:EventPublish',
            'appsync:EventSubscribe'
          ],
          resources: [`${this.api.apiArn}/*`]
        })
      ]
    })

    //docs.aws.amazon.com/appsync/latest/eventapi/configure-event-api-auth.html

    new cdk.CfnOutput(this, 'LiveLambdaEventApiId', {
      value: this.api.apiId,
      description: 'The ID of the AppSync Event API for Live Lambda.'
    })

    new cdk.CfnOutput(this, 'LiveLambdaEventApiHttpHost', {
      value: this.api.httpDns,
      description: 'The HTTP host of the AppSync Event API for Live Lambda.'
    })

    new cdk.CfnOutput(this, 'LiveLambdaEventApiRealtimeHost', {
      value: this.api.realtimeDns,
      description:
        'The WebSocket host of the AppSync Event API for Live Lambda.'
    })

    new cdk.CfnOutput(this, 'LiveLambdaEventApiHttpEndpoint', {
      value: `https://${this.api.httpDns}/event`,
      description: 'The HTTP endpoint of the AppSync Event API for Live Lambda.'
    })

    new cdk.CfnOutput(this, 'LiveLambdaEventApiWebSocketEndpoint', {
      value: `wss://${this.api.realtimeDns}/event/realtime`,
      description:
        'The WebSocket endpoint of the AppSync Event API for Live Lambda.'
    })
  }
}
