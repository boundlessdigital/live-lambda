import { serve } from '../server/server.js'
import { Toolkit } from '@aws-cdk/toolkit-lib'
import * as path from 'node:path'

async function main() {
  // Define project_root_abs for the target CDK project
  const project_root_abs = path.resolve('/Users/sidney/boundless/test-cdk-lambda'); // Hardcoded for now

  const original_cwd = process.cwd();
  console.log(`Original CWD: ${original_cwd}`);
  console.log(`Changing CWD to: ${project_root_abs} for CDK operations.`);
  process.chdir(project_root_abs);

  try {
  const cdk = new Toolkit();

    const app_script_path_abs = path.join(project_root_abs, 'src/infrastructure/app.ts');
  const cdk_app_command = `node --import tsx "${app_script_path_abs}"`;
  console.log(`Synthesizing CDK app using command: "${cdk_app_command}" in CWD: ${process.cwd()}`);

  const assembly = await cdk.fromCdkApp(cdk_app_command);

  const deployment = await cdk.deploy(assembly, {
    deploymentMethod: {
      method: 'direct'
    }
  })

  const events = deployment.stacks.find(
    (stack) => stack.stackName === 'AppSyncStack'
  )

  const layer = deployment.stacks.find(
    (stack) => stack.stackName === 'LiveLambda-LayerStack'
  )

  // NASTY REGION HACK
  const stack_artifact = deployment.stacks[0]
  const region = stack_artifact.environment?.region
  console.log(`Deployment:`)
  console.log(JSON.stringify(deployment, null, 2))
  console.log(`Stack Artifact:`)
  console.log(JSON.stringify(stack_artifact, null, 2))

  const server_parameters = {
    region,
    http: events?.outputs['LiveLambdaEventApiHttpHost'] as string,
    realtime: events?.outputs['LiveLambdaEventApiRealtimeHost'] as string,
    layer_arn: layer?.outputs['LiveLambdaProxyLayerArn'] as string
  }

  await serve(server_parameters)

  await cdk.watch(assembly, {
    deploymentMethod: {
      method: 'direct'
    },
    include: ['**/*'],
    exclude: ['**/node_modules/**']
  })
  } finally {
    console.log(`Reverting CWD to: ${original_cwd}`);
    process.chdir(original_cwd);
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
