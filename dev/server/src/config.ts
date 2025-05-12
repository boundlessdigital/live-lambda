// src/config.ts
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env file in the parent directory of src (i.e., dev/server/.env)
dotenv.config({ path: path.resolve(__dirname, '../.env') });

function getEnvVariable(key: string, defaultValue?: string): string {
  const value = process.env[key];
  if (value) {
    return value;
  }
  if (defaultValue !== undefined) {
    return defaultValue;
  }
  throw new Error(`Missing required environment variable: ${key}`);
}

export const config = {
  appSync: {
    realtimeEndpointWss: getEnvVariable('APPSYNC_REALTIME_ENDPOINT_WSS'),
    host: getEnvVariable('APPSYNC_HOST'),
    // apiId: getEnvVariable('APPSYNC_API_ID'), // Only if needed directly by client logic beyond host/url
    proxyRequestNamespace: getEnvVariable('APPSYNC_PROXY_REQUEST_NAMESPACE', 'liveLambdaEvents'),
  },
  aws: {
    region: getEnvVariable('AWS_REGION', 'us-west-1'),
    accountId: getEnvVariable('AWS_ACCOUNT_ID', '000000000000'), // Default to a placeholder if not set
  },
  server: {
    port: parseInt(getEnvVariable('LOCAL_DEV_SERVER_PORT', '5177'), 10),
    rootPath: path.resolve(__dirname, '../../'), // root is 'dev' directory
  },
  paths: {
    lambdaManifest: path.resolve(__dirname, '../../../dist/lambda-manifest.json'),
  }
};

// Validate critical configurations if necessary
if (!config.appSync.realtimeEndpointWss || !config.appSync.host) {
    console.error('Critical AppSync configuration (APPSYNC_REALTIME_ENDPOINT_WSS, APPSYNC_HOST) is missing.');
    // Optionally throw an error or exit, depending on how critical these are for startup
    // For now, we let server.ts decide if it can proceed without AppSync client
}
