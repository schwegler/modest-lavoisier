/**
 * WikiFlow - Electron Desktop App E2E Tests
 */

const { _electron: electron } = require('@playwright/test');
const { test, expect } = require('@playwright/test');

test.describe('WikiFlow Electron Desktop Tests', () => {
  let electronApp;
  let page;

  test.beforeAll(async () => {
    // Launch Electron process pointing to our directory root
    electronApp = await electron.launch({
      args: ['.']
    });
    // Retrieve the first open window
    page = await electronApp.firstWindow();
  });

  test.afterAll(async () => {
    if (electronApp) {
      await electronApp.close();
    }
  });

  test('should launch desktop app shell and inject Electron specific variables', async () => {
    // 1. Verify standard title loads
    await expect(page).toHaveTitle(/WikiFlow/);
    await expect(page.locator('#welcomeShell h2')).toHaveText('Welcome to WikiFlow');

    // 2. Open sandbox mock workspace
    await page.click('#demoWorkspaceBtn');
    await expect(page.locator('#appShell')).toBeVisible();

    // 3. Verify Electron-specific class injection on body
    const body = page.locator('body');
    await expect(body).toHaveClass(/electron-window/);

    // 4. Verify macOS header spacing is applied via CSS overrides
    const header = page.locator('header.main-header');
    const paddingLeft = await header.evaluate(el => window.getComputedStyle(el).paddingLeft);
    expect(paddingLeft).toBe('80px'); // 80px left padding ensures traffic light controls clear note title
  });

  test('should enable editing and link navigation within Electron runtime', async () => {
    // 0. Ensure split layout is active so editor is visible
    await page.click('#layoutSplitBtn');

    // 1. Click Nested Guide wiki link
    await page.click('a[data-page="Guides/Style Guide"]');
    await expect(page.locator('#activeNoteTitle')).toHaveText('Guides/Style Guide');

    // 2. Verify editor textarea loads content correctly
    const textarea = page.locator('#editorTextarea');
    await expect(textarea).toHaveValue(/This is a sample page nested inside a subfolder/);

    // 3. Edit content
    await textarea.focus();
    await textarea.fill('# Edited Desktop Page\n\nWikiFlow runs natively in Electron!');
    
    // 4. Verify preview render updates cased headers
    await expect(page.locator('#previewContent h1')).toHaveText('Edited Desktop Page');
  });
});
