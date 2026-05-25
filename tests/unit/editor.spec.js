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
