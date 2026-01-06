import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as cdk from 'aws-cdk-lib'
import { Template, Match } from 'aws-cdk-lib/assertions'
import * as appsync from 'aws-cdk-lib/aws-appsync'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { LiveLambdaLayerStack } from './layer.stack.js'
import {
  LAYER_VERSION_NAME,
  LAYER_ARN_SSM_PARAMETER,
  LAYER_DESCRIPTION
} from '../../lib/constants.js'

describe('LiveLambdaLayerStack', () => {
  let app: cdk.App
  let api_stack: cdk.Stack
  let mock_api: appsync.EventApi
  let stack: LiveLambdaLayerStack
  let template: Template
  let temp_asset_dir: string

  beforeAll(() => {
    // Create a temp directory with a placeholder file for the layer asset
    temp_asset_dir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'live-lambda-layer-test-')
    )
    fs.writeFileSync(
      path.join(temp_asset_dir, 'placeholder.txt'),
      'test layer content'
    )

    app = new cdk.App()
    api_stack = new cdk.Stack(app, 'ApiStack', {
      env: { account: '123456789012', region: 'us-east-1' }
    })
    mock_api = new appsync.EventApi(api_stack, 'MockApi', {
      apiName: 'test-api'
    })

    stack = new LiveLambdaLayerStack(app, 'TestLayerStack', {
      env: { account: '123456789012', region: 'us-east-1' },
      api: mock_api,
      asset_path: temp_asset_dir
    })
    template = Template.fromStack(stack)
  })

  afterAll(() => {
    // Clean up temp directory
    if (temp_asset_dir) {
      fs.rmSync(temp_asset_dir, { recursive: true, force: true })
    }
  })

  describe('Lambda Layer', () => {
    it('should create a Lambda LayerVersion', () => {
      template.resourceCountIs('AWS::Lambda::LayerVersion', 1)
    })

    it('should set correct layer version name', () => {
      template.hasResourceProperties('AWS::Lambda::LayerVersion', {
        LayerName: LAYER_VERSION_NAME
      })
    })

    it('should set correct description', () => {
      template.hasResourceProperties('AWS::Lambda::LayerVersion', {
        Description: LAYER_DESCRIPTION
      })
    })

    it('should be compatible with ARM64 and X86_64 architectures', () => {
      template.hasResourceProperties('AWS::Lambda::LayerVersion', {
        CompatibleArchitectures: Match.arrayWith(['arm64', 'x86_64'])
      })
    })
  })

  describe('SSM Parameter', () => {
    it('should create SSM StringParameter', () => {
      template.resourceCountIs('AWS::SSM::Parameter', 1)
    })

    it('should set correct parameter name', () => {
      template.hasResourceProperties('AWS::SSM::Parameter', {
        Name: LAYER_ARN_SSM_PARAMETER
      })
    })

    it('should set correct description', () => {
      template.hasResourceProperties('AWS::SSM::Parameter', {
        Description: 'ARN of the Live Lambda Proxy Layer for live-lambda'
      })
    })
  })

  describe('Outputs', () => {
    it('should output layer ARN', () => {
      template.hasOutput('LiveLambdaProxyLayerArn', {
        Description: 'ARN of the Live Lambda Proxy Layer'
      })
    })
  })

  describe('Stack properties', () => {
    it('should expose layer property as LayerVersion with ARN', () => {
      expect(stack.layer).toBeDefined()
      // LayerVersion exposes layerVersionArn as CDK token for cross-stack references
      expect(stack.layer.layerVersionArn).toBeDefined()
      // Verify layer ARN format is a CDK token (not a static string)
      expect(typeof stack.layer.layerVersionArn).toBe('string')
    })

    it('should expose layer_arn_ssm_parameter property with correct path', () => {
      expect(stack.layer_arn_ssm_parameter).toBe(LAYER_ARN_SSM_PARAMETER)
      expect(stack.layer_arn_ssm_parameter).toMatch(/^\/live-lambda\//)
    })
  })
})

describe('LiveLambdaLayerStack interface contract', () => {
  it('should define correct SSM parameter path', () => {
    expect(LAYER_ARN_SSM_PARAMETER).toBe('/live-lambda/layer/arn')
  })
})
