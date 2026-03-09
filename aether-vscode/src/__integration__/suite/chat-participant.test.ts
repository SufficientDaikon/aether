import * as assert from 'assert';
import * as vscode from 'vscode';
import { getExtension } from '../fixtures/extension-fixture';

suite('Chat Participant Test Suite', () => {
  test('Chat participant should be registered', async () => {
    await getExtension(5000);
    // Chat participants are registered via package.json contributes.chatParticipants
    // We can verify the extension activated (which registers the participant handler)
    const extension = vscode.extensions.getExtension('sufficientdaikon.aether-vscode');
    assert.ok(extension?.isActive, 'Extension should be active (chat participant registered)');
  });

  test('Chat participant ID should match aether.chat', async () => {
    await getExtension(5000);
    // Verify via package.json contributes - the chat participant is declarative
    const extension = vscode.extensions.getExtension('sufficientdaikon.aether-vscode');
    const pkg = extension?.packageJSON;
    const participants = pkg?.contributes?.chatParticipants || [];
    const aetherChat = participants.find((p: any) => p.id === 'aether.chat');
    assert.ok(aetherChat, 'aether.chat participant should be declared');
  });

  test('Chat participant should declare slash commands', async () => {
    await getExtension(5000);
    const extension = vscode.extensions.getExtension('sufficientdaikon.aether-vscode');
    const pkg = extension?.packageJSON;
    const participants = pkg?.contributes?.chatParticipants || [];
    const aetherChat = participants.find((p: any) => p.id === 'aether.chat');
    const commands = aetherChat?.commands || [];
    
    const expectedCommands = ['plan', 'run', 'review', 'test', 'debug', 'architect', 'group', 'status', 'context'];
    for (const cmd of expectedCommands) {
      assert.ok(
        commands.some((c: any) => c.name === cmd),
        `Slash command /${cmd} should be declared`
      );
    }
  });
});
