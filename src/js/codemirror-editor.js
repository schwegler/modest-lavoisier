import { EditorView, keymap, drawSelection, highlightActiveLine, Decoration, ViewPlugin } from 'https://esm.sh/@codemirror/view';
import { EditorState, Compartment } from 'https://esm.sh/@codemirror/state';
import { history, defaultKeymap, historyKeymap, indentWithTab } from 'https://esm.sh/@codemirror/commands';
import { markdown } from 'https://esm.sh/@codemirror/lang-markdown';
import { syntaxHighlighting, HighlightStyle, syntaxTree } from 'https://esm.sh/@codemirror/language';
import { tags as t } from 'https://esm.sh/@lezer/highlight';
import { closeBrackets, closeBracketsKeymap } from 'https://esm.sh/@codemirror/autocomplete';

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

/**
 * CodeMirror 6 ViewPlugin that dynamically hides markdown syntax markers
 * (bold, italic, inline code, headings, and links) unless the cursor/selection
 * is inside the markdown node's range.
 */
const livePreviewPlugin = ViewPlugin.fromClass(class {
  constructor(view) {
    this.decorations = this.buildDecorations(view);
  }

  update(update) {
    if (update.docChanged || update.selectionSet || update.viewportChanged) {
      this.decorations = this.buildDecorations(update.view);
    }
  }

  buildDecorations(view) {
    const builder = [];
    const cursors = view.state.selection.ranges;

    // Helper to check if selection intersects with range [from, to] (inclusive)
    function cursorIntersects(from, to) {
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
              let child = node.firstChild;
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
              let child = node.firstChild;
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
              let child = node.firstChild;
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
              let child = node.firstChild;
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
              let child = node.firstChild;
              while (child) {
                if (child.name === 'LinkMark') {
                  const text = view.state.sliceDoc(child.from, child.to);
                  if (text === '[' || text === ']') {
                    builder.push(hiddenMarkerDecoration.range(child.from, child.to));
                  } else if (text === '(') {
                    // Hide the entire (...) block (including URL and close parenthesis)
                    builder.push(hiddenMarkerDecoration.range(child.from, node.to));
                  }
                }
                child = child.nextSibling;
              }
            }
          }
        }
      });

      // 6. Wiki links: [[Page Name]] or [[Page Name|Label]]
      const text = view.state.sliceDoc(from, to);
      const wikiLinkRegex = /\[\[([^\]]+)\]\]/g;
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
  constructor({ el, initialValue = '', onChange, onWikiLinkClick, theme = 'dracula' }) {
    this.onChange = onChange;
    this.onWikiLinkClick = onWikiLinkClick;
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
        markdown(),
        syntaxHighlighting(customHighlightStyle, { fallback: true }),
        livePreviewPlugin,
        EditorView.lineWrapping,
        EditorView.updateListener.of(update => {
          if (update.docChanged && this.onChange) {
            this.onChange();
          }
        }),
        EditorView.domEventHandlers({
          click: (event, view) => {
            const target = event.target;
            if (target && target.classList.contains('cm-live-link')) {
              const isCmdOrCtrl = event.metaKey || event.ctrlKey;
              if (isCmdOrCtrl && this.onWikiLinkClick) {
                const pageTarget = target.getAttribute('data-page');
                if (pageTarget) {
                  event.preventDefault();
                  this.onWikiLinkClick(pageTarget);
                  return true;
                }
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
        display: "inline-block",
        width: "0px",
        height: "0px",
        overflow: "hidden",
        opacity: "0",
        pointerEvents: "none",
        whiteSpace: "pre"
      },
      ".cm-live-link": {
        color: "var(--accent)",
        textDecoration: "underline",
        cursor: "pointer"
      }
    });
  }
}
