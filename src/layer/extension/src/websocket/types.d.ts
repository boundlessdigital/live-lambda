import WebSocket from 'ws';
export interface AppSyncEventWebSocketClientOptions {
    region: string;
    http: string;
    realtime: string;
    profile?: string;
    on_data?: (subscription_id: string, event_data: any) => void;
    on_error?: (error: any) => void;
    on_close?: (event: WebSocket.CloseEvent) => void;
    on_open?: () => void;
}
export interface WebSocketMessage {
    type: string;
    id?: string;
    payload?: any;
    event?: any;
    connectionTimeoutMs?: number;
    errors?: any[];
    channel?: string;
    authorization?: Record<string, string>;
    events?: string[];
}
export interface OperationCallbacks {
    resolve: (value: any) => void;
    reject: (reason?: any) => void;
    onData?: (data: any) => void;
}
