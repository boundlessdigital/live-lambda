import { STSClient, AssumeRoleCommand, Credentials } from '@aws-sdk/client-sts';
import path from 'path';
import { ViteDevServer } from 'vite';
import { LambdaManifestEntry, LambdaContext } from './types';
import { config } from './config';

async function _assumeLambdaRole(
  roleArn: string,
  roleSessionName: string,
  awsRequestId: string
): Promise<Credentials | null> {
  try {
    console.log(`[${awsRequestId}] Attempting to assume role: ${roleArn}`);
    const stsClient = new STSClient({ region: config.aws.region });
    const assumeRoleCommand = new AssumeRoleCommand({
      RoleArn: roleArn,
      RoleSessionName: roleSessionName,
      DurationSeconds: 900, // 15 minutes
    });

    const { Credentials } = await stsClient.send(assumeRoleCommand);
    if (Credentials) {
      console.log(`[${awsRequestId}] Successfully assumed role: ${roleArn}`);
      return Credentials;
    } else {
      console.warn(`[${awsRequestId}] Failed to get credentials after assuming role for ${roleArn}.`);
      return null;
    }
  } catch (error) {
    console.error(`[${awsRequestId}] Error assuming role ${roleArn}:`, error);
    return null;
  }
}

function _setTemporaryAwsCredentials(credentials: Credentials): Record<string, string | undefined> {
  const originalEnv: Record<string, string | undefined> = {
    AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
    AWS_SESSION_TOKEN: process.env.AWS_SESSION_TOKEN,
    AWS_REGION: process.env.AWS_REGION, // Though region for execution usually doesn't change with role assumption
    AWS_SECURITY_TOKEN: process.env.AWS_SECURITY_TOKEN,
  };

  process.env.AWS_ACCESS_KEY_ID = credentials.AccessKeyId;
  process.env.AWS_SECRET_ACCESS_KEY = credentials.SecretAccessKey;
  process.env.AWS_SESSION_TOKEN = credentials.SessionToken;
  // AWS_SECURITY_TOKEN is an alias for AWS_SESSION_TOKEN used by some older SDKs/tools
  if (credentials.SessionToken) {
      process.env.AWS_SECURITY_TOKEN = credentials.SessionToken;
  }

  return originalEnv;
}

function _restoreOriginalAwsCredentials(originalEnv: Record<string, string | undefined>): void {
  process.env.AWS_ACCESS_KEY_ID = originalEnv.AWS_ACCESS_KEY_ID;
  process.env.AWS_SECRET_ACCESS_KEY = originalEnv.AWS_SECRET_ACCESS_KEY;
  process.env.AWS_SESSION_TOKEN = originalEnv.AWS_SESSION_TOKEN;
  process.env.AWS_REGION = originalEnv.AWS_REGION;
  process.env.AWS_SECURITY_TOKEN = originalEnv.AWS_SECURITY_TOKEN;
}

async function _loadAndInvokeHandler(
  viteServer: ViteDevServer,
  absoluteHandlerPath: string,
  event: any,
  lambdaContext: LambdaContext,
  awsRequestId: string,
  logicalId: string
): Promise<any> {
  console.log(`[${awsRequestId}] Loading handler module from: ${absoluteHandlerPath}`);
  const handlerModule = await viteServer.ssrLoadModule(absoluteHandlerPath);

  if (typeof handlerModule.handler !== 'function') {
    throw new Error(`Handler function not found in ${absoluteHandlerPath}. Expected 'exports.handler'.`);
  }

  console.log(`[${awsRequestId}] Invoking handler for ${logicalId}...`);
  const result = await handlerModule.handler(event, lambdaContext);
  console.log(`[${awsRequestId}] Handler for ${logicalId} completed.`);
  return result;
}

export async function executeLambdaHandler(
  viteServer: ViteDevServer,
  manifestEntry: LambdaManifestEntry,
  event: any, // The event payload for the Lambda
  awsRequestId: string // For logging and context
): Promise<any> {
  
  const { logicalId, handlerPath, roleArn, functionName } = manifestEntry;
  console.log(`[${awsRequestId}] Executing ${logicalId} (Handler: ${handlerPath})`);

  let originalEnv: Record<string, string | undefined> | null = null;
  let roleAssumedSuccessfully = false;

  try {
    if (roleArn) {
      const roleSessionName = `local-dev-${logicalId.replace(/\W/g, '_')}-${Date.now()}`.substring(0, 64);
      const assumedRoleCredentials = await _assumeLambdaRole(
        roleArn,
        roleSessionName,
        awsRequestId
      );

      if (assumedRoleCredentials) {
        originalEnv = _setTemporaryAwsCredentials(assumedRoleCredentials);
        roleAssumedSuccessfully = true;
      } else {
        console.warn(`[${awsRequestId}] Proceeding with default credentials for ${logicalId} as role assumption failed.`);
      }
    } else {
      console.log(`[${awsRequestId}] No roleArn in manifest for ${logicalId}. Proceeding with default credentials.`);
    }

    const lambdaContext: LambdaContext = {
      functionName: functionName,
      functionVersion: '$LATEST',
      invokedFunctionArn: `arn:aws:lambda:${config.aws.region}:${config.aws.accountId}:function:${functionName}`,
      memoryLimitInMB: '128', // Example value
      awsRequestId: awsRequestId,
      logGroupName: `/aws/lambda/local-${functionName}`,
      logStreamName: `${new Date().toISOString().substring(0, 10).replace(/-/g, '/')}/[$LATEST]${awsRequestId}`,
    };

    const absoluteHandlerPath = path.isAbsolute(handlerPath) 
      ? handlerPath 
      : path.resolve(viteServer.config.root, handlerPath);
    
    return await _loadAndInvokeHandler(
      viteServer,
      absoluteHandlerPath,
      event,
      lambdaContext,
      awsRequestId,
      logicalId
    );

  } catch (error) {
    console.error(`[${awsRequestId}] Error executing handler for ${logicalId}:`, error);
    throw error; // Re-throw the error to be caught by the caller in appsync-client
  } finally {
    if (roleAssumedSuccessfully && originalEnv) {
      _restoreOriginalAwsCredentials(originalEnv);
      console.log(`[${awsRequestId}] Restored original AWS credentials for ${logicalId}.`);
    }
  }
}
