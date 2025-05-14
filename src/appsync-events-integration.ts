import { Stack, Aspects, IAspect } from 'aws-cdk-lib'
import { aws_iam as iam, aws_lambda as lambda } from 'aws-cdk-lib'
import * as appsync from 'aws-cdk-lib/aws-appsync'

import { Construct, IConstruct } from 'constructs'
import { AppSyncExtensionLayer } from './go-extension-layer'

export interface AppSyncEventsIntegrationProps {}

export class AppSyncEventsIntegration extends Stack {
  readonly api: appsync.EventApi
  readonly api_policy: iam.Policy

  /** Invoke once on the CDK App or Stage */
  public static install(scope: Construct) {
    if (!scope.node.tryFindChild('AppSyncEventsRoot')) {
      new AppSyncEventsIntegration(scope, 'AppSyncEventsRoot')
    }
  }

  constructor(
    scope: Construct,
    id: string,
    props?: AppSyncEventsIntegrationProps
  ) {
    super(scope, id)

    // Hidden stack containing the global resources
    const infra = new Stack(scope, 'GlobalAppSyncEvents')

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
    const role = new iam.Role(infra, 'EventsAPIRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com')
    })

    role.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          'appsync:EventConnect',
          'appsync:EventPublish',
          'appsync:EventSubscribe'
        ],
        resources: [`${this.api.apiArn}/*`]
      })
    )

    // Attach aspect globally (covers every stack)
    Aspects.of(scope.node.root).add(new LambdaAspect(this.api))
  }
}

/** Aspect that wires every Lambda function */
class LambdaAspect implements IAspect {
  constructor(private readonly api: appsync.EventApi) {}

  visit(node: IConstruct) {
    if (!(node instanceof lambda.Function)) return

    // 1. Attach layer
    node.addLayers(AppSyncExtensionLayer.get_or_create(node))

    // 2. Publish + subscribe permissions
    node.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'appsync:EventConnect',
          'appsync:EventPublish',
          'appsync:EventSubscribe'
        ],
        resources: [`${this.api.httpDns}/*`]
      })
    )

    // 3. Useful environment variables
    node.addEnvironment('EVENTS_API_URL', `https://${this.api.httpDns}/event`)
    node.addEnvironment('EVENTS_API_REGION', Stack.of(node).region)
  }
}
