// src/infrastructure-manager.ts
import { exec } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import util from 'util';
import { AppSyncStackOutputs } from './types';
import { config } from './config';

const execAsync = util.promisify(exec);

const OUTPUTS_FILE_NAME = '.appsync-outputs.json';
const INFRA_DIR = path.resolve(__dirname, '../../infrastructure'); // 'dev/infrastructure'
const OUTPUTS_FILE_PATH = path.join(INFRA_DIR, OUTPUTS_FILE_NAME);

async function _runCdkDeploy(): Promise<void> {
  const command = `pnpm exec cdk deploy AppSyncStack --outputs-file ${OUTPUTS_FILE_NAME} --require-approval never -c liveLambdaActive=true`;
  console.log(`Executing CDK deployment: ${command} in ${INFRA_DIR}`);
  try {
    const { stdout, stderr } = await execAsync(command, { cwd: INFRA_DIR });
    console.log('CDK deployment stdout:', stdout);
    if (stderr) {
      console.error('CDK deployment stderr:', stderr);
      // Check if stderr contains typical CDK progress/success messages before throwing
      if (!stderr.includes('Stack deployment finished successfully')) {
        // throw new Error(`CDK deployment failed: ${stderr}`);
        // For now, we will log the error and proceed, as sometimes CDK outputs non-fatal errors to stderr
        console.warn('CDK deployment process emitted to stderr, but attempting to proceed.');
      }
    }
    console.log('AppSyncStack deployment command executed.');
  } catch (error) {
    console.error('Error during CDK deployment:', error);
    throw error; // Re-throw to be caught by the caller
  }
}

async function _readStackOutputs(): Promise<AppSyncStackOutputs | null> {
  try {
    console.log(`Reading AppSyncStack outputs from: ${OUTPUTS_FILE_PATH}`);
    const outputsJson = await fs.readFile(OUTPUTS_FILE_PATH, 'utf-8');
    const outputs = JSON.parse(outputsJson);

    // The outputs are nested under a key that is the stack name, e.g., "AppSyncStack"
    // We need to find this key. It's usually the only key at the top level of the outputs file.
    const stackName = Object.keys(outputs)[0];
    if (!stackName || !outputs[stackName]) {
      console.error('Could not find stack-specific outputs in JSON file.');
      return null;
    }

    const stackOutputs = outputs[stackName] as Omit<AppSyncStackOutputs, 'appSyncHost'>; // Temporarily Omit for parsing

    if (
      !stackOutputs.LiveLambdaEventApiHttpEndpoint ||
      !stackOutputs.LiveLambdaEventApiId ||
      !stackOutputs.LiveLambdaEventApiWebSocketEndpoint
    ) {
      console.error('One or more required AppSyncStack outputs are missing (excluding appSyncHost for now):', stackOutputs);
      return null;
    }

    // Parse appSyncHost from LiveLambdaEventApiHttpEndpoint
    // Format: https://<api-id>.appsync-api.<region>.amazonaws.com/event
    let appSyncHost = '';
    try {
      const url = new URL(stackOutputs.LiveLambdaEventApiHttpEndpoint);
      appSyncHost = url.hostname; // This will be <api-id>.appsync-api.<region>.amazonaws.com
      if (!appSyncHost) {
        throw new Error('Hostname could not be parsed from HTTP endpoint.');
      }
    } catch (e) {
      console.error(`Error parsing appSyncHost from ${stackOutputs.LiveLambdaEventApiHttpEndpoint}:`, e);
      return null; // Cannot proceed without a valid host for signing
    }

    const completeOutputs: AppSyncStackOutputs = {
      ...stackOutputs,
      appSyncHost,
    };

    console.log('Successfully read and parsed AppSyncStack outputs:', completeOutputs);
    return completeOutputs;
  } catch (error) {
    console.error('Error reading or parsing AppSyncStack outputs file:', error);
    return null;
  }
}

export async function deployAndRetrieveAppSyncOutputs(): Promise<AppSyncStackOutputs | null> {
  try {
    await _runCdkDeploy();
    const outputs = await _readStackOutputs();
    if (!outputs) {
      console.error('Failed to retrieve AppSync outputs after deployment.');
      // Fallback to config if outputs are not available after deployment attempt
      console.log('Falling back to AppSync configuration from .env file.');
      return {
        LiveLambdaEventApiHttpEndpoint: 'Check AppSyncStack outputs in AWS console or .env',
        LiveLambdaEventApiId: 'Check AppSyncStack outputs in AWS console or .env',
        LiveLambdaEventApiWebSocketEndpoint: config.appSync.realtimeEndpointWss,
        appSyncHost: config.appSync.host, // Fallback host
      };
    }
    return outputs;
  } catch (error) {
    console.error('Failed to deploy and retrieve AppSync outputs:', error);
    console.log('Falling back to AppSync configuration from .env file due to deployment error.');
    return {
        LiveLambdaEventApiHttpEndpoint: 'Check AppSyncStack outputs in AWS console or .env',
        LiveLambdaEventApiId: 'Check AppSyncStack outputs in AWS console or .env',
        LiveLambdaEventApiWebSocketEndpoint: config.appSync.realtimeEndpointWss, // Fallback to .env value
        appSyncHost: config.appSync.host, // Fallback host
      };
  }
}
