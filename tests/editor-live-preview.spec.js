const { test, expect } = require('@playwright/test');

test.describe('Editor Live Preview Widgets', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:8080');
    await page.click('#demoWorkspaceBtn');
    
    // Wait for initial load to complete
    await expect(page.locator('#activeNoteTitle')).toHaveText('Welcome');
    const saveIndicator = page.locator('#saveStatus');
    await expect(saveIndicator).toHaveClass(/saved/);
  });

  test('should render images out of focus and show raw text on focus', async ({ page }) => {
    // 1. Set markdown with an empty line at the top, and image on the next line
    await page.evaluate(() => {
      window.app.editor.setMarkdown('\n![Alt Text](https://example.com/image.png)');
      // Focus cursor at position 0 (the empty line)
      window.app.editor.view.dispatch({
        selection: { anchor: 0, head: 0 }
      });
      window.app.editor.view.focus();
    });

    // 2. Since the editor selection is at line 1 (pos 0), the image on line 2 should render visually
    await expect(page.locator('.cm-image-widget')).toBeVisible();
    await expect(page.locator('.cm-image-widget')).toHaveAttribute('src', 'https://example.com/image.png');

    // 3. Move cursor to the image line (e.g. pos 5) to focus it
    await page.evaluate(() => {
      window.app.editor.view.dispatch({
        selection: { anchor: 5, head: 5 }
      });
      window.app.editor.view.focus();
    });
    
    // 4. Image widget should disappear, revealing raw text
    await expect(page.locator('.cm-content')).toContainText('![Alt Text](https://example.com/image.png)');
    await expect(page.locator('.cm-image-widget')).toBeHidden();
  });

  test('should render GFM tables out of focus and show raw text on focus', async ({ page }) => {
    // 1. Set markdown with empty line at start
    const tableMarkdown = '\n\n| Col 1 | Col 2 |\n|---|---|\n| Cell 1 | Cell 2 |';
    await page.evaluate((text) => {
      window.app.editor.setMarkdown(text);
      // Select pos 0
      window.app.editor.view.dispatch({
        selection: { anchor: 0, head: 0 }
      });
      window.app.editor.view.focus();
    }, tableMarkdown);

    // 2. Verify visual table is visible in live preview
    await expect(page.locator('.cm-live-table')).toBeVisible();
    await expect(page.locator('.cm-live-table th').first()).toHaveText('Col 1');
    await expect(page.locator('.cm-live-table td').first()).toHaveText('Cell 1');

    // 3. Move cursor to the table (e.g. pos 10)
    await page.evaluate(() => {
      window.app.editor.view.dispatch({
        selection: { anchor: 10, head: 10 }
      });
      window.app.editor.view.focus();
    });

    // 4. Verify table widget is hidden and raw markdown is visible
    await expect(page.locator('.cm-content')).toContainText('| Col 1 | Col 2 |');
    await expect(page.locator('.cm-live-table')).toBeHidden();
  });

  test('should render bullets and interactive checklist tasks', async ({ page }) => {
    // 1. Set markdown with an empty line at the top so cursor at 0 is out of focus
    const listMarkdown = '\n- Bullet item\n- [ ] Task 1\n- [x] Task 2';
    await page.evaluate((text) => {
      window.app.editor.setMarkdown(text);
      window.app.editor.view.dispatch({
        selection: { anchor: 0, head: 0 }
      });
    }, listMarkdown);

    // 2. Verify bullet and checklist checkboxes are visible in live preview
    await expect(page.locator('.cm-bullet-marker').first()).toBeVisible();
    await expect(page.locator('.cm-task-checkbox')).toHaveCount(2);

    // Verify checkbox states
    const firstCheckbox = page.locator('.cm-task-checkbox').first();
    const secondCheckbox = page.locator('.cm-task-checkbox').nth(1);
    await expect(firstCheckbox).not.toBeChecked();
    await expect(secondCheckbox).toBeChecked();

    // 3. Click the first checkbox to toggle it
    await firstCheckbox.click();

    // 4. Verify markdown text is updated to checked
    const updatedMarkdown = await page.evaluate(() => window.app.editor.getMarkdown());
    expect(updatedMarkdown).toContain('- [x] Task 1');

    // 5. Click it again to toggle back
    await firstCheckbox.click();
    const toggledBackMarkdown = await page.evaluate(() => window.app.editor.getMarkdown());
    expect(toggledBackMarkdown).toContain('- [ ] Task 1');
  });

  test('should focus raw block on clicking visual image and table widgets', async ({ page }) => {
    // 1. Set markdown with empty line, table, and image
    const contentMarkdown = '\n\n| Col |\n|---|\n| Cell |\n\n![Alt](https://example.com/image.png)';
    await page.evaluate((text) => {
      window.app.editor.setMarkdown(text);
      window.app.editor.view.dispatch({
        selection: { anchor: 0, head: 0 }
      });
    }, contentMarkdown);

    // Verify widgets are rendered and raw text is hidden
    await expect(page.locator('.cm-live-table-container')).toBeVisible();
    await expect(page.locator('.cm-image-widget')).toBeVisible();
    await expect(page.locator('.cm-content')).not.toContainText('| Col |');
    await expect(page.locator('.cm-content')).not.toContainText('![Alt]');

    // 2. Click the table container and verify it shifts selection and focuses the table (shows raw text)
    await page.click('.cm-live-table-container');
    await expect(page.locator('.cm-content')).toContainText('| Col |');
    await expect(page.locator('.cm-live-table-container')).toBeHidden();

    // 3. Move cursor back to position 0 (out of focus) to render image widget again
    await page.evaluate(() => {
      window.app.editor.view.dispatch({
        selection: { anchor: 0, head: 0 }
      });
    });
    await expect(page.locator('.cm-image-widget')).toBeVisible();

    // 4. Click the image widget and verify it focuses the image block (shows raw text)
    await page.click('.cm-image-widget');
    await expect(page.locator('.cm-content')).toContainText('![Alt](https://example.com/image.png)');
    await expect(page.locator('.cm-image-widget')).toBeHidden();
  });
});
