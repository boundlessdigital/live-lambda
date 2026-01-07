import { Command } from 'commander'
import * as fs from 'fs'
import { main } from './main.js'
import {
  bootstrap,
  destroy_bootstrap,
  check_bootstrap_status,
  get_bootstrap_config
} from './bootstrap.js'
import { set_log_level, LOG_LEVELS, logger } from '../lib/logger.js'
import {
  format_app_name,
  format_stage,
  get_default_ssm_prefix
} from '../lib/constants.js'

const program = new Command()

/**
 * Get app_name from options or cdk.json context
 */
function get_app_name(options: { app?: string }): string {
  if (options.app) {
    return options.app
  }

  // Try to read from cdk.json context
  try {
    const cdk_json = JSON.parse(fs.readFileSync('cdk.json', 'utf-8'))
    const app_name = cdk_json.context?.['live-lambda:app-name']
    if (app_name) {
      return app_name
    }
  } catch {
    // Ignore - cdk.json may not exist or be readable
  }

  throw new Error(
    'App name is required. Provide --app <name> or set "live-lambda:app-name" in cdk.json context.'
  )
}

/**
 * Get stage from options or cdk.json context
 */
function get_stage(options: { stage?: string }): string {
  if (options.stage) {
    return options.stage
  }

  // Try to read from cdk.json context
  try {
    const cdk_json = JSON.parse(fs.readFileSync('cdk.json', 'utf-8'))
    const stage = cdk_json.context?.['live-lambda:stage']
    if (stage) {
      return stage
    }
  } catch {
    // Ignore - cdk.json may not exist or be readable
  }

  throw new Error(
    'Stage is required. Provide --stage <stage> or set "live-lambda:stage" in cdk.json context.'
  )
}

/**
 * Validate and format app_name and stage
 */
function validate_config(app_name: string, stage: string): {
  formatted_app: string
  formatted_stage: string
  ssm_prefix: string
} {
  const formatted_app = format_app_name(app_name)
  const formatted_stage = format_stage(stage)

  if (!formatted_app) {
    throw new Error(
      `Invalid app name: "${app_name}". Must contain at least one alphanumeric character.`
    )
  }

  if (!formatted_stage) {
    throw new Error(
      `Invalid stage: "${stage}". Must contain at least one alphanumeric character.`
    )
  }

  const ssm_prefix = get_default_ssm_prefix(app_name, stage)

  return { formatted_app, formatted_stage, ssm_prefix }
}

program
  .name('live-lambda')
  .version('1.0.0')
  .description('Live Lambda CLI for serverless development')
  .option('-v, --verbose', 'Enable verbose logging (debug level)')
  .option('-q, --quiet', 'Suppress most output (warn level only)')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts()
    if (opts.verbose) {
      set_log_level(LOG_LEVELS.debug)
    } else if (opts.quiet) {
      set_log_level(LOG_LEVELS.warn)
    }
  })

program
  .command('bootstrap')
  .description(
    'Bootstrap LiveLambda infrastructure (AppSync API and Lambda Layer)'
  )
  .requiredOption('-a, --app <name>', 'Application name for infrastructure isolation')
  .requiredOption('-s, --stage <stage>', 'Deployment stage (e.g., dev, staging, prod)')
  .requiredOption('-r, --region <region>', 'AWS region to bootstrap')
  .option('-f, --force', 'Force redeployment even if already bootstrapped')
  .action(async (options) => {
    const app_name = get_app_name(options)
    const stage = get_stage(options)
    validate_config(app_name, stage)

    await bootstrap({
      region: options.region,
      app_name,
      stage,
      force: options.force
    })
  })

program
  .command('status')
  .description('Check LiveLambda bootstrap status')
  .requiredOption('-a, --app <name>', 'Application name')
  .requiredOption('-s, --stage <stage>', 'Deployment stage')
  .requiredOption('-r, --region <region>', 'AWS region to check')
  .action(async (options) => {
    const app_name = get_app_name(options)
    const stage = get_stage(options)
    const { formatted_app, formatted_stage, ssm_prefix } = validate_config(app_name, stage)

    const status = await check_bootstrap_status(options.region, ssm_prefix)

    if (!status.is_bootstrapped) {
      logger.info(`LiveLambda is NOT bootstrapped for "${formatted_app}-${formatted_stage}" in ${options.region}`)
      logger.info(`Run 'live-lambda bootstrap --app ${app_name} --stage ${stage} --region ${options.region}' to set up.`)
      return
    }

    logger.info(`LiveLambda bootstrap status for "${formatted_app}-${formatted_stage}" in ${options.region}:`)
    logger.info(`  Bootstrapped: yes`)
    logger.info(`  Version: ${status.version}`)

    if (status.needs_upgrade) {
      logger.info(`  Upgrade available: yes`)
      logger.info(
        `  Run 'live-lambda bootstrap --app ${app_name} --stage ${stage} --region ${options.region} --force' to upgrade.`
      )
    }

    try {
      const config = await get_bootstrap_config(options.region, ssm_prefix)
      logger.info(`  API ARN: ${config.api_arn}`)
      logger.info(`  HTTP Host: ${config.http_host}`)
      logger.info(`  Realtime Host: ${config.realtime_host}`)
      logger.info(`  Layer ARN: ${config.layer_arn}`)
    } catch (error) {
      logger.warn(`  Config incomplete - run bootstrap to fix`)
    }
  })

program
  .command('destroy-bootstrap')
  .description('Destroy LiveLambda bootstrap infrastructure')
  .requiredOption('-a, --app <name>', 'Application name')
  .requiredOption('-s, --stage <stage>', 'Deployment stage')
  .requiredOption('-r, --region <region>', 'AWS region')
  .action(async (options) => {
    const app_name = get_app_name(options)
    const stage = get_stage(options)
    validate_config(app_name, stage)

    await destroy_bootstrap({
      region: options.region,
      app_name,
      stage
    })
  })

program
  .command('start')
  .description('Starts the development server')
  .requiredOption('-a, --app <name>', 'Application name for infrastructure isolation')
  .requiredOption('-s, --stage <stage>', 'Deployment stage')
  .option(
    '--no-auto-bootstrap',
    'Disable automatic bootstrapping if not already done'
  )
  .action(async function (this: Command) {
    await main(this)
  })

program
  .command('destroy')
  .description('Destroys the user development stacks (not bootstrap infrastructure)')
  .action(async function (this: Command) {
    await main(this)
  })

program.parse(process.argv)
