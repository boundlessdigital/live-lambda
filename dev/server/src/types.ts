// src/types.ts

export interface LambdaManifestEntry {
  logicalId: string;
  functionName: string;
  handlerPath: string;
  runtime: string;
  roleArn?: string;
}

export interface LambdaManifest {
  [logicalId: string]: LambdaManifestEntry;
}

export interface AppSyncEvent {
  lambdaLogicalId: string; // Expected field from stub to identify target Lambda
  eventPayload: any;       // The original event for the Lambda
  lambdaContext?: any;     // Optional: any context passed from stub
  awsRequestId: string;    // To trace the request
}

export interface LambdaContext {
  functionName: string;
  functionVersion: string;
  invokedFunctionArn: string;
  memoryLimitInMB: string;
  awsRequestId: string;
  logGroupName: string;
  logStreamName: string;
  // getRemainingTimeInMillis?: () => number; // Uncomment if needed
}

// Outputs from AppSyncStack CDK deployment
export interface AppSyncStackOutputs {
  LiveLambdaEventApiHttpEndpoint: string;
  LiveLambdaEventApiId: string;
  LiveLambdaEventApiWebSocketEndpoint: string;
  appSyncHost: string; // Added for the signing host, e.g., <api-id>.appsync-api.<region>.amazonaws.com
}
