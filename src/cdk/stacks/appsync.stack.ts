import * as cdk from 'aws-cdk-lib'
import { Construct } from 'constructs'
import * as appsync from 'aws-cdk-lib/aws-appsync'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as ssm from 'aws-cdk-lib/aws-ssm'
import { APPSYNC_EVENTS_API_NAMESPACE } from '../../constants.js'

export interface AppSyncSsmPaths {
  readonly api_arn: string
  readonly http_dns: string
  readonly realtime_dns: string
}

export interface AppSyncStackProps extends cdk.StackProps {
  /** Deployment prefix used for naming AppSync resources (keeps names short and unique). */
  readonly prefix: string
  /** SSM parameter paths for storing AppSync values (avoids cross-stack exports). */
  readonly ssm_paths: AppSyncSsmPaths
}

export class AppSyncStack extends cdk.Stack {
  readonly api: appsync.EventApi
  readonly api_policy: iam.Policy
  readonly ssm_paths: AppSyncSsmPaths

  constructor(scope: Construct, id: string, props: AppSyncStackProps) {
    super(scope, id, props)

    this.ssm_paths = props.ssm_paths

    this.api = new appsync.EventApi(this, 'LiveLambdaEventApi', {
      apiName: `ll-events-${props!.prefix}`.slice(0, 50),
      authorizationConfig: {
        authProviders: [
          { authorizationType: appsync.AppSyncAuthorizationType.IAM }
        ]
      }
    })

    this.api.addChannelNamespace(APPSYNC_EVENTS_API_NAMESPACE)

    this.api_policy = new iam.Policy(this, 'LiveLambdaEventApiPolicy', {
      policyName: `ll-events-${props!.prefix}`,
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

    new ssm.StringParameter(this, 'LiveLambdaApiArnParameter', {
      parameterName: this.ssm_paths.api_arn,
      stringValue: this.api.apiArn,
      description: 'ARN of the AppSync Event API for live-lambda'
    })

    new ssm.StringParameter(this, 'LiveLambdaHttpDnsParameter', {
      parameterName: this.ssm_paths.http_dns,
      stringValue: this.api.httpDns,
      description: 'HTTP DNS of the AppSync Event API for live-lambda'
    })

    new ssm.StringParameter(this, 'LiveLambdaRealtimeDnsParameter', {
      parameterName: this.ssm_paths.realtime_dns,
      stringValue: this.api.realtimeDns,
      description: 'Realtime DNS of the AppSync Event API for live-lambda'
    })
  }
}
