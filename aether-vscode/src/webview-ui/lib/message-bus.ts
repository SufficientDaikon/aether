// Typed message bus for Extension Host ↔ Webview communication

import type {
  WebviewRequest,
  ExtensionResponse,
  ExtensionEventMessage,
} from "./types";

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

let vscodeApi: ReturnType<typeof acquireVsCodeApi> | null = null;

function getVsCodeApi() {
  if (!vscodeApi) {
    vscodeApi = acquireVsCodeApi();
  }
  return vscodeApi;
}

type EventHandler = (data: any) => void;
type ResponseHandler = {
  resolve: (value: any) => void;
  reject: (reason: Error) => void;
};

const pendingRequests = new Map<string, ResponseHandler>();
const eventListeners = new Map<string, Set<EventHandler>>();
let messageId = 0;

function generateId(): string {
  return `msg_${++messageId}_${Date.now()}`;
}

// Send an RPC request and await response
export function rpcCall<T = any>(method: string, params?: any): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = generateId();
    const request: WebviewRequest = {
      id,
      type: "request",
      method,
      params,
      timestamp: Date.now(),
    };

    const timer = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error(`RPC timeout: ${method}`));
    }, 30_000);

    pendingRequests.set(id, {
      resolve: (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      reject: (reason) => {
        clearTimeout(timer);
        reject(reason);
      },
    });

    getVsCodeApi().postMessage(request);
  });
}

// Subscribe to extension events
export function onEvent(event: string, handler: EventHandler): () => void {
  if (!eventListeners.has(event)) {
    eventListeners.set(event, new Set());
  }
  eventListeners.get(event)!.add(handler);
  return () => eventListeners.get(event)?.delete(handler);
}

// Subscribe to all events
export function onAnyEvent(handler: EventHandler): () => void {
  return onEvent("*", handler);
}

// Handle incoming messages from extension host
function handleMessage(event: MessageEvent) {
  const msg = event.data;
  if (!msg || !msg.type) return;

  if (msg.type === "response") {
    const response = msg as ExtensionResponse;
    const pending = pendingRequests.get(response.correlationId);
    if (pending) {
      pendingRequests.delete(response.correlationId);
      if (response.error) {
        pending.reject(new Error(response.error.message));
      } else {
        pending.resolve(response.result);
      }
    }
  } else if (msg.type === "event") {
    const eventMsg = msg as ExtensionEventMessage;
    const handlers = eventListeners.get(eventMsg.event);
    if (handlers) {
      handlers.forEach((h) => h(eventMsg.data));
    }
    // Notify wildcard listeners
    const wildcardHandlers = eventListeners.get("*");
    if (wildcardHandlers) {
      wildcardHandlers.forEach((h) => h(eventMsg));
    }
  } else if (msg.type === "navigate") {
    // Tab navigation from extension host
    const handlers = eventListeners.get("navigate");
    if (handlers) {
      handlers.forEach((h) => h(msg.tab));
    }
  }
}

// Persist state
export function saveState(state: any) {
  getVsCodeApi().setState(state);
}

export function loadState<T = any>(): T | undefined {
  return getVsCodeApi().getState() as T | undefined;
}

// Signal ready to extension
export function signalReady() {
  getVsCodeApi().postMessage({ type: "ready" });
}

// Initialize the message bus
export function initMessageBus() {
  window.addEventListener("message", handleMessage);
}
