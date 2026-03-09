import * as assert from 'assert';
import * as vscode from 'vscode';
import { getExtension } from '../fixtures/extension-fixture';

suite('Commands Registration Test Suite', () => {
  const expectedCommands = [
    'aether.reconnect',
    'aether.dashboard',
    'aether.dashboard.overview',
    'aether.dashboard.agents',
    'aether.dashboard.tasks',
    'aether.dashboard.chat',
    'aether.dashboard.approvals',
    'aether.dashboard.memory',
    'aether.dashboard.settings',
    'aether.runTask',
    'aether.planTask',
    'aether.showOrchestrator',
    'aether.showCosts',
    'aether.showMemory',
    'aether.showSettings',
    'aether.switchContext',
    'aether.approveAll',
    'aether.rejectAll'
  ];

  test('All 18 commands should be registered', async () => {
    await getExtension(5000);
    
    const allCommands = await vscode.commands.getCommands(true);
    
    for (const command of expectedCommands) {
      assert.ok(
        allCommands.includes(command),
        `Command ${command} should be registered`
      );
    }
  });

  test('Should have at least 18 aether commands', async () => {
    await getExtension(5000);
    
    const allCommands = await vscode.commands.getCommands(true);
    const aetherCommands = allCommands.filter(cmd => cmd.startsWith('aether.'));
    
    assert.ok(
      aetherCommands.length >= expectedCommands.length,
      `Should have at least ${expectedCommands.length} aether commands, found ${aetherCommands.length}`
    );
  });
});
