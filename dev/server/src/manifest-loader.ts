// src/manifest-loader.ts
import path from 'path';
import fs from 'fs';
import { LambdaManifest } from './types';
import { config } from './config';

const MANIFEST_PATH = config.paths.lambdaManifest;

export async function loadLambdaManifest(): Promise<LambdaManifest> {
  let manifest: LambdaManifest = {};
  try {
    if (fs.existsSync(MANIFEST_PATH)) {
      const rawData = fs.readFileSync(MANIFEST_PATH, 'utf-8');
      manifest = JSON.parse(rawData) as LambdaManifest;
      console.log('Lambda manifest loaded successfully.');
      // console.log('Manifest content:', manifest);
    } else {
      console.error(`Lambda manifest not found at: ${MANIFEST_PATH}`);
      console.error('Please run `cdk synth` in your `dev/infrastructure` directory to generate it.');
      // Return empty manifest or throw error, depending on desired behavior
    }
  } catch (error) {
    console.error('Error loading or parsing lambda manifest:', error);
    // Return empty manifest or throw error
  }
  return manifest;
}
