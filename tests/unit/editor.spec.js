const { test, expect } = require('@playwright/test');

// We use Playwright's page.evaluate to run these tests in the browser context
// because the project uses ES modules natively without a build step for Node.js.

test.describe('extractTags', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:8080');
  });

  async function evaluateExtractTags(page, input) {
    return await page.evaluate(async (text) => {
      const { extractTags } = await import('/js/editor.js');
      return extractTags(text);
    }, input);
  }

  test('should extract single tag', async ({ page }) => {
    const tags = await evaluateExtractTags(page, '---\ntags: [javascript]\n---\n# Content');
    expect(tags).toEqual(['javascript']);
  });

  test('should extract multiple tags', async ({ page }) => {
    const tags = await evaluateExtractTags(page, '---\ntags: [javascript, testing,  playwright ]\n---\n# Content');
    expect(tags).toEqual(['javascript', 'testing', 'playwright']);
  });

  test('should return empty array for markdown without frontmatter', async ({ page }) => {
    const tags = await evaluateExtractTags(page, '# Content\nThis is just markdown.');
    expect(tags).toEqual([]);
  });

  test('should return empty array for frontmatter without tags', async ({ page }) => {
    const tags = await evaluateExtractTags(page, '---\ntitle: My Note\ndate: 2023-10-27\n---\n# Content');
    expect(tags).toEqual([]);
  });

  test('should return empty array for empty tags array in frontmatter', async ({ page }) => {
    const tags = await evaluateExtractTags(page, '---\ntags: []\n---\n# Content');
    expect(tags).toEqual([]);
  });

  test('should handle empty markdown', async ({ page }) => {
    const tags = await evaluateExtractTags(page, '');
    expect(tags).toEqual([]);
  });

  test('should handle null/undefined input gracefully', async ({ page }) => {
    const tags = await evaluateExtractTags(page, null);
    expect(tags).toEqual([]);
  });

  test('should handle Windows style line endings (CRLF)', async ({ page }) => {
    const tags = await evaluateExtractTags(page, '---\r\ntags: [win, crlf]\r\n---\r\n# Content');
    expect(tags).toEqual(['win', 'crlf']);
  });
});

test.describe('renderMarkdown', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:8080');
  });

  async function evaluateRenderMarkdown(page, markdown, existingPages = []) {
    return await page.evaluate(async ({ text, pages }) => {
      const { renderMarkdown } = await import('/js/editor.js');
      return renderMarkdown(text, new Set(pages.map(p => p.toLowerCase())));
    }, { text: markdown, pages: existingPages });
  }

  test('should handle empty, null, or undefined input gracefully', async ({ page }) => {
    expect(await evaluateRenderMarkdown(page, '')).toBe('');
    expect(await evaluateRenderMarkdown(page, null)).toBe('');
  });

  test('should render basic markdown to HTML', async ({ page }) => {
    const html = await evaluateRenderMarkdown(page, '**Bold** and *Italic*');
    expect(html).toContain('<strong>Bold</strong>');
    expect(html).toContain('<em>Italic</em>');
  });

  test('should strip frontmatter before rendering', async ({ page }) => {
    const html = await evaluateRenderMarkdown(page, '---\ntitle: Hello\n---\n# Content');
    expect(html).not.toContain('title: Hello');
    expect(html).toMatch(/<h1.*>Content<\/h1>/);
  });

  test('should sanitize potentially dangerous HTML', async ({ page }) => {
    const html = await evaluateRenderMarkdown(page, '<script>alert("xss")</script> **Safe**');
    expect(html).not.toContain('<script>');
    expect(html).toMatch(/Safe/);
  });

  test('should render HTTP links with correct target and rel attributes', async ({ page }) => {
    const html = await evaluateRenderMarkdown(page, '[OpenAI](https://openai.com "Title")');
    expect(html).toContain('href="https://openai.com"');
    // DOMPurify strips target="_blank" by default unless configured with ADD_ATTR.
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('title="Title"');
    expect(html).toContain('>OpenAI</a>');
  });

  test('should render broken wiki links with broken class', async ({ page }) => {
    const html = await evaluateRenderMarkdown(page, 'Check out [[Missing Page]]');
    expect(html).toContain('href="#/page/Missing%20Page"');
    expect(html).toContain('class="wiki-link broken"');
    expect(html).toContain('data-page="Missing Page"');
    expect(html).toContain('title="Missing Page (page does not exist - click to create)"');
  });

  test('should render valid wiki links without broken class (exact match)', async ({ page }) => {
    const html = await evaluateRenderMarkdown(page, 'Check out [[Existing Page]]', ['Existing Page']);
    expect(html).toContain('href="#/page/existing%20page"');
    expect(html).toContain('class="wiki-link"');
    expect(html).toContain('data-page="existing page"');
    expect(html).toContain('title="Go to existing page"');
  });

  test('should render valid wiki links with flat namespace match', async ({ page }) => {
    const html = await evaluateRenderMarkdown(page, 'Check out [[Target]]', ['Folder/Target']);
    expect(html).toContain('href="#/page/folder%2Ftarget"');
    expect(html).toContain('class="wiki-link"');
    expect(html).toContain('data-page="folder/target"');
    expect(html).toContain('title="Go to folder/target"');
  });

  test('should handle wiki link labels correctly', async ({ page }) => {
    const html = await evaluateRenderMarkdown(page, 'Check out [[Target|My Label]]', ['Folder/Target']);
    expect(html).toContain('href="#/page/folder%2Ftarget"');
    expect(html).toContain('class="wiki-link"');
    expect(html).toContain('>My Label</a>');
  });
});
