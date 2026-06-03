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
    table(header, body) {
      return `<table data-sortable="true">
        <thead>${header}</thead>
        <tbody>${body}</tbody>
      </table>`;
    },
    code(codeOrObj, infostring, escaped) {
      let codeText = '';
      let lang = '';
      if (typeof codeOrObj === 'object' && codeOrObj !== null) {
        codeText = codeOrObj.text || '';
        lang = codeOrObj.lang || '';
      } else {
        codeText = codeOrObj || '';
        lang = infostring || '';
      }
      if (lang === 'mermaid') {
        return `<div class="mermaid">${escapeHTML(codeText)}</div>`;
      }
      return `<pre><code class="language-${escapeHTML(lang)}">${escapeHTML(codeText)}</code></pre>`;
    },
    image(href, title, text) {
      let cleanHref = href;
      if (href.startsWith('wikilink:')) {
        cleanHref = decodeURIComponent(href.slice(9));
      }
      
      const key = cleanHref.toLowerCase();
      let resolvedUrl = href;
      
      if (isMap) {
        let foundPage = existingPages.get(key);
        if (!foundPage) {
          const suffix = '/' + key;
          for (const existingKey of existingPages.keys()) {
            if (existingKey.endsWith(suffix)) {
              foundPage = existingPages.get(existingKey);
              break;
            }
          }
        }
        
        if (foundPage && foundPage.isImage && foundPage.url) {
          resolvedUrl = foundPage.url;
        }
      }
      
      return `<div class="markdown-image-container">
        <img src="${escapeHTML(resolvedUrl)}" alt="${escapeHTML(text || cleanHref)}" title="${escapeHTML(title || '')}">
        ${text && text !== cleanHref ? `<span class="image-caption">${escapeHTML(text)}</span>` : ''}
      </div>`;
    },
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
  let rawHTML = marked.parse(preprocessed, {
    gfm: true,
    breaks: true
  });
  
  // Post-process footnotes in HTML
  // 1. Process Footnote Definitions: convert <p>[^label]: content</p> to block divs
  rawHTML = rawHTML.replace(/<p>\[\^([^\]]+)\]:\s*([\s\S]*?)<\/p>/g, (match, label, content) => {
    return `<div class="footnote-definition" id="fn-${label}">
      <span class="footnote-label"><a href="#fnref-${label}">[^${label}]</a>:</span>
      <span class="footnote-content">${content}</span>
    </div>`;
  });

  // 2. Process Footnote References: convert [^label] (not followed by colon) to sup link
  rawHTML = rawHTML.replace(/\[\^([^\]:]+)\](?!:)/g, (match, label) => {
    return `<sup class="footnote-ref" id="fnref-${label}"><a href="#fn-${label}">${label}</a></sup>`;
  });

  return DOMPurify.sanitize(rawHTML, {
    ADD_URI_SAFE_ATTR: ['src'],
    ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|xxx|wikilink|blob|data):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i
  });
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

/**
 * Parses all frontmatter fields from markdown.
 * 
 * @param {string} markdown 
 * @returns {{tags: string[], fields: Object<string, string>}}
 */
export function parseFrontmatter(markdown) {
  const result = { tags: [], fields: {} };
  if (!markdown) return result;
  
  const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
  const match = markdown.match(frontmatterRegex);
  if (match) {
    const frontmatterContent = match[1];
    const lines = frontmatterContent.split('\n');
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      
      const colonIndex = trimmed.indexOf(':');
      if (colonIndex !== -1) {
        const key = trimmed.slice(0, colonIndex).trim();
        const valueStr = trimmed.slice(colonIndex + 1).trim();
        
        if (key === 'tags') {
          // Parse tags: tags: [tag1, tag2] or tags: tag1, tag2
          const tagsMatch = valueStr.match(/^\[(.*?)\]$/);
          if (tagsMatch) {
            result.tags = tagsMatch[1].split(',')
              .map(t => t.trim())
              .filter(Boolean);
          } else {
            result.tags = valueStr.split(',')
              .map(t => t.trim())
              .filter(Boolean);
          }
        } else {
          result.fields[key] = valueStr;
        }
      }
    }
  }
  return result;
}

/**
 * Generates frontmatter string from tags and fields.
 * 
 * @param {string[]} tags 
 * @param {Object<string, string>} fields 
 * @returns {string} Frontmatter block (including --- wrappers)
 */
export function stringifyFrontmatter(tags, fields) {
  const lines = [];
  lines.push('---');
  lines.push(`tags: [${(tags || []).join(', ')}]`);
  for (const [key, val] of Object.entries(fields || {})) {
    if (key.trim() && key !== 'tags') {
      lines.push(`${key.trim()}: ${String(val).trim()}`);
    }
  }
  lines.push('---');
  return lines.join('\n') + '\n';
}
