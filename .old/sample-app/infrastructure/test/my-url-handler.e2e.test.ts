import { describe, it, expect, beforeAll } from 'vitest';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

interface CdkOutput {
  SampleInfrastructureStack: {
    MyUrlLambdaFunctionUrl: string;
    // Add other outputs here if needed
  };
  // Add other stacks here if needed
}

describe('MyUrlLambda End-to-End Test', () => {
  let function_url: string;

  beforeAll(() => {
    try {
      const outputs_file_path = path.resolve(__dirname, '..', 'cdk-outputs.json');
      const cdk_outputs_raw = fs.readFileSync(outputs_file_path, 'utf-8');
      const cdk_outputs: CdkOutput = JSON.parse(cdk_outputs_raw);
      function_url = cdk_outputs.SampleInfrastructureStack.MyUrlLambdaFunctionUrl;

      if (!function_url) {
        throw new Error('MyUrlLambdaFunctionUrl not found in cdk-outputs.json');
      }
    } catch (error) {
      console.error('Error reading cdk-outputs.json:', error);
      throw new Error(
        'Failed to read function URL from cdk-outputs.json. ' +
        'Ensure you have deployed the stack with `pnpm run deploy` which generates this file.'
      );
    }
  });

  it('should return a 200 status and the correct message', async () => {
    expect(function_url, 'Function URL must be defined').toBeDefined();

    try {
      const response = await axios.get(function_url);
      expect(response.status).toBe(200);
      expect(response.data).toEqual(
        expect.objectContaining({
          message: 'Hello from your Lambda Function URL!',
          sqs_send_status: expect.stringContaining('Message sent to SQS, ID:'), // Check that it's a string starting with this
        })
      );
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error('Axios error details:', {
          message: error.message,
          code: error.code,
          status: error.response?.status,
          data: error.response?.data,
        });
      }
      throw error; // Re-throw to fail the test
    }
  });
});
