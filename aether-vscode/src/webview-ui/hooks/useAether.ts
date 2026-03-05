// ─────────────────────────────────────────────────────────────
// useAether — Bridge hook for extension <-> webview messaging
//
// Provides a typed API for webview code to communicate with
// the extension host via vscode.postMessage / onMessage.
// ─────────────────────────────────────────────────────────────

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

let _vscode: VsCodeApi | null = null;

function getVsCode(): VsCodeApi {
  if (!_vscode) {
    _vscode = acquireVsCodeApi();
  }
  return _vscode;
}

export type MessageHandler = (data: {
  type: string;
  data?: string;
  [key: string]: unknown;
}) => void;

/**
 * Send a message to the extension host.
 */
export function postMessage(
  type: string,
  payload?: Record<string, unknown>,
): void {
  getVsCode().postMessage({ type, ...payload });
}

/**
 * Listen for messages from the extension host.
 * Returns an unsubscribe function.
 */
export function onMessage(handler: MessageHandler): () => void {
  const listener = (event: MessageEvent) => {
    handler(event.data);
  };
  window.addEventListener("message", listener);
  return () => window.removeEventListener("message", listener);
}

/**
 * Request agents from the extension and return via callback.
 */
export function requestAgents(callback: (agents: string) => void): void {
  const unsub = onMessage((msg) => {
    if (msg.type === "agents" && msg.data) {
      unsub();
      callback(msg.data);
    }
  });
  postMessage("getAgents");
}

/**
 * Request system status from the extension.
 */
export function requestStatus(callback: (status: string) => void): void {
  const unsub = onMessage((msg) => {
    if (msg.type === "status" && msg.data) {
      unsub();
      callback(msg.data);
    }
  });
  postMessage("getStatus");
}

/**
 * Search memory via the extension bridge.
 */
export function searchMemory(
  query: string,
  topK: number,
  callback: (results: string) => void,
): void {
  const unsub = onMessage((msg) => {
    if (msg.type === "searchResults" && msg.data) {
      unsub();
      callback(msg.data);
    }
  });
  postMessage("search", { query, topK });
}

/**
 * Persist state across webview visibility changes.
 */
export function saveState(state: unknown): void {
  getVsCode().setState(state);
}

export function loadState<T>(): T | undefined {
  return getVsCode().getState() as T | undefined;
}
