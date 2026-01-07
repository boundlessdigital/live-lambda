import * as cdk from 'aws-cdk-lib'
import { Toolkit } from '@aws-cdk/toolkit-lib'
import {
  SSMClient,
  GetParameterCommand,
  GetParametersByPathCommand,
  ParameterNotFound
} from '@aws-sdk/client-ssm'
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts'
import { fromNodeProviderChain } from '@aws-sdk/credential-providers'
import { AppSyncStack } from '../cdk/stacks/appsync.stack.js'
import { LiveLambdaLayerStack } from '../cdk/stacks/layer.stack.js'
import { CustomIoHost } from '../cdk/toolkit/iohost.js'
import { logger } from '../lib/logger.js'
import {
  get_ssm_param_appsync_api_arn,
  get_ssm_param_appsync_http_host,
  get_ssm_param_appsync_realtime_host,
  get_ssm_param_appsync_region,
  get_ssm_param_bootstrap_version,
  get_layer_arn_ssm_parameter,
  get_appsync_stack_name,
  get_layer_stack_name,
  get_default_ssm_prefix,
  format_app_name,
  format_stage,
  BOOTSTRAP_VERSION
} from '../lib/constants.js'

export interface BootstrapStatus {
  is_bootstrapped: boolean
  version?: string
  needs_upgrade?: boolean
}

export interface BootstrapConfig {
  region: string
  api_arn: string
  http_host: string
  realtime_host: string
  layer_arn: string
}

export interface BootstrapProps {
  region: string
  app_name: string
  stage: string
  /** Custom SSM prefix. Default: /live-lambda/{app_name}/{stage} */
  ssm_prefix?: string
  force?: boolean
}

/**
 * Check if LiveLambda infrastructure has been bootstrapped in the given region
 */
export async function check_bootstrap_status(
  region: string,
  ssm_prefix: string
): Promise<BootstrapStatus> {
  const credentials = fromNodeProviderChain()
  const ssm = new SSMClient({ region, credentials })

  try {
    const result = await ssm.send(
      new GetParameterCommand({
        Name: get_ssm_param_bootstrap_version(ssm_prefix)
      })
    )

    const deployed_version = result.Parameter?.Value
    const needs_upgrade =
      deployed_version !== undefined && deployed_version !== BOOTSTRAP_VERSION

    return {
      is_bootstrapped: true,
      version: deployed_version,
      needs_upgrade
    }
  } catch (error) {
    if (
      error instanceof ParameterNotFound ||
      (error as any).name === 'ParameterNotFound'
    ) {
      return { is_bootstrapped: false }
    }
    throw error
  }
}

/**
 * Get the bootstrap configuration from SSM parameters
 */
export async function get_bootstrap_config(
  region: string,
  ssm_prefix: string
): Promise<BootstrapConfig> {
  const credentials = fromNodeProviderChain()
  const ssm = new SSMClient({ region, credentials })

  // Fetch all parameters under the SSM prefix
  const result = await ssm.send(
    new GetParametersByPathCommand({
      Path: ssm_prefix,
      Recursive: true
    })
  )

  const params = new Map<string, string>()
  for (const param of result.Parameters ?? []) {
    if (param.Name && param.Value) {
      params.set(param.Name, param.Value)
    }
  }

  const api_arn = params.get(get_ssm_param_appsync_api_arn(ssm_prefix))
  const http_host = params.get(get_ssm_param_appsync_http_host(ssm_prefix))
  const realtime_host = params.get(
    get_ssm_param_appsync_realtime_host(ssm_prefix)
  )
  const layer_arn = params.get(get_layer_arn_ssm_parameter(ssm_prefix))
  const appsync_region = params.get(get_ssm_param_appsync_region(ssm_prefix))

  const missing: string[] = []
  if (!api_arn) missing.push('api_arn')
  if (!http_host) missing.push('http_host')
  if (!realtime_host) missing.push('realtime_host')
  if (!layer_arn) missing.push('layer_arn')

  if (missing.length > 0) {
    throw new Error(
      `LiveLambda bootstrap is incomplete. Missing: ${missing.join(', ')}. ` +
        `The infrastructure will be automatically deployed when you run 'live-lambda start'.`
    )
  }

  return {
    region: appsync_region ?? region,
    api_arn: api_arn!,
    http_host: http_host!,
    realtime_host: realtime_host!,
    layer_arn: layer_arn!
  }
}

/**
 * Get the current AWS account ID
 */
async function get_account_id(): Promise<string> {
  const credentials = fromNodeProviderChain()
  const sts = new STSClient({ credentials })
  const result = await sts.send(new GetCallerIdentityCommand({}))
  if (!result.Account) {
    throw new Error('Could not determine AWS account ID')
  }
  return result.Account
}

/**
 * Bootstrap LiveLambda infrastructure in the given region
 */
export async function bootstrap(props: BootstrapProps): Promise<void> {
  const { region, app_name, stage, force } = props

  // Compute derived values
  const formatted_app = format_app_name(app_name)
  const formatted_stage = format_stage(stage)
  const ssm_prefix = props.ssm_prefix ?? get_default_ssm_prefix(app_name, stage)

  logger.info(
    `Checking LiveLambda bootstrap status for "${formatted_app}-${formatted_stage}" in ${region}...`
  )

  // Check if already bootstrapped
  const status = await check_bootstrap_status(region, ssm_prefix)

  if (status.is_bootstrapped && !force) {
    if (status.needs_upgrade) {
      logger.info(
        `LiveLambda bootstrap version ${status.version} found, but version ${BOOTSTRAP_VERSION} is available.`
      )
      logger.info(`Run 'live-lambda start --force' to upgrade.`)
    } else {
      logger.info(
        `LiveLambda already bootstrapped (version ${status.version}). Use --force to redeploy.`
      )
    }
    return
  }

  if (status.is_bootstrapped && force) {
    logger.info(`Force redeploying LiveLambda bootstrap infrastructure...`)
  } else {
    logger.info(`Bootstrapping LiveLambda infrastructure...`)
  }

  // Get account ID for environment
  const account = await get_account_id()
  const env = { account, region }

  const appsync_stack_name = get_appsync_stack_name(app_name, stage)
  const layer_stack_name = get_layer_stack_name(app_name, stage)

  // Create dedicated CDK app for bootstrap infrastructure
  const app = new cdk.App({
    outdir: `cdk.out.live-lambda-bootstrap-${formatted_app}-${formatted_stage}`
  })

  // Create stacks with stage-prefixed names
  const appsync_stack = new AppSyncStack(app, appsync_stack_name, {
    ssm_prefix,
    env
  })
  new LiveLambdaLayerStack(app, layer_stack_name, {
    ssm_prefix,
    api: appsync_stack.api,
    env
  })

  // Deploy using CDK Toolkit
  const custom_io_host = new CustomIoHost()
  const toolkit = new Toolkit({ ioHost: custom_io_host })

  try {
    const assembly = await toolkit.fromAssemblyBuilder(async () => {
      return app.synth()
    })

    await toolkit.deploy(assembly, {
      outputsFile: `cdk.out.live-lambda-bootstrap-${formatted_app}-${formatted_stage}/outputs.json`,
      concurrency: 2,
      deploymentMethod: { method: 'change-set' }
    })

    logger.info(`LiveLambda bootstrap complete!`)
    logger.info(`  App: ${formatted_app}`)
    logger.info(`  Stage: ${formatted_stage}`)
    logger.info(`  Region: ${region}`)
    logger.info(`  Version: ${BOOTSTRAP_VERSION}`)
  } finally {
    custom_io_host.cleanup()
  }
}

export interface DestroyBootstrapProps {
  region: string
  app_name: string
  stage: string
  /** Custom SSM prefix. Default: /live-lambda/{app_name}/{stage} */
  ssm_prefix?: string
}

/**
 * Destroy the bootstrap infrastructure
 */
export async function destroy_bootstrap(
  props: DestroyBootstrapProps
): Promise<void> {
  const { region, app_name, stage } = props

  // Compute derived values
  const formatted_app = format_app_name(app_name)
  const formatted_stage = format_stage(stage)
  const ssm_prefix = props.ssm_prefix ?? get_default_ssm_prefix(app_name, stage)

  logger.info(
    `Destroying LiveLambda bootstrap infrastructure for "${formatted_app}-${formatted_stage}" in ${region}...`
  )

  const status = await check_bootstrap_status(region, ssm_prefix)
  if (!status.is_bootstrapped) {
    logger.info(
      `LiveLambda is not bootstrapped for "${formatted_app}-${formatted_stage}" in ${region}. Nothing to destroy.`
    )
    return
  }

  const account = await get_account_id()
  const env = { account, region }

  const appsync_stack_name = get_appsync_stack_name(app_name, stage)
  const layer_stack_name = get_layer_stack_name(app_name, stage)

  // Create the same app structure to destroy
  const app = new cdk.App({
    outdir: `cdk.out.live-lambda-bootstrap-${formatted_app}-${formatted_stage}`
  })

  const appsync_stack = new AppSyncStack(app, appsync_stack_name, {
    ssm_prefix,
    env
  })
  new LiveLambdaLayerStack(app, layer_stack_name, {
    ssm_prefix,
    api: appsync_stack.api,
    env
  })

  const custom_io_host = new CustomIoHost()
  const toolkit = new Toolkit({ ioHost: custom_io_host })

  try {
    const assembly = await toolkit.fromAssemblyBuilder(async () => {
      return app.synth()
    })

    await toolkit.destroy(assembly)

    logger.info(`LiveLambda bootstrap destroyed for "${formatted_app}-${formatted_stage}".`)
  } finally {
    custom_io_host.cleanup()
  }
}
