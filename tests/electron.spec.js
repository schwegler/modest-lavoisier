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
      args: ['.'],
      env: { ...process.env, PLAYWRIGHT_TEST: 'true' }
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
    if (process.platform === 'darwin') {
      expect(paddingLeft).toBe('80px'); // 80px left padding ensures traffic light controls clear note title
    } else {
      expect(paddingLeft).toBe('32px'); // Standard padding on non-mac platforms
    }
  });

  test('should enable editing and link navigation within Electron runtime', async () => {
    // Ensure we are in a workspace first
    if (await page.locator('#demoWorkspaceBtn').isVisible()) {
      await page.click('#demoWorkspaceBtn');
    }
    // 0. Ensure split layout is active so editor is visible
    await page.click('#layoutSplitBtn', { timeout: 10000 });

    // Wait for the layout to change so we know we're ready
    await expect(page.locator('#workspacePanels')).toHaveClass(/split-only/);

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

  test('should support selecting and restoring directory workspace in Electron', async () => {
    // We add an init script to mock showDirectoryPicker and IndexedDB storage
    await page.addInitScript(() => {
      class MockDirectoryHandle {
        constructor(name) {
          this.kind = 'directory';
          this.name = name;
        }
        async queryPermission() {
          return 'prompt';
        }
        async requestPermission() {
          return 'granted';
        }
        async *values() {
          // No files in mock directory for this test
        }
      }

      window.showDirectoryPicker = async () => {
        return new MockDirectoryHandle('schwegler-test');
      };

      const originalGet = IDBObjectStore.prototype.get;
      IDBObjectStore.prototype.get = function (key) {
        if (key === 'directoryHandle') {
          const request = {};
          setTimeout(() => {
            request.result = new MockDirectoryHandle('schwegler-test');
            if (request.onsuccess) request.onsuccess({ target: request });
          }, 0);
          return request;
        }
        return originalGet.apply(this, arguments);
      };
    });

    // Reset hash and reload the page so the init script takes effect
    await page.evaluate(() => {
      window.location.hash = '#/';
    });
    await page.reload();

    // The app should immediately detect the stored handle and display the restore button
    const restoreBtn = page.locator('#restoreFolderBtn');
    await expect(restoreBtn).toBeVisible();
    await expect(restoreBtn).toContainText('Unlock Workspace (schwegler-test)');

    // Click Unlock Workspace
    await restoreBtn.click();

    // It should load successfully and transition to appShell
    await expect(page.locator('#appShell')).toBeVisible();
    await expect(page.locator('#activeWorkspaceName')).toHaveText('schwegler-test');
  });

  test('should automatically restore workspace on startup if permission is already granted', async () => {
    // We add an init script to mock showDirectoryPicker and IndexedDB storage with permission 'granted'
    await page.addInitScript(() => {
      class MockDirectoryHandle {
        constructor(name) {
          this.kind = 'directory';
          this.name = name;
        }
        async queryPermission() {
          return 'granted';
        }
        async requestPermission() {
          return 'granted';
        }
        async *values() {
          // No files in mock directory for this test
        }
      }

      const originalGet = IDBObjectStore.prototype.get;
      IDBObjectStore.prototype.get = function (key) {
        if (key === 'directoryHandle') {
          const request = {};
          setTimeout(() => {
            request.result = new MockDirectoryHandle('schwegler-auto-restore');
            if (request.onsuccess) request.onsuccess({ target: request });
          }, 0);
          return request;
        }
        return originalGet.apply(this, arguments);
      };
    });

    // Reset hash and reload the page so the init script takes effect
    await page.evaluate(() => {
      window.location.hash = '#/';
    });
    await page.reload();

    // The app should automatically bypass the welcome screen and load the workspace
    await expect(page.locator('#appShell')).toBeVisible();
    await expect(page.locator('#activeWorkspaceName')).toHaveText('schwegler-auto-restore');
    await expect(page.locator('#restoreFolderBtn')).toBeHidden();
  });
});
