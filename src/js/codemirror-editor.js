import { EditorView, keymap, drawSelection, highlightActiveLine, Decoration, ViewPlugin, WidgetType } from 'https://esm.sh/@codemirror/view';
import { EditorState, Compartment, EditorSelection } from 'https://esm.sh/@codemirror/state';
import { history, defaultKeymap, historyKeymap, indentWithTab } from 'https://esm.sh/@codemirror/commands';
import { markdown } from 'https://esm.sh/@codemirror/lang-markdown';
import { GFM } from 'https://esm.sh/@lezer/markdown';
import { syntaxHighlighting, HighlightStyle, syntaxTree } from 'https://esm.sh/@codemirror/language';
import { tags as t } from 'https://esm.sh/@lezer/highlight';
import { closeBrackets, closeBracketsKeymap } from 'https://esm.sh/@codemirror/autocomplete';
import { renderMarkdown } from './editor.js';

// Styles to apply to hidden markdown markup elements
const hiddenMarkerDecoration = Decoration.mark({ class: 'cm-hidden-marker' });

// Styles to apply to wiki link labels dynamically with page name attributes
function getWikiLinkDecoration(pageName) {
  return Decoration.mark({
    attributes: {
      class: 'cm-live-link',
      'data-page': pageName,
      title: `Cmd/Ctrl+Click to open ${pageName}`
    }
  });
}

// Styles to apply to external URL link labels
function getExternalLinkDecoration(url) {
  return Decoration.mark({
    attributes: {
      class: 'cm-live-link cm-external-link',
      'data-href': url,
      title: `Cmd/Ctrl+Click to open ${url}`
    }
  });
}

function resolveImageUrl(target) {
  if (!target) return '';
  if (/^(https?:|data:|blob:)/i.test(target)) {
    return target;
  }
  
  if (window.app && window.app.pages) {
    const key = target.toLowerCase();
    const pagesMap = window.app.pages;
    
    // 1. Try exact match
    let foundPage = pagesMap.get(key);
    
    // 2. Try suffix match (e.g. key is "logo.png", stored key is "attachments/logo.png")
    if (!foundPage) {
      const suffix = '/' + key;
      for (const existingKey of pagesMap.keys()) {
        if (existingKey.endsWith(suffix)) {
          foundPage = pagesMap.get(existingKey);
          break;
        }
      }
    }
    
    // 3. Try reverse suffix/prefix match (e.g. key is "attachments/logo.png", stored key is "logo.png")
    if (!foundPage) {
      for (const [existingKey, pageObj] of pagesMap.entries()) {
        if (key.endsWith('/' + existingKey) || existingKey.endsWith('/' + key)) {
          foundPage = pageObj;
          break;
        }
      }
    }

    if (foundPage && foundPage.url) {
      return foundPage.url;
    }
  }
  return target;
}

class ImageWidget extends WidgetType {
  constructor(src, alt) {
    super();
    this.src = src;
    this.alt = alt;
  }

  toDOM(view) {
    const container = document.createElement('div');
    container.className = 'cm-image-widget-container';
    
    const img = document.createElement('img');
    img.src = this.src;
    img.alt = this.alt || 'image';
    img.className = 'cm-image-widget';
    
    container.appendChild(img);
    
    // Add click event listener to take user to the block for editing
    container.addEventListener('click', (e) => {
      try {
        const pos = view.posAtDOM(container);
        if (pos !== null && pos !== undefined) {
          view.dispatch({
            selection: { anchor: pos, head: pos },
            scrollIntoView: true
          });
          view.focus();
        }
      } catch (err) {
        console.error(err);
      }
    });

    return container;
  }

  eq(other) {
    return other instanceof ImageWidget && other.src === this.src && other.alt === this.alt;
  }
}

function parseMarkdownTable(markdownText) {
  const lines = markdownText.trim().split('\n');
  if (lines.length < 1) return null;

  const splitLine = (line) => {
    const parts = line.split('|').map(s => s.trim());
    if (parts[0] === '') parts.shift();
    if (parts[parts.length - 1] === '') parts.pop();
    return parts;
  };

  const headers = splitLine(lines[0]);
  const rows = [];

  for (let i = 2; i < lines.length; i++) {
    if (lines[i].trim() !== '') {
      rows.push(splitLine(lines[i]));
    }
  }

  return { headers, rows };
}

class TableWidget extends WidgetType {
  constructor(rawMarkdown) {
    super();
    this.rawMarkdown = rawMarkdown;
  }

  toDOM(view) {
    const tableData = parseMarkdownTable(this.rawMarkdown);
    if (!tableData) {
      const errorDiv = document.createElement('div');
      errorDiv.textContent = 'Invalid table';
      return errorDiv;
    }

    const container = document.createElement('div');
    container.className = 'cm-live-table-container';

    const table = document.createElement('table');
    table.className = 'cm-live-table';
    
    const pagesMap = (window.app && window.app.pages) ? window.app.pages : new Map();

    if (tableData.headers.length > 0) {
      const thead = document.createElement('thead');
      const tr = document.createElement('tr');
      tableData.headers.forEach(h => {
        const th = document.createElement('th');
        let html = renderMarkdown(h, pagesMap).trim();
        if (html.startsWith('<p>') && html.endsWith('</p>')) {
          html = html.substring(3, html.length - 4);
        }
        th.innerHTML = html;
        tr.appendChild(th);
      });
      thead.appendChild(tr);
      table.appendChild(thead);
    }

    const tbody = document.createElement('tbody');
    tableData.rows.forEach((row, rIdx) => {
      const tr = document.createElement('tr');
      row.forEach(cell => {
        const td = document.createElement('td');
        let html = renderMarkdown(cell, pagesMap).trim();
        if (html.startsWith('<p>') && html.endsWith('</p>')) {
          html = html.substring(3, html.length - 4);
        }
        td.innerHTML = html;
        tr.appendChild(td);
      });
      for (let i = row.length; i < tableData.headers.length; i++) {
        const td = document.createElement('td');
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    container.appendChild(table);

    // Add click event listener to take user to the block for editing
    container.addEventListener('click', (e) => {
      if (e.target.closest('a')) {
        return; // Don't intercept clicks on active links inside the table
      }
      try {
        const pos = view.posAtDOM(container);
        if (pos !== null && pos !== undefined) {
          view.dispatch({
            selection: { anchor: pos, head: pos },
            scrollIntoView: true
          });
          view.focus();
        }
      } catch (err) {
        console.error(err);
      }
    });

    return container;
  }

  eq(other) {
    return other instanceof TableWidget && other.rawMarkdown === this.rawMarkdown;
  }
}

class BulletWidget extends WidgetType {
  toDOM(view) {
    const bullet = document.createElement('span');
    bullet.className = 'cm-bullet-marker';
    bullet.innerHTML = '&bull;';
    return bullet;
  }

  eq(other) {
    return other instanceof BulletWidget;
  }
}

class TaskWidget extends WidgetType {
  constructor(checked) {
    super();
    this.checked = checked;
  }

  toDOM(view) {
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'cm-task-checkbox';
    checkbox.checked = this.checked;
    
    checkbox.addEventListener('change', (e) => {
      try {
        const pos = view.posAtDOM(checkbox);
        if (pos !== null && pos !== undefined) {
          const newChar = checkbox.checked ? 'x' : ' ';
          view.dispatch({
            changes: { from: pos + 1, to: pos + 2, insert: newChar }
          });
        }
      } catch (err) {
        console.error("Failed to find task checkbox position:", err);
      }
    });

    return checkbox;
  }

  eq(other) {
    return other instanceof TaskWidget && other.checked === this.checked;
  }
}

/**
 * CodeMirror 6 ViewPlugin that dynamically hides markdown syntax markers
 * (bold, italic, inline code, headings, and links) unless the cursor/selection
 * is inside the markdown node's range.
 */
const livePreviewPlugin = ViewPlugin.fromClass(class {
  constructor(view) {
    this.hasFocus = view.hasFocus;
    this.decorations = this.buildDecorations(view);
  }

  update(update) {
    const focusChanged = update.view.hasFocus !== this.hasFocus;
    this.hasFocus = update.view.hasFocus;

    if (focusChanged || update.docChanged || update.selectionSet || update.viewportChanged || syntaxTree(update.state) !== syntaxTree(update.startState)) {
      this.decorations = this.buildDecorations(update.view);
    }
  }

  buildDecorations(view) {
    const builder = [];
    const cursors = view.state.selection.ranges;

    // Helper to check if selection intersects with range [from, to] (inclusive)
    function cursorIntersects(from, to) {
      if (!view.hasFocus) return false;
      return cursors.some(range => {
        return (range.from >= from && range.from <= to) || 
               (range.to >= from && range.to <= to) || 
               (range.from <= from && range.to >= to);
      });
    }

    // Traverse the syntax tree in the visible viewport
    for (let { from, to } of view.visibleRanges) {
      syntaxTree(view.state).iterate({
        from, to,
        enter: (node) => {
          const type = node.type.name;

          // 1. StrongEmphasis (e.g. **bold**)
          if (type === 'StrongEmphasis') {
            if (!cursorIntersects(node.from, node.to)) {
              let child = node.node.firstChild;
              while (child) {
                if (child.name === 'EmphasisMark') {
                  builder.push(hiddenMarkerDecoration.range(child.from, child.to));
                }
                child = child.nextSibling;
              }
            }
          }

          // 2. Emphasis (e.g. *italic*)
          else if (type === 'Emphasis') {
            if (!cursorIntersects(node.from, node.to)) {
              let child = node.node.firstChild;
              while (child) {
                if (child.name === 'EmphasisMark') {
                  builder.push(hiddenMarkerDecoration.range(child.from, child.to));
                }
                child = child.nextSibling;
              }
            }
          }

          // 3. InlineCode (e.g. `code`)
          else if (type === 'InlineCode') {
            if (!cursorIntersects(node.from, node.to)) {
              let child = node.node.firstChild;
              while (child) {
                if (child.name === 'CodeMark') {
                  builder.push(hiddenMarkerDecoration.range(child.from, child.to));
                }
                child = child.nextSibling;
              }
            }
          }

          // 4. ATXHeading1 to ATXHeading6 (e.g. # Header)
          else if (type.startsWith('ATXHeading')) {
            if (!cursorIntersects(node.from, node.to)) {
              let child = node.node.firstChild;
              while (child) {
                if (child.name === 'HeaderMark') {
                  builder.push(hiddenMarkerDecoration.range(child.from, child.to));
                }
                child = child.nextSibling;
              }
            }
          }

          // 5. Standard Link (e.g. [label](url))
          else if (type === 'Link') {
            if (!cursorIntersects(node.from, node.to)) {
              // Extract the URL from the link node
              let linkUrl = '';
              let urlChild = node.node.firstChild;
              while (urlChild) {
                if (urlChild.name === 'URL') {
                  linkUrl = view.state.sliceDoc(urlChild.from, urlChild.to);
                }
                urlChild = urlChild.nextSibling;
              }

              // Find label range (text between [ and ])
              let labelFrom = -1;
              let labelTo = -1;
              let child = node.node.firstChild;
              while (child) {
                if (child.name === 'LinkMark') {
                  const text = view.state.sliceDoc(child.from, child.to);
                  if (text === '[') {
                    builder.push(hiddenMarkerDecoration.range(child.from, child.to));
                    labelFrom = child.to;
                  } else if (text === ']') {
                    builder.push(hiddenMarkerDecoration.range(child.from, child.to));
                    labelTo = child.from;
                  } else if (text === '(') {
                    // Hide the entire (...) block (including URL and close parenthesis)
                    builder.push(hiddenMarkerDecoration.range(child.from, node.to));
                  }
                }
                child = child.nextSibling;
              }

              // Apply external link decoration to the label if URL is external
              if (linkUrl && /^https?:\/\//i.test(linkUrl) && labelFrom >= 0 && labelTo > labelFrom) {
                builder.push(getExternalLinkDecoration(linkUrl).range(labelFrom, labelTo));
              }
            }
          }
          // 6. GFM Tables
          else if (type === 'Table') {
            if (!cursorIntersects(node.from, node.to)) {
              const rawTableText = view.state.sliceDoc(node.from, node.to);
              
              // Add a widget containing the visual table before the first line
              builder.push(Decoration.widget({
                widget: new TableWidget(rawTableText),
                side: -1
              }).range(node.from));

              // Hide the text on each line of the table individually (to avoid line break replacement error)
              let pos = node.from;
              while (pos < node.to) {
                const line = view.state.doc.lineAt(pos);
                if (line.to > line.from) {
                  const hideTo = Math.min(line.to, node.to);
                  builder.push(Decoration.replace({}).range(line.from, hideTo));
                }
                pos = line.to + 1;
              }
            } else {
              builder.push(Decoration.mark({ class: 'cm-table-row' }).range(node.from, node.to));
            }
          }
          // 7. Standard Image (e.g. ![alt](url))
          else if (type === 'Image') {
            if (!cursorIntersects(node.from, node.to)) {
              const rawImageText = view.state.sliceDoc(node.from, node.to);
              const match = /!\[([^\]]*)\]\(([^)]+)\)/.exec(rawImageText);
              if (match) {
                const alt = match[1];
                const url = match[2];
                const resolvedUrl = resolveImageUrl(url);
                builder.push(Decoration.replace({
                  widget: new ImageWidget(resolvedUrl, alt),
                  inclusive: false
                }).range(node.from, node.to));
              }
            }
          }
          // 8. List Marker (bullets)
          else if (type === 'ListMark') {
            if (!cursorIntersects(node.from, node.to)) {
              const markerText = view.state.sliceDoc(node.from, node.to);
              if (markerText === '-' || markerText === '*' || markerText === '+') {
                builder.push(Decoration.replace({
                  widget: new BulletWidget(),
                  inclusive: false
                }).range(node.from, node.to));
              }
            }
          }
          // 9. Task Marker (checklists [ ] / [x])
          else if (type === 'TaskMarker') {
            if (!cursorIntersects(node.from, node.to)) {
              const markerText = view.state.sliceDoc(node.from, node.to);
              const checked = markerText.toLowerCase().includes('x');
              builder.push(Decoration.replace({
                widget: new TaskWidget(checked),
                inclusive: false
              }).range(node.from, node.to));
            }
          }
        }
      });
 
      // 10. Wiki links: [[Page Name]] or [[Page Name|Label]] (ignoring ![[)
      const text = view.state.sliceDoc(from, to);
      const wikiLinkRegex = /(?<!\!)\[\[([^\]]+)\]\]/g;
      let match;
      while ((match = wikiLinkRegex.exec(text)) !== null) {
        const matchStart = from + match.index;
        const matchEnd = matchStart + match[0].length;
        const isCursorInside = cursorIntersects(matchStart, matchEnd);
 
        if (!isCursorInside) {
          // Hide [[ and ]]
          builder.push(hiddenMarkerDecoration.range(matchStart, matchStart + 2));
          builder.push(hiddenMarkerDecoration.range(matchEnd - 2, matchEnd));
 
          const innerText = match[1];
          const pipeIndex = innerText.indexOf('|');
          const pageTarget = pipeIndex !== -1 ? innerText.substring(0, pipeIndex).trim() : innerText.trim();
          const wikiLinkDeco = getWikiLinkDecoration(pageTarget);
 
          if (pipeIndex !== -1) {
            // Hide "Page Name|"
            const pipePos = matchStart + 2 + pipeIndex;
            builder.push(hiddenMarkerDecoration.range(matchStart + 2, pipePos + 1));
            // Style "Label" as a link
            builder.push(wikiLinkDeco.range(pipePos + 1, matchEnd - 2));
          } else {
            // Style "Page Name" as a link
            builder.push(wikiLinkDeco.range(matchStart + 2, matchEnd - 2));
          }
        } else {
          // Cursor is inside. We still style it as a link for clarity
          const innerText = match[1];
          const pipeIndex = innerText.indexOf('|');
          const pageTarget = pipeIndex !== -1 ? innerText.substring(0, pipeIndex).trim() : innerText.trim();
          const wikiLinkDeco = getWikiLinkDecoration(pageTarget);
 
          if (pipeIndex !== -1) {
            const pipePos = matchStart + 2 + pipeIndex;
            builder.push(wikiLinkDeco.range(pipePos + 1, matchEnd - 2));
          } else {
            builder.push(wikiLinkDeco.range(matchStart + 2, matchEnd - 2));
          }
        }
      }

      // 11. Wiki images: ![[Page Name]] or ![[Page Name|Label]]
      const wikiImageRegex = /!\[\[([^\]]+)\]\]/g;
      let imgMatch;
      while ((imgMatch = wikiImageRegex.exec(text)) !== null) {
        const matchStart = from + imgMatch.index;
        const matchEnd = matchStart + imgMatch[0].length;
        const isCursorInside = cursorIntersects(matchStart, matchEnd);

        if (!isCursorInside) {
          const innerText = imgMatch[1];
          const pipeIndex = innerText.indexOf('|');
          const pageTarget = pipeIndex !== -1 ? innerText.substring(0, pipeIndex).trim() : innerText.trim();
          const altText = pipeIndex !== -1 ? innerText.substring(pipeIndex + 1).trim() : '';

           const resolvedUrl = resolveImageUrl(pageTarget);
          builder.push(Decoration.replace({
            widget: new ImageWidget(resolvedUrl, altText),
            inclusive: false
          }).range(matchStart, matchEnd));
        }
      }
    }

    // Sort ranges by `from` ascending
    builder.sort((a, b) => a.from - b.from);
    return Decoration.set(builder);
  }
}, {
  decorations: v => v.decorations
});

// Custom syntax highlighting styling to apply to markers inside CodeMirror
const customHighlightStyle = HighlightStyle.define([
  { tag: t.strong, class: 'cm-strong' },
  { tag: t.emphasis, class: 'cm-emphasis' },
  { tag: t.heading1, class: 'cm-heading cm-h1' },
  { tag: t.heading2, class: 'cm-heading cm-h2' },
  { tag: t.heading3, class: 'cm-heading cm-h3' },
  { tag: t.heading4, class: 'cm-heading cm-h4' },
  { tag: t.heading5, class: 'cm-heading cm-h5' },
  { tag: t.heading6, class: 'cm-heading cm-h6' },
  { tag: t.monospace, class: 'cm-inline-code' },
  { tag: t.link, class: 'cm-link' }
]);

export class CodeMirrorEditor {
  constructor({ el, initialValue = '', onChange, onWikiLinkClick, onSelectionChange, theme = 'dracula' }) {
    this.onChange = onChange;
    this.onWikiLinkClick = onWikiLinkClick;
    this.onSelectionChange = onSelectionChange;
    this.themeConfig = new Compartment();

    const state = EditorState.create({
      doc: initialValue,
      extensions: [
        highlightActiveLine(),
        drawSelection(),
        history(),
        closeBrackets(),
        keymap.of([
          ...defaultKeymap,
          ...historyKeymap,
          ...closeBracketsKeymap,
          indentWithTab
        ]),
        markdown({ extensions: [GFM] }),
        syntaxHighlighting(customHighlightStyle, { fallback: true }),
        livePreviewPlugin,
        EditorView.lineWrapping,
        EditorView.updateListener.of(update => {
          if (update.docChanged && this.onChange) {
            this.onChange();
          }
          if (this.onSelectionChange) {
            this.onSelectionChange(update.view);
          }
        }),
        EditorView.domEventHandlers({
          focus: (event, view) => {
            view.dispatch({});
          },
          blur: (event, view) => {
            view.dispatch({});
          },
          click: (event, view) => {
            // Check if user clicked in the margins (left or right of .cm-content)
            const contentEl = view.dom.querySelector('.cm-content');
            if (contentEl) {
              const rect = contentEl.getBoundingClientRect();
              if (event.clientX < rect.left || event.clientX > rect.right) {
                view.contentDOM.blur();
                return true;
              }
            }

            const target = event.target;
            if (target && target.classList.contains('cm-live-link')) {
              const isCmdOrCtrl = event.metaKey || event.ctrlKey;
              if (isCmdOrCtrl) {
                // Handle external links (data-href attribute)
                const externalUrl = target.getAttribute('data-href');
                if (externalUrl) {
                  event.preventDefault();
                  if (window.__TAURI__ && window.__TAURI__.core) {
                    window.__TAURI__.core.invoke('open_external_url', { url: externalUrl }).catch(err => {
                      console.error('Failed to open external link:', err);
                      window.open(externalUrl, '_blank');
                    });
                  } else {
                    window.open(externalUrl, '_blank');
                  }
                  return true;
                }
                // Handle wiki links (data-page attribute)
                const pageTarget = target.getAttribute('data-page');
                if (pageTarget && this.onWikiLinkClick) {
                  event.preventDefault();
                  this.onWikiLinkClick(pageTarget);
                  return true;
                }
              }
            }
          },
          dragover: (event, view) => {
            const types = event.dataTransfer.types;
            if (types && (types.includes('application/x-page-name') || types.includes('text/plain') || types.includes('Files'))) {
              event.preventDefault();
              event.stopPropagation();
              event.dataTransfer.dropEffect = 'copy';
              return true;
            }
          },
          drop: (event, view) => {
            // 1. First check for sidebar drags (internal page/image drag)
            let pageName = event.dataTransfer.getData('application/x-page-name');
            if (!pageName) {
              const plainText = event.dataTransfer.getData('text/plain');
              if (plainText && window.app && window.app.pages.has(plainText.toLowerCase())) {
                pageName = plainText;
              }
            }
            if (pageName) {
              event.preventDefault();
              event.stopPropagation();
              let isImage = event.dataTransfer.getData('application/x-is-image') === 'true';
              if (!isImage && window.app) {
                const pageObj = window.app.pages.get(pageName.toLowerCase());
                if (pageObj && pageObj.isImage) {
                  isImage = true;
                }
              }
              const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
              if (pos !== null) {
                const insertText = isImage ? `![[${pageName}]]` : `[[${pageName}]]`;
                view.dispatch({
                  changes: { from: pos, insert: insertText },
                  selection: { anchor: pos + insertText.length }
                });
                view.focus();
              }
              return true;
            }

            // 2. Then check for OS file drops (e.g. from Finder/Desktop)
            const files = event.dataTransfer.files;
            if (files && files.length > 0) {
              const file = files[0];
              const isImage = /\.(png|jpg|jpeg|gif|webp|svg|bmp)$/i.test(file.name);
              if (isImage) {
                event.preventDefault();
                event.stopPropagation();
                if (window.app) {
                  window.app.handleExternalImageDrop(file, event, view);
                }
                return true;
              }
            }
          }
        }),
        this.themeConfig.of(this.getEditorTheme(theme))
      ]
    });

    this.view = new EditorView({
      state,
      parent: el
    });
  }

  getMarkdown() {
    return this.view.state.doc.toString();
  }

  setMarkdown(text) {
    if (this.getMarkdown() === text) return;
    this.view.dispatch({
      changes: { from: 0, to: this.view.state.doc.length, insert: text }
    });
  }

  setTheme(themeName) {
    this.view.dispatch({
      effects: this.themeConfig.reconfigure(this.getEditorTheme(themeName))
    });
  }

  getEditorTheme(themeName) {
    return EditorView.theme({
      "&": {
        height: "100%",
        backgroundColor: "var(--input-bg)",
        color: "var(--text)",
        fontFamily: "var(--font-mono)",
        fontSize: "14px",
        border: "none !important",
      },
      "&.cm-focused": {
        outline: "none !important",
      },
      ".cm-scroller": {
        overflow: "auto",
        height: "100%",
      },
      ".cm-content": {
        padding: "40px 40px 100px 40px",
        fontFamily: "var(--font-sans)",
        fontSize: "15px",
        lineHeight: "1.7",
        maxWidth: "720px",
        margin: "0 auto",
      },
      ".cm-gutters": {
        display: "none"
      },
      ".cm-activeLine": {
        backgroundColor: "var(--accent-glow)",
        borderRadius: "4px"
      },
      ".cm-hidden-marker": {
        display: "none"
      },
      ".cm-live-link": {
        color: "var(--accent)",
        textDecoration: "underline",
        cursor: "pointer"
      },
      ".cm-table-row": {
        fontFamily: "var(--font-mono) !important",
        fontSize: "14px",
        color: "var(--text-muted)",
        letterSpacing: "0",
      }
    });
  }

  insertFormatting(type) {
    const view = this.view;
    
    view.dispatch(view.state.changeByRange(range => {
      const selectedText = view.state.sliceDoc(range.from, range.to);
      let insertText = '';
      let selectFrom = range.from;
      let selectTo = range.to;

      switch (type) {
        case 'bold': {
          // Check if selection starts/ends with '**'
          if (selectedText.startsWith('**') && selectedText.endsWith('**') && selectedText.length >= 4) {
            const unwrapped = selectedText.slice(2, -2);
            return {
              changes: { from: range.from, to: range.to, insert: unwrapped },
              range: EditorSelection.range(range.from, range.from + unwrapped.length)
            };
          }
          // Check if surrounding text has '**'
          const before = view.state.sliceDoc(range.from - 2, range.from);
          const after = view.state.sliceDoc(range.to, range.to + 2);
          if (before === '**' && after === '**') {
            return {
              changes: { from: range.from - 2, to: range.to + 2, insert: selectedText },
              range: EditorSelection.range(range.from - 2, range.from - 2 + selectedText.length)
            };
          }
          // Otherwise, apply bold
          insertText = `**${selectedText || 'bold text'}**`;
          selectFrom += 2;
          selectTo = selectFrom + (selectedText || 'bold text').length;
          break;
        }
        case 'italic': {
          // Check if selection starts/ends with '*' (excluding double stars)
          if (selectedText.startsWith('*') && selectedText.endsWith('*') && 
              !(selectedText.startsWith('**') && selectedText.endsWith('**')) && 
              selectedText.length >= 2) {
            const unwrapped = selectedText.slice(1, -1);
            return {
              changes: { from: range.from, to: range.to, insert: unwrapped },
              range: EditorSelection.range(range.from, range.from + unwrapped.length)
            };
          }
          // Check if surrounding text has '*' (excluding double stars)
          const before1 = view.state.sliceDoc(range.from - 1, range.from);
          const after1 = view.state.sliceDoc(range.to, range.to + 1);
          const before2 = view.state.sliceDoc(range.from - 2, range.from);
          const after2 = view.state.sliceDoc(range.to, range.to + 2);
          if (before1 === '*' && after1 === '*' && !(before2 === '**' && after2 === '**')) {
            return {
              changes: { from: range.from - 1, to: range.to + 1, insert: selectedText },
              range: EditorSelection.range(range.from - 1, range.from - 1 + selectedText.length)
            };
          }
          // Otherwise, apply italic
          insertText = `*${selectedText || 'italic text'}*`;
          selectFrom += 1;
          selectTo = selectFrom + (selectedText || 'italic text').length;
          break;
        }
        case 'code': {
          // Check if selection starts/ends with '`'
          if (selectedText.startsWith('`') && selectedText.endsWith('`') && selectedText.length >= 2) {
            const unwrapped = selectedText.slice(1, -1);
            return {
              changes: { from: range.from, to: range.to, insert: unwrapped },
              range: EditorSelection.range(range.from, range.from + unwrapped.length)
            };
          }
          // Check if surrounding text has '`'
          const before = view.state.sliceDoc(range.from - 1, range.from);
          const after = view.state.sliceDoc(range.to, range.to + 1);
          if (before === '`' && after === '`') {
            return {
              changes: { from: range.from - 1, to: range.to + 1, insert: selectedText },
              range: EditorSelection.range(range.from - 1, range.from - 1 + selectedText.length)
            };
          }
          // Otherwise, apply code
          insertText = `\`${selectedText || 'code'}\``;
          selectFrom += 1;
          selectTo = selectFrom + (selectedText || 'code').length;
          break;
        }
        case 'heading': {
          const line = view.state.doc.lineAt(range.from);
          if (line.text.startsWith('### ')) {
            // Remove '### ' from start of the line
            return {
              changes: { from: line.from, to: line.from + 4, insert: '' },
              range: EditorSelection.range(Math.max(line.from, range.from - 4), Math.max(line.from, range.to - 4))
            };
          }
          const isAtStart = range.from === line.from;
          insertText = isAtStart ? `### ${selectedText}` : `\n### ${selectedText}`;
          selectFrom += isAtStart ? 4 : 5;
          selectTo = selectFrom + selectedText.length;
          break;
        }
        case 'link':
          insertText = `[[${selectedText || 'Link Target'}]]`;
          selectFrom += 2;
          selectTo = selectFrom + (selectedText || 'Link Target').length;
          break;
        default:
          return { range };
      }

      return {
        changes: { from: range.from, to: range.to, insert: insertText },
        range: EditorSelection.range(selectFrom, selectTo)
      };
    }));
    view.focus();
  }

  insertText(text) {
    const view = this.view;
    const ranges = view.state.selection.ranges;
    if (ranges.length === 0) return;
    
    const range = ranges[0];
    view.dispatch({
      changes: { from: range.from, to: range.to, insert: text },
      selection: { anchor: range.from + text.length }
    });
    view.focus();
  }
}
