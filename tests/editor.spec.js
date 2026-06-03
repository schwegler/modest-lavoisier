const { test, expect } = require('@playwright/test');

test.describe('Editor Utility Functions - extractWikiLinks', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:8080');
  });

  test('should extract simple wiki links', async ({ page }) => {
    const links = await page.evaluate(async () => {
      const { extractWikiLinks } = await new Function("return import('./js/editor.js')")();
      return extractWikiLinks('Here is a [[WikiLink]] and another [[Page Two]].');
    });
    expect(links).toEqual(['WikiLink', 'Page Two']);
  });

  test('should handle empty or null input', async ({ page }) => {
    const emptyLinks = await page.evaluate(async () => {
      const { extractWikiLinks } = await new Function("return import('./js/editor.js')")();
      return extractWikiLinks('');
    });
    expect(emptyLinks).toEqual([]);

    const nullLinks = await page.evaluate(async () => {
      const { extractWikiLinks } = await new Function("return import('./js/editor.js')")();
      return extractWikiLinks(null);
    });
    expect(nullLinks).toEqual([]);
  });

  test('should extract links with labels and only return target page', async ({ page }) => {
    const links = await page.evaluate(async () => {
      const { extractWikiLinks } = await new Function("return import('./js/editor.js')")();
      return extractWikiLinks('Check out [[Guides/Style Guide|the style guide]]');
    });
    expect(links).toEqual(['Guides/Style Guide']);
  });

  test('should extract unique links only', async ({ page }) => {
    const links = await page.evaluate(async () => {
      const { extractWikiLinks } = await new Function("return import('./js/editor.js')")();
      return extractWikiLinks('[[Home]] and [[Home|Go Home]] and [[Home]]');
    });
    expect(links).toEqual(['Home']);
  });

  test('should trim whitespace from page names', async ({ page }) => {
    const links = await page.evaluate(async () => {
      const { extractWikiLinks } = await new Function("return import('./js/editor.js')")();
      return extractWikiLinks('[[  Spaced Page  ]] and [[ Another Page | label ]]');
    });
    expect(links).toEqual(['Spaced Page', 'Another Page']);
  });

  test('should strip frontmatter before extracting links', async ({ page }) => {
    const links = await page.evaluate(async () => {
      const { extractWikiLinks } = await new Function("return import('./js/editor.js')")();
      const markdown = `---
tags: [markdown, guide]
title: [[Not A Link]]
---
Actual link is [[Here]]`;
      return extractWikiLinks(markdown);
    });
    expect(links).toEqual(['Here']);
  });


  test('should return empty array for text without links', async ({ page }) => {
    const links = await page.evaluate(async () => {
      const { extractWikiLinks } = await new Function("return import('./js/editor.js')")();
      return extractWikiLinks('Just some regular text. No brackets here.');
    });
    expect(links).toEqual([]);
  });

  test('should ignore empty or whitespace-only links', async ({ page }) => {
    const links = await page.evaluate(async () => {
      const { extractWikiLinks } = await new Function("return import('./js/editor.js')")();
      return extractWikiLinks('Some text [[ ]] and [[ | label ]]');
    });
    expect(links).toEqual([]);
  });

  test('should ignore malformed links', async ({ page }) => {
    const links = await page.evaluate(async () => {
      const { extractWikiLinks } = await new Function("return import('./js/editor.js')")();
      return extractWikiLinks('Some [single bracket] and [[unclosed and unopened and [ [spaced] ]');
    });
    expect(links).toEqual([]);
  });

  test('should extract links with special characters', async ({ page }) => {
    const links = await page.evaluate(async () => {
      const { extractWikiLinks } = await new Function("return import('./js/editor.js')")();
      return extractWikiLinks('Languages like [[C++]] and [[Node.js]], paths like [[path/to/page]]');
    });
    expect(links).toEqual(['C++', 'Node.js', 'path/to/page']);
  });

  test('should be case-sensitive for unique links', async ({ page }) => {
    const links = await page.evaluate(async () => {
      const { extractWikiLinks } = await new Function("return import('./js/editor.js')")();
      return extractWikiLinks('[[Page]] and [[page]] are different');
    });
    expect(links).toEqual(['Page', 'page']);
  });

  test('should extract multiple links across different lines', async ({ page }) => {
    const links = await page.evaluate(async () => {
      const { extractWikiLinks } = await new Function("return import('./js/editor.js')")();
      const markdown = `# Header
      Here is [[Link 1]].

      And another [[Link 2]] here.`;
      return extractWikiLinks(markdown);
    });
    expect(links).toEqual(['Link 1', 'Link 2']);
  });

});
