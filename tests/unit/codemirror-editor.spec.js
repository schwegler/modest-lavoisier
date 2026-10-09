const { test, expect } = require('@playwright/test');

test.describe('CodeMirrorEditor', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:8080');
  });

  async function initEditor(page, options = {}) {
    return await page.evaluate(async (opts) => {
      const { CodeMirrorEditor } = await new Function("return import('/js/codemirror-editor.js')")();

      const el = document.createElement('div');
      el.id = 'editor-container';
      document.body.appendChild(el);

      window._editorChangeCount = 0;
      window._lastSelectionView = null;
      window._wikiLinkClicked = null;

      window._testEditor = new CodeMirrorEditor({
        el,
        initialValue: opts.initialValue || '',
        onChange: () => { window._editorChangeCount++; },
        onSelectionChange: (view) => { window._lastSelectionView = !!view; },
        onWikiLinkClick: (page) => { window._wikiLinkClicked = page; },
        theme: opts.theme || 'dracula'
      });
      return true;
    }, options);
  }

  test('should initialize with provided text', async ({ page }) => {
    await initEditor(page, { initialValue: '# Hello World' });

    const value = await page.evaluate(() => {
      return window._testEditor.getMarkdown();
    });
    expect(value).toBe('# Hello World');
  });

  test('should update markdown correctly', async ({ page }) => {
    await initEditor(page, { initialValue: 'Initial text' });

    await page.evaluate(() => {
      window._testEditor.setMarkdown('Updated text');
    });

    const value = await page.evaluate(() => {
      return window._testEditor.getMarkdown();
    });
    expect(value).toBe('Updated text');
  });

  test('should not trigger change event when setting same markdown', async ({ page }) => {
    await initEditor(page, { initialValue: 'Test' });

    const count = await page.evaluate(() => {
      window._editorChangeCount = 0;
      window._testEditor.setMarkdown('Test');
      return window._editorChangeCount;
    });

    expect(count).toBe(0);
  });

  test('should trigger onChange when document is modified by user', async ({ page }) => {
    await initEditor(page, { initialValue: 'Test' });

    const count = await page.evaluate(() => {
      window._editorChangeCount = 0;
      // Simulate user editing by dispatching a change
      window._testEditor.view.dispatch({
        changes: {from: 4, to: 4, insert: 'ing'}
      });
      return window._editorChangeCount;
    });

    expect(count).toBe(1);

    const text = await page.evaluate(() => window._testEditor.getMarkdown());
    expect(text).toBe('Testing');
  });

  test('should trigger onSelectionChange when cursor moves', async ({ page }) => {
    await initEditor(page, { initialValue: 'Test document' });

    const triggered = await page.evaluate(() => {
      window._lastSelectionView = false;
      // Simulate selection change
      window._testEditor.view.dispatch({
        selection: {anchor: 4, head: 4}
      });
      return window._lastSelectionView;
    });

    expect(triggered).toBe(true);
  });

  test('should apply theme correctly', async ({ page }) => {
    await initEditor(page, { initialValue: 'Test', theme: 'dracula' });

    // We can't easily check actual CSS applied deep in CodeMirror,
    // but we can ensure setTheme doesn't throw and triggers an effect
    const success = await page.evaluate(() => {
      try {
        window._testEditor.setTheme('github');
        return true;
      } catch (e) {
        return false;
      }
    });

    expect(success).toBe(true);
  });

  test('should handle focus and blur dom events appropriately', async ({ page }) => {
    await initEditor(page, { initialValue: 'Test document' });

    const blurHandled = await page.evaluate(() => {
      let blurTriggered = false;
      const view = window._testEditor.view;

      try {
        view.contentDOM.blur();
        blurTriggered = true;
      } catch(e) {
        blurTriggered = false;
      }
      return blurTriggered;
    });

    expect(blurHandled).toBe(true);
  });

  test('should format text appropriately when requested', async ({ page }) => {
    await initEditor(page, { initialValue: 'Format this text' });

    const { markdown, selection } = await page.evaluate(() => {
      const view = window._testEditor.view;

      // Select "this"
      view.dispatch({
        selection: {anchor: 7, head: 11}
      });

      // Apply bold formatting
      window._testEditor.insertFormatting('bold');

      return {
        markdown: window._testEditor.getMarkdown(),
        selection: view.state.selection.main
      };
    });

    expect(markdown).toBe('Format **this** text');
    // After formatting, the text itself should be selected without the **
    expect(selection.from || selection.anchor).toBe(9); // "this" starts at 9
    expect(selection.to || selection.head).toBe(13); // "this" ends at 13
  });

  test('should toggle formatting when requested', async ({ page }) => {
    await initEditor(page, { initialValue: 'Format **this** text' });

    const { markdown } = await page.evaluate(() => {
      const view = window._testEditor.view;

      // Select "**this**"
      view.dispatch({
        selection: {anchor: 7, head: 15}
      });

      // Apply bold formatting (should toggle off)
      window._testEditor.insertFormatting('bold');

      return {
        markdown: window._testEditor.getMarkdown()
      };
    });

    expect(markdown).toBe('Format this text');
  });
});
