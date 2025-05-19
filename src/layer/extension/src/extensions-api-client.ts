// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

// Read about Lambda Extensions API here
// https://docs.aws.amazon.com/lambda/latest/dg/runtimes-extensions-api.html

const AWS_LAMBDA_RUNTIME_API = process.env.AWS_LAMBDA_RUNTIME_API
const EXTENSIONS_API_ENDPOINT = `http://${AWS_LAMBDA_RUNTIME_API}/2020-01-01/extension`

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'

interface ExtensionAPIRequest {
  method: Method
  path: string
  payload?: object
  headers?: object
}
export class ExtensionsApiClient {
  private extension_id: string | null = null

  constructor() {
    this.extension_id = null
  }

  async bootstrap() {
    console.info(`[LRAP:ExtensionsApiClient] bootstrap `)
    await this.register()
    await this.next()
  }

  async call(request: ExtensionAPIRequest) {
    if (!request.headers) {
      request.headers = {}
    }
    const headers = {
      'Content-Type': 'application/json',
      ...(this.extension_id
        ? {
            'Lambda-Extension-Identifier': this.extension_id
          }
        : {
            'Lambda-Extension-Name': 'live-lambda-extension'
          })
    }

    const response = await fetch(`${EXTENSIONS_API_ENDPOINT}/${request.path}`, {
      method: request.method,
      body: JSON.stringify(request.payload),
      headers
    })

    return response
  }

  async register() {
    const response = await this.call({
      method: 'POST',
      path: 'register',
      payload: {
        events: ['INVOKE', 'SHUTDOWN']
      }
    })

    if (!response.ok) {
      console.error(
        '[LRAP:ExtensionsApiClient] register failed',
        await response.text()
      )
      return null
    }

    this.extension_id = response.headers.get('lambda-extension-identifier')
  }

  async next() {
    const response = await this.call({
      method: 'GET',
      path: 'event/next'
    })

    if (!response.ok) {
      console.error(
        '[LRAP:ExtensionsApiClient] next failed',
        await response.text()
      )
      return null
    }

    const event = await response.json()
    return event
  }
}
