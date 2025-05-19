import http from 'node:http'
import { URL } from 'node:url'
import {
  fetch,
  Agent,
  RequestInit as UndiciRequestInit,
  Response as UndiciResponse
} from 'undici' // For custom fetch dispatcher
import { AppSyncEventWebSocketClient } from '../../../websocket/index.js'
enum Method {
  GET = 'GET',
  POST = 'POST',
  PUT = 'PUT',
  DELETE = 'DELETE',
  PATCH = 'PATCH'
}

const RUNTIME_API_ENDPOINT =
  process.env.LRAP_RUNTIME_API_ENDPOINT || process.env.AWS_LAMBDA_RUNTIME_API
if (!RUNTIME_API_ENDPOINT) {
  throw new Error('RUNTIME_API_ENDPOINT env var required')
}

const LISTENER_PORT = Number(process.env.LRAP_LISTENER_PORT || 9009)
const BASE_RUNTIME_URL = `http://${RUNTIME_API_ENDPOINT}/2018-06-01/runtime`

export class LambdaRuntimeApiProxy {
  private upstream_dispatcher: Agent
  private routes: Array<{
    method: Method
    regex: RegExp
    handler: (
      request: http.IncomingMessage,
      response: http.ServerResponse,
      ...params: string[]
    ) => Promise<void>
  }> = []

  constructor() {
    // Initialize a dispatcher (agent) for upstream calls to the actual Lambda Runtime API
    // with longer timeouts suitable for long-polling and potentially slow responses.
    this.upstream_dispatcher = new Agent({
      headersTimeout: 16 * 60 * 1000, // 16 minutes (Lambda max timeout + 1 min buffer)
      bodyTimeout: 16 * 60 * 1000, // 16 minutes
      keepAliveTimeout: 5 * 60 * 1000, // 5 minutes keep-alive for idle connections
      keepAliveMaxTimeout: 15 * 60 * 1000 // Undici will forcefully close connections after this time of inactivity
    })

    this.routes = [
      {
        method: Method.GET,
        regex: /^\/2018-06-01\/runtime\/invocation\/next$/,
        handler: this.handle_next
      },
      {
        method: Method.POST,
        regex: /^\/2018-06-01\/runtime\/init\/error$/,
        handler: this.handle_init_error
      },
      {
        method: Method.POST,
        regex: /^\/2018-06-01\/runtime\/invocation\/([^/]+)\/response$/,
        handler: this.handle_response
      },
      {
        method: Method.POST,
        regex: /^\/2018-06-01\/runtime\/invocation\/([^/]+)\/error$/,
        handler: this.handle_invoke_error
      }
    ]
  }

  async start() {
    const server = http.createServer((req, res) => this.dispatch(req, res)) // Node core HTTP server [oai_citation:turn0search0](https://nodejs.org/api/http.html)
    server.listen(LISTENER_PORT, () =>
      console.info(
        `[LiveLambda Runtime API Proxy] listening on :${LISTENER_PORT}, proxying → ${RUNTIME_API_ENDPOINT}`
      )
    )
  }

  async dispatch(request: http.IncomingMessage, response: http.ServerResponse) {
    try {
      const { pathname } = new URL(request.url as string, 'http://l') // WHATWG URL parsing [oai_citation:turn0search1](https://nodejs.org/api/url.html)
      const route = this.routes.find(
        (r) => r.method === request.method && r.regex.test(pathname)
      )

      if (!route) {
        response.writeHead(404)
        return response.end()
      }

      const params = pathname?.match(route.regex)?.slice(1)
      await route.handler.call(this, request, response, ...(params || []))
    } catch (err) {
      console.error('[LiveLambda Runtime API Proxy] dispatch error', err)
      const error = JSON.stringify({
        message: 'internal error',
        error: err instanceof Error ? err.message : String(err)
      })

      response.writeHead(500, { 'content-type': 'application/json' })
      response.end(error)
    }
  }

  async handle_next(
    request: http.IncomingMessage,
    response: http.ServerResponse
  ) {
    const upstream = await fetch(`${BASE_RUNTIME_URL}/invocation/next`, {
      dispatcher: this.upstream_dispatcher
    } as UndiciRequestInit) // AWS Runtime API: invocation/next [oai_citation:turn0search4](https://docs.aws.amazon.com/lambda/latest/dg/runtimes-api.html)
    this.copy_headers(upstream, response)

    const payload = await upstream.json()

    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify(payload))
  }

  async handle_response(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    request_id: string
  ) {
    const body = await this.read_json_body(request)

    const upstream = await fetch(
      `${BASE_RUNTIME_URL}/invocation/${request_id}/response`,
      {
        method: Method.POST,
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
        dispatcher: this.upstream_dispatcher
      } as UndiciRequestInit
    ) // AWS Runtime API: invocation/<id>/response [oai_citation:turn0search4](https://docs.aws.amazon.com/lambda/latest/dg/runtimes-api.html)
    await this.pipe(upstream, response)
  }

  async handle_init_error(
    request: http.IncomingMessage,
    response: http.ServerResponse
  ) {
    const body = await this.read_json_body(request)

    const error_type_header = body?.errorType || 'InitError'

    const headers_to_send: Record<string, string> = {
      'Content-Type': 'application/json',
      'Lambda-Runtime-Function-Error-Type': error_type_header // AWS error header [oai_citation:turn0search4](https://docs.aws.amazon.com/lambda/latest/dg/runtimes-api.html)
    }

    const upstream = await fetch(`${BASE_RUNTIME_URL}/initialize/error`, {
      method: Method.POST,
      headers: headers_to_send,
      body: JSON.stringify(body),
      dispatcher: this.upstream_dispatcher
    } as UndiciRequestInit) // AWS Runtime API: init/error [oai_citation:turn0search4](https://docs.aws.amazon.com/lambda/latest/dg/runtimes-api.html)
    await this.pipe(upstream, response)
  }

  async handle_invoke_error(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    request_id: string
  ) {
    const body = await this.read_json_body(request)

    // Extract error type from the body if possible, otherwise use a default
    const error_type_header = body?.errorType || 'UnhandledRuntimeError'

    const headers_to_send: Record<string, string> = {
      'Content-Type': 'application/json',
      'Lambda-Runtime-Function-Error-Type': error_type_header // AWS error header [oai_citation:turn0search4](https://docs.aws.amazon.com/lambda/latest/dg/runtimes-api.html)
    }

    const upstream = await fetch(
      `${BASE_RUNTIME_URL}/invocation/${request_id}/error`,
      {
        method: Method.POST,
        headers: headers_to_send, // Use the constructed minimal headers
        body: JSON.stringify(body),
        dispatcher: this.upstream_dispatcher
      } as UndiciRequestInit
    ) // AWS Runtime API: invocation/<id>/error [oai_citation:turn0search4](https://docs.aws.amazon.com/lambda/latest/dg/runtimes-api.html)
    await this.pipe(upstream, response)
  }

  async read_json_body(request: http.IncomingMessage) {
    const chunks = []
    for await (const c of request) chunks.push(c) // streaming read via async iterator [oai_citation:turn0search8](https://nodejs.org/en/learn/modules/how-to-use-streams)
    const raw = Buffer.concat(chunks).toString('utf8')
    return raw ? JSON.parse(raw) : {}
  }

  copy_headers(upstream: UndiciResponse, response: http.ServerResponse) {
    upstream.headers.forEach((v, k) => response.setHeader(k, v)) // setHeader API [oai_citation:turn0search12](https://nodejs.org/en/learn/modules/anatomy-of-an-http-transaction)
  }

  async pipe(upstream: UndiciResponse, response: http.ServerResponse) {
    response.writeHead(upstream.status, Object.fromEntries(upstream.headers))
    response.end(await upstream.text())
  }
}
