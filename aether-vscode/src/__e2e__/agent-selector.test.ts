import { test, expect } from "@playwright/test";
import { launchVSCode } from "./fixtures/playwright-fixture";

test.describe("Agent Selector", () => {
  test("agent selector dropdown should be visible in header", async () => {
    const { page, cleanup } = await launchVSCode();
    try {
      // Look for the agent selector in the sidebar header
      const sidebar = page.locator('[data-testid="aether-sidebar"]');
      await expect(sidebar).toBeVisible({ timeout: 10000 });

      const agentSelector = sidebar.locator(
        '.agent-selector, [aria-label*="agent"], select'
      );
      await expect(agentSelector.first()).toBeVisible({ timeout: 5000 });
    } finally {
      await cleanup();
    }
  });

  test("agent selector should list available agents", async () => {
    const { page, cleanup } = await launchVSCode();
    try {
      const sidebar = page.locator('[data-testid="aether-sidebar"]');
      await expect(sidebar).toBeVisible({ timeout: 10000 });

      // Find select element and check it has options
      const select = sidebar.locator("select").first();
      await expect(select).toBeVisible({ timeout: 5000 });

      const options = await select.locator("option").count();
      expect(options).toBeGreaterThan(0);
    } finally {
      await cleanup();
    }
  });

  test("selecting an agent should update the active agent", async () => {
    const { page, cleanup } = await launchVSCode();
    try {
      const sidebar = page.locator('[data-testid="aether-sidebar"]');
      await expect(sidebar).toBeVisible({ timeout: 10000 });

      const select = sidebar.locator("select").first();
      await expect(select).toBeVisible({ timeout: 5000 });

      // Get initial value
      const initialValue = await select.inputValue();

      // Select a different option if available
      const options = await select.locator("option").allTextContents();
      if (options.length > 1) {
        await select.selectOption({ index: 1 });
        const newValue = await select.inputValue();
        expect(newValue).not.toBe(initialValue);
      }
    } finally {
      await cleanup();
    }
  });
});
