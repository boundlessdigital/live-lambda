import * as cdk from 'aws-cdk-lib'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs'
import * as appsync from 'aws-cdk-lib/aws-appsync'
import * as iam from 'aws-cdk-lib/aws-iam'
import { IConstruct } from 'constructs'
import path from 'node:path'

export interface LiveLambdaLayerAspectProps {
  readonly layer_arn: string
  readonly api: appsync.EventApi
  include_patterns?: string[]
  exclude_patterns?: string[]
}

interface LiveLambdaMapEntryForCDK {
  local_path: string // Path to TS source file, relative to project root
  handler_export: string // Exported handler name
  role_arn: string
  // project_root is implicitly where cdk.json is, or can be configured
}

import { IAspect, Aspects, Stack, CfnResource, TagManager } from 'aws-cdk-lib'
import { CfnFunction } from 'aws-cdk-lib/aws-lambda'
import { MetadataEntryResult } from 'aws-cdk-lib/cx-api'

export class LiveLambdaLayerAspect implements cdk.IAspect {
  private readonly props: LiveLambdaLayerAspectProps
  public static readonly function_mappings: {
    [deployedFunctionName: string]: LiveLambdaMapEntryForCDK
  } = {}

  constructor(props: LiveLambdaLayerAspectProps) {
    this.props = props
  }

  public visit(node: IConstruct): void {
    const staging = node.node.tryFindChild('Stage')
    let src,
      out = undefined
    if (staging && (staging as any).sourcePath) {
      src = (staging as any).sourcePath
      out = (staging as any).absoluteStagedPath
      console.log(
        `[stage]  ${node.node.path} → src=${src} staged=${out} - ${typeof node}`
      )
    }

    if (node instanceof lambda.Function) {
      const functionPath = node.node.path
      const stackName = node.stack.stackName

      if (
        this.props.include_patterns &&
        !this.props.include_patterns.some((pattern) =>
          functionPath.includes(pattern)
        )
      ) {
        return
      }

      const excludedStackPrefixes = [
        'LiveLambda-',
        'SSTBootstrap',
        'CDKToolkit'
      ]
      if (
        excludedStackPrefixes.some((prefix) => stackName.startsWith(prefix))
      ) {
        return
      }

      const internalFunctionPathPatterns = [
        'CustomResourceHandler',
        'Framework/Resource',
        'Providerframework',
        'LogRetention',
        'SingletonLambda',
        '/NodejsBuildV1$/Resource',
        '/AssetVersionNotifier$/Resource'
      ]
      if (
        internalFunctionPathPatterns.some((pattern) =>
          functionPath.includes(pattern)
        )
      ) {
        return
      }

      // Use a more unique ID for the imported layer version per function to avoid conflicts
      const layer_import_id =
        `LiveLambdaProxyLayerImport-${node.node.id.replace(
          /[^a-zA-Z0-9-]/g,
          ''
        )}`.slice(0, 255)
      node.addLayers(
        lambda.LayerVersion.fromLayerVersionArn(
          node,
          layer_import_id,
          this.props.layer_arn
        )
      )

      node.addToRolePolicy(
        new iam.PolicyStatement({
          actions: [
            'appsync:EventConnect',
            'appsync:EventPublish',
            'appsync:EventSubscribe'
          ],
          resources: [`${this.props.api.apiArn}/*`, `${this.props.api.apiArn}`]
        })
      )

      node.addEnvironment(
        'AWS_LAMBDA_EXEC_WRAPPER',
        '/opt/live-lambda-runtime-wrapper.sh'
      )

      // Set the listener port for the extension's Runtime API Proxy
      node.addEnvironment('LRAP_LISTENER_PORT', '8082')

      // Set the official extension name, required by the Go extension to register itself
      node.addEnvironment('AWS_LAMBDA_EXTENSION_NAME', 'live-lambda-extension')

      // Add CloudFormation outputs for Function ARN and Role ARN
      new cdk.CfnOutput(node.stack, `${node.node.id}FunctionArn`, {
        value: node.functionArn,
        description: `ARN of the Lambda function ${node.node.path}`,
        exportName: `${node.stack.stackName}-${node.node.id}-FunctionArn`
      })

      if (node.role) {
        new cdk.CfnOutput(node.stack, `${node.node.id}RoleArn`, {
          value: node.role.roleArn,
          description: `ARN of the execution role for Lambda function ${node.node.path}`,
          exportName: `${node.stack.stackName}-${node.node.id}-RoleArn`
        })
      }

      // Output the path of the asset within cdk.out (Staged Asset Path)
      const cfnFunction = node.node.defaultChild as lambda.CfnFunction // L1 construct

      let cdkOutAssetPathValue: string | undefined;
      const cfnOptionsMetadata = cfnFunction.cfnOptions?.metadata;
      const assetPathFromCfnOptions = cfnOptionsMetadata?.['aws:asset:path'];

      if (typeof assetPathFromCfnOptions === 'string') {
        cdkOutAssetPathValue = path.join('cdk.out', assetPathFromCfnOptions);
        new cdk.CfnOutput(node.stack, `${node.node.id}CdkOutAssetPath`, {
          value: cdkOutAssetPathValue,
          description: `Path to the function's code asset within the cdk.out directory (relative to project root).`,
          exportName: `${node.stack.stackName}-${node.node.id}-CdkOutAssetPath`,
        });
        console.log(
          `[Live Lambda Aspect] CDK out asset path for ${node.node.path} (from cfnOptions.metadata): ${cdkOutAssetPathValue}`
        );
      } else {
        // Fallback to trying node.metadata if cfnOptions didn't work
        const assetMetadataEntry = cfnFunction.node.metadata.find(
          (m: any) => m.type === 'aws:asset:path'
        );
        if (assetMetadataEntry && typeof assetMetadataEntry.data === 'string') {
          cdkOutAssetPathValue = path.join('cdk.out', assetMetadataEntry.data);
          new cdk.CfnOutput(node.stack, `${node.node.id}CdkOutAssetPath`, {
            value: cdkOutAssetPathValue,
            description: `Path to the function's code asset within the cdk.out directory (relative to project root).`,
            exportName: `${node.stack.stackName}-${node.node.id}-CdkOutAssetPath`,
          });
          console.log(
            `[Live Lambda Aspect] CDK out asset path for ${node.node.path} (from node.metadata): ${cdkOutAssetPathValue}`
          );
        } else {
            // If both methods fail, log the warning.
            console.warn(
              `[Live Lambda Aspect] Could not find 'aws:asset:path' metadata for ${node.node.path} using cfnOptions.metadata or node.metadata. Cannot output cdk.out asset path.`
            );
        }
      }

      // Determine Original Source Path, output it, and populate function_mappings
      let determined_original_source_path: string | undefined
      // Project root from MEMORY[924d3e42-9ee8-4d17-b121-6b0cdd2c0542]
      const project_root_for_original_path = process.cwd()

      if (node instanceof NodejsFunction) {
        const entry_point = (node as any).entry;
        if (typeof entry_point === 'string') {
          if (path.isAbsolute(entry_point)) {
            determined_original_source_path = path.relative(project_root_for_original_path, entry_point);
          } else {
            determined_original_source_path = entry_point;
          }
        } else {
          console.warn(`[Live Lambda Aspect] 'entry' property for NodejsFunction ${node.node.path} is not a string or is undefined. Skipping original source path determination.`);
        }
      } else if ('code' in node && (node as any).code instanceof lambda.AssetCode) {
        const asset_code_path = (node as any).code.path;
        if (typeof asset_code_path === 'string') {
          if (path.isAbsolute(asset_code_path)) {
            determined_original_source_path = path.relative(project_root_for_original_path, asset_code_path);
          } else {
            determined_original_source_path = asset_code_path;
          }
        } else {
          console.warn(`[Live Lambda Aspect] 'code.path' for AssetCode function ${node.node.path} is not a string or is undefined. Skipping original source path determination.`);
        }
      }

      if (determined_original_source_path) {
        const normalized_original_source_path = determined_original_source_path
          .split(path.sep)
          .join(path.posix.sep)

        // Output for Original Source Path
        new cdk.CfnOutput(node.stack, `${node.node.id}OriginalSourcePath`, {
          value: normalized_original_source_path,
          description: `Original source code path for function ${node.node.path}, relative to project root.`,
          exportName: `${node.stack.stackName}-${node.node.id}-OriginalSourcePath`
        })
        console.log(
          `[Live Lambda Aspect] Original source path for ${node.node.path}: ${normalized_original_source_path}`
        )

        // Populate function_mappings
        const handler_string_for_map = cfnFunction.handler
        if (handler_string_for_map) {
          const handler_export_name_for_map = handler_string_for_map
            .split('.')
            .pop()
          if (handler_export_name_for_map) {
            LiveLambdaLayerAspect.function_mappings[node.node.id] = {
              local_path: normalized_original_source_path,
              handler_export: handler_export_name_for_map,
              role_arn: node.role?.roleArn || ''
            }
            console.log(
              `[Live Lambda Aspect] Collected mapping for ${node.node.id}: local_path=${normalized_original_source_path}, handler=${handler_export_name_for_map}`
            )
          } else {
            console.warn(
              `[Live Lambda Aspect] Could not derive handler_export_name for ${node.node.path} for function_mappings.`
            )
          }
        } else {
          console.warn(
            `[Live Lambda Aspect] Handler string not found for ${node.node.path} for function_mappings.`
          )
        }
      } else {
        console.warn(
          `[Live Lambda Aspect] Could not determine original source path for function ${node.node.path}. Cannot output or map.`
        )
      }

      // Add AppSync configuration as environment variables for the extension
      node.addEnvironment(
        'LIVE_LAMBDA_APPSYNC_REGION',
        this.props.api.env.region
      )
      node.addEnvironment(
        'LIVE_LAMBDA_APPSYNC_REALTIME_HOST',
        this.props.api.realtimeDns
      )
      node.addEnvironment(
        'LIVE_LAMBDA_APPSYNC_HTTP_HOST',
        this.props.api.httpDns
      )

      console.log('LiveLambdaLayerAspect: node.node.defaultChild')
      console.log(node.node.defaultChild)
      let local_source_path_relative_to_project_root: string | undefined
      const cfn_function = node.node.defaultChild as lambda.CfnFunction
      const handler_string = cfn_function.handler
      if (!handler_string) {
        console.warn(
          `[Live Lambda Aspect] Handler string not found for function ${node.node.path}. Skipping map entry.`
        )
        return
      }
      const handler_export_name = handler_string.split('.').pop()

      if (!handler_export_name) {
        console.warn(
          `[Live Lambda Aspect] Could not determine handler export for ${node.node.path}. Skipping map entry.`
        )
        return
      }
    }
  }
}
