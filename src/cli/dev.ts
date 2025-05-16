const env = {
  account: '942189704687',
  region: 'us-west-1'
}

import { deploy_live_lambda_stacks } from '../stacks/app.js'
import { serve } from '../server/server.js'

async function main() {
  const { server_parameters } = await deploy_live_lambda_stacks(env)

  console.log(`Deployment completed`.green)

  // Start WebSocket Client
  await serve(server_parameters)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
