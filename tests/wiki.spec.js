/**
 * WikiFlow - Browser E2E Tests
 */

const { test, expect } = require('@playwright/test');

test.describe('WikiFlow Web App Tests', () => {
  
  test.beforeEach(async ({ page }) => {
    // Load home page served by Python server
    await page.goto('http://localhost:8080');
  });

  test('should load welcome card and enter sandbox mode', async ({ page }) => {
    // 1. Verify Welcome Shell structure
    await expect(page).toHaveTitle(/WikiFlow/);
    await expect(page.locator('#welcomeShell h2')).toHaveText('Welcome to WikiFlow');

    // 2. Click Sandbox Mode CTA
    await page.click('#demoWorkspaceBtn');

    // 3. Verify Shell Transitions
    await expect(page.locator('#welcomeShell')).toBeHidden();
    await expect(page.locator('#appShell')).toBeVisible();

    // 4. Verify Active Page loads "Welcome" note
    await expect(page.locator('#activeNoteTitle')).toHaveText('Welcome');
    await expect(page.locator('#previewContent h1')).toContainText('Welcome to WikiFlow!');
  });

  test('should support nested file tree and collapse interactions', async ({ page }) => {
    await page.click('#demoWorkspaceBtn');

    // 1. Verify files/folders are listed in tree
    await expect(page.locator('.folder-item:has-text("Guides")')).toBeVisible();
    await expect(page.locator('.file-item:has-text("Tutorial")')).toBeVisible();

    // 2. Verify subfolder is expanded by default on scan
    const guidesChildren = page.locator('.folder-item:has-text("Guides") .folder-children');
    await expect(guidesChildren).toBeVisible();
    await expect(guidesChildren.locator('.file-item')).toContainText('Style Guide');

    // 3. Toggle collapse on Guides folder
    await page.click('.folder-item:has-text("Guides") .folder-title');
    await expect(guidesChildren).toBeHidden();

    // 4. Toggle expand back
    await page.click('.folder-item:has-text("Guides") .folder-title');
    await expect(guidesChildren).toBeVisible();
  });

  test('should handle layout switches and dark/light themes', async ({ page }) => {
    await page.click('#demoWorkspaceBtn');

    // 1. Theme toggle verification
    const html = page.locator('html');
    const initialTheme = await html.getAttribute('data-theme');
    expect(['light', 'dark']).toContain(initialTheme);
    
    await page.click('#themeToggleBtn');
    const expectedTheme = initialTheme === 'dark' ? 'light' : 'dark';
    await expect(html).toHaveAttribute('data-theme', expectedTheme);

    // 2. Layout panel toggling
    const panels = page.locator('#workspacePanels');
    await expect(panels).not.toHaveClass(/edit-only/);
    await expect(panels).not.toHaveClass(/preview-only/);
    
    await page.click('#layoutEditBtn');
    await expect(panels).toHaveClass(/edit-only/);
    
    await page.click('#layoutPreviewBtn');
    await expect(panels).toHaveClass(/preview-only/);

    await page.click('#layoutSplitBtn');
    await expect(panels).toHaveClass(/split-only/);
  });

  test('should support note editing, previewing, and autosaving', async ({ page }) => {
    await page.click('#demoWorkspaceBtn');

    // 1. Focus editor and add changes
    const textarea = page.locator('#editorTextarea');
    await textarea.focus();
    await textarea.fill('# Sandbox Custom Note\n\nTesting auto saving...');

    // 2. Verify Save Indicator switches to Editing state
    const saveIndicator = page.locator('#saveStatus');
    await expect(saveIndicator).toHaveClass(/dirty/);
    await expect(saveIndicator.locator('span')).toHaveText('Editing...');

    // 3. Wait for Autosave debounce (1.2s timeout) and verify Saved state
    await page.waitForTimeout(1600);
    await expect(saveIndicator).toHaveClass(/saved/);
    await expect(saveIndicator.locator('span')).toHaveText('Saved');

    // 4. Verify preview pane rendered HTML content
    await expect(page.locator('#previewContent h1')).toHaveText('Sandbox Custom Note');
  });

  test('should support flat namespace wiki links and folder collapse-all', async ({ page }) => {
    await page.click('#demoWorkspaceBtn');

    // 1. Navigate via cased link from Welcome to Tutorial note
    await page.click('a[data-page="Tutorial"]');
    await expect(page.locator('#activeNoteTitle')).toHaveText('Tutorial');

    // 2. Test flat suffix resolution: link in Welcome is [[Style Guide]] 
    // which should load Guides/Style Guide.
    await page.goto('http://localhost:8080/#/page/Welcome');
    await page.click('a[data-page="Guides/Style Guide"]');
    await expect(page.locator('#activeNoteTitle')).toHaveText('Guides/Style Guide');

    // 3. Test collapse all button folds all folders
    const guidesChildren = page.locator('.folder-item:has-text("Guides") .folder-children');
    await expect(guidesChildren).toBeVisible();
    
    await page.click('#sidebarCollapseAllBtn');
    await expect(guidesChildren).toBeHidden();
  });
});
