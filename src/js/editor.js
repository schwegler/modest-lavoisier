/**
 * Native Nodes - Editor & Markdown Subsystem
 * 
 * Handles rendering of Markdown text and extraction of Wiki style bracket links.
 */

import { marked } from 'https://esm.sh/marked@12.0.0';
import DOMPurify from 'https://esm.sh/dompurify@3.0.9';

/**
 * Escapes HTML characters to prevent XSS in attributes.
 * @param {string} unsafe 
 * @returns {string}
 */
export function escapeHTML(unsafe) {
  if (!unsafe) return "";
  return String(unsafe)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Preprocesses wiki-style [[Page Name]] or [[Page Name|Label]] links 
 * and transforms them into standard Markdown links with a custom scheme.
 * @param {string} text 
 * @returns {string}
 */
function preprocessWikiLinks(text) {
  if (!text) return '';
  return text.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (match, targetPage, label) => {
    const pageName = targetPage.trim();
    const finalLabel = (label || pageName).trim();
    return `[${finalLabel}](wikilink:${encodeURIComponent(pageName)})`;
  });
}

/**
 * Renders raw Markdown to sanitized HTML.
 * Resolves wikilinks against the list of existing page names.
 * 
 * @param {string} markdown 
 * @param {Set<string> | Map<string, Object>} existingPages Set of page names or Map of page objects
 * @returns {string} Sanitized HTML
 */
export function renderMarkdown(markdown, existingPages = new Set()) {
  if (!markdown) return '';
  const cleanMarkdown = stripFrontmatter(markdown);
  const preprocessed = preprocessWikiLinks(cleanMarkdown);

  const isMap = existingPages instanceof Map;

  // Configure custom marked renderer
  const renderer = {
    link(href, title, text) {
      if (href.startsWith('wikilink:')) {
        const pageName = decodeURIComponent(href.slice(9));
        const key = pageName.toLowerCase();
        
        let resolvedPageName = pageName;
        let exists = false;
        
        if (isMap) {
          // Fast path for O(1) exact lookup when using Map
          const exactMatch = existingPages.get(key);
          if (exactMatch && exactMatch.exists) {
            resolvedPageName = exactMatch.name;
            exists = true;
          } else {
            // Check for flat namespace match (suffix match)
            const suffix = '/' + key;
            for (const existingKey of existingPages.keys()) {
              if (existingKey.endsWith(suffix) && existingPages.get(existingKey).exists) {
                resolvedPageName = existingPages.get(existingKey).name;
                exists = true;
                break;
              }
            }
          }
        } else {
          // 1. Check for exact case-insensitive match (including directories)
          for (const existing of existingPages) {
            if (existing.toLowerCase() === key) {
              resolvedPageName = existing;
              exists = true;
              break;
            }
          }

          // 2. Check for flat namespace match (suffix match)
          if (!exists) {
            const suffix = '/' + key;
            for (const existing of existingPages) {
              if (existing.toLowerCase().endsWith(suffix)) {
                resolvedPageName = existing;
                exists = true;
                break;
              }
            }
          }
        }

        const className = exists ? 'wiki-link' : 'wiki-link broken';
        const titleAttr = exists 
          ? `Go to ${resolvedPageName}` 
          : `${pageName} (page does not exist - click to create)`;
        
        return `<a href="#/page/${encodeURIComponent(resolvedPageName)}" class="${className}" data-page="${escapeHTML(resolvedPageName)}" title="${escapeHTML(titleAttr)}">${text}</a>`;
      }
      
      // Default link behavior with target security
      const target = href.startsWith('http') ? ' target="_blank" rel="noopener noreferrer"' : '';
      return `<a href="${href}"${target} title="${title ? escapeHTML(title) : ''}">${text}</a>`;
    }
  };

  marked.use({ renderer });
  
  // Custom marked options for tables, gfm, lists, etc.
  const rawHTML = marked.parse(preprocessed, {
    gfm: true,
    breaks: true
  });
  
  return DOMPurify.sanitize(rawHTML);
}

/**
 * Extracts all unique wiki links target page names from a markdown text.
 * Used to compile connections for the graph view.
 * 
 * @param {string} markdown 
 * @returns {string[]} Array of raw targeted page names
 */
export function extractWikiLinks(markdown) {
  if (!markdown) return [];
  const cleanMarkdown = stripFrontmatter(markdown);
  const links = new Set();
  const regex = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
  let match;
  while ((match = regex.exec(cleanMarkdown)) !== null) {
    const pageName = match[1].trim();
    if (pageName) {
      links.add(pageName);
    }
  }
  return Array.from(links);
}

/**
 * Extracts tags from markdown frontmatter.
 * Frontmatter format:
 * ---
 * tags: [tag1, tag2]
 * ---
 * 
 * @param {string} markdown 
 * @returns {string[]} Array of tags
 */
export function extractTags(markdown) {
  if (!markdown) return [];
  const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
  const match = markdown.match(frontmatterRegex);
  if (match) {
    const frontmatterContent = match[1];
    const tagsMatch = frontmatterContent.match(/tags:\s*\[(.*?)\]/);
    if (tagsMatch) {
      const tagsString = tagsMatch[1];
      return tagsString.split(',')
        .map(t => t.trim())
        .filter(Boolean);
    }
  }
  return [];
}

/**
 * Strips frontmatter from markdown content.
 * 
 * @param {string} markdown 
 * @returns {string} Markdown without frontmatter
 */
export function stripFrontmatter(markdown) {
  if (!markdown) return '';
  const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
  return markdown.replace(frontmatterRegex, '');
}
