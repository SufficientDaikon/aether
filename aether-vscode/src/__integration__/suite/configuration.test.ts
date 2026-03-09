import * as assert from 'assert';
import * as vscode from 'vscode';
import { getExtension } from '../fixtures/extension-fixture';

suite('Configuration Test Suite', () => {
  let config: vscode.WorkspaceConfiguration;

  setup(async () => {
    await getExtension(5000);
    config = vscode.workspace.getConfiguration('aether');
  });

  test('Should read aether.runtimePath setting', () => {
    const runtimePath = config.get<string>('runtimePath');
    assert.ok(runtimePath !== undefined, 'runtimePath should be defined');
    assert.strictEqual(typeof runtimePath, 'string');
  });

  test('Should update aether.budgetLimit setting', async () => {
    const newLimit = 100;
    await config.update('budgetLimit', newLimit, vscode.ConfigurationTarget.Global);
    
    const updatedConfig = vscode.workspace.getConfiguration('aether');
    const budgetLimit = updatedConfig.get<number>('budgetLimit');
    
    assert.strictEqual(budgetLimit, newLimit, 'Budget limit should be updated');
    
    // Reset to default
    await config.update('budgetLimit', 0, vscode.ConfigurationTarget.Global);
  });

  test('Should read aether.autoApprove default (none)', () => {
    const autoApprove = config.get<string>('autoApprove');
    assert.strictEqual(autoApprove, 'none', 'Default autoApprove should be "none"');
  });

  test('Should read aether.showCostInStatusBar default (true)', () => {
    const showCost = config.get<boolean>('showCostInStatusBar');
    assert.strictEqual(showCost, true, 'Default showCostInStatusBar should be true');
  });

  test('Should read aether.defaultContext default', () => {
    const defaultContext = config.get<string>('defaultContext');
    assert.strictEqual(defaultContext, 'default', 'Default context should be "default"');
  });
});
