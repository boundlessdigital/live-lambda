import * as cdk from 'aws-cdk-lib'
import { Construct } from 'constructs'
import { NodejsFunction, NodejsFunctionProps, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs'
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
import { LiveLambdaTunnel } from '@live-lambda/tunnel';
import * as lambda from 'aws-cdk-lib/aws-lambda'; // Ensure 'lambda' alias is used for aws_lambda

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
    message_queue.grantSendMessages(my_url_lambda);

    // --- Live Lambda Tunnel Integration for my_url_lambda ---
    const enable_live_tunnel = props?.live_lambda_enabled ?? false; // Use prop, default to false

    const my_url_lambda_tunnel = new LiveLambdaTunnel(this, 'MyUrlLambdaTunnel', {
      lambda_function: my_url_lambda, // The original Lambda
      is_live: enable_live_tunnel, // Use the dynamically configured value
      // Optionally, provide specific props for the stub if needed
      // stub_lambda_props: { ... }
    });

    // --- Conditionally Configure Function URL Target ---
    // Determine the target for the Function URL based on whether live mode is enabled
    const target_lambda_for_function_url = 
      enable_live_tunnel && my_url_lambda_tunnel.stub_function
        ? my_url_lambda_tunnel.stub_function
        : my_url_lambda;

    // Create the Function URL with a fixed logical ID and a conditional target
    // This replaces the previous my_url_lambda.addFunctionUrl()
    // TEMPORARILY COMMENTED OUT FOR STATE CLEARING - NOW RE-ENABLING
    const live_switched_function_url = new lambda.FunctionUrl(this, 'MyUrlLambdaLiveSwitchUrl', { // Fixed logical ID for the FunctionUrl resource
      function: target_lambda_for_function_url, // Conditionally points to original or stub
      authType: lambda.FunctionUrlAuthType.NONE,
      cors: {
        allowedOrigins: ['*'], // Allow all origins for simplicity in this example
        allowedMethods: [lambda.HttpMethod.ALL], // Allow all methods
        allowedHeaders: ['*'], // Allow all headers
      },
    });

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

    // Output the SQS queue URL and ARN
    new cdk.CfnOutput(this, 'MessageQueueUrlCfn', {
      value: message_queue.queueUrl,
    });
    new cdk.CfnOutput(this, 'MessageQueueArnCfn', {
      value: message_queue.queueArn,
    });

    // Output the conditionally targeted Function URL
    // TEMPORARILY COMMENTED OUT FOR STATE CLEARING - NOW RE-ENABLING
    new cdk.CfnOutput(this, 'MyUrlLambdaFunctionUrl', { // Keep the CfnOutput name consistent
      value: live_switched_function_url.url,
      description: 'The Function URL for MyUrlLambda (conditionally proxied if live mode is active)',
    });

    // Output the ARN of the stub Lambda if it's created (for verification/debugging)
    if (enable_live_tunnel && my_url_lambda_tunnel.stub_function_arn) {
      new cdk.CfnOutput(this, 'StubMyUrlLambdaArn', {
        value: my_url_lambda_tunnel.stub_function_arn,
        description: 'ARN of the Stub Lambda for MyUrlLambda when live mode is active.',
      });
    }
  }
}
