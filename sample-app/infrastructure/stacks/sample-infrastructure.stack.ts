import * as cdk from 'aws-cdk-lib'
import { Construct } from 'constructs'
import { NodejsFunction, NodejsFunctionProps, OutputFormat, BundlingOptions } from 'aws-cdk-lib/aws-lambda-nodejs'
import {
  Runtime,
  FunctionUrlAuthType,
  Architecture,
  IFunction,
  FunctionUrl
} from 'aws-cdk-lib/aws-lambda'
import * as path from 'path'
import * as sqs from 'aws-cdk-lib/aws-sqs'; 
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources'; 
import { LiveLambdaTunnel, LiveLambdaTunnelProps } from '@live-lambda/tunnel';
import * as lambda from 'aws-cdk-lib/aws-lambda'; // Ensure 'lambda' alias is used for aws_lambda
import * as iam from 'aws-cdk-lib/aws-iam';
import * as appsync from 'aws-cdk-lib/aws-appsync'; // Added for EventApi

export interface SampleInfrastructureStackProps extends cdk.StackProps {
  // Define any stack-specific props here
  readonly live_lambda_enabled?: boolean;
}

export class SampleInfrastructureStack extends cdk.Stack {
  constructor(
    scope: Construct,
    id: string,
    props?: SampleInfrastructureStackProps
  ) {
    super(scope, id, props)

    // Common bundling options for all Lambda functions
    const common_bundling_options: NodejsFunctionProps['bundling'] = {
      format: OutputFormat.ESM,
      minify: false,
      sourceMap: true,
      sourcesContent: false,
      target: 'node20',
      // AWS SDK v3 is available in Node.js 20.x, so no need to bundle it.
      // If you were to explicitly use aws-sdk v2, you might list it here.
      // For v3, ensure your Lambda code imports from @aws-sdk/* packages.
      externalModules: [
        // 'aws-sdk', // for AWS SDK v2
        '@aws-sdk/client-sqs' // Example if you want to ensure it's external; usually not needed for v3 in Node 20
      ],
    }

    // SQS Queue for processing messages
    const message_queue = new sqs.Queue(this, 'MessageQueue', {
      visibilityTimeout: cdk.Duration.seconds(300), // Example: 5 minutes
      // Consider adding a dead-letter queue (DLQ) for production
    });

    // Existing Lambda function triggered by a URL
    const my_url_lambda = new NodejsFunction(this, 'MyUrlLambda', {
      projectRoot: path.join(__dirname, '../..'), // projectRoot is now live-lambda/sample-app/
      entry: path.join(__dirname, '../../backend/handlers/my-url-handler.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64, // Or X86_64 if preferred
      bundling: common_bundling_options,
      environment: {
        NODE_OPTIONS: '--enable-source-maps', // Recommended for better debugging
        SQS_QUEUE_URL: message_queue.queueUrl // Corrected back to SQS_QUEUE_URL
      }
    })

    // Grant the URL Lambda permission to send messages to the SQS queue
    message_queue.grantSendMessages(my_url_lambda.role!);

    // New Lambda function to process messages from the SQS queue
    const sqs_message_processor_lambda = new NodejsFunction(this, 'SqsMessageProcessorLambda', {
      projectRoot: path.join(__dirname, '../..'), // projectRoot is now live-lambda/sample-app/
      entry: path.join(__dirname, '../../backend/handlers/sqs-message-handler.ts'), // Path to the new handler
      handler: 'handler', // Assuming the handler function is named 'handler'
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      bundling: common_bundling_options,
      environment: {
        NODE_OPTIONS: '--enable-source-maps',
      },
    });

    // Add SQS event source to the SQS message processor Lambda
    sqs_message_processor_lambda.addEventSource(new SqsEventSource(message_queue, {
      batchSize: 10, // Optional: Number of records to send to the Lambda in each batch
    }));

    // --- Live Lambda Tunnel Setup ---
    // Determine if live mode should be active based on the prop passed from index.ts
    const enable_live_tunnel_via_props = props?.live_lambda_enabled ?? false;
    console.log(`STACK_DEBUG: props.live_lambda_enabled received: ${props?.live_lambda_enabled}, evaluated enable_live_tunnel_via_props: ${enable_live_tunnel_via_props}`);

    // --- AppSync Event API for Live Lambda --- 
    const live_lambda_event_api = new appsync.EventApi(this, 'LiveLambdaEventApi', {
      apiName: `live-lambda-events-${this.stackName}`,
      authorizationConfig: {
        authProviders: [
          { authorizationType: appsync.AppSyncAuthorizationType.IAM },
        ],
      },
    });

    // Add the 'liveLambda' namespace to the Event API
    live_lambda_event_api.addChannelNamespace('liveLambda');

    // Bundling options for the stub Lambda defined within the tunnel
    const stub_lambda_bundling_options: BundlingOptions = {
      ...common_bundling_options, // Reuse common options like format, minify, sourceMap
      // No need to exclude aws-sdk v3 as it's available in Node 20 runtime and ESM compatible
    };
    // Ensure aws-sdk is not in externalModules if it was added by common_bundling_options
    if (stub_lambda_bundling_options.externalModules?.includes('aws-sdk')) {
      stub_lambda_bundling_options.externalModules = stub_lambda_bundling_options.externalModules.filter(m => m !== 'aws-sdk');
    }

    // --- Live Lambda Tunnel Integration for my_url_lambda ---
    let my_url_lambda_tunnel: LiveLambdaTunnel;

    try {
      console.log(`SYNTHESIS_DEBUG: Attempting 'new LiveLambdaTunnel("MyUrlLambdaTunnel", ...)' with live_mode_active: ${enable_live_tunnel_via_props}`);
      my_url_lambda_tunnel = new LiveLambdaTunnel(this, 'MyUrlLambdaTunnel', {
        live_mode_active: enable_live_tunnel_via_props, // Use the value from props
        lambda_to_proxy: my_url_lambda,
        appsync_event_api_url: `https://${live_lambda_event_api.httpDns}/event`,
        appsync_api_id: live_lambda_event_api.apiId,
        appsync_channel_namespace: 'liveLambda', // Reverted to general namespace
        // New props for stub Lambda bundling, from perspective of monorepo root
        stub_lambda_project_root: path.join(__dirname, '../../../'), // -> monorepo root /Users/sidney/boundless/live-lambda
        stub_lambda_entry_path: path.join('tunnel', 'src', 'lambda-proxy', 'handler.ts'), // -> tunnel/src/lambda-proxy/handler.ts relative to monorepo root
        stub_lambda_deps_lock_file_path: path.join(__dirname, '../../../pnpm-lock.yaml'), // -> monorepo root pnpm-lock.yaml

        stub_lambda_props: { // Other NodejsFunctionProps for the stub, if any
          timeout: cdk.Duration.seconds(30),
          memorySize: 256,
          // 'entry', 'projectRoot', and 'depsLockFilePath' are now handled by the direct props above
          // bundling options like 'banner' are set by default in LiveLambdaTunnel
        },
      });
      console.log(`SYNTHESIS_DEBUG: 'new LiveLambdaTunnel' completed.`);
    } catch (error) {
      console.error('CRITICAL_ERROR: Failed to instantiate LiveLambdaTunnel:', error);
      // Optionally, rethrow or handle to prevent further operations if tunnel is crucial
      throw new Error(`CRITICAL_ERROR: LiveLambdaTunnel instantiation failed. See logs for details. Error: ${error instanceof Error ? error.message : String(error)}`);
    }

    console.log(`SYNTHESIS_DEBUG: my_url_lambda_tunnel.stub_lambda ARN (if created): ${my_url_lambda_tunnel!.stub_lambda?.functionArn ?? 'undefined'}`);
    console.log(`SYNTHESIS_DEBUG: my_url_lambda_tunnel.original_lambda ARN: ${my_url_lambda_tunnel!.original_lambda?.functionArn ?? 'undefined'}`);
    console.log(`SYNTHESIS_DEBUG: my_url_lambda_tunnel.active_lambda_target ARN: ${my_url_lambda_tunnel!.active_lambda_target?.functionArn ?? 'undefined'}`);

    // --- Conditionally Configure Function URL Target ---
    // The LiveLambdaTunnel construct now handles selecting the active target based on 'is_live'
    const target_lambda_for_function_url = my_url_lambda_tunnel!.active_lambda_target;
    
    console.log(`SYNTHESIS_DEBUG: target_lambda_for_function_url is now directly from tunnel.active_lambda_target ARN: ${target_lambda_for_function_url?.functionArn ?? 'undefined'}`);

    // Create the Function URL with a fixed logical ID and a conditional target
    const live_switched_function_url = new lambda.FunctionUrl(this, 'MyUrlLambdaLiveSwitchUrl', { // Fixed logical ID for the FunctionUrl resource
      function: target_lambda_for_function_url, // Conditionally points to original or stub
      authType: lambda.FunctionUrlAuthType.NONE,
      cors: {
        allowedOrigins: ['*'], // Allow all origins for simplicity in this example
        allowedMethods: [lambda.HttpMethod.ALL], // Allow all methods
        allowedHeaders: ['*'], // Allow all headers
      },
    });

    // Grant the stub Lambda permission to invoke the original Lambda if it's defined
    if (my_url_lambda_tunnel.original_lambda && my_url_lambda_tunnel.stub_lambda) { // also check stub_lambda here for safety
      my_url_lambda_tunnel.original_lambda.grantInvoke(my_url_lambda_tunnel.stub_lambda);
    }

    // Grant the stub Lambda's role permission to publish to the Event API
    if (my_url_lambda_tunnel.stub_lambda) { // Check if stub_lambda exists
      live_lambda_event_api.grantPublish(my_url_lambda_tunnel.stub_lambda);
    }

    // --- Outputs for Live Mode ---
    new cdk.CfnOutput(this, 'StubMyUrlLambdaArn', {
      value: my_url_lambda_tunnel!.stub_lambda?.functionArn ?? 'undefined',
      description: 'ARN of the Stub Lambda for MyUrlLambda used in live mode',
    });

    // Output the SQS queue URL and ARN
    new cdk.CfnOutput(this, 'MessageQueueUrlCfn', {
      value: message_queue.queueUrl,
    });
    new cdk.CfnOutput(this, 'MessageQueueArnCfn', {
      value: message_queue.queueArn,
    });

    // Output the conditionally targeted Function URL
    new cdk.CfnOutput(this, 'MyUrlLambdaFunctionUrl', { // Keep the CfnOutput name consistent
      value: live_switched_function_url.url,
      description: 'The Function URL for MyUrlLambda (conditionally proxied if live mode is active)',
    });

    new cdk.CfnOutput(this, 'LiveLambdaEventApiId', {
      value: live_lambda_event_api.apiId,
      description: 'The ID of the AppSync Event API for Live Lambda.',
    });
    new cdk.CfnOutput(this, 'LiveLambdaEventApiHttpEndpoint', {
      value: `https://${live_lambda_event_api.httpDns}/event`,
      description: 'The HTTP endpoint for the AppSync Event API for Live Lambda.',
    });
    new cdk.CfnOutput(this, 'LiveLambdaEventApiWssEndpoint', {
      value: `wss://${live_lambda_event_api.realtimeDns}/event/realtime`,
      description: 'The WebSocket endpoint for the AppSync Event API for Live Lambda.',
    });
  }
}
