import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as cdk from 'aws-cdk-lib'
import { Template, Match } from 'aws-cdk-lib/assertions'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import {
  LiveLambdaLayerAspect,
  LiveLambdaLayerAspectProps
} from './live-lambda-layer.aspect.js'
import {
  ENV_LAMBDA_EXEC_WRAPPER,
  ENV_LRAP_LISTENER_PORT,
  ENV_EXTENSION_NAME
} from '../../lib/constants.js'

describe('LiveLambdaLayerAspect', () => {
  let temp_entry_dir: string
  let entry_file_path: string

  beforeAll(() => {
    // Create a temp directory with a simple TypeScript entry point for NodejsFunction
    temp_entry_dir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'live-lambda-entry-test-')
    )
    entry_file_path = path.join(temp_entry_dir, 'handler.ts')
    fs.writeFileSync(
      entry_file_path,
      `export const handler = async () => ({ statusCode: 200, body: 'OK' })`
    )
  })

  afterAll(() => {
    // Clean up temp directories
    if (temp_entry_dir) {
      fs.rmSync(temp_entry_dir, { recursive: true, force: true })
    }
  })

  /**
   * Helper to create a test setup with all necessary CDK constructs.
   * The aspect now reads configuration from SSM parameters, so no layer_stack or api needed.
   */
  function create_test_setup(options?: {
    stack_name?: string
    function_id?: string
    include_patterns?: string[]
    exclude_patterns?: string[]
    developer_principal_arns?: string[]
  }) {
    const app = new cdk.App()
    const env = { account: '123456789012', region: 'us-east-1' }

    // Create application stack with NodejsFunction
    const stack_name = options?.stack_name ?? 'TestAppStack'
    const app_stack = new cdk.Stack(app, stack_name, { env })

    const function_id = options?.function_id ?? 'TestFunction'
    const test_function = new NodejsFunction(app_stack, function_id, {
      entry: entry_file_path,
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X
    })

    // Create and apply aspect - it reads from SSM parameters
    const aspect_props: LiveLambdaLayerAspectProps = {
      ssm_prefix: '/live-lambda/test-app/dev',
      stack_prefix: 'test-app-dev-',
      include_patterns: options?.include_patterns,
      exclude_patterns: options?.exclude_patterns,
      developer_principal_arns: options?.developer_principal_arns
    }

    const aspect = new LiveLambdaLayerAspect(aspect_props)
    cdk.Aspects.of(app).add(aspect)

    // Synthesize to trigger aspects
    app.synth()

    const template = Template.fromStack(app_stack)

    return {
      app,
      app_stack,
      test_function,
      aspect,
      template
    }
  }

  describe('Layer configuration', () => {
    it('should add layer to NodejsFunction', () => {
      const { template } = create_test_setup()

      // Verify that the function has layers configured
      template.hasResourceProperties('AWS::Lambda::Function', {
        Layers: Match.anyValue()
      })
    })
  })

  describe('IAM permissions', () => {
    it('should add AppSync IAM permissions', () => {
      const { template } = create_test_setup()

      // Verify IAM policy with AppSync permissions
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: Match.arrayWith([
                'appsync:EventConnect',
                'appsync:EventPublish',
                'appsync:EventSubscribe'
              ]),
              Effect: 'Allow'
            })
          ])
        }
      })
    })

    it('should add trust relationship for role assumption', () => {
      const { template } = create_test_setup()

      // Verify IAM role has assume role policy with account root principal
      template.hasResourceProperties('AWS::IAM::Role', {
        AssumeRolePolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: 'sts:AssumeRole',
              Effect: 'Allow',
              Principal: {
                AWS: Match.anyValue()
              }
            })
          ])
        }
      })
    })

    it('should add developer principal ARNs when provided', () => {
      const developer_arn = 'arn:aws:iam::999999999999:user/developer'
      const { template } = create_test_setup({
        developer_principal_arns: [developer_arn]
      })

      // Verify IAM role has assume role policy with developer principal
      template.hasResourceProperties('AWS::IAM::Role', {
        AssumeRolePolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: 'sts:AssumeRole',
              Effect: 'Allow',
              Principal: {
                AWS: developer_arn
              }
            })
          ])
        }
      })
    })
  })

  describe('Environment variables', () => {
    it('should set AWS_LAMBDA_EXEC_WRAPPER env var to /opt/live-lambda-runtime-wrapper.sh', () => {
      const { template } = create_test_setup()

      template.hasResourceProperties('AWS::Lambda::Function', {
        Environment: {
          Variables: Match.objectLike({
            AWS_LAMBDA_EXEC_WRAPPER: ENV_LAMBDA_EXEC_WRAPPER
          })
        }
      })
    })

    it('should set LRAP_LISTENER_PORT env var to 8082', () => {
      const { template } = create_test_setup()

      template.hasResourceProperties('AWS::Lambda::Function', {
        Environment: {
          Variables: Match.objectLike({
            LRAP_LISTENER_PORT: ENV_LRAP_LISTENER_PORT
          })
        }
      })
    })

    it('should set AWS_LAMBDA_EXTENSION_NAME env var', () => {
      const { template } = create_test_setup()

      template.hasResourceProperties('AWS::Lambda::Function', {
        Environment: {
          Variables: Match.objectLike({
            AWS_LAMBDA_EXTENSION_NAME: ENV_EXTENSION_NAME
          })
        }
      })
    })

    it('should set AppSync environment variables', () => {
      const { template } = create_test_setup()

      template.hasResourceProperties('AWS::Lambda::Function', {
        Environment: {
          Variables: Match.objectLike({
            LIVE_LAMBDA_APPSYNC_REGION: Match.anyValue(),
            LIVE_LAMBDA_APPSYNC_REALTIME_HOST: Match.anyValue(),
            LIVE_LAMBDA_APPSYNC_HTTP_HOST: Match.anyValue()
          })
        }
      })
    })
  })

  describe('CloudFormation outputs', () => {
    it('should create function ARN output', () => {
      const { template } = create_test_setup()

      template.hasOutput('TestFunctionArn', {
        Description: Match.stringLikeRegexp('ARN of the Lambda function')
      })
    })

    it('should create role ARN output', () => {
      const { template } = create_test_setup()

      template.hasOutput('TestFunctionRoleArn', {
        Description: Match.stringLikeRegexp(
          'ARN of the execution role for Lambda function'
        )
      })
    })

    it('should create handler output', () => {
      const { template } = create_test_setup()

      template.hasOutput('TestFunctionHandler', {
        Description: Match.stringLikeRegexp('Handler string for function')
      })
    })

    it('should have export names for outputs', () => {
      const { template } = create_test_setup()

      template.hasOutput('TestFunctionArn', {
        Export: {
          Name: 'TestAppStack-TestFunction-FunctionArn'
        }
      })

      template.hasOutput('TestFunctionRoleArn', {
        Export: {
          Name: 'TestAppStack-TestFunction-RoleArn'
        }
      })
    })
  })

  describe('Function skipping logic', () => {
    /**
     * Helper to create a test app with a function that should be skipped.
     * Returns the synthesized template for verification.
     */
    function create_skip_test_setup(options: {
      stack_name: string
      function_id: string
    }) {
      const app = new cdk.App()
      const env = { account: '123456789012', region: 'us-east-1' }

      const target_stack = new cdk.Stack(app, options.stack_name, { env })
      new NodejsFunction(target_stack, options.function_id, {
        entry: entry_file_path,
        handler: 'handler',
        runtime: lambda.Runtime.NODEJS_20_X
      })

      const aspect = new LiveLambdaLayerAspect({
        ssm_prefix: '/live-lambda/test-app/dev',
        stack_prefix: 'test-app-dev-'
      })
      cdk.Aspects.of(app).add(aspect)

      app.synth()

      return Template.fromStack(target_stack)
    }

    /**
     * Verifies that a function exists but was NOT processed by the aspect
     * (i.e., doesn't have the live-lambda environment variables)
     */
    function assert_function_skipped(template: Template) {
      const functions = template.findResources('AWS::Lambda::Function')
      const function_keys = Object.keys(functions)
      expect(function_keys.length).toBe(1)

      const fn = functions[function_keys[0]]
      const env_vars = fn.Properties?.Environment?.Variables
      expect(env_vars?.AWS_LAMBDA_EXEC_WRAPPER).toBeUndefined()
    }

    // Parameterized tests for stack-based skip scenarios
    const stack_skip_scenarios = [
      {
        scenario: 'LiveLambda AppSync bootstrap stacks',
        stack_name: 'test-app-dev-LiveLambdaAppSyncStack',
        function_id: 'SkippedFunction'
      },
      {
        scenario: 'LiveLambda Layer bootstrap stacks',
        stack_name: 'test-app-dev-LiveLambdaLayerStack',
        function_id: 'SkippedFunction'
      },
      {
        scenario: 'SSTBootstrap stacks',
        stack_name: 'SSTBootstrapStack',
        function_id: 'SSTFunction'
      },
      {
        scenario: 'CDKToolkit stacks',
        stack_name: 'CDKToolkitStack',
        function_id: 'CDKToolkitFunction'
      }
    ]

    it.each(stack_skip_scenarios)(
      'should skip functions in $scenario',
      ({ stack_name, function_id }) => {
        const template = create_skip_test_setup({ stack_name, function_id })
        assert_function_skipped(template)
      }
    )

    // Parameterized tests for function name-based skip scenarios
    const function_skip_scenarios = [
      {
        scenario: 'CustomResourceHandler functions',
        function_id: 'CustomResourceHandler'
      },
      {
        scenario: 'LogRetention functions',
        function_id: 'LogRetentionHandler'
      },
      {
        scenario: 'SingletonLambda functions',
        function_id: 'SingletonLambdaFunction'
      },
      {
        scenario: 'Provider functions',
        function_id: 'ProviderframeworkonEvent'
      }
    ]

    it.each(function_skip_scenarios)(
      'should skip $scenario',
      ({ function_id }) => {
        const template = create_skip_test_setup({
          stack_name: 'AppStack',
          function_id
        })
        assert_function_skipped(template)
      }
    )
  })

  describe('Include/Exclude patterns', () => {
    it('should process functions matching include patterns', () => {
      const { template } = create_test_setup({
        function_id: 'ApiHandler',
        include_patterns: ['ApiHandler']
      })

      // Function should be processed (has the env var)
      template.hasResourceProperties('AWS::Lambda::Function', {
        Environment: {
          Variables: Match.objectLike({
            AWS_LAMBDA_EXEC_WRAPPER: ENV_LAMBDA_EXEC_WRAPPER
          })
        }
      })
    })

    it('should skip functions not matching include patterns', () => {
      const app = new cdk.App()
      const env = { account: '123456789012', region: 'us-east-1' }

      const app_stack = new cdk.Stack(app, 'AppStack', { env })
      new NodejsFunction(app_stack, 'OtherFunction', {
        entry: entry_file_path,
        handler: 'handler',
        runtime: lambda.Runtime.NODEJS_20_X
      })

      const aspect = new LiveLambdaLayerAspect({
        ssm_prefix: '/live-lambda/test-app/dev',
        stack_prefix: 'test-app-dev-',
        include_patterns: ['ApiHandler', 'ProcessorFunction'] // OtherFunction not in list
      })
      cdk.Aspects.of(app).add(aspect)

      app.synth()

      const template = Template.fromStack(app_stack)

      // Verify that the function exists but does NOT have live-lambda env vars
      const functions = template.findResources('AWS::Lambda::Function')
      const function_keys = Object.keys(functions)
      expect(function_keys.length).toBe(1)

      const fn = functions[function_keys[0]]
      const env_vars = fn.Properties?.Environment?.Variables
      expect(env_vars?.AWS_LAMBDA_EXEC_WRAPPER).toBeUndefined()
    })

    it('should process all functions when no include patterns specified', () => {
      const { template } = create_test_setup({
        function_id: 'RandomFunction'
        // No include_patterns
      })

      // Function should be processed
      template.hasResourceProperties('AWS::Lambda::Function', {
        Environment: {
          Variables: Match.objectLike({
            AWS_LAMBDA_EXEC_WRAPPER: ENV_LAMBDA_EXEC_WRAPPER
          })
        }
      })
    })

    it('should skip functions matching exclude patterns', () => {
      const app = new cdk.App()
      const env = { account: '123456789012', region: 'us-east-1' }

      const app_stack = new cdk.Stack(app, 'AppStack', { env })
      new NodejsFunction(app_stack, 'AdminHandler', {
        entry: entry_file_path,
        handler: 'handler',
        runtime: lambda.Runtime.NODEJS_20_X
      })

      const aspect = new LiveLambdaLayerAspect({
        ssm_prefix: '/live-lambda/test-app/dev',
        stack_prefix: 'test-app-dev-',
        exclude_patterns: ['Admin'] // AdminHandler matches this
      })
      cdk.Aspects.of(app).add(aspect)

      app.synth()

      const template = Template.fromStack(app_stack)

      // Verify that the function exists but does NOT have live-lambda env vars
      const functions = template.findResources('AWS::Lambda::Function')
      const function_keys = Object.keys(functions)
      expect(function_keys.length).toBe(1)

      const fn = functions[function_keys[0]]
      const env_vars = fn.Properties?.Environment?.Variables
      expect(env_vars?.AWS_LAMBDA_EXEC_WRAPPER).toBeUndefined()
    })

    it('should process functions not matching exclude patterns', () => {
      const { template } = create_test_setup({
        function_id: 'PublicApiHandler',
        exclude_patterns: ['Admin', 'Internal']
      })

      // Function should be processed (PublicApiHandler doesn't match Admin or Internal)
      template.hasResourceProperties('AWS::Lambda::Function', {
        Environment: {
          Variables: Match.objectLike({
            AWS_LAMBDA_EXEC_WRAPPER: ENV_LAMBDA_EXEC_WRAPPER
          })
        }
      })
    })

    it('should combine include and exclude patterns correctly', () => {
      const app = new cdk.App()
      const env = { account: '123456789012', region: 'us-east-1' }

      const app_stack = new cdk.Stack(app, 'AppStack', { env })

      // Create multiple functions
      new NodejsFunction(app_stack, 'ApiHandler', {
        entry: entry_file_path,
        handler: 'handler',
        runtime: lambda.Runtime.NODEJS_20_X
      })

      new NodejsFunction(app_stack, 'ApiAdminHandler', {
        entry: entry_file_path,
        handler: 'handler',
        runtime: lambda.Runtime.NODEJS_20_X
      })

      new NodejsFunction(app_stack, 'WorkerFunction', {
        entry: entry_file_path,
        handler: 'handler',
        runtime: lambda.Runtime.NODEJS_20_X
      })

      const aspect = new LiveLambdaLayerAspect({
        ssm_prefix: '/live-lambda/test-app/dev',
        stack_prefix: 'test-app-dev-',
        include_patterns: ['Api'], // Include functions with Api
        exclude_patterns: ['Admin'] // But exclude Admin functions
      })
      cdk.Aspects.of(app).add(aspect)

      app.synth()

      const template = Template.fromStack(app_stack)

      const functions = template.findResources('AWS::Lambda::Function')

      // Find each function and check its configuration
      let api_handler_processed = false
      let api_admin_handler_processed = false
      let worker_function_processed = false

      for (const [, fn] of Object.entries(functions)) {
        const env_vars = (fn as any).Properties?.Environment?.Variables
        const has_wrapper = env_vars?.AWS_LAMBDA_EXEC_WRAPPER === ENV_LAMBDA_EXEC_WRAPPER

        // We can identify functions by their handler output or other unique properties
        // Since all use same handler, check the wrapper status
        if (has_wrapper) {
          // Only ApiHandler should be processed (matches Api, doesn't match Admin)
          api_handler_processed = true
        }
      }

      // At least one function should be processed
      expect(api_handler_processed).toBe(true)

      // Verify outputs - only ApiHandler should have outputs
      template.hasOutput('ApiHandlerArn', {})

      // ApiAdminHandler and WorkerFunction should NOT have outputs
      const outputs = template.toJSON().Outputs
      expect(outputs['ApiAdminHandlerArn']).toBeUndefined()
      expect(outputs['WorkerFunctionArn']).toBeUndefined()
    })
  })

  describe('Multiple functions', () => {
    it('should process multiple NodejsFunctions in the same stack', () => {
      const app = new cdk.App()
      const env = { account: '123456789012', region: 'us-east-1' }

      const app_stack = new cdk.Stack(app, 'AppStack', { env })

      new NodejsFunction(app_stack, 'Function1', {
        entry: entry_file_path,
        handler: 'handler',
        runtime: lambda.Runtime.NODEJS_20_X
      })

      new NodejsFunction(app_stack, 'Function2', {
        entry: entry_file_path,
        handler: 'handler',
        runtime: lambda.Runtime.NODEJS_20_X
      })

      const aspect = new LiveLambdaLayerAspect({
        ssm_prefix: '/live-lambda/test-app/dev',
        stack_prefix: 'test-app-dev-'
      })
      cdk.Aspects.of(app).add(aspect)

      app.synth()

      const template = Template.fromStack(app_stack)

      // Both functions should have the env vars
      const functions = template.findResources('AWS::Lambda::Function')
      const function_keys = Object.keys(functions)

      expect(function_keys.length).toBe(2)

      // Verify each function has the required environment variables
      for (const key of function_keys) {
        const fn = functions[key]
        expect(fn.Properties.Environment.Variables.AWS_LAMBDA_EXEC_WRAPPER).toBe(
          '/opt/live-lambda-runtime-wrapper.sh'
        )
        expect(fn.Properties.Environment.Variables.LRAP_LISTENER_PORT).toBe(
          '8082'
        )
      }

      // Both should have outputs
      template.hasOutput('Function1Arn', {})
      template.hasOutput('Function2Arn', {})
      template.hasOutput('Function1RoleArn', {})
      template.hasOutput('Function2RoleArn', {})
    })
  })
})
