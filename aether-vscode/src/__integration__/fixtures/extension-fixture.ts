import * as vscode from 'vscode';

export async function getExtension(timeoutMs: number = 5000): Promise<vscode.Extension<any>> {
  const extensionId = 'sufficientdaikon.aether-vscode';
  
  const extension = vscode.extensions.getExtension<any>(extensionId);
  if (!extension) {
    throw new Error(`Extension ${extensionId} not found`);
  }

  // Wait for activation
  const startTime = Date.now();
  while (!extension.isActive && Date.now() - startTime < timeoutMs) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  if (!extension.isActive) {
    throw new Error(`Extension ${extensionId} did not activate within ${timeoutMs}ms`);
  }

  return extension;
}

export async function waitForActivation(timeoutMs: number = 5000): Promise<any> {
  const extension = await getExtension(timeoutMs);
  return extension.exports;
}
