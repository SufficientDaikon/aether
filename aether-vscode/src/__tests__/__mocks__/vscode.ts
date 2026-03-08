// Mock VS Code API for unit tests (extension host code)

import { vi } from "vitest";

const mockOutputChannel = {
  appendLine: vi.fn(),
  append: vi.fn(),
  show: vi.fn(),
  clear: vi.fn(),
  dispose: vi.fn(),
  name: "AETHER",
};

const mockWebview = {
  html: "",
  options: {},
  cspSource: "vscode-resource:",
  postMessage: vi.fn().mockResolvedValue(true),
  onDidReceiveMessage: vi.fn().mockReturnValue({ dispose: vi.fn() }),
  asWebviewUri: vi.fn((uri: any) => uri),
};

const mockWebviewView = {
  webview: mockWebview,
  visible: true,
  show: vi.fn(),
  onDidDispose: vi.fn().mockReturnValue({ dispose: vi.fn() }),
  onDidChangeVisibility: vi.fn().mockReturnValue({ dispose: vi.fn() }),
};

const mockWebviewPanel = {
  webview: mockWebview,
  visible: true,
  active: true,
  title: "AETHER Dashboard",
  reveal: vi.fn(),
  dispose: vi.fn(),
  iconPath: undefined,
  onDidDispose: vi.fn().mockReturnValue({ dispose: vi.fn() }),
  onDidChangeViewState: vi.fn().mockReturnValue({ dispose: vi.fn() }),
};

const mockExtensionContext = {
  extensionUri: { fsPath: "/mock/extension", scheme: "file" },
  extensionPath: "/mock/extension",
  globalState: {
    get: vi.fn(),
    update: vi.fn().mockResolvedValue(undefined),
    keys: vi.fn().mockReturnValue([]),
  },
  workspaceState: {
    get: vi.fn(),
    update: vi.fn().mockResolvedValue(undefined),
    keys: vi.fn().mockReturnValue([]),
  },
  subscriptions: [],
  secrets: { get: vi.fn(), store: vi.fn(), delete: vi.fn() },
  asAbsolutePath: vi.fn((p: string) => `/mock/extension/${p}`),
  storagePath: "/mock/storage",
  globalStoragePath: "/mock/global-storage",
  logPath: "/mock/logs",
  extensionMode: 1,
};

// URI mock
class MockUri {
  fsPath: string;
  scheme: string;
  path: string;

  constructor(scheme: string, authority: string, path: string) {
    this.scheme = scheme;
    this.path = path;
    this.fsPath = path;
  }

  static file(path: string) {
    return new MockUri("file", "", path);
  }

  static joinPath(base: any, ...parts: string[]) {
    const joined = [base.path ?? base.fsPath ?? "", ...parts].join("/");
    return { fsPath: joined, path: joined, scheme: "file", toString: () => joined };
  }

  static parse(str: string) {
    return new MockUri("https", "", str);
  }

  toString() {
    return `${this.scheme}://${this.path}`;
  }
}

export const Uri = MockUri;
export const EventEmitter = class {
  event = vi.fn();
  fire = vi.fn();
  dispose = vi.fn();
};

export const window = {
  createOutputChannel: vi.fn().mockReturnValue(mockOutputChannel),
  createWebviewPanel: vi.fn().mockReturnValue(mockWebviewPanel),
  registerWebviewViewProvider: vi.fn().mockReturnValue({ dispose: vi.fn() }),
  createStatusBarItem: vi.fn().mockReturnValue({
    text: "",
    tooltip: "",
    command: "",
    show: vi.fn(),
    hide: vi.fn(),
    dispose: vi.fn(),
  }),
  showInformationMessage: vi.fn(),
  showWarningMessage: vi.fn(),
  showErrorMessage: vi.fn(),
  showInputBox: vi.fn(),
  showQuickPick: vi.fn(),
  registerTreeDataProvider: vi.fn().mockReturnValue({ dispose: vi.fn() }),
  withProgress: vi.fn(),
};

export const commands = {
  registerCommand: vi.fn().mockReturnValue({ dispose: vi.fn() }),
  executeCommand: vi.fn(),
};

export const workspace = {
  getConfiguration: vi.fn().mockReturnValue({
    get: vi.fn().mockReturnValue(""),
    update: vi.fn(),
    has: vi.fn().mockReturnValue(false),
  }),
  workspaceFolders: undefined,
  fs: {
    stat: vi.fn().mockRejectedValue(new Error("not found")),
    readFile: vi.fn(),
    writeFile: vi.fn(),
  },
  openTextDocument: vi.fn(),
  onDidChangeConfiguration: vi.fn().mockReturnValue({ dispose: vi.fn() }),
};

export const languages = {
  registerCodeLensProvider: vi.fn().mockReturnValue({ dispose: vi.fn() }),
  createDiagnosticCollection: vi.fn().mockReturnValue({ dispose: vi.fn() }),
};

export const chat = {
  createChatParticipant: vi.fn().mockReturnValue({ dispose: vi.fn() }),
};

export const StatusBarAlignment = { Left: 1, Right: 2 };
export const ViewColumn = { One: 1, Two: 2, Three: 3, Active: -1 };
export const DiagnosticSeverity = { Error: 0, Warning: 1, Information: 2, Hint: 3 };
export const CodeLensProvider = class {};
export const CancellationTokenSource = class {
  token = { isCancellationRequested: false, onCancellationRequested: vi.fn() };
  cancel = vi.fn();
  dispose = vi.fn();
};

export const Disposable = {
  from: (...d: any[]) => ({ dispose: () => d.forEach((x) => x?.dispose?.()) }),
};

export const ExtensionMode = { Production: 1, Development: 2, Test: 3 };

// Named exports matching what extension code imports
export { mockOutputChannel, mockWebviewView, mockWebviewPanel, mockExtensionContext };
