import { test as base, _electron as electron } from '@playwright/test';
import * as path from 'path';

export interface ElectronFixtures {
  electronApp: any;
  page: any;
}

export const test = base.extend<ElectronFixtures>({
  electronApp: async ({}, use) => {
    // Find VS Code executable
    const vscodeExecutable = process.platform === 'win32'
      ? 'C:\\Program Files\\Microsoft VS Code\\Code.exe'
      : process.platform === 'darwin'
      ? '/Applications/Visual Studio Code.app/Contents/MacOS/Electron'
      : '/usr/share/code/code';

    const extensionPath = path.resolve(__dirname, '../../../');
    const testWorkspace = path.resolve(__dirname, '../__integration__/fixtures/test-workspace');

    // Launch Electron
    const app = await electron.launch({
      executablePath: vscodeExecutable,
      args: [
        '--extensionDevelopmentPath=' + extensionPath,
        testWorkspace,
        '--disable-extensions',
        '--disable-gpu',
        '--no-sandbox'
      ]
    });

    await use(app);
    await app.close();
  },

  page: async ({ electronApp }, use) => {
    const page = await electronApp.firstWindow();
    await use(page);
  }
});

export { expect } from '@playwright/test';
