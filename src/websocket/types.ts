import WebSocket from 'ws'

export interface AppSyncEventWebSocketClientOptions {
  region: string
  http: string
  realtime: string
  profile?: string
  on_data?: (subscription_id: string, event_data: any) => void
  on_error?: (error: any) => void
  on_close?: (event: WebSocket.CloseEvent) => void
  on_open?: () => void // Callback when connection_ack is received
}

export interface WebSocketMessage {
  type: string
  id?: string
  payload?: any // For client-sent messages with GraphQL structure
  event?: any // For server-sent data messages
  connectionTimeoutMs?: number // For connection_ack
  errors?: any[] // For error messages
  channel?: string // For subscribe/publish client messages
  authorization?: Record<string, string> // For subscribe/publish client messages
  events?: string[] // For publish client messages
}

export interface OperationCallbacks {
  resolve: (value: any) => void
  reject: (reason?: any) => void
  onData?: (data: any) => void // For ongoing subscription data
}
