const { test, expect } = require('@playwright/test');

test.describe('Editor Utility Functions - extractWikiLinks', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:8080');
  });

  test('should extract simple wiki links', async ({ page }) => {
    const links = await page.evaluate(async () => {
      const { extractWikiLinks } = await import('./js/editor.js');
      return extractWikiLinks('Here is a [[WikiLink]] and another [[Page Two]].');
    });
    expect(links).toEqual(['WikiLink', 'Page Two']);
  });

  test('should handle empty or null input', async ({ page }) => {
    const emptyLinks = await page.evaluate(async () => {
      const { extractWikiLinks } = await import('./js/editor.js');
      return extractWikiLinks('');
    });
    expect(emptyLinks).toEqual([]);

    const nullLinks = await page.evaluate(async () => {
      const { extractWikiLinks } = await import('./js/editor.js');
      return extractWikiLinks(null);
    });
    expect(nullLinks).toEqual([]);
  });

  test('should extract links with labels and only return target page', async ({ page }) => {
    const links = await page.evaluate(async () => {
      const { extractWikiLinks } = await import('./js/editor.js');
      return extractWikiLinks('Check out [[Guides/Style Guide|the style guide]]');
    });
    expect(links).toEqual(['Guides/Style Guide']);
  });

  test('should extract unique links only', async ({ page }) => {
    const links = await page.evaluate(async () => {
      const { extractWikiLinks } = await import('./js/editor.js');
      return extractWikiLinks('[[Home]] and [[Home|Go Home]] and [[Home]]');
    });
    expect(links).toEqual(['Home']);
  });

  test('should trim whitespace from page names', async ({ page }) => {
    const links = await page.evaluate(async () => {
      const { extractWikiLinks } = await import('./js/editor.js');
      return extractWikiLinks('[[  Spaced Page  ]] and [[ Another Page | label ]]');
    });
    expect(links).toEqual(['Spaced Page', 'Another Page']);
  });

  test('should strip frontmatter before extracting links', async ({ page }) => {
    const links = await page.evaluate(async () => {
      const { extractWikiLinks } = await import('./js/editor.js');
      const markdown = `---
tags: [markdown, guide]
title: [[Not A Link]]
---
Actual link is [[Here]]`;
      return extractWikiLinks(markdown);
    });
    // Assuming stripFrontmatter strips out the entire frontmatter, including the bracketed "Not A Link"
    expect(links).toEqual(['Here']);
  });

});
