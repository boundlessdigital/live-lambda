import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Command } from 'commander'
import {
  APPSYNC_STACK_NAME,
  LAYER_STACK_NAME,
  OUTPUT_LIVE_LAMBDA_PROXY_LAYER_ARN,
  OUTPUT_EVENT_API_HTTP_HOST,
  OUTPUT_EVENT_API_REALTIME_HOST,
  CONTEXT_APP_NAME,
  CONTEXT_ENVIRONMENT,
  CONTEXT_APP_ID,
  compute_prefix,
  prefixed_stack_names
} from '../lib/constants.js'

// Use vi.hoisted() to ensure mock functions are available when mocks are evaluated
const {
  mock_deploy,
  mock_destroy,
  mock_watch,
  mock_list,
  mock_bootstrap,
  mock_from_cdk_app,
  mock_serve,
  mock_cleanup,
  mock_read_file_sync,
  mock_exists_sync,
  mock_chokidar_watch,
  mock_watcher_on,
  mock_logger,
  mock_clean_lambda_functions,
  mock_extract_region_from_arn,
  mock_keypress_start,
  mock_keypress_stop,
  mock_display_info,
  mock_display_stop
} = vi.hoisted(() => ({
  mock_deploy: vi.fn(),
  mock_destroy: vi.fn(),
  mock_watch: vi.fn(),
  mock_list: vi.fn(),
  mock_bootstrap: vi.fn(),
  mock_from_cdk_app: vi.fn(),
  mock_serve: vi.fn(),
  mock_cleanup: vi.fn(),
  mock_read_file_sync: vi.fn(),
  mock_exists_sync: vi.fn(),
  mock_chokidar_watch: vi.fn(),
  mock_watcher_on: vi.fn(),
  mock_logger: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    start: vi.fn(),
    warn: vi.fn()
  },
  mock_clean_lambda_functions: vi.fn(),
  mock_extract_region_from_arn: vi.fn(),
  mock_keypress_start: vi.fn(),
  mock_keypress_stop: vi.fn(),
  mock_display_info: vi.fn(),
  mock_display_stop: vi.fn()
}))

// Mock dependencies
vi.mock('@aws-cdk/toolkit-lib', () => {
  return {
    Toolkit: vi.fn().mockImplementation(function () {
      return {
        deploy: mock_deploy,
        destroy: mock_destroy,
        watch: mock_watch,
        list: mock_list,
        bootstrap: mock_bootstrap,
        fromCdkApp: mock_from_cdk_app
      }
    }),
    BootstrapEnvironments: {
      fromList: vi.fn().mockReturnValue('mock-environments')
    },
    StackSelectionStrategy: {
      PATTERN_MATCH: 'PATTERN_MATCH',
      ALL_STACKS: 'ALL_STACKS'
    }
  }
})

vi.mock('../server/index.js', () => {
  return {
    serve: mock_serve
  }
})

vi.mock('../cdk/toolkit/iohost.js', () => {
  return {
    CustomIoHost: vi.fn().mockImplementation(function () {
      return {
        cleanup: mock_cleanup,
        toggle_verbose: vi.fn()
      }
    })
  }
})

vi.mock('../lib/display/index.js', () => {
  return {
    SpinnerDisplay: vi.fn().mockImplementation(function () {
      return {
        start_operation: vi.fn(),
        update_operation: vi.fn(),
        complete_operation: vi.fn(),
        fail_operation: vi.fn(),
        info: mock_display_info,
        warn: vi.fn(),
        error: vi.fn(),
        line: vi.fn(),
        output: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
        stop: mock_display_stop
      }
    }),
    KeypressListener: vi.fn().mockImplementation(function () {
      return {
        start: mock_keypress_start,
        stop: mock_keypress_stop
      }
    })
  }
})

vi.mock('../lib/logger.js', () => {
  return {
    logger: mock_logger
  }
})

vi.mock('fs', () => {
  return {
    default: {
      readFileSync: mock_read_file_sync,
      existsSync: mock_exists_sync
    },
    readFileSync: mock_read_file_sync,
    existsSync: mock_exists_sync
  }
})

vi.mock('chokidar', () => {
  return {
    default: {
      watch: mock_chokidar_watch
    }
  }
})

vi.mock('./lambda_cleanup.js', () => {
  return {
    clean_lambda_functions: mock_clean_lambda_functions,
    extract_region_from_arn: mock_extract_region_from_arn
  }
})

// Import after mocks
import { main } from './main.js'
import * as toolkit_lib from '@aws-cdk/toolkit-lib'
import * as iohost_module from '../cdk/toolkit/iohost.js'

// Test constants for prefix computation
const TEST_APP_NAME = 'test-app'
const TEST_ENVIRONMENT = 'dev'
const TEST_PREFIX = compute_prefix(TEST_APP_NAME, TEST_ENVIRONMENT)
const TEST_STACK_NAMES = prefixed_stack_names(TEST_PREFIX)

describe('main', () => {
  const mock_assembly = { mockAssembly: true }
  let original_process_on: typeof process.on
  let sigint_handler: (() => Promise<void>) | null = null
  let sigterm_handler: (() => Promise<void>) | null = null

  function create_mock_command(name: string, opts: Record<string, any> = {}): Command {
    return {
      name: () => name,
      opts: () => opts
    } as unknown as Command
  }

  function create_mock_deployment(stacks: any[] = []) {
    return {
      stacks
    }
  }

  /** Create a mock stack entry for cdk.list() with proper id/name fields */
  function mock_stack(name: string, extra?: Record<string, any>) {
    // CDK displayName format: "hierarchicalId (stackName)" for Stage stacks
    const hierarchical_id = `${TEST_PREFIX}/${name}`
    const cf_name = `${TEST_PREFIX}-${name}`
    return { id: `${hierarchical_id} (${cf_name})`, name: cf_name, ...extra }
  }

  function create_default_cdk_json(
    app = 'npx ts-node app.ts',
    watch_config = { include: ['**/*.ts'] }
  ) {
    return JSON.stringify({
      app,
      watch: watch_config,
      context: {
        [CONTEXT_APP_NAME]: TEST_APP_NAME,
        [CONTEXT_ENVIRONMENT]: TEST_ENVIRONMENT
      }
    })
  }

  function create_valid_deployment() {
    return create_mock_deployment([
      {
        stackName: TEST_STACK_NAMES.appsync,
        environment: { region: 'us-east-1' },
        outputs: {
          [OUTPUT_EVENT_API_HTTP_HOST]: 'http-host',
          [OUTPUT_EVENT_API_REALTIME_HOST]: 'realtime-host'
        }
      },
      {
        stackName: TEST_STACK_NAMES.layer,
        outputs: {
          [OUTPUT_LIVE_LAMBDA_PROXY_LAYER_ARN]: 'arn:aws:lambda:us-east-1:123:layer:test:1'
        }
      }
    ])
  }

  beforeEach(() => {
    vi.clearAllMocks()

    // Capture signal handlers
    original_process_on = process.on
    sigint_handler = null
    sigterm_handler = null

    process.on = vi.fn((signal: string, handler: any) => {
      if (signal === 'SIGINT') sigint_handler = handler
      if (signal === 'SIGTERM') sigterm_handler = handler
      return process
    }) as any

    // Reset mock return values for chokidar
    mock_watcher_on.mockReturnValue({ on: vi.fn() })
    mock_chokidar_watch.mockReturnValue({ on: mock_watcher_on })

    // Default mock implementations
    mock_read_file_sync.mockReturnValue(create_default_cdk_json())
    mock_exists_sync.mockReturnValue(false)
    mock_from_cdk_app.mockResolvedValue(mock_assembly)
    mock_deploy.mockResolvedValue(create_mock_deployment())
    mock_destroy.mockResolvedValue(undefined)
    mock_watch.mockResolvedValue(undefined)
    mock_list.mockResolvedValue([mock_stack('MockStack', { environment: { account: '123456789012', region: 'us-east-1' } })])
    mock_bootstrap.mockResolvedValue(undefined)
    mock_serve.mockResolvedValue(undefined)
    mock_clean_lambda_functions.mockResolvedValue({ functions_scanned: 0, functions_cleaned: 0, errors: [] })
    mock_extract_region_from_arn.mockReturnValue('us-east-1')
  })

  afterEach(() => {
    process.on = original_process_on
  })

  describe('cdk.json configuration', () => {
    it('should read cdk.json configuration', async () => {
      const command = create_mock_command('dev')
      mock_deploy.mockResolvedValue(create_valid_deployment())

      await main(command)

      expect(mock_read_file_sync).toHaveBeenCalledWith('cdk.json', 'utf-8')
    })

    it('should parse app entrypoint from cdk.json', async () => {
      const custom_entrypoint = 'npx tsx custom-app.ts'
      mock_read_file_sync.mockReturnValue(
        JSON.stringify({
          app: custom_entrypoint,
          watch: {},
          context: {
            [CONTEXT_APP_NAME]: TEST_APP_NAME,
            [CONTEXT_ENVIRONMENT]: TEST_ENVIRONMENT
          }
        })
      )
      const command = create_mock_command('dev')
      mock_deploy.mockResolvedValue(create_valid_deployment())

      await main(command)

      expect(mock_from_cdk_app).toHaveBeenCalledWith(custom_entrypoint)
    })

    it('should report all missing context keys at once', async () => {
      mock_read_file_sync.mockReturnValue(
        JSON.stringify({ app: 'npx ts-node app.ts', watch: {}, context: {} })
      )
      const command = create_mock_command('dev')

      await main(command)

      const msg = mock_logger.error.mock.calls[0][0]
      expect(msg).toContain(CONTEXT_APP_NAME)
      expect(msg).toContain(CONTEXT_ENVIRONMENT)
      expect(msg).toContain(CONTEXT_APP_ID)
    })

    it('should show only the missing key when one is provided', async () => {
      mock_read_file_sync.mockReturnValue(
        JSON.stringify({
          app: 'npx ts-node app.ts',
          watch: {},
          context: { [CONTEXT_APP_NAME]: 'my-app' }
        })
      )
      const command = create_mock_command('dev')

      await main(command)

      const msg = mock_logger.error.mock.calls[0][0]
      expect(msg).toContain(CONTEXT_ENVIRONMENT)
      expect(msg).not.toContain(`Missing required context in cdk.json: ${CONTEXT_APP_NAME}`)
    })
  })

  describe('bootstrap command', () => {
    it('should deploy only internal stacks', async () => {
      const command = create_mock_command('bootstrap')

      await main(command)

      expect(mock_deploy).toHaveBeenCalledWith(mock_assembly, {
        stacks: {
          strategy: 'PATTERN_MATCH',
          patterns: TEST_STACK_NAMES.patterns
        },
        outputsFile: 'cdk.out/outputs.json',
        concurrency: 5,
        deploymentMethod: { method: 'change-set' }
      })
    })

    it('should not start server or watch', async () => {
      const command = create_mock_command('bootstrap')

      await main(command)

      expect(mock_serve).not.toHaveBeenCalled()
      expect(mock_watch).not.toHaveBeenCalled()
      expect(mock_chokidar_watch).not.toHaveBeenCalled()
    })

    it('should log bootstrap messages', async () => {
      const command = create_mock_command('bootstrap')

      await main(command)

      expect(mock_logger.info).toHaveBeenCalledWith('Deploying live-lambda infrastructure stacks...')
      expect(mock_logger.info).toHaveBeenCalledWith('Bootstrap complete. AppSync and Layer stacks deployed.')
    })
  })

  describe('dev command', () => {
    it('should deploy all stacks', async () => {
      const command = create_mock_command('dev')
      mock_deploy.mockResolvedValue(create_valid_deployment())

      await main(command)

      expect(mock_deploy).toHaveBeenCalledWith(mock_assembly, {
        stacks: { strategy: 'ALL_STACKS' },
        outputsFile: 'cdk.out/outputs.json',
        concurrency: 5,
        deploymentMethod: { method: 'change-set' }
      })
    })

    it('should start server after deployment', async () => {
      const command = create_mock_command('dev')
      mock_deploy.mockResolvedValue(
        create_mock_deployment([
          {
            stackName: TEST_STACK_NAMES.appsync,
            environment: { region: 'us-east-1' },
            outputs: {
              [OUTPUT_EVENT_API_HTTP_HOST]: 'http-host.appsync.aws',
              [OUTPUT_EVENT_API_REALTIME_HOST]: 'realtime-host.appsync.aws'
            }
          },
          {
            stackName: TEST_STACK_NAMES.layer,
            outputs: {
              [OUTPUT_LIVE_LAMBDA_PROXY_LAYER_ARN]:
                'arn:aws:lambda:us-east-1:123456789012:layer:LiveLambdaProxy:1'
            }
          }
        ])
      )

      await main(command)

      expect(mock_serve).toHaveBeenCalledWith(
        expect.objectContaining({
          region: 'us-east-1',
          http: 'http-host.appsync.aws',
          realtime: 'realtime-host.appsync.aws',
          layer_arn: 'arn:aws:lambda:us-east-1:123456789012:layer:LiveLambdaProxy:1',
          display: expect.any(Object)
        })
      )
    })

    it('should start watch mode after server starts', async () => {
      const watch_config = { include: ['**/*.ts'], exclude: ['node_modules'] }
      mock_read_file_sync.mockReturnValue(
        JSON.stringify({
          app: 'npx ts-node app.ts',
          watch: watch_config,
          context: {
            [CONTEXT_APP_NAME]: TEST_APP_NAME,
            [CONTEXT_ENVIRONMENT]: TEST_ENVIRONMENT
          }
        })
      )
      const command = create_mock_command('dev')
      mock_deploy.mockResolvedValue(create_valid_deployment())

      await main(command)

      expect(mock_watch).toHaveBeenCalledWith(mock_assembly, {
        concurrency: 5,
        deploymentMethod: { method: 'change-set' },
        outputsFile: 'cdk.out/outputs.json',
        ...watch_config
      })
    })

    it('should set up file watcher with chokidar', async () => {
      const command = create_mock_command('dev')
      mock_deploy.mockResolvedValue(create_valid_deployment())

      await main(command)

      expect(mock_chokidar_watch).toHaveBeenCalledWith('.', expect.any(Object))
    })
  })

  describe('destroy command', () => {
    it('should list all stacks to find consumer stacks', async () => {
      const command = create_mock_command('destroy')
      mock_list.mockResolvedValue([
        mock_stack(APPSYNC_STACK_NAME),
        mock_stack(LAYER_STACK_NAME),
        mock_stack('ConsumerStack')
      ])

      await main(command)

      expect(mock_list).toHaveBeenCalledWith(mock_assembly, {
        stacks: { strategy: 'ALL_STACKS' }
      })
    })

    it('should destroy only consumer stacks using hierarchical IDs', async () => {
      const command = create_mock_command('destroy')
      mock_list.mockResolvedValue([
        mock_stack(APPSYNC_STACK_NAME),
        mock_stack(LAYER_STACK_NAME),
        mock_stack('WebLambda'),
        mock_stack('QueueStack')
      ])

      await main(command)

      expect(mock_destroy).toHaveBeenCalledWith(mock_assembly, {
        stacks: {
          strategy: 'PATTERN_MATCH',
          patterns: [`${TEST_PREFIX}/WebLambda`, `${TEST_PREFIX}/QueueStack`]
        }
      })
    })

    it('should not destroy internal stacks', async () => {
      const command = create_mock_command('destroy')
      mock_list.mockResolvedValue([
        mock_stack(APPSYNC_STACK_NAME),
        mock_stack(LAYER_STACK_NAME),
        mock_stack('ConsumerStack')
      ])

      await main(command)

      const destroy_call = mock_destroy.mock.calls[0]
      const patterns = destroy_call[1].stacks.patterns
      expect(patterns).not.toContain(expect.stringContaining(APPSYNC_STACK_NAME))
      expect(patterns).not.toContain(expect.stringContaining(LAYER_STACK_NAME))
    })

    it('should log and skip when no consumer stacks exist', async () => {
      const command = create_mock_command('destroy')
      mock_list.mockResolvedValue([
        mock_stack(APPSYNC_STACK_NAME),
        mock_stack(LAYER_STACK_NAME)
      ])

      await main(command)

      expect(mock_destroy).not.toHaveBeenCalled()
      expect(mock_logger.info).toHaveBeenCalledWith('No consumer stacks to destroy.')
    })

    it('should not deploy or start server', async () => {
      const command = create_mock_command('destroy')
      mock_list.mockResolvedValue([mock_stack('ConsumerStack')])

      await main(command)

      expect(mock_deploy).not.toHaveBeenCalled()
      expect(mock_serve).not.toHaveBeenCalled()
    })
  })

  describe('uninstall command', () => {
    it('should clean lambda functions using layer ARN from outputs.json', async () => {
      const command = create_mock_command('uninstall')
      mock_exists_sync.mockReturnValue(true)
      mock_read_file_sync.mockImplementation((path: string) => {
        if (path === 'cdk.json') return create_default_cdk_json()
        // outputs.json read via resolve_layer_arn
        return JSON.stringify({
          [TEST_STACK_NAMES.layer]: {
            [OUTPUT_LIVE_LAMBDA_PROXY_LAYER_ARN]: 'arn:aws:lambda:us-west-1:123:layer:live-lambda-proxy:5'
          }
        })
      })
      mock_extract_region_from_arn.mockReturnValue('us-west-1')

      await main(command)

      expect(mock_extract_region_from_arn).toHaveBeenCalledWith('arn:aws:lambda:us-west-1:123:layer:live-lambda-proxy:5')
      expect(mock_clean_lambda_functions).toHaveBeenCalledWith('us-west-1', 'arn:aws:lambda:us-west-1:123:layer:live-lambda-proxy:5')
    })

    it('should skip cleanup and warn when outputs.json is missing', async () => {
      const command = create_mock_command('uninstall')
      mock_exists_sync.mockReturnValue(false)

      await main(command)

      expect(mock_clean_lambda_functions).not.toHaveBeenCalled()
      expect(mock_logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Could not determine layer ARN')
      )
    })

    it('should skip cleanup with --skip-cleanup flag', async () => {
      const command = create_mock_command('uninstall', { skipCleanup: true })

      await main(command)

      expect(mock_clean_lambda_functions).not.toHaveBeenCalled()
    })

    it('should only destroy internal stacks, not consumer stacks', async () => {
      const command = create_mock_command('uninstall', { skipCleanup: true })

      await main(command)

      expect(mock_destroy).toHaveBeenCalledTimes(1)
      expect(mock_destroy).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          stacks: {
            strategy: 'PATTERN_MATCH',
            patterns: TEST_STACK_NAMES.patterns
          }
        })
      )
    })

    it('should log uninstall complete', async () => {
      const command = create_mock_command('uninstall', { skipCleanup: true })

      await main(command)

      expect(mock_logger.info).toHaveBeenCalledWith('Uninstall complete.')
    })
  })

  describe('server config extraction', () => {
    it('should extract server config from deployment outputs', async () => {
      const command = create_mock_command('dev')
      mock_deploy.mockResolvedValue(
        create_mock_deployment([
          {
            stackName: TEST_STACK_NAMES.appsync,
            environment: { region: 'eu-west-1' },
            outputs: {
              [OUTPUT_EVENT_API_HTTP_HOST]: 'abc123.appsync-api.eu-west-1.amazonaws.com',
              [OUTPUT_EVENT_API_REALTIME_HOST]: 'abc123.appsync-realtime.eu-west-1.amazonaws.com'
            }
          },
          {
            stackName: TEST_STACK_NAMES.layer,
            outputs: {
              [OUTPUT_LIVE_LAMBDA_PROXY_LAYER_ARN]:
                'arn:aws:lambda:eu-west-1:123456789012:layer:LiveLambdaProxy:5'
            }
          }
        ])
      )

      await main(command)

      expect(mock_serve).toHaveBeenCalledWith(
        expect.objectContaining({
          region: 'eu-west-1',
          http: 'abc123.appsync-api.eu-west-1.amazonaws.com',
          realtime: 'abc123.appsync-realtime.eu-west-1.amazonaws.com',
          layer_arn: 'arn:aws:lambda:eu-west-1:123456789012:layer:LiveLambdaProxy:5',
          display: expect.any(Object)
        })
      )
    })

    it('should throw ServerConfigError when AppSync stack outputs are missing', async () => {
      const command = create_mock_command('dev')
      mock_deploy.mockResolvedValue(
        create_mock_deployment([
          { stackName: TEST_STACK_NAMES.appsync, environment: { region: 'us-east-1' }, outputs: {} },
          { stackName: TEST_STACK_NAMES.layer, outputs: {} }
        ])
      )

      await main(command)

      expect(mock_logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Missing required stack outputs')
      )
      expect(mock_serve).not.toHaveBeenCalled()
    })

    it('should throw ServerConfigError when stacks are missing from deployment', async () => {
      const command = create_mock_command('dev')
      mock_deploy.mockResolvedValue(create_mock_deployment([]))

      await main(command)

      expect(mock_logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Missing required stacks')
      )
      expect(mock_serve).not.toHaveBeenCalled()
    })

    it('should list all missing stacks in error message', async () => {
      const command = create_mock_command('dev')
      mock_deploy.mockResolvedValue(create_mock_deployment([]))

      await main(command)

      expect(mock_logger.error).toHaveBeenCalledWith(
        expect.stringMatching(new RegExp(`${APPSYNC_STACK_NAME}.*${LAYER_STACK_NAME}|${LAYER_STACK_NAME}.*${APPSYNC_STACK_NAME}`))
      )
    })

    it('should list all missing outputs in error message', async () => {
      const command = create_mock_command('dev')
      mock_deploy.mockResolvedValue(
        create_mock_deployment([
          {
            stackName: TEST_STACK_NAMES.appsync,
            environment: { region: 'us-east-1' },
            outputs: { [OUTPUT_EVENT_API_HTTP_HOST]: 'http-host' }
          },
          { stackName: TEST_STACK_NAMES.layer, outputs: {} }
        ])
      )

      await main(command)

      const error_msg = mock_logger.error.mock.calls.find(
        (call: any[]) => typeof call[0] === 'string' && call[0].includes('Missing required')
      )
      expect(error_msg).toBeDefined()
      expect(error_msg![0]).toContain(OUTPUT_EVENT_API_REALTIME_HOST)
      expect(error_msg![0]).toContain(OUTPUT_LIVE_LAMBDA_PROXY_LAYER_ARN)
    })
  })

  describe('error handling', () => {
    it('should handle deployment errors gracefully', async () => {
      const command = create_mock_command('dev')
      const deployment_error = new Error('Deployment failed')
      mock_deploy.mockRejectedValueOnce(deployment_error)

      await main(command)

      expect(mock_logger.error).toHaveBeenCalledWith(
        'An unexpected error occurred:',
        deployment_error
      )
    })

    it('should handle cdk.json read errors', async () => {
      const command = create_mock_command('dev')
      const read_error = new Error('ENOENT: no such file or directory')
      mock_read_file_sync.mockImplementation(() => { throw read_error })

      await main(command)

      expect(mock_logger.error).toHaveBeenCalledWith(
        'An unexpected error occurred:',
        read_error
      )
    })

    it('should handle invalid cdk.json format', async () => {
      const command = create_mock_command('dev')
      mock_read_file_sync.mockReturnValue('invalid json {')

      await main(command)

      expect(mock_logger.error).toHaveBeenCalledWith(
        'An unexpected error occurred:',
        expect.any(SyntaxError)
      )
    })

    it('should call cleanup even after errors', async () => {
      const command = create_mock_command('dev')
      mock_read_file_sync.mockImplementation(() => { throw new Error('Read error') })

      await main(command)

      expect(mock_cleanup).toHaveBeenCalled()
    })

    it('should handle watch errors gracefully', async () => {
      const command = create_mock_command('dev')
      const watch_error = new Error('Watch mode failed')
      mock_deploy.mockResolvedValue(create_valid_deployment())
      mock_watch.mockRejectedValue(watch_error)

      await main(command)

      expect(mock_logger.error).toHaveBeenCalledWith(
        'An unexpected error occurred:',
        watch_error
      )
    })
  })

  describe('signal handlers', () => {
    it('should register SIGINT handler', async () => {
      const command = create_mock_command('bootstrap')
      await main(command)

      expect(process.on).toHaveBeenCalledWith('SIGINT', expect.any(Function))
      expect(sigint_handler).not.toBeNull()
    })

    it('should register SIGTERM handler', async () => {
      const command = create_mock_command('bootstrap')
      await main(command)

      expect(process.on).toHaveBeenCalledWith('SIGTERM', expect.any(Function))
      expect(sigterm_handler).not.toBeNull()
    })

    it('should cleanup on SIGINT', async () => {
      const command = create_mock_command('bootstrap')
      const mock_exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

      await main(command)
      if (sigint_handler) await sigint_handler()

      expect(mock_cleanup).toHaveBeenCalled()
      expect(mock_exit).toHaveBeenCalledWith(0)
      mock_exit.mockRestore()
    })

    it('should cleanup on SIGTERM', async () => {
      const command = create_mock_command('bootstrap')
      const mock_exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

      await main(command)
      if (sigterm_handler) await sigterm_handler()

      expect(mock_cleanup).toHaveBeenCalled()
      expect(mock_exit).toHaveBeenCalledWith(0)
      mock_exit.mockRestore()
    })
  })

  describe('unknown commands', () => {
    it('should not call deploy or destroy for unknown commands', async () => {
      const command = create_mock_command('unknown')

      await main(command)

      expect(mock_deploy).not.toHaveBeenCalled()
      expect(mock_destroy).not.toHaveBeenCalled()
      expect(mock_serve).not.toHaveBeenCalled()
    })
  })

  describe('Toolkit initialization', () => {
    it('should create Toolkit with CustomIoHost', async () => {
      const { Toolkit } = toolkit_lib
      const { CustomIoHost } = iohost_module
      const command = create_mock_command('bootstrap')

      await main(command)

      expect(CustomIoHost).toHaveBeenCalled()
      expect(Toolkit).toHaveBeenCalledWith({ ioHost: expect.any(Object) })
    })
  })

  describe('cleanup', () => {
    it('should always call cleanup in finally block', async () => {
      const command = create_mock_command('bootstrap')
      await main(command)
      expect(mock_cleanup).toHaveBeenCalled()
    })

    it('should stop keypress listener on cleanup', async () => {
      const command = create_mock_command('bootstrap')
      const mock_exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

      await main(command)
      if (sigint_handler) await sigint_handler()

      expect(mock_keypress_stop).toHaveBeenCalled()
      expect(mock_cleanup).toHaveBeenCalled()
      mock_exit.mockRestore()
    })
  })
})
