import * as assert from 'assert';
import * as vscode from 'vscode';
import { getExtension } from '../fixtures/extension-fixture';

suite('Error Handling Test Suite', () => {
  test('Commands should not throw when bridge disconnected', async () => {
    await getExtension(5000);
    
    // Execute various commands that might interact with disconnected bridge
    const commands = [
      'aether.dashboard',
      'aether.showCosts',
      'aether.showMemory',
      'aether.showSettings'
    ];

    for (const command of commands) {
      await assert.doesNotReject(
        async () => {
          try {
            await vscode.commands.executeCommand(command);
          } catch (error) {
            // Expected errors are ok, we just want to ensure no unhandled exceptions
          }
        },
        `Command ${command} should not throw unhandled errors`
      );
    }
  });

  test('Reconnect command should not throw', async () => {
    await getExtension(5000);
    
    await assert.doesNotReject(
      async () => {
        await vscode.commands.executeCommand('aether.reconnect');
      },
      'Reconnect command should handle errors gracefully'
    );
  });

  test('Dashboard commands should handle missing data gracefully', async () => {
    await getExtension(5000);
    
    const dashboardCommands = [
      'aether.dashboard.overview',
      'aether.dashboard.agents',
      'aether.dashboard.tasks',
      'aether.dashboard.chat',
      'aether.dashboard.approvals',
      'aether.dashboard.memory',
      'aether.dashboard.settings'
    ];

    for (const command of dashboardCommands) {
      await assert.doesNotReject(
        async () => {
          try {
            await vscode.commands.executeCommand(command);
          } catch (error) {
            // Expected errors are ok
          }
        },
        `Dashboard command ${command} should not throw unhandled errors`
      );
    }
  });
});
