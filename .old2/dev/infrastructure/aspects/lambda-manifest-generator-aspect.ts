import * as cdk from 'aws-cdk-lib'
import { IAspect, RemovalPolicy } from 'aws-cdk-lib'
import { IConstruct } from 'constructs'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs'
import * as fs from 'fs'
import * as path from 'path'

export interface LambdaManifestEntry {
  logicalId: string // The CDK logical ID
  functionName: string // The deployed Lambda function name
  handlerPath: string // Path to the source handler file (CDK entry)
  runtime: string
  roleArn?: string // ARN of the Lambda's execution role (optional as it might not always be resolvable or present)
  // Add other useful info if needed: memory, timeout, environment variables
}

export interface LambdaManifest {
  [logicalId: string]: LambdaManifestEntry
}

export class LambdaManifestGeneratorAspect implements IAspect {
  private readonly manifest: LambdaManifest = {}
  private readonly outputPath: string
  private executionCount = 0 // To ensure manifest is written only once effectively

  constructor(outputPath: string) {
    // Ensure the output directory exists
    const outputDir = path.dirname(outputPath)
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true })
    }
    this.outputPath = outputPath

    // Attempt to delete the manifest file at the beginning of synthesis
    // to ensure it's fresh for each synth.
    try {
      if (fs.existsSync(this.outputPath)) {
        fs.unlinkSync(this.outputPath)
      }
    } catch (e) {
      console.warn(
        `Could not delete old manifest file at ${this.outputPath}:`,
        e
      )
    }
  }

  public visit(node: IConstruct): void {
    // We are interested in NodejsFunction instances that are tagged for live lambda.
    // Using NodejsFunction specifically because 'entry' is a direct property.
    // If you use other Function types, you'd need to adapt how 'handlerPath' is found.
    if (
      node instanceof NodejsFunction &&
      cdk.Tags.of(node).tagValues()['live-lambda-target'] === 'true'
    ) {
      const func = node as NodejsFunction
      if (func.entry) {
        // Ensure entry point is defined
        this.manifest[func.node.id] = {
          logicalId: func.node.id,
          functionName: func.functionName,
          handlerPath: func.entry, // For NodejsFunction, 'entry' is the path to the TS/JS file
          runtime: func.runtime.name,
          roleArn: func.role?.roleArn // Get the role ARN if the role exists
        }
      } else {
        console.warn(
          `LambdaManifestGeneratorAspect: Tagged Lambda ${func.node.id} has no 'entry' property defined. Cannot add to manifest.`
        )
      }
    }
  }

  // This method should be called at a point where all nodes have been visited.
  // A common way is to use CDK's validation mechanism which runs at the end of synthesis phases.
  public writeManifest(): void {
    // This check is a simple way to prevent writing multiple times if called from multiple validation hooks.
    // A more robust solution might involve CDK App stages or a flag on the App construct.
    if (this.executionCount === 0) {
      fs.writeFileSync(this.outputPath, JSON.stringify(this.manifest, null, 2))
      console.log(`Lambda manifest generated at: ${this.outputPath}`)
    }
    this.executionCount++
  }
}
