#!/usr/bin/env node
import 'source-map-support/register'
import * as cdk from 'aws-cdk-lib'
import { SampleInfrastructureStack } from './stacks/sample-infrastructure.stack'

const app = new cdk.App()

// Read the context variable. It will be undefined if not set.
const live_lambda_active_context = app.node.tryGetContext('liveLambdaActive');

// Determine the boolean value. If context is not set, default to false.
// CDK context values passed via -c are strings 'true'/'false' or numbers.
const is_live_lambda_enabled = live_lambda_active_context === 'true' || live_lambda_active_context === true;

new SampleInfrastructureStack(app, 'SampleInfrastructureStack', {
  /* If you don't specify 'env', this stack will be environment-agnostic. 
   * Account/Region-dependent features and context lookups will not work, 
   * but a single synthesized template can be deployed anywhere. */
  /* Uncomment the next line to specialize this stack for the AWS Account
   * and Region that are implied by the current CLI configuration. */
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
  /* Uncomment the next line if you know exactly what Account and Region you
   * want to deploy the stack to. */
  // env: { account: 'YOUR_ACCOUNT_ID', region: 'YOUR_REGION' },
  /* For more information, see https://docs.aws.amazon.com/cdk/latest/guide/environments.html */
  live_lambda_enabled: is_live_lambda_enabled, // Pass the dynamic value
})
