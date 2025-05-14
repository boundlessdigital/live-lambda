import * as cdk from 'aws-cdk-lib';
import * as appsync from 'aws-cdk-lib/aws-appsync';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as path from 'path';
import * as iam from 'aws-cdk-lib/aws-iam';

export class LiveLambdaResourcesStack extends cdk.Stack {
  public readonly liveLambdaForwarderLayer: lambda.ILayerVersion;
  public readonly appSyncApi: appsync.IGraphqlApi;
  public readonly appSyncApiId: string;
  public readonly appSyncChannelNamespace = 'liveLambdaEvents'; // Default namespace

  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // 1. Define the AppSync Event API for Live Lambda
    const eventApi = new appsync.GraphqlApi(this, 'LiveLambdaEventApi', {
      name: 'live-lambda-event-api',
      schema: new appsync.SchemaFile({ filePath: path.join(__dirname, 'schema.graphql') }), // Placeholder schema
      authorizationConfig: {
        defaultAuthorization: {
          authorizationType: appsync.AuthorizationType.IAM,
        },
      },
      // For event-driven APIs, you might not need X-Ray, or can enable it as needed.
      xrayEnabled: false, 
    });

    this.appSyncApi = eventApi;
    this.appSyncApiId = eventApi.apiId;

    // Create a dummy resolver or mutation if needed for the schema.graphql to be valid for event publishing.
    // For an event-only API, you might have a very simple schema like:
    // type Mutation {
    //   publishEvent(channel: String!, data: AWSJSON!): AWSJSON
    // }
    // type Query { getStatus: String }
    // type Subscription { onEvent(channel: String!): AWSJSON @aws_subscribe(mutations: ["publishEvent"]) }
    // Ensure schema.graphql exists with at least a minimal structure.
    const noneDataSource = eventApi.addNoneDataSource('NoneDS');
    noneDataSource.createResolver('PublishEventResolver', {
        typeName: 'Mutation',
        fieldName: 'publishEvent',
        requestMappingTemplate: appsync.MappingTemplate.fromString(JSON.stringify({ "version": "2017-02-28", "payload": "$util.toJson($context.arguments)" })),
        responseMappingTemplate: appsync.MappingTemplate.fromString("$util.toJson($context.result)"),
    });

    // 2. Define the Lambda Layer for the wrapper
    // Ensure the path points to the directory containing the 'nodejs' folder for the layer structure
    this.liveLambdaForwarderLayer = new lambda.LayerVersion(this, 'LiveLambdaForwarderLayer', {
      code: lambda.Code.fromAsset(path.join(__dirname, 'lambda/live-lambda-layer-content')), 
      compatibleRuntimes: [lambda.Runtime.NODEJS_18_X, lambda.Runtime.NODEJS_20_X], // Adjust as needed
      description: 'Layer to conditionally forward Lambda invocations to AppSync for live development.',
      layerVersionName: 'live-lambda-forwarder',
    });

    // Outputs for easy reference (optional)
    new cdk.CfnOutput(this, 'AppSyncApiIdOutput', {
      value: eventApi.apiId,
      description: 'Live Lambda Event API ID',
    });
    new cdk.CfnOutput(this, 'AppSyncApiUrlOutput', {
      value: eventApi.graphqlUrl,
      description: 'Live Lambda Event API URL',
    });
    new cdk.CfnOutput(this, 'AppSyncRealtimeUrlOutput', {
        value: eventApi.realtimeGraphQlUrl,
        description: 'Live Lambda Event API Realtime URL (WebSocket)',
    });
    new cdk.CfnOutput(this, 'LiveLambdaForwarderLayerArn', {
      value: this.liveLambdaForwarderLayer.layerVersionArn,
      description: 'ARN of the Live Lambda Forwarder Layer',
    });
  }
}
