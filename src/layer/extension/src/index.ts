#!/usr/bin/env node

// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { ExtensionsApiClient } from './extensions-api-client.js'
import { LambdaRuntimeApiProxy } from './lambda-runtime-api-proxy.js'

console.log('[LRAP:index] starting...')

process.on('SIGINT', () => process.exit(0))
process.on('SIGTERM', () => process.exit(0))

new LambdaRuntimeApiProxy().start()
new ExtensionsApiClient().bootstrap()
