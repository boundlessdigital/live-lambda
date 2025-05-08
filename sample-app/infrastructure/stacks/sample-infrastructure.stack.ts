import * as cdk from 'aws-cdk-lib'
import { Construct } from 'constructs'
import {
  NodejsFunction,
  NodejsFunctionProps,
  OutputFormat
} from 'aws-cdk-lib/aws-lambda-nodejs'
import {
  Runtime,
  FunctionUrlAuthType,
  Architecture,
  IFunction
} from 'aws-cdk-lib/aws-lambda'
import * as path from 'path'
import * as sqs from 'aws-cdk-lib/aws-sqs'; 
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources'; 
import { LiveLambdaTunnel } from '@live-lambda/tunnel';

export interface SampleInfrastructureStackProps extends cdk.StackProps {
  // Define any stack-specific props here
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
        SQS_QUEUE_URL: message_queue.queueUrl // Pass queue URL to the URL Lambda
      }
    })

    const function_url = my_url_lambda.addFunctionUrl({
      authType: FunctionUrlAuthType.NONE, // Changed to NONE for public access
      // cors: { // Optional: Configure CORS if you need to call it from a browser
      //   allowedOrigins: ['*'],
      //   allowedMethods: ['GET', 'POST'],
      // }
    })

    // Grant the URL Lambda permission to send messages to the SQS queue
    message_queue.grantSendMessages(my_url_lambda);

    // --- Live Lambda Tunnel Integration for my_url_lambda ---
    const is_live_mode_enabled = true; // For testing, set this to true
    // In a real scenario, this might come from an env var or CDK context set by live-lambda-serve CLI

    const my_url_lambda_tunnel = new LiveLambdaTunnel(this, 'MyUrlLambdaTunnel', {
      lambda_function: my_url_lambda, // The original Lambda
      is_live: is_live_mode_enabled,
      // Optionally, provide specific props for the stub if needed
      // stub_lambda_props: { ... }
    });

    // Output the ARN of the stub Lambda if it was created
    if (my_url_lambda_tunnel.stub_function) {
      new cdk.CfnOutput(this, 'StubMyUrlLambdaArn', {
        value: my_url_lambda_tunnel.stub_function.functionArn,
        description: 'The ARN of the MyUrlLambda Stub Function (if live mode is enabled)',
      });
      // IMPORTANT: For actual live mode, the `function_url` would need to point to
      // `my_url_lambda_tunnel.stub_function` instead of `my_url_lambda`.
      // This re-wiring is not done automatically by the construct yet.
    }
    // --- End Live Lambda Tunnel Integration ---

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
      // enabled: true, // Optional: Default is true
    }));

    new cdk.CfnOutput(this, 'MyUrlLambdaFunctionUrl', {
      value: function_url.url,
      description: 'The URL of the MyUrlLambda function',
    })

    new cdk.CfnOutput(this, 'MessageQueueUrlCfn', { 
      value: message_queue.queueUrl,
      description: 'The URL of the SQS message queue',
    });

    new cdk.CfnOutput(this, 'MessageQueueArnCfn', { 
      value: message_queue.queueArn,
      description: 'The ARN of the SQS message queue',
    });
  }
}
