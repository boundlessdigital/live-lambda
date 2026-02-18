import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as cdk from 'aws-cdk-lib'
import { Template, Match } from 'aws-cdk-lib/assertions'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { LiveLambda, LiveLambdaInstallProps } from './live_lambda.js'
import {
  ENV_LAMBDA_EXEC_WRAPPER,
  CONTEXT_APP_NAME,
  CONTEXT_ENVIRONMENT,
  APPSYNC_STACK_NAME,
  compute_prefix
} from '../lib/constants.js'

const TEST_APP_NAME = 'test-app'
const TEST_ENVIRONMENT = 'test'
const TEST_PREFIX = compute_prefix(TEST_APP_NAME, TEST_ENVIRONMENT)

describe('LiveLambda.install()', () => {
  let temp_asset_dir: string
  let temp_entry_dir: string
  let entry_file_path: string

  beforeAll(() => {
    // Create a temp directory with a placeholder file for the layer asset
    temp_asset_dir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'live-lambda-install-test-')
    )
    fs.writeFileSync(
      path.join(temp_asset_dir, 'placeholder.txt'),
      'test layer content'
    )

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
    if (temp_asset_dir) {
      fs.rmSync(temp_asset_dir, { recursive: true, force: true })
    }
    if (temp_entry_dir) {
      fs.rmSync(temp_entry_dir, { recursive: true, force: true })
    }
  })

  function create_test_app_with_context() {
    return new cdk.App({
      context: {
        [CONTEXT_APP_NAME]: TEST_APP_NAME,
        [CONTEXT_ENVIRONMENT]: TEST_ENVIRONMENT
      }
    })
  }

  /**
   * Helper to create an app with LiveLambda.install() called
   * and optionally an application stack with a NodejsFunction.
   * Consumer stacks are created under the returned scope (Stage)
   * so the aspect applies to them.
   */
  function create_test_app(options?: {
    props?: LiveLambdaInstallProps
    include_app_stack?: boolean
  }) {
    const app = create_test_app_with_context()
    const env = { account: '123456789012', region: 'us-east-1' }

    const props = options?.props ?? { env }

    // Call the install method - returns a scope (Stage or App)
    const scope = LiveLambda.install(app, props)

    let app_stack: cdk.Stack | undefined
    let test_function: NodejsFunction | undefined

    if (options?.include_app_stack !== false) {
      // Create consumer stack under returned scope so aspect applies
      app_stack = new cdk.Stack(scope, 'TestAppStack', { env })
      test_function = new NodejsFunction(app_stack, 'TestFunction', {
        entry: entry_file_path,
        handler: 'handler',
        runtime: lambda.Runtime.NODEJS_20_X
      })
    }

    // Synthesize to trigger aspects
    app.synth()

    return {
      app,
      scope,
      app_stack,
      test_function,
      env
    }
  }

  describe('Stack creation', () => {
    it('should create AppSyncStack when called', () => {
      const { scope } = create_test_app({ include_app_stack: false })

      const appsync_stack = scope.node.tryFindChild(APPSYNC_STACK_NAME) as cdk.Stack
      expect(appsync_stack).toBeDefined()
      expect(appsync_stack).toBeInstanceOf(cdk.Stack)

      const template = Template.fromStack(appsync_stack)
      template.resourceCountIs('AWS::AppSync::Api', 1)
    })

    it('should create LiveLambda-LayerStack when called', () => {
      const { scope } = create_test_app({ include_app_stack: false })

      const layer_stack = scope.node.tryFindChild('LiveLambda-LayerStack') as cdk.Stack
      expect(layer_stack).toBeDefined()
      expect(layer_stack).toBeInstanceOf(cdk.Stack)

      const template = Template.fromStack(layer_stack)
      template.resourceCountIs('AWS::Lambda::LayerVersion', 1)
    })

    it('should create a Stage with the computed prefix', () => {
      const { app } = create_test_app({ include_app_stack: false })

      const stage = app.node.tryFindChild(TEST_PREFIX) as cdk.Stage
      expect(stage).toBeDefined()
      expect(stage).toBeInstanceOf(cdk.Stage)
    })

    it('should use prefix override when provided', () => {
      const app = create_test_app_with_context()
      const env = { account: '123456789012', region: 'us-east-1' }

      const scope = LiveLambda.install(app, { env, prefix: 'custom-prefix' })
      app.synth()

      // Stage should use the custom prefix
      const stage = app.node.tryFindChild('custom-prefix') as cdk.Stage
      expect(stage).toBeDefined()
      expect(scope).toBe(stage)
    })

    it('should not create a Stage when auto_prefix_stacks is false', () => {
      const app = create_test_app_with_context()
      const env = { account: '123456789012', region: 'us-east-1' }

      const scope = LiveLambda.install(app, { env, auto_prefix_stacks: false })
      app.synth()

      // Should return the app itself, not a Stage
      expect(scope).toBe(app)

      // Internal stacks should have prefixed IDs
      const appsync_stack = app.node.tryFindChild(`${TEST_PREFIX}-${APPSYNC_STACK_NAME}`)
      expect(appsync_stack).toBeDefined()
    })
  })

  describe('Aspect application when skip_layer is false', () => {
    it('should apply aspect to NodejsFunction (check for AWS_LAMBDA_EXEC_WRAPPER env var)', () => {
      const { app_stack } = create_test_app({
        props: { env: { account: '123456789012', region: 'us-east-1' }, skip_layer: false }
      })

      const template = Template.fromStack(app_stack!)
      template.hasResourceProperties('AWS::Lambda::Function', {
        Environment: {
          Variables: Match.objectLike({
            AWS_LAMBDA_EXEC_WRAPPER: ENV_LAMBDA_EXEC_WRAPPER
          })
        }
      })
    })

    it('should apply aspect by default when skip_layer is not specified', () => {
      const { app_stack } = create_test_app({
        props: { env: { account: '123456789012', region: 'us-east-1' } }
      })

      const template = Template.fromStack(app_stack!)
      template.hasResourceProperties('AWS::Lambda::Function', {
        Environment: {
          Variables: Match.objectLike({
            AWS_LAMBDA_EXEC_WRAPPER: ENV_LAMBDA_EXEC_WRAPPER
          })
        }
      })
    })

    it('should add layer to NodejsFunction', () => {
      const { app_stack } = create_test_app()

      const template = Template.fromStack(app_stack!)
      template.hasResourceProperties('AWS::Lambda::Function', {
        Layers: Match.anyValue()
      })
    })
  })

  describe('Aspect skipping when skip_layer is true', () => {
    it('should NOT apply aspect when skip_layer is true', () => {
      const { app_stack } = create_test_app({
        props: { env: { account: '123456789012', region: 'us-east-1' }, skip_layer: true }
      })

      const template = Template.fromStack(app_stack!)

      // Function should exist but should NOT have the live-lambda env var
      const functions = template.findResources('AWS::Lambda::Function')
      const function_keys = Object.keys(functions)
      expect(function_keys.length).toBe(1)

      const fn = functions[function_keys[0]]
      const env_vars = fn.Properties?.Environment?.Variables
      expect(env_vars?.AWS_LAMBDA_EXEC_WRAPPER).toBeUndefined()
    })

    it('should NOT add layer to NodejsFunction when skip_layer is true', () => {
      const { app_stack } = create_test_app({
        props: { env: { account: '123456789012', region: 'us-east-1' }, skip_layer: true }
      })

      const template = Template.fromStack(app_stack!)

      // Function should exist but should NOT have layers
      const functions = template.findResources('AWS::Lambda::Function')
      const function_keys = Object.keys(functions)
      expect(function_keys.length).toBe(1)

      const fn = functions[function_keys[0]]
      expect(fn.Properties?.Layers).toBeUndefined()
    })
  })

  describe('developer_principal_arns configuration', () => {
    it('should pass developer_principal_arns to the aspect', () => {
      const developer_arn = 'arn:aws:iam::999999999999:user/developer'
      const { app_stack } = create_test_app({
        props: {
          env: { account: '123456789012', region: 'us-east-1' },
          developer_principal_arns: [developer_arn]
        }
      })

      const template = Template.fromStack(app_stack!)

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

    it('should support multiple developer_principal_arns', () => {
      const developer_arn_1 = 'arn:aws:iam::999999999999:user/developer1'
      const developer_arn_2 = 'arn:aws:iam::888888888888:user/developer2'
      const { app_stack } = create_test_app({
        props: {
          env: { account: '123456789012', region: 'us-east-1' },
          developer_principal_arns: [developer_arn_1, developer_arn_2]
        }
      })

      const template = Template.fromStack(app_stack!)

      // Verify IAM role has assume role policy with both developer principals
      template.hasResourceProperties('AWS::IAM::Role', {
        AssumeRolePolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: 'sts:AssumeRole',
              Effect: 'Allow',
              Principal: {
                AWS: developer_arn_1
              }
            })
          ])
        }
      })

      template.hasResourceProperties('AWS::IAM::Role', {
        AssumeRolePolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: 'sts:AssumeRole',
              Effect: 'Allow',
              Principal: {
                AWS: developer_arn_2
              }
            })
          ])
        }
      })
    })
  })

  describe('context validation', () => {
    it('should throw when app_name is missing from context', () => {
      const app = new cdk.App({
        context: { [CONTEXT_ENVIRONMENT]: 'test' }
      })

      expect(() => {
        LiveLambda.install(app, { env: { account: '123456789012', region: 'us-east-1' } })
      }).toThrow(CONTEXT_APP_NAME)
    })

    it('should throw when environment is missing from context', () => {
      const app = new cdk.App({
        context: { [CONTEXT_APP_NAME]: 'test-app' }
      })

      expect(() => {
        LiveLambda.install(app, { env: { account: '123456789012', region: 'us-east-1' } })
      }).toThrow(CONTEXT_ENVIRONMENT)
    })

    it('should work with undefined props when context is set', () => {
      const app = create_test_app_with_context()

      // Call install with undefined props - should not throw
      const scope = LiveLambda.install(app, undefined)

      // Stacks should be created under the Stage scope
      const appsync_stack = scope.node.tryFindChild(APPSYNC_STACK_NAME)
      expect(appsync_stack).toBeDefined()

      const layer_stack = scope.node.tryFindChild('LiveLambda-LayerStack')
      expect(layer_stack).toBeDefined()
    })

    it('should apply aspect by default when props is undefined', () => {
      const app = create_test_app_with_context()

      const scope = LiveLambda.install(app, undefined)

      // Create consumer stack under returned scope
      const app_stack = new cdk.Stack(scope, 'TestAppStack')
      new NodejsFunction(app_stack, 'TestFunction', {
        entry: entry_file_path,
        handler: 'handler',
        runtime: lambda.Runtime.NODEJS_20_X
      })

      app.synth()

      const template = Template.fromStack(app_stack)

      // Aspect should be applied since skip_layer defaults to false
      template.hasResourceProperties('AWS::Lambda::Function', {
        Environment: {
          Variables: Match.objectLike({
            AWS_LAMBDA_EXEC_WRAPPER: ENV_LAMBDA_EXEC_WRAPPER
          })
        }
      })
    })
  })
})
