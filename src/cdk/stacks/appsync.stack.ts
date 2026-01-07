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
  readonly ssm_namespace: string
  readonly live_lambda_enabled?: boolean
}

export class AppSyncStack extends cdk.Stack {
  readonly api: appsync.EventApi
  readonly api_policy: iam.Policy

  constructor(scope: Construct, id: string, props: AppSyncStackProps) {
    super(scope, id, props)

    const { ssm_namespace } = props

    this.api = new appsync.EventApi(this, 'LiveLambdaEventApi', {
      apiName: `live-lambda-events-${ssm_namespace}`,
      authorizationConfig: {
        authProviders: [
          { authorizationType: appsync.AppSyncAuthorizationType.IAM }
        ]
      }
    })

    this.api.addChannelNamespace(APPSYNC_EVENTS_API_NAMESPACE)

    this.api_policy = new iam.Policy(this, 'LiveLambdaEventApiPolicy', {
      policyName: `live-lambda-events-policy-${ssm_namespace}`,
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
      parameterName: get_ssm_param_appsync_api_arn(ssm_namespace),
      stringValue: this.api.apiArn,
      description: `ARN of the Live Lambda AppSync Event API for ${ssm_namespace}`
    })

    new ssm.StringParameter(this, 'HttpHostParam', {
      parameterName: get_ssm_param_appsync_http_host(ssm_namespace),
      stringValue: this.api.httpDns,
      description: `HTTP host of the Live Lambda AppSync Event API for ${ssm_namespace}`
    })

    new ssm.StringParameter(this, 'RealtimeHostParam', {
      parameterName: get_ssm_param_appsync_realtime_host(ssm_namespace),
      stringValue: this.api.realtimeDns,
      description: `WebSocket host of the Live Lambda AppSync Event API for ${ssm_namespace}`
    })

    new ssm.StringParameter(this, 'RegionParam', {
      parameterName: get_ssm_param_appsync_region(ssm_namespace),
      stringValue: this.region,
      description: `Region of the Live Lambda AppSync Event API for ${ssm_namespace}`
    })

    new ssm.StringParameter(this, 'BootstrapVersionParam', {
      parameterName: get_ssm_param_bootstrap_version(ssm_namespace),
      stringValue: BOOTSTRAP_VERSION,
      description: `Bootstrap version of Live Lambda infrastructure for ${ssm_namespace}`
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
