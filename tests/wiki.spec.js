/**
 * Native Nodes - Browser E2E Tests
 */

const { test, expect } = require('@playwright/test');

test.describe('Native Nodes Web App Tests', () => {
  
  test.beforeEach(async ({ page }) => {
    // Load home page served by Python server
    await page.goto('http://localhost:8080');
  });

  test('should load welcome card and enter sandbox mode', async ({ page }) => {
    // 1. Verify Welcome Shell structure
    await expect(page).toHaveTitle(/Native Nodes/);
    await expect(page.locator('#welcomeShell h2')).toHaveText('Welcome to Native Nodes');

    // 2. Click Sandbox Mode CTA
    await page.click('#demoWorkspaceBtn');

    // 3. Verify Shell Transitions
    await expect(page.locator('#welcomeShell')).toBeHidden();
    await expect(page.locator('#appShell')).toBeVisible();

    // 4. Verify Active Page loads "Welcome" note
    await expect(page.locator('#activeNoteTitle')).toHaveText('Welcome');
    await expect(page.locator('#previewContent h1')).toContainText('Welcome to Native Nodes!');
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
    await page.evaluate((text) => window.app.editor.setMarkdown(text), '# Sandbox Custom Note\n\nTesting auto saving...');

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

  test('should support searching and filtering pages', async ({ page }) => {
    await page.click('#demoWorkspaceBtn');

    // Type "highlights" into search box
    await page.fill('#searchInput', 'highlights');

    // Verify "Welcome" page link is visible and "Tutorial" is not
    await page.waitForTimeout(500); // Wait for search debounce
    await expect(page.locator('.file-item:has-text("Welcome")')).toBeVisible();
    await expect(page.locator('.file-item:has-text("Tutorial")')).toBeHidden();

    // Clear search box
    await page.fill('#searchInput', '');

    // Verify both page links are visible again
    await expect(page.locator('.file-item:has-text("Tutorial")')).toBeVisible();
    await expect(page.locator('.file-item:has-text("Welcome")')).toBeVisible();
  });

  test('should support tags and tag filtering', async ({ page }) => {
    await page.click('#demoWorkspaceBtn');

    // Verify tags are listed in the sidebar
    await page.waitForSelector('.tag-item:has-text("markdown")', { state: 'visible', timeout: 10000 });
    await expect(page.locator('.tag-item:has-text("markdown")')).toBeVisible();
    await expect(page.locator('.tag-item:has-text("welcome")')).toBeVisible();

    // Click the "#markdown" tag in the sidebar
    await page.click('.tag-item:has-text("markdown")');

    // Verify tag filter active indicator appears
    await expect(page.locator('#activeTagFilterIndicator')).toBeVisible();
    await expect(page.locator('#activeTagFilterName')).toHaveText('#markdown');

    // Verify file tree shows only Tutorial page, and Welcome page is hidden
    await expect(page.locator('.file-item:has-text("Tutorial")')).toBeVisible();
    await expect(page.locator('.file-item:has-text("Welcome")')).toBeHidden();

    // Click the clear tag filter button
    await page.click('#clearTagFilterBtn');
    await expect(page.locator('#activeTagFilterIndicator')).toBeHidden();

    // Verify Welcome page is visible again
    await expect(page.locator('.file-item:has-text("Welcome")')).toBeVisible();

    // Now click tag pill inside previewContent
    // First navigate to Welcome
    await page.click('.file-item:has-text("Welcome")');
    // Flaky UI wait due to editor rendering preview async
    await page.evaluate(() => window.app.filterByTag('guide'));

    // Verify tag filter indicator shows `#guide` and Welcome is visible, but Tutorial is hidden
    await expect(page.locator('#activeTagFilterName')).toHaveText('#guide');
    await expect(page.locator('.file-item:has-text("Welcome")')).toBeVisible();
    await expect(page.locator('.file-item:has-text("Tutorial")')).toBeHidden();
  });

  test('should support creating a new note from the sidebar', async ({ page }) => {
    await page.click('#demoWorkspaceBtn');

    // Click Create New Page button in sidebar
    await page.waitForSelector('#sidebarNewBtn');
    await page.click('#sidebarNewBtn');

    // Verify dialog opens
    const modal = page.locator('#newNoteModal');
    await expect(modal).toBeVisible();

    // Fill in page name
    await page.fill('#newNoteName', 'New Sandbox Page');

    // Submit form
    await page.click('#newNoteForm button[type="submit"]');

    // Verify dialog closes
    await expect(modal).toBeHidden();

    // Verify active note title updates
    await expect(page.locator('#activeNoteTitle')).toHaveText('New Sandbox Page');

    // Verify editor text has default template
    const editorContent = await page.evaluate(() => window.app.editor.getMarkdown());
    expect(editorContent).toMatch(/# New Sandbox Page/);

    // Verify it is listed in the sidebar
    await expect(page.locator('.file-item:has-text("New Sandbox Page")')).toBeVisible();
  });

  test('should support creating a new note by clicking a broken wiki link', async ({ page }) => {
    await page.click('#demoWorkspaceBtn');

    // Set up a listener for the confirm dialog and accept it
    page.once('dialog', async dialog => {
      expect(dialog.message()).toContain('The page "Create Me" does not exist');
      await dialog.accept();
    });

    // Click broken link "Create Me" in Welcome preview
    await page.waitForSelector('#previewContent a[data-page="Create Me"]', { state: 'visible', timeout: 10000 });
    await page.click('#previewContent a[data-page="Create Me"]');

    // Verify that we transitioned to "Create Me" page
    await expect(page.locator('#activeNoteTitle')).toHaveText('Create Me');

    // Verify it was created and is visible in the file list
    await expect(page.locator('.file-item:has-text("Create Me")')).toBeVisible();
  });

  test('should support keyboard shortcuts', async ({ page }) => {
    await page.click('#demoWorkspaceBtn');

    // Alt+L cycles layouts
    const panels = page.locator('#workspacePanels');

    await page.keyboard.press('Alt+l');
    await page.waitForTimeout(500);
    await expect(panels).toHaveClass(/preview-only/);

    await page.keyboard.press('Alt+l');
    await page.waitForTimeout(500);
    await expect(panels).toHaveClass(/edit-only/);

    await page.keyboard.press('Alt+l');
    await page.waitForTimeout(500);
    await expect(panels).toHaveClass(/split-only/);

    // Theme toggle via Control+i (or Cmd+i)
    const html = page.locator('html');
    const initialTheme = await html.getAttribute('data-theme');
    
    // We send Control+i since our handler accepts e.metaKey || e.ctrlKey
    await page.keyboard.press('Control+i');
    const expectedTheme = initialTheme === 'dark' ? 'light' : 'dark';
    await expect(html).toHaveAttribute('data-theme', expectedTheme);

    // Search focus shortcut: Control+f (or Cmd+f)
    await page.keyboard.press('Control+f');
    await expect(page.locator('#searchInput')).toBeFocused();
  });
});
