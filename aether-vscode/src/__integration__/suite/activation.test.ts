import * as assert from 'assert';
import * as vscode from 'vscode';
import { getExtension } from '../fixtures/extension-fixture';

suite('Extension Activation Test Suite', () => {
  test('Extension should activate within 5 seconds', async () => {
    const extension = await getExtension(5000);
    assert.ok(extension.isActive, 'Extension should be active');
  });

  test('Extension should be properly loaded', async () => {
    const extension = await getExtension(5000);
    assert.ok(extension, 'Extension should be loaded');
    assert.strictEqual(extension.isActive, true, 'Extension should be activated');
  });

  test('Extension ID should match sufficientdaikon.aether-vscode', async () => {
    const extension = await getExtension(5000);
    assert.strictEqual(extension.id, 'sufficientdaikon.aether-vscode');
  });
});
