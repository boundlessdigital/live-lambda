import * as cdk from 'aws-cdk-lib';
import { IAspect } from 'aws-cdk-lib';
import { Construct, IConstruct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as path from 'path';
import * as iam from 'aws-cdk-lib/aws-iam';

// Helper to find FunctionUrl associated with a Lambda
function findAssociatedFunctionUrl(scope: Construct, targetFunction: lambda.IFunction): lambda.FunctionUrl | undefined {
  // Search within the same scope (e.g., Stack) as the targetFunction
  // to ensure we are looking for FunctionUrls related to it.
  const searchScope = targetFunction.stack; 
  for (const child of searchScope.node.findAll()) {
    if (child instanceof lambda.FunctionUrl && child.function === targetFunction) {
      return child;
    }
  }
  return undefined;
}

export class LiveLambdaSwapperAspect implements IAspect {
  private readonly liveLambdaEnabled: boolean;
  private readonly appSyncApiUrl: string; 
  private readonly appSyncRegion: string;
  private readonly appSyncApiId?: string; // Optional: pass if known for more robust permissioning

  constructor(
    liveLambdaEnabled: boolean,
    appSyncApiUrl: string,
    appSyncRegion: string,
    appSyncApiId?: string 
  ) {
    this.liveLambdaEnabled = liveLambdaEnabled;
    this.appSyncApiUrl = appSyncApiUrl;
    this.appSyncRegion = appSyncRegion;
    this.appSyncApiId = appSyncApiId;
  }

  public visit(node: IConstruct): void {
    if (!this.liveLambdaEnabled) {
      return; 
    }

    // If liveLambdaEnabled, this Aspect will attempt to swap any lambda.Function it encounters
    // that is explicitly tagged for live lambda swapping.
    // NOTE: The current stub handler (stub.handler.ts) is designed primarily for HTTP-like events
    // (e.g., from Function URLs or API Gateway). If this Aspect processes Lambdas with other
    // trigger types (SQS, SNS, etc.), the stub may not function correctly without modification
    // to handle those specific event structures.
    if (node instanceof lambda.Function && cdk.Tags.of(node).tagValues()['live-lambda-target'] === 'true') { 
      const originalFunction = node as NodejsFunction; 
      const stack = cdk.Stack.of(originalFunction);

      console.log(`LiveLambdaSwapperAspect: Found tagged Lambda: ${originalFunction.node.id}`);

      const stubId = `${originalFunction.node.id}Stub`;
      let stubLambda = stack.node.tryFindChild(stubId) as NodejsFunction | undefined;

      if (!stubLambda) {
        stubLambda = new NodejsFunction(stack, stubId, {
          entry: path.join(__dirname, './lambda/stub.handler.ts'), // Adjusted path relative to infrastructure dir
          handler: 'handler',
          runtime: originalFunction.runtime,
          architecture: originalFunction.architecture,
          memorySize: 256,
          timeout: cdk.Duration.seconds(30),
          environment: {
            ...(originalFunction.environment || {}),
            APPSYNC_EVENT_API_URL: this.appSyncApiUrl,
            APPSYNC_REGION: this.appSyncRegion,
            APPSYNC_REQUEST_CHANNEL: `live-requests/${originalFunction.node.id}`,
            IS_STUB_LAMBDA: 'true',
          },
        });

        // Grant AppSync publish permissions
        const targetApiId = this.appSyncApiId || this.appSyncApiUrl.split('/')[this.appSyncApiUrl.split('/').length - 2];
        if (targetApiId && !targetApiId.startsWith('https:')) { 
            stubLambda.addToRolePolicy(new iam.PolicyStatement({
                actions: ['appsync:GraphQL'], 
                resources: [
                    `arn:aws:appsync:${this.appSyncRegion}:${stack.account}:apis/${targetApiId}/*`,
                ],
            }));
        } else {
            console.warn(`LiveLambdaSwapperAspect: Could not determine AppSync API ID for ${originalFunction.node.id} to set IAM permissions for stub. URL: ${this.appSyncApiUrl}`);
        }
        console.log(`LiveLambdaSwapperAspect: Created Stub Lambda: ${stubLambda.node.id}`);
      } else {
        console.log(`LiveLambdaSwapperAspect: Stub Lambda ${stubId} already exists.`);
      }

      const functionUrl = findAssociatedFunctionUrl(stack, originalFunction);

      if (functionUrl) {
        console.log(`LiveLambdaSwapperAspect: Found FunctionUrl ${functionUrl.node.id} for ${originalFunction.node.id}`);
        
        const cfnFunctionUrl = functionUrl.node.defaultChild as lambda.CfnUrl;
        if (cfnFunctionUrl && stubLambda) {
          if (cfnFunctionUrl.targetFunctionArn !== stubLambda.functionArn) {
            cfnFunctionUrl.addPropertyOverride('TargetFunctionArn', stubLambda.functionArn);
            console.log(`LiveLambdaSwapperAspect: Redirected FunctionUrl ${functionUrl.node.id} to ${stubLambda.node.id}`);
            
            const permId = `${stubLambda.node.id}UrlInvokePermission`;
            if (!stack.node.tryFindChild(permId)) {
                new lambda.CfnPermission(stack, permId, {
                    action: 'lambda:InvokeFunctionUrl',
                    functionName: stubLambda.functionName,
                    principal: '*', 
                    functionUrlAuthType: (functionUrl.node.tryGetContext('aws:cdk:toolkit:default-auth-type') || lambda.FunctionUrlAuthType.NONE).toUpperCase(),
                });
                console.log(`LiveLambdaSwapperAspect: Added CfnPermission for ${stubLambda.node.id} to be invoked by Function URL.`);
            }
          } else {
            console.log(`LiveLambdaSwapperAspect: FunctionUrl ${functionUrl.node.id} already points to stub.`);
          }
        }
      }
    }
  }
}

// New Aspect for automatically adding the live lambda layer without tagging
import * as iam from 'aws-cdk-lib/aws-iam'; // Ensure iam is imported if not already

export interface AutoLiveLambdaLayerAspectProps {
  readonly liveLambdaForwarderLayer: lambda.ILayerVersion;
  readonly appSyncApiId: string;
  readonly appSyncChannelNamespace: string;
  readonly liveLambdaActiveDefault?: string; // e.g., 'false'
}

export class AutoLiveLambdaLayerAspect implements cdk.IAspect {
  private readonly layer: lambda.ILayerVersion;
  private readonly appSyncApiId: string;
  private readonly appSyncChannelNamespace: string;
  private readonly liveLambdaActive: string;

  // Define common patterns for CDK internal/provider Lambda function paths/names
  private readonly internalLambdaPatterns: string[] = [
    '/Provider/', // Generic provider pattern
    'Custom::', // Custom resource handlers
    'SingletonLambda', // Often used for one-off custom resource tasks
    'NodeJsFunction/Provider', // Specific to NodeJsFunction's custom resource provider
    'framework-onEvent', // CDK framework event handlers
    'framework--handling-framework-onEvent', // More specific framework handler
    'CrossRegionCode', // Lambdas for cross-region resource management
    'LogRetention', // For log retention custom resources
    'VpcRestrictDefaultSGCustomResource', // VPC related custom resource
    'AwsCliLayer/', // AWS CLI layer related functions if any
    'SsmParameterValue:', // For custom resources fetching SSM params
    'BootstrapVersion', // CDK bootstrap related
    'FileMode', // CDK asset related
    // Add any other patterns you identify for exclusion
  ];

  constructor(props: AutoLiveLambdaLayerAspectProps) {
    this.layer = props.liveLambdaForwarderLayer;
    this.appSyncApiId = props.appSyncApiId;
    this.appSyncChannelNamespace = props.appSyncChannelNamespace;
    this.liveLambdaActive = props.liveLambdaActiveDefault || 'false';
  }

  public visit(node: IConstruct): void {
    if (node instanceof lambda.Function) {
      const functionPath = node.node.path;
      const functionId = node.node.id;

      // 1. Skip if it matches known internal/provider patterns
      if (this.internalLambdaPatterns.some(pattern => functionPath.includes(pattern))) {
        // console.log(`AutoLiveLambdaLayerAspect: Skipping internal-like Lambda at path: ${functionPath}`);
        return;
      }

      // 2. Check if the runtime is Node.js (add other compatible runtimes if your wrapper supports them)
      const compatibleRuntimes = [
        lambda.Runtime.NODEJS_16_X,
        lambda.Runtime.NODEJS_18_X,
        lambda.Runtime.NODEJS_20_X,
        // Potentially lambda.Runtime.NODEJS_LATEST if defined and stable for your use
      ];
      // The runtime property might be an unresolved token during synthesis for some complex cases,
      // but usually for a direct lambda.Function, it's available.
      // Accessing cfnFunction.runtime is more robust if available.
      const cfnFunction = node.node.defaultChild as lambda.CfnFunction;
      if (!cfnFunction || !(cfnFunction instanceof lambda.CfnFunction)) {
          // console.warn(`AutoLiveLambdaLayerAspect: Could not get CfnFunction for ${functionId}. Skipping runtime check for now.`);
          // Fallback or skip if runtime cannot be determined or is not Node.js
          // For now, let's try to proceed if cfnFunction isn't found, assuming it might be a higher-level construct
          // that we didn't explicitly exclude. A more robust check would be to ensure runtime is Node.js.
      } else {
        const runtimeName = cfnFunction.runtime;
        if (runtimeName && !compatibleRuntimes.some(r => r.name === runtimeName)) {
          // console.log(`AutoLiveLambdaLayerAspect: Skipping Lambda ${functionId} due to incompatible runtime: ${runtimeName}`);
          return;
        }
      }

      // 3. Get original handler (from CfnFunction for robustness)
      let originalHandler: string | undefined;
      if (cfnFunction && cfnFunction.handler) {
        originalHandler = cfnFunction.handler as string; // Assuming it's a string here
      }
      if (typeof originalHandler !== 'string' || !originalHandler) {
        console.warn(`AutoLiveLambdaLayerAspect: Original handler for ${functionId} is not a string or is undefined ('${originalHandler}'). Skipping.`);
        return;
      }

      // 4. Avoid re-applying if already wrapped
      if (originalHandler === 'liveLambdaWrapper.handler') {
        // console.log(`AutoLiveLambdaLayerAspect: Handler for ${functionId} is already set to wrapper. Skipping.`);
        return;
      }

      console.log(`AutoLiveLambdaLayerAspect: Applying to ${functionId}. Original handler: ${originalHandler}`);

      // Add the layer
      node.addLayers(this.layer);

      // Override the handler (needs to be done on the CfnFunction)
      cfnFunction.addPropertyOverride('Handler', 'liveLambdaWrapper.handler');

      // Set environment variables
      node.addEnvironment('LIVE_LAMBDA_ORIGINAL_HANDLER_PATH', originalHandler);
      node.addEnvironment('LIVE_LAMBDA_ACTIVE', this.liveLambdaActive);
      node.addEnvironment('LIVE_LAMBDA_APPSYNC_API_ID', this.appSyncApiId);
      node.addEnvironment('LIVE_LAMBDA_APPSYNC_CHANNEL_NAMESPACE', this.appSyncChannelNamespace);
      node.addEnvironment('LIVE_LAMBDA_FUNCTION_LOGICAL_ID', functionId); // CDK Logical ID
      // AWS_REGION is typically available by default in Lambda environment, but can be explicit
      node.addEnvironment('AWS_REGION', cdk.Stack.of(node).region);

      // Add IAM permissions to publish to AppSync
      const appSyncEventPublishPolicy = new iam.PolicyStatement({
        actions: ['appsync:PublishEvent'],
        resources: [
          `arn:aws:appsync:${cdk.Stack.of(node).region}:${cdk.Stack.of(node).account}:apis/${this.appSyncApiId}/channelNamespace/${this.appSyncChannelNamespace}`
        ],
      });
      node.addToRolePolicy(appSyncEventPublishPolicy);
    }
  }
}
