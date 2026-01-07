import * as cdk from 'aws-cdk-lib'
import { Construct } from 'constructs'
import * as appsync from 'aws-cdk-lib/aws-appsync'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as ssm from 'aws-cdk-lib/aws-ssm'
import { APPSYNC_EVENTS_API_NAMESPACE } from '../../constants.js'
import {
  get_ssm_param_appsync_api_arn,
  get_ssm_param_appsync_http_host,
  get_ssm_param_appsync_realtime_host,
  get_ssm_param_appsync_region,
  get_ssm_param_bootstrap_version,
  BOOTSTRAP_VERSION
} from '../../lib/constants.js'

export interface AppSyncStackProps extends cdk.StackProps {
  readonly ssm_prefix: string
  readonly live_lambda_enabled?: boolean
}

export class AppSyncStack extends cdk.Stack {
  readonly api: appsync.EventApi
  readonly api_policy: iam.Policy

  constructor(scope: Construct, id: string, props: AppSyncStackProps) {
    super(scope, id, props)

    const { ssm_prefix } = props

    // Extract a short identifier from the ssm_prefix for naming
    // /live-lambda/my-app/dev -> my-app-dev
    const prefix_id = ssm_prefix.replace(/^\/live-lambda\//, '').replace(/\//g, '-').replace(/-$/, '')

    this.api = new appsync.EventApi(this, 'LiveLambdaEventApi', {
      apiName: `live-lambda-events-${prefix_id}`,
      authorizationConfig: {
        authProviders: [
          { authorizationType: appsync.AppSyncAuthorizationType.IAM }
        ]
      }
    })

    this.api.addChannelNamespace(APPSYNC_EVENTS_API_NAMESPACE)

    this.api_policy = new iam.Policy(this, 'LiveLambdaEventApiPolicy', {
      policyName: `live-lambda-events-policy-${prefix_id}`,
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

    // Store configuration in SSM for discovery by aspect and CLI
    new ssm.StringParameter(this, 'ApiArnParam', {
      parameterName: get_ssm_param_appsync_api_arn(ssm_prefix),
      stringValue: this.api.apiArn,
      description: `ARN of the Live Lambda AppSync Event API for ${prefix_id}`
    })

    new ssm.StringParameter(this, 'HttpHostParam', {
      parameterName: get_ssm_param_appsync_http_host(ssm_prefix),
      stringValue: this.api.httpDns,
      description: `HTTP host of the Live Lambda AppSync Event API for ${prefix_id}`
    })

    new ssm.StringParameter(this, 'RealtimeHostParam', {
      parameterName: get_ssm_param_appsync_realtime_host(ssm_prefix),
      stringValue: this.api.realtimeDns,
      description: `WebSocket host of the Live Lambda AppSync Event API for ${prefix_id}`
    })

    new ssm.StringParameter(this, 'RegionParam', {
      parameterName: get_ssm_param_appsync_region(ssm_prefix),
      stringValue: this.region,
      description: `Region of the Live Lambda AppSync Event API for ${prefix_id}`
    })

    new ssm.StringParameter(this, 'BootstrapVersionParam', {
      parameterName: get_ssm_param_bootstrap_version(ssm_prefix),
      stringValue: BOOTSTRAP_VERSION,
      description: `Bootstrap version of Live Lambda infrastructure for ${prefix_id}`
    })

    // CloudFormation outputs for visibility
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
