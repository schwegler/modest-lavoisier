const { test, expect } = require('@playwright/test');

// We use Playwright's page.evaluate to run these tests in the browser context
// because the project uses ES modules natively without a build step for Node.js.

test.describe('extractTags', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:8080');
  });

  async function evaluateExtractTags(page, input) {
    return await page.evaluate(async (text) => {
      const { extractTags } = await new Function("return import('/js/editor.js')")();
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

test.describe('parseFrontmatter', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:8080');
  });

  async function evaluateParseFrontmatter(page, input) {
    return await page.evaluate(async (text) => {
      const { parseFrontmatter } = await new Function("return import('/js/editor.js')")();
      return parseFrontmatter(text);
    }, input);
  }

  test('should handle null/empty input', async ({ page }) => {
    const result1 = await evaluateParseFrontmatter(page, null);
    expect(result1).toEqual({ tags: [], fields: {} });

    const result2 = await evaluateParseFrontmatter(page, '');
    expect(result2).toEqual({ tags: [], fields: {} });
  });

  test('should return empty object for markdown without frontmatter', async ({ page }) => {
    const result = await evaluateParseFrontmatter(page, '# Heading\nJust some text');
    expect(result).toEqual({ tags: [], fields: {} });
  });

  test('should parse frontmatter with only normal fields', async ({ page }) => {
    const markdown = '---\ntitle: My Note\ndate: 2023-10-27\n---\n# Content';
    const result = await evaluateParseFrontmatter(page, markdown);
    expect(result).toEqual({
      tags: [],
      fields: {
        title: 'My Note',
        date: '2023-10-27'
      }
    });
  });

  test('should parse frontmatter with tags in bracket format', async ({ page }) => {
    const markdown = '---\ntags: [javascript, testing]\n---\n# Content';
    const result = await evaluateParseFrontmatter(page, markdown);
    expect(result).toEqual({
      tags: ['javascript', 'testing'],
      fields: {}
    });
  });

  test('should parse frontmatter with tags in comma-separated format', async ({ page }) => {
    const markdown = '---\ntags: javascript, testing\n---\n# Content';
    const result = await evaluateParseFrontmatter(page, markdown);
    expect(result).toEqual({
      tags: ['javascript', 'testing'],
      fields: {}
    });
  });

  test('should parse frontmatter with both fields and tags', async ({ page }) => {
    const markdown = '---\ntitle: test\ntags: [tag1, tag2]\nauthor: John Doe\n---\n# Content';
    const result = await evaluateParseFrontmatter(page, markdown);
    expect(result).toEqual({
      tags: ['tag1', 'tag2'],
      fields: {
        title: 'test',
        author: 'John Doe'
      }
    });
  });

  test('should handle Windows style line endings (CRLF)', async ({ page }) => {
    const markdown = '---\r\ntitle: My Note\r\ntags: [win, crlf]\r\n---\r\n# Content';
    const result = await evaluateParseFrontmatter(page, markdown);
    expect(result).toEqual({
      tags: ['win', 'crlf'],
      fields: {
        title: 'My Note'
      }
    });
  });
});

test.describe('stringifyFrontmatter', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:8080');
  });

  async function evaluateStringifyFrontmatter(page, tags, fields) {
    return await page.evaluate(async ({ tags, fields }) => {
      const { stringifyFrontmatter } = await new Function("return import('/js/editor.js')")();
      return stringifyFrontmatter(tags, fields);
    }, { tags, fields });
  }

  test('should stringify tags without fields', async ({ page }) => {
    const result = await evaluateStringifyFrontmatter(page, ['javascript', 'testing'], null);
    expect(result).toBe('---\ntags: [javascript, testing]\n---\n');
  });

  test('should stringify fields without tags', async ({ page }) => {
    const result = await evaluateStringifyFrontmatter(page, null, { title: 'My Note', author: 'John Doe' });
    expect(result).toBe('---\ntags: []\ntitle: My Note\nauthor: John Doe\n---\n');
  });

  test('should stringify both tags and fields', async ({ page }) => {
    const result = await evaluateStringifyFrontmatter(page, ['tag1', 'tag2'], { title: 'My Note' });
    expect(result).toBe('---\ntags: [tag1, tag2]\ntitle: My Note\n---\n');
  });

  test('should handle null/undefined inputs gracefully', async ({ page }) => {
    const result1 = await evaluateStringifyFrontmatter(page, null, null);
    expect(result1).toBe('---\ntags: []\n---\n');

    const result2 = await evaluateStringifyFrontmatter(page, undefined, undefined);
    expect(result2).toBe('---\ntags: []\n---\n');
  });

  test('should ignore tags key in fields object', async ({ page }) => {
    const result = await evaluateStringifyFrontmatter(page, ['real-tag'], { title: 'My Note', tags: 'should-be-ignored' });
    expect(result).toBe('---\ntags: [real-tag]\ntitle: My Note\n---\n');
  });

  test('should trim keys and values and ignore empty keys', async ({ page }) => {
    const result = await evaluateStringifyFrontmatter(page, [], {
      '  title  ': '  Spaced Title  ',
      '   ': 'empty key value'
    });
    expect(result).toBe('---\ntags: []\ntitle: Spaced Title\n---\n');
  });

  test('should stringify non-string values', async ({ page }) => {
    const result = await evaluateStringifyFrontmatter(page, [], { count: 42, isDraft: true });
    expect(result).toBe('---\ntags: []\ncount: 42\nisDraft: true\n---\n');
  });
});
