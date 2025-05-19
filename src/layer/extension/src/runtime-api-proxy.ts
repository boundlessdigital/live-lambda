// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

// Read about Lambda Runtime API here
// https://docs.aws.amazon.com/lambda/latest/dg/runtimes-api.html

import express, { Request, Response, NextFunction } from 'express'

const RUNTIME_API_ENDPOINT =
  process.env.LRAP_RUNTIME_API_ENDPOINT || process.env.AWS_LAMBDA_RUNTIME_API
const LISTENER_PORT = process.env.LRAP_LISTENER_PORT || 9009
const RUNTIME_API_URL = `http://${RUNTIME_API_ENDPOINT}/2018-06-01/runtime`

import { IncomingHttpHeaders } from 'http'

export class RuntimeApiProxy {
  private event_payloads: Record<string, string> = {}
  async start() {
    console.info(
      `[LRAP:RuntimeApiProxy] start RUNTIME_API_ENDPOINT=${RUNTIME_API_ENDPOINT} LISTENER_PORT=${LISTENER_PORT}`
    )
    const listener = express()
    listener.use(express.json())
    listener.use(this.logIncomingRequest)
    listener.get('/2018-06-01/runtime/invocation/next', this.handleNext)
    listener.post(
      '/2018-06-01/runtime/invocation/:requestId/response',
      this.handleResponse
    )
    listener.post('/2018-06-01/runtime/init/error', this.handleInitError)
    listener.post(
      '/2018-06-01/runtime/invocation/:requestId/error',
      this.handleInvokeError
    )
    listener.use((_req: Request, res: Response) => res.status(404).send())
    listener.listen(LISTENER_PORT)
  }

  async handleNext(_req: Request, res: Response) {
    console.log('[LRAP:RuntimeProxy] handleNext');

    // Getting the next event from Lambda Runtime API
    const next_event_response = await fetch(`${RUNTIME_API_URL}/invocation/next`);

    // Extracting the event payload as text and storing it
    const event_text = await next_event_response.text();
    const aws_request_id = next_event_response.headers.get('lambda-runtime-aws-request-id');

    if (aws_request_id) {
      this.event_payloads[aws_request_id] = event_text;
      console.log(`[LRAP:RuntimeProxy] Stored event for requestId: ${aws_request_id}`);
    } else {
      console.error('[LRAP:RuntimeProxy] Could not get lambda-runtime-aws-request-id from /next event');
      // Fallback or error handling if needed, for now, just pass through without storing if no request ID
    }

    // Copying headers from the original /next response to the response for the function runtime
    next_event_response.headers.forEach((value, key) => {
      res.set(key, value);
    });

    // Send the raw event text to the function runtime
    return res.status(next_event_response.status).send(event_text);
  }

  async handleResponse(req: Request, res: Response) {
    const request_id = req.params.requestId;
    console.log(`[LRAP:RuntimeProxy] handleResponse intercepted for requestId=${request_id}`);

    // Retrieve the stored event payload for this request ID
    const stored_event_payload = this.event_payloads[request_id];

    if (stored_event_payload) {
      console.log(`[LRAP:RuntimeProxy] Found stored event for ${request_id}. Sending it as response.`);
      delete this.event_payloads[request_id]; // Clean up

      // Posting the stored event payload to the actual Lambda Runtime API
      const runtime_api_response = await fetch(
        `${RUNTIME_API_URL}/invocation/${request_id}/response`,
        {
          method: 'POST',
          body: stored_event_payload, // Send the raw string of the original event
          headers: { 'Content-Type': 'application/json' } // Assume original event was JSON
        }
      );
      console.log(`[LRAP:RuntimeProxy] Posted stored event to Runtime API for ${request_id}, status: ${runtime_api_response.status}`);
      // Acknowledge back to the function runtime (which called our proxy)
      return res.status(202).send(); // Or 200, doesn't strictly matter to the function code
    } else {
      console.warn(`[LRAP:RuntimeProxy] No stored event found for ${request_id}. Passing through original response.`);
      // Fallback: Pass through the function's actual response if no stored event (should not happen in POC)
      const original_response_body = req.body;
      const runtime_api_response = await fetch(
        `${RUNTIME_API_URL}/invocation/${request_id}/response`,
        {
          method: 'POST',
          body: JSON.stringify(original_response_body),
          headers: { 'Content-Type': 'application/json' } 
        }
      );
      console.log(`[LRAP:RuntimeProxy] Posted original response to Runtime API for ${request_id}, status: ${runtime_api_response.status}`);
      return res.status(runtime_api_response.status).send(await runtime_api_response.text()); // Send runtime API's response back to function
    }
  }

  private convertHeaders(
    incomingHeaders: IncomingHttpHeaders
  ): Record<string, string> {
    const result: Record<string, string> = {}
    for (const key in incomingHeaders) {
      const value = incomingHeaders[key]
      if (typeof value === 'string') {
        result[key] = value
      } else if (Array.isArray(value) && value.length > 0) {
        result[key] = value[0] // Take the first value if it's an array
      }
      // Skip undefined values
    }
    return result
  }

  async handleInitError(req: Request, res: Response) {
    console.log(`[LRAP:RuntimeProxy] handleInitError`)

    const resp = await fetch(`${RUNTIME_API_URL}/init/error`, {
      method: 'POST',
      headers: this.convertHeaders(req.headers),
      body: JSON.stringify(req.body)
    })

    console.log('[LRAP:RuntimeProxy] handleInitError posted')
    return res.status(resp.status).json(await resp.json())
  }

  async handleInvokeError(req: Request, res: Response) {
    const requestId = req.params.requestId
    console.log(`[LRAP:RuntimeProxy] handleInvokeError requestid=${requestId}`)

    const resp = await fetch(
      `${RUNTIME_API_URL}/invocation/${requestId}/error`,
      {
        method: 'POST',
        headers: this.convertHeaders(req.headers),
        body: JSON.stringify(req.body)
      }
    )

    console.log('[LRAP:RuntimeProxy] handleInvokeError posted')
    return res.status(resp.status).json(await resp.json())
  }

  logIncomingRequest(req: Request, _res: Response, next: NextFunction) {
    console.log(
      `[LRAP:RuntimeProxy] logIncomingRequest method=${req.method} url=${req.originalUrl}`
    )
    next()
  }
}
