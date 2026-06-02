/**
 * Native Nodes - Main Application Coordinator
 * 
 * Orchestrates filesystem access, in-memory sandbox demo mode,
 * routing, autosaving, PWA installer states, and visual graph binding.
 */

import { getSetting, setSetting, deleteSetting } from './db.js';

import { renderMarkdown, extractWikiLinks, extractTags, stripFrontmatter, escapeHTML, parseFrontmatter, stringifyFrontmatter } from './editor.js';
import { CodeMirrorEditor } from './codemirror-editor.js';
import { WikiGraph } from './graph.js';

class NativeNodesApp {
  constructor() {
    // App State
    this.dirHandle = null;
    this.pages = new Map(); // Lowercase Page Name -> { name, content, handle, exists }
    this.pageNamesIndex = new Map(); // Flat Name -> Array of Page Objects
    this.activePage = null;  // { name, content }
    this.theme = 'dark';
    this.layout = 'split'; // 'edit', 'split', 'preview'
    this.graphVisible = true;
    this.graphFullscreen = false;
    this.isSandbox = false;
    this.selectedTag = null;
    this.saveTimeout = null;

    // Check if running in Tauri desktop environment
    this.isTauri = !!(window.__TAURI__);
    if (this.isTauri) {
      document.body.classList.add('tauri-window');
      const isMac = navigator.userAgent.toLowerCase().includes('macintosh') || navigator.userAgent.toLowerCase().includes('mac os x');
      if (isMac) {
        document.body.classList.add('tauri-mac');
      } else {
        document.body.classList.add('tauri-non-mac');
      }
    }

    // Graph Visualizer instance
    this.graph = null;

    // DOM Elements Cache
    this.dom = {
      appShell: document.getElementById('appShell'),
      welcomeShell: document.getElementById('welcomeShell'),
      unlockState: document.getElementById('unlockState'),
      unlockFolderBtn: document.getElementById('unlockFolderBtn'),
      openFolderBtn: document.getElementById('openFolderBtn'),
      demoWorkspaceBtn: document.getElementById('demoWorkspaceBtn'),
      
      sidebar: document.getElementById('sidebar'),
      menuToggleBtn: document.getElementById('menuToggleBtn'),
      searchInput: document.getElementById('searchInput'),
      sidebarNewBtn: document.getElementById('sidebarNewBtn'),
      sidebarCollapseAllBtn: document.getElementById('sidebarCollapseAllBtn'),
      fileList: document.getElementById('fileList'),
      tagList: document.getElementById('tagList'),
      activeWorkspaceName: document.getElementById('activeWorkspaceName'),
      changeWorkspaceBtn: document.getElementById('changeWorkspaceBtn'),
      
      activeNoteTitle: document.getElementById('activeNoteTitle'),
      saveStatus: document.getElementById('saveStatus'),
      editorTextarea: document.getElementById('editorTextarea'),
      previewPanel: document.getElementById('previewPanel'),
      previewContent: document.getElementById('previewContent'),
      workspacePanels: document.getElementById('workspacePanels'),
      
      layoutToggleBtn: document.getElementById('layoutToggleBtn'),
      toggleGraphBtn: document.getElementById('toggleGraphBtn'),
      exportHtmlBtn: document.getElementById('exportHtmlBtn'),
      themePickerBtn: document.getElementById('themePickerBtn'),
      themeDropdownMenu: document.getElementById('themeDropdownMenu'),
      
      graphCard: document.getElementById('graphCard'),
      graphCanvas: document.getElementById('graphCanvas'),
      graphFullscreenBtn: document.getElementById('graphFullscreenBtn'),

      newNoteModal: document.getElementById('newNoteModal'),
      newNoteForm: document.getElementById('newNoteForm'),
      newNoteName: document.getElementById('newNoteName'),
      clearTagFilterBtn: document.getElementById('clearTagFilterBtn'),
      activeTagFilterIndicator: document.getElementById('activeTagFilterIndicator'),
      activeTagFilterName: document.getElementById('activeTagFilterName'),
      helpModalBtn: document.getElementById('helpModalBtn'),
      helpModal: document.getElementById('helpModal'),
      tagInputField: document.getElementById('tagInputField'),
      tagPillsList: document.getElementById('tagPillsList'),
      tagAutocompleteDropdown: document.getElementById('tagAutocompleteDropdown'),
      propertiesContainer: document.getElementById('propertiesContainer'),
      propertiesHeader: document.getElementById('propertiesHeader'),
      propertiesList: document.getElementById('propertiesList'),
      addPropertyBtn: document.getElementById('addPropertyBtn'),
      activeNoteTitleInput: document.getElementById('activeNoteTitleInput')
    };


    this.editor = new CodeMirrorEditor({
      el: this.dom.editorTextarea,
      theme: this.theme,
      onChange: () => {
        this.markAsDirty();
        this.triggerAutoSave();
      },
      onWikiLinkClick: (pageName) => {
        const resolved = this.resolveWikiLink(pageName);
        window.location.hash = `#/page/${encodeURIComponent(resolved)}`;
      }
    });

    try {
      mermaid.initialize({
        startOnLoad: false,
        theme: 'dark',
        securityLevel: 'loose',
        logLevel: 5
      });
    } catch (e) {
      console.error('Failed to initialize mermaid:', e);
    }

    this.init();

  }

  async init() {
    this.registerServiceWorker();
    this.setupEventListeners();
    await this.loadPreferences();
    this.checkBrowserCapabilities();
  }

  /**
   * Registers PWA service worker.
   */
  registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
          .then(reg => console.log('Service Worker registered.'))
          .catch(err => console.error('Service Worker registration failed:', err));
      });
    }
  }

  /**
   * Fallback for browser verification and IndexedDB handle checking.
   */

  async checkBrowserCapabilities() {
    if (this.isTauri) {
      // Tauri desktop startup — check for previously saved workspace path
      try {
        const savedHandle = await getSetting('directoryHandle');
        if (savedHandle && savedHandle.isTauri && savedHandle.path) {
          // Persisted scope plugin auto-restores access to this path
          this.isSandbox = false;
          this.dirHandle = savedHandle;
          await this.loadWorkspace();
        }
      } catch (err) {
        console.error('Error loading saved Tauri workspace:', err);
      }
      return;
    }

    const supportsFileSystem = 'showDirectoryPicker' in window;

    if (!supportsFileSystem) {
      console.warn('File System Access API not supported in this browser. Mock sandbox will run.');
      // Disable local folder picking features, prompt fallback
      this.dom.openFolderBtn.disabled = true;
      this.dom.openFolderBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="15" y1="9" x2="9" y2="15"></line>
          <line x1="9" y1="9" x2="15" y2="15"></line>
        </svg>
        Folder Sync Unsupported
      `;
      this.dom.openFolderBtn.title = 'Please use a Chromium-based browser (Chrome, Edge, Opera) for local sync support.';
    } else {
      // Check IndexedDB if directory handle exists and auto-load if permission is already active

      try {
        const savedHandle = await getSetting('directoryHandle');
        if (savedHandle) {
          if (savedHandle.isTauri) {
            // Cannot auto-load Tauri workspace path in browser mode
            console.log('Saved workspace is for Tauri mode; cannot load in browser.');
          } else {
            // Web Mode
            const permission = await savedHandle.queryPermission({ mode: 'readwrite' });
            if (permission === 'granted') {
            this.isSandbox = false;
            this.dirHandle = savedHandle;
            await this.loadWorkspace();
          } else {
            // Customize landing UI to be a prominent Unlock button
            this.dom.openFolderBtn.style.display = 'none';
            
            let restoreBtn = document.getElementById('restoreFolderBtn');
            if (!restoreBtn) {
              restoreBtn = document.createElement('button');
              restoreBtn.id = 'restoreFolderBtn';
              restoreBtn.className = 'btn-primary';
              this.dom.openFolderBtn.parentNode.insertBefore(restoreBtn, this.dom.demoWorkspaceBtn);
            }
            
            restoreBtn.innerHTML = `
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
              </svg>
              Unlock Workspace (${escapeHTML(savedHandle.name)})
            `;
            
            restoreBtn.addEventListener('click', async () => {
              const status = await savedHandle.requestPermission({ mode: 'readwrite' });
              if (status === 'granted') {
                this.isSandbox = false;
                this.dirHandle = savedHandle;
                await this.loadWorkspace();
              } else {
                alert('Permission denied to open folder.');
              }
            });
          }

            this.dom.unlockState.innerHTML = `
              Want to open a different folder? 
              <a href="#" id="chooseNewFolderBtn" style="color: var(--accent); font-weight: 500; text-decoration: none;">Choose another folder</a>
            `;
            this.dom.unlockState.style.display = 'block';

            document.getElementById('chooseNewFolderBtn').addEventListener('click', (e) => {
              e.preventDefault();
              this.selectWorkspace();
            });
          }
        }
      } catch (err) {
        console.error('Error loading directory handle from IDB:', err);
      }
    }
  }

  /**
   * Restores settings from DB cache.
   */
  async loadPreferences() {
    // Theme
    const savedTheme = await getSetting('theme');
    if (savedTheme) {
      this.setTheme(savedTheme);
    } else {
      this.setTheme('dracula');
    }

    // Layout
    const savedLayout = await getSetting('layout');
    this.setLayout(savedLayout || 'edit');

    // Graph visibility
    const savedGraphVisible = await getSetting('graphVisible');
    if (savedGraphVisible !== undefined) {
      this.setGraphVisibility(savedGraphVisible);
    }

    // Expanded folders state
    const savedExpanded = await getSetting('expandedFolders');
    this.expandedFolders = savedExpanded ? new Set(savedExpanded) : null;

    // Properties collapsed state
    const savedCollapsed = await getSetting('propertiesCollapsed');
    if (savedCollapsed !== undefined) {
      this.dom.propertiesContainer.classList.toggle('collapsed', savedCollapsed);
    }
  }

  /**
   * Theme configuration handler.
   */
  setTheme(theme) {
    this.theme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    setSetting('theme', theme);

    if (this.dom.themeDropdownMenu) {
      this.dom.themeDropdownMenu.querySelectorAll('.dropdown-item').forEach(item => {
        item.classList.toggle('active', item.dataset.themeId === theme);
      });
    }

    try {
      const isDark = ['dracula', 'onedark', 'nord', 'gruvbox-dark', 'solarized-dark', 'monokai', 'tokyonight', 'catppuccin', 'github-dark', 'dark'].includes(theme);
      mermaid.initialize({
        theme: isDark ? 'dark' : 'default'
      });
    } catch (e) {}

    if (this.editor && typeof this.editor.setTheme === 'function') {
      this.editor.setTheme(theme);
    }

    if (this.graph) {
      const isDark = ['dracula', 'onedark', 'nord', 'gruvbox-dark', 'solarized-dark', 'monokai', 'tokyonight', 'catppuccin', 'github-dark', 'dark'].includes(theme);
      this.graph.updateData(
        this.getGraphNodes(),
        this.getGraphLinks(),
        this.activePage ? this.activePage.name : null,
        isDark
      );
    }

    // Re-render preview to apply new mermaid theme
    this.renderPreview();
  }

  /**
   * Panel toggle handler.
   */
  setLayout(layout) {
    if (layout !== 'edit' && layout !== 'preview') {
      layout = 'edit';
    }
    this.layout = layout;
    this.dom.workspacePanels.className = `workspace-panels ${layout}-only`;
    
    // Toggle active class on toolbar toggle button
    if (this.dom.layoutToggleBtn) {
      this.dom.layoutToggleBtn.classList.toggle('active', layout === 'edit');
    }

    setSetting('layout', layout);
  }

  /**
   * Graph card popup toggles.
   */
  setGraphVisibility(visible) {
    this.graphVisible = visible;
    this.dom.toggleGraphBtn.classList.toggle('active', visible);
    this.dom.graphCard.classList.toggle('collapsed', !visible);
    
    if (visible && this.graph) {
      this.graph.start();
    } else if (this.graph) {
      this.graph.stop();
    }
    setSetting('graphVisible', visible);
  }

  /**
   * Sets up click handlers, routing and key listeners.
   */
  setupEventListeners() {
    // Landing Page Controls
    this.dom.openFolderBtn.addEventListener('click', () => this.selectWorkspace());
    this.dom.demoWorkspaceBtn.addEventListener('click', () => this.startSandboxDemo());
    this.dom.unlockFolderBtn.addEventListener('click', (e) => {
      e.preventDefault();
      this.restoreWorkspace();
    });

    // Sidebar Items
    this.dom.changeWorkspaceBtn.addEventListener('click', () => this.selectWorkspace());
    this.dom.sidebarNewBtn.addEventListener('click', () => this.openNewNoteModal());
    this.dom.sidebarCollapseAllBtn.addEventListener('click', () => {
      if (this.expandedFolders) {
        this.expandedFolders.clear();
        setSetting('expandedFolders', []);
        this.renderFileList();
      }
    });
    this.dom.searchInput.addEventListener('input', () => this.renderFileList());
    this.dom.clearTagFilterBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.filterByTag(null);
    });
    
    // Mobile Sidebar Drawer
    this.dom.menuToggleBtn.addEventListener('click', () => {
      this.dom.sidebar.classList.toggle('open');
    });

    // Layout Toolbar Toggle
    this.dom.layoutToggleBtn.addEventListener('click', () => {
      this.setLayout(this.layout === 'edit' ? 'preview' : 'edit');
    });
    this.dom.toggleGraphBtn.addEventListener('click', () => this.setGraphVisibility(!this.graphVisible));
    
    // Graph Fullscreen
    this.dom.graphFullscreenBtn.addEventListener('click', () => {
      this.graphFullscreen = !this.graphFullscreen;
      this.dom.graphCard.classList.toggle('fullscreen', this.graphFullscreen);
      
      const icon = this.dom.graphFullscreenBtn.querySelector('svg');
      if (this.graphFullscreen) {
        icon.innerHTML = `
          <polyline points="4 14 10 14 10 20"></polyline>
          <polyline points="20 10 14 10 14 4"></polyline>
          <line x1="14" y1="10" x2="21" y2="3"></line>
          <line x1="10" y1="14" x2="3" y2="21"></line>
        `;
      } else {
        icon.innerHTML = `
          <polyline points="15 3 21 3 21 9"></polyline>
          <polyline points="9 21 3 21 3 15"></polyline>
          <line x1="21" y1="3" x2="14" y2="10"></line>
          <line x1="3" y1="21" x2="10" y2="14"></line>
        `;
      }
      setTimeout(() => this.graph.resizeCanvas(), 250);
    });

    // Initialize Theme Picker
    this.populateThemePicker();

    // Collapsible Properties Panel Header listener
    this.dom.propertiesHeader.addEventListener('click', () => {
      const collapsed = this.dom.propertiesContainer.classList.contains('collapsed');
      this.dom.propertiesContainer.classList.toggle('collapsed', !collapsed);
      setSetting('propertiesCollapsed', !collapsed);
    });

    // Properties Add property button listener
    this.dom.addPropertyBtn.addEventListener('click', () => {
      if (!this.activePage) return;
      if (!this.activePage.fields) this.activePage.fields = {};
      
      let fieldName = 'property';
      let counter = 1;
      while (fieldName in this.activePage.fields || fieldName === 'tags') {
        fieldName = `property${counter}`;
        counter++;
      }
      
      this.activePage.fields[fieldName] = '';
      this.markAsDirty();
      this.triggerAutoSave();
      this.renderProperties();
      
      setTimeout(() => {
        const keyInputs = this.dom.propertiesList.querySelectorAll('.property-key');
        if (keyInputs.length > 0) {
          const lastInput = keyInputs[keyInputs.length - 1];
          lastInput.focus();
          lastInput.select();
        }
      }, 50);
    });

    // Title Click-to-rename listener
    this.dom.activeNoteTitle.addEventListener('click', () => {
      if (!this.activePage) return;
      this.dom.activeNoteTitle.style.display = 'none';
      this.dom.activeNoteTitleInput.style.display = 'block';
      this.dom.activeNoteTitleInput.value = this.activePage.name;
      this.dom.activeNoteTitleInput.focus();
      
      const name = this.activePage.name;
      const lastSlash = name.lastIndexOf('/');
      if (lastSlash !== -1) {
        this.dom.activeNoteTitleInput.setSelectionRange(lastSlash + 1, name.length);
      } else {
        this.dom.activeNoteTitleInput.select();
      }
    });

    const finishTitleEdit = () => {
      if (this.dom.activeNoteTitleInput.style.display === 'block') {
        const newTitle = this.dom.activeNoteTitleInput.value.trim();
        this.dom.activeNoteTitleInput.style.display = 'none';
        this.dom.activeNoteTitle.style.display = 'block';
        if (newTitle && newTitle !== this.activePage.name) {
          this.renameActivePage(newTitle);
        }
      }
    };

    this.dom.activeNoteTitleInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        finishTitleEdit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.dom.activeNoteTitleInput.style.display = 'none';
        this.dom.activeNoteTitle.style.display = 'block';
      }
    });

    this.dom.activeNoteTitleInput.addEventListener('blur', () => {
      finishTitleEdit();
    });

    document.querySelectorAll('[data-close]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const dialog = e.target.closest('dialog');
        if (dialog) dialog.close();
      });
    });

    this.dom.newNoteForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const title = this.dom.newNoteName.value.trim();
      if (title) {
        this.createNewPage(title);
        this.dom.newNoteModal.close();
        this.dom.newNoteName.value = '';
      }
    });

    // Export Page Control
    this.dom.exportHtmlBtn.addEventListener('click', async () => {
      // Ensure preview content is up-to-date before printing
      this.renderPreview();
      
      // Small delay to let the DOM update before triggering print
      await new Promise(r => setTimeout(r, 100));
      
      if (this.isTauri) {
        try {
          await window.__TAURI__.core.invoke('print_page');
        } catch (err) {
          console.error('Tauri print failed, falling back:', err);
          window.print();
        }
      } else {
        window.print();
      }
    });

    // Help Shortcuts Modal Trigger
    this.dom.helpModalBtn.addEventListener('click', () => {
      this.dom.helpModal.showModal();
    });

    // Editor AutoSave & Sync Change Events handled by ToastUI Editor events

    // Global Key Bindings
    window.addEventListener('keydown', (e) => {
      const isCmd = e.metaKey || e.ctrlKey;
      
      // Save: Cmd+S
      if (isCmd && e.key.toLowerCase() === 's') {
        e.preventDefault();
        this.saveActivePageSync();
      }
      
      // New Page: Cmd+N
      if (isCmd && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        this.openNewNoteModal();
      }

      // Find/Focus Search: Cmd+F
      if (isCmd && e.key.toLowerCase() === 'f') {
        // Only trigger focus if not focused in editor
        if (!this.dom.editorTextarea.contains(document.activeElement)) {
          e.preventDefault();
          this.dom.searchInput.focus();
        }
      }

      // Graph Toggle: Cmd+G
      if (isCmd && e.key.toLowerCase() === 'g') {
        e.preventDefault();
        this.setGraphVisibility(!this.graphVisible);
      }

      // Theme Cycle: Cmd+I
      if (isCmd && e.key.toLowerCase() === 'i') {
        e.preventDefault();
        const themeKeys = ['dracula', 'onedark', 'nord', 'gruvbox-dark', 'gruvbox-light', 'solarized-dark', 'solarized-light', 'monokai', 'tokyonight', 'catppuccin', 'github-dark', 'github-light'];
        const currentIndex = themeKeys.indexOf(this.theme);
        const nextIndex = (currentIndex + 1) % themeKeys.length;
        this.setTheme(themeKeys[nextIndex]);
      }

      // Layout toggle: Alt+L
      if (e.altKey && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        this.setLayout(this.layout === 'edit' ? 'preview' : 'edit');
      }

      // Print: Cmd+P
      if (isCmd && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        this.dom.exportHtmlBtn.click();
      }
    });

    // Hash Router Listener
    window.addEventListener('hashchange', () => this.handleRouting());

    // Init tag input listeners
    this.setupTagEditor();
  }

  /**
   * Router resolution: parses hash tags.
   */
  async handleRouting() {
    const hash = window.location.hash;
    
    // Close mobile menu sidebar drawer if open
    this.dom.sidebar.classList.remove('open');

    if (hash.startsWith('#/page/')) {
      const pageName = decodeURIComponent(hash.slice(7));
      const key = pageName.toLowerCase();
      
      if (this.pages.has(key)) {
        await this.loadPage(pageName);
      } else {
        // Attempt to create page automatically if it doesn't exist (Wiki pattern)
        const ok = confirm(`The page "${pageName}" does not exist. Would you like to create it?`);
        if (ok) {
          await this.createNewPage(pageName);
        } else {
          // Go back or load index
          window.location.hash = this.activePage ? `#/page/${encodeURIComponent(this.activePage.name)}` : '#/';
        }
      }
    } else {
      // Load last opened page if it exists and still in workspace, otherwise load first page by default
      const lastPage = await getSetting('lastOpenedPage');
      if (lastPage && this.pages.has(lastPage.toLowerCase())) {
        window.location.hash = `#/page/${encodeURIComponent(lastPage)}`;
      } else if (this.pages.size > 0) {
        const firstPage = Array.from(this.pages.values())[0].name;
        window.location.hash = `#/page/${encodeURIComponent(firstPage)}`;
      }
    }
  }

  /**
   * Triggers file browser picker and parses directory.
   */

  async selectWorkspace() {
    try {
      if (this.isTauri) {
        // Use Tauri dialog plugin for native folder picker
        const folderPath = await window.__TAURI__.dialog.open({
          directory: true,
          multiple: false,
          recursive: true,
          title: 'Select Workspace Folder'
        });
        if (folderPath) {
          this.isSandbox = false;
          this.dirHandle = { path: folderPath, name: folderPath.split(/[\\/]/).pop(), isTauri: true };
          await setSetting('directoryHandle', this.dirHandle);
          await this.loadWorkspace();
        }
        return;
      }

      const handle = await window.showDirectoryPicker({
        mode: 'readwrite'
      });
      const permission = await handle.queryPermission({ mode: 'readwrite' });
      if (permission !== 'granted') {
        alert('Permission is required to write changes to local workspace.');
        return;
      }
      
      this.isSandbox = false;
      this.dirHandle = handle;
      
      // Save directory handle in IndexedDB
      await setSetting('directoryHandle', handle);
      
      await this.loadWorkspace();
    } catch (err) {

      if (err.name !== 'AbortError') {
        alert('Could not open workspace. Please ensure read/write permissions are granted.');
        console.error(err);
      }
    }
  }

  /**
   * Restores directory handles on startup.
   */

  async restoreWorkspace() {
    try {
      const handle = await getSetting('directoryHandle');
      if (handle) {
        if (handle.isTauri) {
           if (!this.isTauri) {
             alert('Cannot restore Tauri workspace in browser mode.');
             return;
           }
           this.isSandbox = false;
           this.dirHandle = handle;
           await this.loadWorkspace();
           return;
        }

        // Chrome security policies require prompting permission on gesture click

        const permission = await handle.requestPermission({ mode: 'readwrite' });
        if (permission === 'granted') {
          this.isSandbox = false;
          this.dirHandle = handle;
          await this.loadWorkspace();
        } else {
          alert('Permission was denied. Please select the folder again.');
        }
      }
    } catch (err) {
      alert('Failed to restore previous folder workspace. Let\'s select it fresh.');
      console.error(err);
    }
  }

  /**
   * Initializes virtual workspace for sandbox.
   */
  startSandboxDemo() {
    this.isSandbox = true;
    this.dirHandle = null;
    this.dom.activeWorkspaceName.textContent = 'Sandbox (In-Memory)';

    // Populates demo contents
    this.pages.clear();
    this.pageNamesIndex.clear();
    const demoNotes = [
      {
        name: 'Welcome',
        content: `---\ntags: [welcome, guide]\n---\n# Welcome to Native Nodes! 🌊\n\nNative Nodes is a premium, client-side note-taking workspace that turns your local directory into a wiki using standard Markdown files. \n\n### Key Highlights\n1. **Local Folder Integration**: Edits write directly to your local drive. No cloud accounts required!\n2. **Wiki Double-Brackets**: Link pages together by writing [[Wiki Links]].\n3. **Connection Graph**: A force-directed dynamic visualizer mapped on the right displays all your linked notes. Drag nodes and click to explore.\n\n### Getting Started\n* Click on [[Wiki Links]] to navigate.\n* Here is an unresolved link: [[Create Me]]. Clicking it will prompt you to create that page instantly!\n* Read the [[Tutorial]] to see formatting rules.\n* Checkout our nested guide: [[Style Guide]].`
      },
      {
        name: 'Tutorial',
        content: `---\ntags: [tutorial, markdown]\n---\n# Native Nodes Guide & Markdown Tips 📝\n\nWiki links are written using bracket indicators. Let's see some samples:\n\n* Standard Link: [[Welcome]]\n* Custom Label: [[Welcome|Go Back Welcome]]\n\n### Markdown Features\nWrite standard GFM Markdown like tables, checklists, blockquotes:\n\n| Feature | Supported | Premium Style |\n| :--- | :---: | :---: |\n| Tables | Yes | Light/Dark themed |\n| Checklists | Yes | Custom sliders |\n| Inline code | \`const a = 1\` | Monospaced block |\n\n> "Simple design, complex connections. Keep writing."`
      },
      {
        name: 'Guides/Style Guide',
        content: `---\ntags: [guides, style]\n---\n# Style Guide 🎨\n\nThis is a sample page nested inside a subfolder named \`Guides\`.\n\nNotice that you can link to it directly via [[Style Guide]] (flat lookup) or explicitly via [[Guides/Style Guide]].\n\n### Folder Organization\nOrganizing notes in directories keeps your workspace clean. The sidebar shows folders in a collapsible hierarchy.`
      }
    ];

    for (const note of demoNotes) {
      const fm = parseFrontmatter(note.content);
      const pageObj = {
        name: note.name,
        content: note.content,
        exists: true,
        handle: null,
        tags: fm.tags,
        fields: fm.fields
      };
      this.pages.set(note.name.toLowerCase(), pageObj);

      const parts = note.name.toLowerCase().split('/');
      const flatName = parts[parts.length - 1];
      if (!this.pageNamesIndex.has(flatName)) {
        this.pageNamesIndex.set(flatName, []);
      }
      this.pageNamesIndex.get(flatName).push(pageObj);
    }

    this.showAppShell();
  }

  /**
   * Scans files from directories.
   */
  async loadWorkspace() {
    if (!this.dirHandle) return;
    this.dom.activeWorkspaceName.textContent = this.dirHandle.name;

    this.pages.clear();
    this.pageNamesIndex.clear();
    await this.scanDirectory(this.dirHandle);
    
    this.showAppShell();
  }

  /**
   * Recursively scans for markdown files.
   */

  async scanDirectory(dirHandle, currentPath = '', entries = []) {
    if (dirHandle.isTauri) {
      // Tauri mode: use fs plugin to read directory recursively
      await this._scanDirectoryTauri(dirHandle.path, '');
      return;
    }

    const isRoot = currentPath === '';


    for await (const entry of dirHandle.values()) {
      const relativePath = currentPath ? `${currentPath}/${entry.name}` : entry.name;
      
      if (entry.kind === 'file' && entry.name.toLowerCase().endsWith('.md')) {
        entries.push({ entry, relativePath });
      } else if (entry.kind === 'directory') {
        if (entry.name.startsWith('.')) continue; // skip hidden/system directories
        await this.scanDirectory(entry, relativePath, entries);
      }
    }

    if (isRoot && entries.length > 0) {
      const promises = [];
      for (const { entry, relativePath } of entries) {
        promises.push((async () => {
          const file = await entry.getFile();
          const content = await file.text();
          const pageName = relativePath.slice(0, -3); // Strip .md

          const fm = parseFrontmatter(content);
          const pageObj = {
            name: pageName,
            content: content,
            exists: true,
            handle: entry,
            tags: fm.tags,
            fields: fm.fields
          };
          this.pages.set(pageName.toLowerCase(), pageObj);

          const parts = pageName.toLowerCase().split('/');
          const flatName = parts[parts.length - 1];
          if (!this.pageNamesIndex.has(flatName)) {
            this.pageNamesIndex.set(flatName, []);
          }
          this.pageNamesIndex.get(flatName).push(pageObj);
        })());

        if (promises.length >= 100) {
          await Promise.all(promises);
          promises.length = 0;
        }
      }

      if (promises.length > 0) {
        await Promise.all(promises);
      }
    }
  }

  /**
   * Recursively scan directory using Tauri fs plugin.
   */
  async _scanDirectoryTauri(basePath, currentRelative) {
    const fs = window.__TAURI__.fs;
    const fullPath = currentRelative ? `${basePath}/${currentRelative}` : basePath;
    
    let entries;
    try {
      entries = await fs.readDir(fullPath);
    } catch (err) {
      console.error('Error reading directory:', fullPath, err);
      return;
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;

      const relativePath = currentRelative ? `${currentRelative}/${entry.name}` : entry.name;

      if (entry.isDirectory) {
        await this._scanDirectoryTauri(basePath, relativePath);
      } else if (entry.isFile && entry.name.toLowerCase().endsWith('.md')) {
        try {
          const content = await fs.readTextFile(`${basePath}/${relativePath}`);
          const pageName = relativePath.slice(0, -3); // Strip .md

          const fm = parseFrontmatter(content);
          const pageObj = {
            name: pageName,
            content: content,
            exists: true,
            handle: `${basePath}/${relativePath}`, // Store full path string
            tags: fm.tags,
            fields: fm.fields
          };
          this.pages.set(pageName.toLowerCase(), pageObj);

          const parts = pageName.toLowerCase().split('/');
          const flatName = parts[parts.length - 1];
          if (!this.pageNamesIndex.has(flatName)) {
            this.pageNamesIndex.set(flatName, []);
          }
          this.pageNamesIndex.get(flatName).push(pageObj);
        } catch (err) {
          console.error('Error reading file:', relativePath, err);
        }
      }
    }
  }

  /**
   * Transitions UI layouts.
   */
  showAppShell() {
    this.dom.welcomeShell.style.display = 'none';
    this.dom.appShell.style.display = 'flex';

    // Initialize Canvas Graph View
    if (!this.graph) {
      this.graph = new WikiGraph(this.dom.graphCanvas, (nodeId) => {
        window.location.hash = `#/page/${encodeURIComponent(nodeId)}`;
      });
    }

    this.renderFileList();
    this.renderTagList();
    this.updateGraph();

    // Trigger hash routing logic
    this.handleRouting();
  }

  /**
   * Filters and renders file list. Renders hierarchical folders.
   */
  renderFileList() {
    const filter = this.dom.searchInput.value.toLowerCase().trim();
    const activeTag = this.selectedTag ? this.selectedTag.toLowerCase() : null;
    this.dom.fileList.innerHTML = '';

    if (filter) {
      this._renderFlatFileList(filter, activeTag);
      return;
    }

    this._renderDirectoryTree(activeTag);
  }

  _matchesFilters(page, filter, activeTag) {
    if (filter && !page.name.toLowerCase().includes(filter) && !page.content.toLowerCase().includes(filter)) {
      return false;
    }
    if (activeTag) {
      const pageTags = (page.tags || []).map(t => t.toLowerCase());
      if (!pageTags.includes(activeTag)) {
        return false;
      }
    }
    return true;
  }

  _renderFlatFileList(filter, activeTag) {
    const list = Array.from(this.pages.values()).sort((a, b) => a.name.localeCompare(b.name));
    for (const page of list) {
      if (!this._matchesFilters(page, filter, activeTag)) {
        continue;
      }

      const li = document.createElement('li');
      const isActive = this.activePage && page.name.toLowerCase() === this.activePage.name.toLowerCase();
      li.className = `file-item ${isActive ? 'active' : ''}`;

      li.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
          <polyline points="14 2 14 8 20 8"></polyline>
          <line x1="16" y1="13" x2="8" y2="13"></line>
          <line x1="16" y1="17" x2="8" y2="17"></line>
        </svg>
        <span>${escapeHTML(page.name)}</span>
      `;

      li.addEventListener('click', () => {
        window.location.hash = `#/page/${encodeURIComponent(page.name)}`;
      });

      this.dom.fileList.appendChild(li);
    }
  }

  _renderDirectoryTree(activeTag) {
    // Build directory tree structure
    const root = { children: new Map(), files: [] };
    for (const page of this.pages.values()) {
      if (!this._matchesFilters(page, null, activeTag)) {
        continue;
      }
      const parts = page.name.split('/');
      let current = root;
      for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        if (!current.children.has(part)) {
          current.children.set(part, { name: part, children: new Map(), files: [] });
        }
        current = current.children.get(part);
      }
      current.files.push(page);
    }

    // Restore expanded states from memory or auto expand top levels
    if (!this.expandedFolders) {
      this.expandedFolders = new Set();
      for (const key of root.children.keys()) {
        this.expandedFolders.add(key.toLowerCase());
      }
      setSetting('expandedFolders', Array.from(this.expandedFolders));
    }

    this._renderDirectoryNode(root, this.dom.fileList);
  }

  _renderDirectoryNode(node, container, pathPrefix = '') {
    const sortedDirs = Array.from(node.children.values()).sort((a, b) => a.name.localeCompare(b.name));
    const sortedFiles = node.files.sort((a, b) => a.name.localeCompare(b.name));

    for (const dir of sortedDirs) {
      const fullDirPath = pathPrefix ? `${pathPrefix}/${dir.name}` : dir.name;
      const dirKey = fullDirPath.toLowerCase();
      const folderLi = document.createElement('li');
      folderLi.className = 'folder-item';

      const isExpanded = this.expandedFolders.has(dirKey);

      folderLi.innerHTML = `
        <div class="folder-title">
          <svg class="chevron-icon ${isExpanded ? 'expanded' : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="9 18 15 12 9 6"></polyline>
          </svg>
          <svg class="folder-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
          </svg>
          <span>${escapeHTML(dir.name)}</span>
        </div>
        <ul class="folder-children" style="display: ${isExpanded ? 'block' : 'none'};"></ul>
      `;

      const titleDiv = folderLi.querySelector('.folder-title');
      const childrenUl = folderLi.querySelector('.folder-children');
      const chevron = folderLi.querySelector('.chevron-icon');

      titleDiv.addEventListener('click', (e) => {
        e.stopPropagation();
        const currentlyExpanded = this.expandedFolders.has(dirKey);
        if (currentlyExpanded) {
          this.expandedFolders.delete(dirKey);
          childrenUl.style.display = 'none';
          chevron.classList.remove('expanded');
        } else {
          this.expandedFolders.add(dirKey);
          childrenUl.style.display = 'block';
          chevron.classList.add('expanded');
        }
        setSetting('expandedFolders', Array.from(this.expandedFolders));
      });

      this._renderDirectoryNode(dir, childrenUl, fullDirPath);
      container.appendChild(folderLi);
    }

    for (const file of sortedFiles) {
      const fileLi = document.createElement('li');
      const isActive = this.activePage && file.name.toLowerCase() === this.activePage.name.toLowerCase();
      fileLi.className = `file-item ${isActive ? 'active' : ''}`;

      const displayTitle = file.name.split('/').pop();

      fileLi.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
          <polyline points="14 2 14 8 20 8"></polyline>
          <line x1="16" y1="13" x2="8" y2="13"></line>
          <line x1="16" y1="17" x2="8" y2="17"></line>
        </svg>
        <span>${escapeHTML(displayTitle)}</span>
      `;

      fileLi.addEventListener('click', (e) => {
        e.stopPropagation();
        window.location.hash = `#/page/${encodeURIComponent(file.name)}`;
      });

      container.appendChild(fileLi);
    }
  }

  async loadPage(pageName) {
    // Check if there is an unsaved file changes, save them
    if (this.isDirty) {
      await this.saveActivePageSync();
    }

    const key = pageName.toLowerCase();
    const page = this.pages.get(key);
    if (!page) return;

    this.activePage = page;
    setSetting('lastOpenedPage', page.name);

    // Load editor text (hide frontmatter block in editor)
    this.editor.setMarkdown(stripFrontmatter(page.content));
    this.dom.activeNoteTitle.textContent = page.name;

    // Render properties metadata block
    this.renderProperties();

    // Mark as clean initially
    this.markAsClean();

    // Render Preview HTML
    this.renderPreview();
    
    // Highlight Active Sidebar Item
    this.renderFileList();

    // Update Node positions
    if (this.graph) {
      this.graph.updateData(
        this.getGraphNodes(),
        this.getGraphLinks(),
        page.name,
        this.theme === 'dark'
      );
    }
  }

  /**
   * Refreshes preview parser.
   */
  renderPreview() {
    if (!this.activePage) return;
    const text = this.editor.getMarkdown();
    const html = renderMarkdown(text, this.pages);
    
    // Render properties block for preview if any exist
    let propertiesHTML = '';
    const tags = this.activePage.tags || [];
    const fields = this.activePage.fields || {};
    const hasFields = Object.keys(fields).length > 0;
    
    if (tags.length > 0 || hasFields) {
      propertiesHTML += `<div class="preview-properties">`;
      propertiesHTML += `<div class="preview-properties-title">Properties</div>`;
      propertiesHTML += `<div class="preview-properties-grid">`;
      
      if (tags.length > 0) {
        propertiesHTML += `<div class="preview-property-label">`;
        propertiesHTML += `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right: 4px; display: inline;"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path><line x1="7" y1="7" x2="7.01" y2="7"></line></svg>`;
        propertiesHTML += `tags</div>`;
        propertiesHTML += `<div class="preview-property-value">`;
        propertiesHTML += tags.map(tag => `<span class="tag-pill" data-tag="${escapeHTML(tag)}">#${escapeHTML(tag)}</span>`).join(' ');
        propertiesHTML += `</div>`;
      }
      
      for (const [k, v] of Object.entries(fields)) {
        propertiesHTML += `<div class="preview-property-label">${escapeHTML(k)}</div>`;
        propertiesHTML += `<div class="preview-property-value">${escapeHTML(v)}</div>`;
      }
      
      propertiesHTML += `</div></div>`;
    }
    
    const printTitleHTML = `<h1 class="print-only print-title">${escapeHTML(this.activePage.name)}</h1>`;
    this.dom.previewContent.innerHTML = printTitleHTML + propertiesHTML + html;

    // Add event listeners to tags in preview to filter by tag when clicked
    this.dom.previewContent.querySelectorAll('.tag-pill').forEach(pill => {
      pill.addEventListener('click', (e) => {
        e.stopPropagation();
        const tag = pill.getAttribute('data-tag');
        this.filterByTag(tag);
      });
    });

    // Run mermaid rendering
    try {
      mermaid.run({
        querySelector: '.mermaid'
      }).catch(err => {
        console.warn("Mermaid render error:", err);
      });
    } catch (e) {
      console.warn("Mermaid run error:", e);
    }
  }

  /**
   * Workspace auto-saving.
   */
  triggerAutoSave() {
    if (this.saveTimeout) clearTimeout(this.saveTimeout);
    
    this.saveTimeout = setTimeout(() => {
      this.saveActivePageSync();
    }, 1200);
  }

  markAsDirty() {
    this.isDirty = true;
    this.dom.saveStatus.className = 'save-indicator dirty';
    this.dom.saveStatus.querySelector('span').textContent = 'Editing...';
    this.dom.saveStatus.querySelector('svg').innerHTML = `
      <circle cx="12" cy="12" r="10"></circle>
      <line x1="12" y1="8" x2="12" y2="12"></line>
      <line x1="12" y1="16" x2="12.01" y2="16"></line>
    `;
    this.renderPreview();
  }

  markAsClean() {
    this.isDirty = false;
    this.dom.saveStatus.className = 'save-indicator saved';
    this.dom.saveStatus.querySelector('span').textContent = 'Saved';
    this.dom.saveStatus.querySelector('svg').innerHTML = `
      <polyline points="20 6 9 17 4 12"></polyline>
    `;
  }

  /**
   * Saves page content.
   */
  async saveActivePageSync() {
    if (!this.activePage || !this.isDirty) return;
    
    const editorMarkdown = this.editor.getMarkdown();
    const tagsList = this.activePage.tags || [];
    const fields = this.activePage.fields || {};
    
    // Reconstruct frontmatter and prepend to markdown
    const frontmatter = stringifyFrontmatter(tagsList, fields);
    const fullContent = frontmatter + editorMarkdown;
    
    this.activePage.content = fullContent;
    
    // Update in Map
    const pageInMap = this.pages.get(this.activePage.name.toLowerCase());
    if (pageInMap) {
      pageInMap.content = fullContent;
      pageInMap.tags = tagsList;
      pageInMap.fields = fields;
    }

    if (this.isSandbox) {
      // In sandbox mode, it resides only in memory
      this.markAsClean();
      this.renderTagList();
      this.updateGraph();
      return;
    }

    try {
      // Write file changes back to local hard drive
      const handle = this.activePage.handle;
      if (handle) {
        if (typeof handle === 'string' && this.isTauri) {
          // Tauri mode — write via fs plugin
          await window.__TAURI__.fs.writeTextFile(handle, fullContent);
        } else {
          // Web API mode
          const writable = await handle.createWritable();
          await writable.write(fullContent);
          await writable.close();
        }
        
        this.markAsClean();
        this.renderTagList();
        this.updateGraph();
      }
    } catch (err) {
      console.error('Failed to write changes directly to disk:', err);
      // Fallback: Notify user
      this.dom.saveStatus.className = 'save-indicator dirty';
      this.dom.saveStatus.querySelector('span').textContent = 'Write Failed!';
    }
  }

  /**
   * Generates a new .md note file.
   */
  /**
   * Generates a new .md note file. Automatically makes folders if needed.
   */
  async createNewPage(title) {
    // Split and clean parts, but preserve slashes for folder paths
    const parts = title.split('/').map(p => p.replace(/[\\:*?"<>|]/g, '').trim()).filter(Boolean);
    if (parts.length === 0) return;

    // Resolve relative to active page's directory if the input has no folders
    let relativePathParts = [...parts];
    if (parts.length === 1 && this.activePage) {
      const activeParts = this.activePage.name.split('/');
      if (activeParts.length > 1) {
        relativePathParts = [...activeParts.slice(0, -1), parts[0]];
      }
    }

    const cleanTitle = relativePathParts.join('/');
    const key = cleanTitle.toLowerCase();
    
    if (this.pages.has(key)) {
      window.location.hash = `#/page/${encodeURIComponent(this.pages.get(key).name)}`;
      return;
    }

    const filename = relativePathParts[relativePathParts.length - 1] + '.md';
    const folderPathParts = relativePathParts.slice(0, -1);
    const defaultContent = `---\ntags: []\n---\n# ${relativePathParts[relativePathParts.length - 1]}\n\nStart writing notes... Use [[WikiLinks]] to connect pages.`;

    if (this.isSandbox) {
      const pageObj = {
        name: cleanTitle,
        content: defaultContent,
        exists: true,
        handle: null,
        tags: []
      };
      this.pages.set(key, pageObj);

      const parts = cleanTitle.toLowerCase().split('/');
      const flatName = parts[parts.length - 1];
      if (!this.pageNamesIndex.has(flatName)) {
        this.pageNamesIndex.set(flatName, []);
      }
      this.pageNamesIndex.get(flatName).push(pageObj);
      
      this.renderFileList();
      this.renderTagList();
      this.updateGraph();
      
      const targetHash = `#/page/${encodeURIComponent(cleanTitle)}`;
      if (decodeURIComponent(window.location.hash) === decodeURIComponent(targetHash)) {
        await this.loadPage(cleanTitle);
      } else {
        window.location.hash = targetHash;
      }
      return;
    }


    try {
      let handleOrPath;
      if (this.dirHandle.isTauri && this.isTauri) {
        // Tauri mode — create directories and file via fs plugin
        const fs = window.__TAURI__.fs;
        if (folderPathParts.length > 0) {
          const folderFullPath = `${this.dirHandle.path}/${folderPathParts.join('/')}`;
          await fs.mkdir(folderFullPath, { recursive: true });
        }
        const fullPath = `${this.dirHandle.path}/${relativePathParts.join('/')}.md`;
        await fs.writeTextFile(fullPath, defaultContent);
        handleOrPath = fullPath;
      } else {
        // Web API mode
        let currentDir = this.dirHandle;
        for (const folderName of folderPathParts) {
          currentDir = await currentDir.getDirectoryHandle(folderName, { create: true });
        }
        const newFileHandle = await currentDir.getFileHandle(filename, { create: true });
        const writable = await newFileHandle.createWritable();
        await writable.write(defaultContent);
        await writable.close();
        handleOrPath = newFileHandle;
      }

      const pageObj = {
        name: cleanTitle,
        content: defaultContent,
        exists: true,
        handle: handleOrPath,
        tags: []
      };

      this.pages.set(key, pageObj);

      const parts = cleanTitle.toLowerCase().split('/');
      const flatName = parts[parts.length - 1];
      if (!this.pageNamesIndex.has(flatName)) {
        this.pageNamesIndex.set(flatName, []);
      }
      this.pageNamesIndex.get(flatName).push(pageObj);

      this.renderFileList();
      this.renderTagList();
      this.updateGraph();
      
      // Load newly created file
      const targetHash = `#/page/${encodeURIComponent(cleanTitle)}`;
      if (decodeURIComponent(window.location.hash) === decodeURIComponent(targetHash)) {
        await this.loadPage(cleanTitle);
      } else {
        window.location.hash = targetHash;
      }
    } catch (err) {
      alert('Could not create page file in directory.');
      console.error(err);
    }
  }

  openNewNoteModal() {
    this.dom.newNoteModal.showModal();
    this.dom.newNoteName.focus();
  }

  /**
   * Resolves a typed wiki-link target to the actual workspace page cased name
   * using flat lookup or exact match.
   */
  resolveWikiLink(targetName) {
    const key = targetName.toLowerCase();
    if (this.pages.has(key)) {
      return this.pages.get(key).name; // Exact match
    }

    if (this.pageNamesIndex.has(key)) {
      const matches = this.pageNamesIndex.get(key);
      if (matches && matches.length > 0) {
        return matches[0].name; // Flat suffix match
      }
    }

    // Fallback for multi-segment suffix matching (e.g. [[sub/page]] -> archive/sub/page)
    const suffix = '/' + key;
    for (const [existingKey, page] of this.pages.entries()) {
      if (existingKey.endsWith(suffix)) {
        return page.name;
      }
    }

    return targetName; // Not found, keep as is
  }

  /**
   * Dynamic node resolution for graph visualization.
   */
  getGraphNodes() {
    const nodes = [];
    const existing = new Set(Array.from(this.pages.keys()));

    // 1. Gather all pages in current workspace
    for (const page of this.pages.values()) {
      nodes.push({ name: page.name, exists: true });
    }

    // 2. Gather non-existent page links that are referenced
    const referenced = new Set();
    for (const page of this.pages.values()) {
      const extracted = extractWikiLinks(page.content);
      for (const target of extracted) {
        const resolvedName = this.resolveWikiLink(target);
        const key = resolvedName.toLowerCase();
        if (!existing.has(key)) {
          referenced.add(resolvedName);
        }
      }
    }

    for (const missingPage of referenced) {
      nodes.push({ name: missingPage, exists: false });
    }

    return nodes;
  }

  /**
   * Formulates list of links for graph visualization.
   */
  getGraphLinks() {
    const links = [];
    for (const page of this.pages.values()) {
      const extracted = extractWikiLinks(page.content);
      for (const target of extracted) {
        const resolvedName = this.resolveWikiLink(target);
        links.push({
          source: page.name,
          target: resolvedName
        });
      }
    }
    return links;
  }

  /**
   * Refreshes graph simulation coordinates.
   */
  updateGraph() {
    if (!this.graph) return;
    this.graph.updateData(
      this.getGraphNodes(),
      this.getGraphLinks(),
      this.activePage ? this.activePage.name : null,
      this.theme === 'dark'
    );
  }

  /**
   * Renders the sidebar tag list with unique tags and their respective counts.
   */
  renderTagList() {
    this.dom.tagList.innerHTML = '';
    
    // Extract all unique tags in alphabetical order, with counts
    const tagCounts = new Map();
    for (const page of this.pages.values()) {
      const tags = page.tags || [];
      for (const tag of tags) {
        const cleanTag = tag.trim();
        if (cleanTag) {
          tagCounts.set(cleanTag, (tagCounts.get(cleanTag) || 0) + 1);
        }
      }
    }
    
    const sortedTags = Array.from(tagCounts.keys()).sort((a, b) => a.localeCompare(b));
    
    if (sortedTags.length === 0) {
      const emptyLi = document.createElement('li');
      emptyLi.className = 'tag-item-empty';
      emptyLi.textContent = 'No tags found';
      this.dom.tagList.appendChild(emptyLi);
      return;
    }
    
    for (const tag of sortedTags) {
      const count = tagCounts.get(tag);
      const li = document.createElement('li');
      const isActive = this.selectedTag && this.selectedTag.toLowerCase() === tag.toLowerCase();
      li.className = `tag-item ${isActive ? 'active' : ''}`;
      

      li.innerHTML = `
        <span class="tag-name">#${escapeHTML(tag)}</span>
        <span class="tag-count">${count}</span>
      `;
      li.addEventListener('click', () => {
        if (isActive) {
          this.filterByTag(null);
        } else {
          this.filterByTag(tag);
        }
      });
      this.dom.tagList.appendChild(li);
    }
  }

  /**
   * Sets/unsets tag filter and re-renders sidebar articles and tag list.
   * @param {string|null} tag 
   */
  filterByTag(tag) {
    this.selectedTag = tag;
    
    if (tag) {
      this.dom.activeTagFilterName.textContent = `#${tag}`;
      this.dom.activeTagFilterIndicator.style.display = 'inline-flex';
    } else {
      this.dom.activeTagFilterIndicator.style.display = 'none';
    }
    
    this.renderFileList();
    this.renderTagList();
  }

  /**
   * Renders tag chips in the tags bar.
   */
  renderTagBarChips() {
    if (!this.activePage) return;
    const tagsList = this.activePage.tags || [];
    this.dom.tagPillsList.innerHTML = '';
    
    tagsList.forEach((tag) => {
      const chip = document.createElement('div');
      chip.className = 'tag-chip';
      
      const span = document.createElement('span');
      span.textContent = `#${tag}`;
      chip.appendChild(span);
      
      const btn = document.createElement('button');
      btn.className = 'delete-tag-btn';
      btn.innerHTML = '&times;';
      btn.title = `Remove tag ${tag}`;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.removeTag(tag);
      });
      chip.appendChild(btn);
      
      this.dom.tagPillsList.appendChild(chip);
    });
  }

  /**
   * Adds a tag to the active note.
   */
  addTag(tag) {
    if (!this.activePage) return;
    const cleanTag = tag.trim().toLowerCase().replace(/[#\s,]/g, '');
    if (!cleanTag) return;
    
    if (!this.activePage.tags) {
      this.activePage.tags = [];
    }
    
    if (!this.activePage.tags.includes(cleanTag)) {
      this.activePage.tags.push(cleanTag);
      this.markAsDirty();
      this.renderTagBarChips();
      this.renderTagList(); // Update sidebar tags list
      this.triggerAutoSave();
    }
    
    this.dom.tagInputField.value = '';
    this.hideAutocomplete();
  }

  /**
   * Removes a tag from the active note.
   */
  removeTag(tag) {
    if (!this.activePage || !this.activePage.tags) return;
    
    const idx = this.activePage.tags.indexOf(tag);
    if (idx !== -1) {
      this.activePage.tags.splice(idx, 1);
      this.markAsDirty();
      this.renderTagBarChips();
      this.renderTagList(); // Update sidebar tags list
      this.triggerAutoSave();
    }
  }

  /**
   * Compiles all unique tags present in the workspace.
   */
  getWorkspaceTags() {
    const allTags = new Set();
    for (const page of this.pages.values()) {
      if (page.tags) {
        page.tags.forEach(t => allTags.add(t.toLowerCase()));
      }
    }
    return Array.from(allTags).sort();
  }

  /**
   * Initializes event listeners for the tag editor input.
   */
  setupTagEditor() {
    const input = this.dom.tagInputField;
    const dropdown = this.dom.tagAutocompleteDropdown;
    
    let activeSuggestionIndex = -1;
    
    input.addEventListener('input', () => {
      const query = input.value.trim().toLowerCase().replace(/#/g, '');
      if (!query) {
        this.hideAutocomplete();
        return;
      }
      
      const workspaceTags = this.getWorkspaceTags();
      const activeTags = this.activePage ? (this.activePage.tags || []) : [];
      
      // Filter out tags already added to the note
      const filtered = workspaceTags.filter(t => t.includes(query) && !activeTags.includes(t));
      
      if (filtered.length > 0) {
        this.showAutocomplete(filtered);
      } else {
        this.hideAutocomplete();
      }
      activeSuggestionIndex = -1;
    });
    
    input.addEventListener('keydown', (e) => {
      const items = dropdown.querySelectorAll('.autocomplete-item');
      
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        if (activeSuggestionIndex >= 0 && activeSuggestionIndex < items.length) {
          const selectedTag = items[activeSuggestionIndex].getAttribute('data-tag');
          this.addTag(selectedTag);
        } else {
          this.addTag(input.value);
        }
      } else if (e.key === 'Backspace' && !input.value && this.activePage && this.activePage.tags && this.activePage.tags.length > 0) {
        // Backspace on empty input removes the last tag
        const lastTag = this.activePage.tags[this.activePage.tags.length - 1];
        this.removeTag(lastTag);
      } else if (e.key === 'ArrowDown' && dropdown.style.display !== 'none') {
        e.preventDefault();
        activeSuggestionIndex = (activeSuggestionIndex + 1) % items.length;
        this.highlightSuggestion(items, activeSuggestionIndex);
      } else if (e.key === 'ArrowUp' && dropdown.style.display !== 'none') {
        e.preventDefault();
        activeSuggestionIndex = (activeSuggestionIndex - 1 + items.length) % items.length;
        this.highlightSuggestion(items, activeSuggestionIndex);
      } else if (e.key === 'Escape') {
        this.hideAutocomplete();
      }
    });
    
    // Hide autocomplete when clicking outside
    document.addEventListener('click', (e) => {
      if (!this.dom.tagInputField.contains(e.target) && !dropdown.contains(e.target)) {
        this.hideAutocomplete();
      }
    });
  }

  highlightSuggestion(items, index) {
    items.forEach((item, idx) => {
      item.classList.toggle('active', idx === index);
      if (idx === index) {
        item.scrollIntoView({ block: 'nearest' });
      }
    });
  }

  showAutocomplete(tags) {
    const dropdown = this.dom.tagAutocompleteDropdown;
    dropdown.innerHTML = '';
    dropdown.style.display = 'block';
    
    tags.forEach(tag => {
      const item = document.createElement('div');
      item.className = 'autocomplete-item';
      item.textContent = tag;
      item.setAttribute('data-tag', tag);
      item.addEventListener('click', () => {
        this.addTag(tag);
      });
      dropdown.appendChild(item);
    });
  }

  hideAutocomplete() {
    this.dom.tagAutocompleteDropdown.style.display = 'none';
    this.dom.tagAutocompleteDropdown.innerHTML = '';
  }

  populateThemePicker() {
    const THEMES = {
      'dracula': { name: 'Dracula', mode: 'dark' },
      'onedark': { name: 'One Dark', mode: 'dark' },
      'nord': { name: 'Nord', mode: 'dark' },
      'gruvbox-dark': { name: 'Gruvbox Dark', mode: 'dark' },
      'gruvbox-light': { name: 'Gruvbox Light', mode: 'light' },
      'solarized-dark': { name: 'Solarized Dark', mode: 'dark' },
      'solarized-light': { name: 'Solarized Light', mode: 'light' },
      'monokai': { name: 'Monokai', mode: 'dark' },
      'tokyonight': { name: 'Tokyo Night', mode: 'dark' },
      'catppuccin': { name: 'Catppuccin', mode: 'dark' },
      'github-dark': { name: 'Github Dark', mode: 'dark' },
      'github-light': { name: 'Github Light', mode: 'light' }
    };
    
    this.dom.themeDropdownMenu.innerHTML = '';
    for (const [themeId, themeData] of Object.entries(THEMES)) {
      const btn = document.createElement('div');
      btn.className = `dropdown-item ${this.theme === themeId ? 'active' : ''}`;
      btn.dataset.themeId = themeId;
      btn.textContent = themeData.name;
      
      btn.addEventListener('click', () => {
        this.setTheme(themeId);
        this.dom.themeDropdownMenu.style.display = 'none';
      });
      
      this.dom.themeDropdownMenu.appendChild(btn);
    }
    
    // Handle theme dropdown toggling
    this.dom.themePickerBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const visible = this.dom.themeDropdownMenu.style.display === 'flex';
      this.dom.themeDropdownMenu.style.display = visible ? 'none' : 'flex';
    });
    
    document.addEventListener('click', () => {
      this.dom.themeDropdownMenu.style.display = 'none';
    });
  }

  renderProperties() {
    if (!this.activePage) {
      this.dom.propertiesContainer.style.display = 'none';
      return;
    }
    
    this.dom.propertiesContainer.style.display = 'flex';
    
    // Keep only the tags row in the grid, clear everything else
    const rows = this.dom.propertiesList.querySelectorAll('.property-row');
    rows.forEach(row => {
      if (row.id !== 'tagsPropertyRow') {
        row.remove();
      }
    });
    
    // Render tag chips
    this.renderTagBarChips();
    
    // Now render each custom field
    const fields = this.activePage.fields || {};
    for (const [key, val] of Object.entries(fields)) {
      const row = document.createElement('div');
      row.className = 'property-row';
      
      row.innerHTML = `
        <div class="property-key-container">
          <svg class="property-key-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="4" y1="9" x2="20" y2="9"></line>
            <line x1="4" y1="15" x2="20" y2="15"></line>
            <line x1="10" y1="3" x2="8" y2="21"></line>
            <line x1="16" y1="3" x2="14" y2="21"></line>
          </svg>
          <input type="text" class="property-key" value="${escapeHTML(key)}" placeholder="property name">
        </div>
        <div>
          <input type="text" class="property-val-input" value="${escapeHTML(val)}" placeholder="value">
        </div>
        <div>
          <button class="delete-property-btn" title="Delete Property">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
        </div>
      `;
      
      const keyInput = row.querySelector('.property-key');
      const valInput = row.querySelector('.property-val-input');
      const deleteBtn = row.querySelector('.delete-property-btn');
      
      // Event: Edit Key name
      keyInput.addEventListener('change', () => {
        const newKey = keyInput.value.trim();
        if (!newKey) {
          delete this.activePage.fields[key];
          this.markAsDirty();
          this.triggerAutoSave();
          this.renderProperties();
          return;
        }
        if (newKey === key) return;
        
        const currentVal = this.activePage.fields[key];
        delete this.activePage.fields[key];
        this.activePage.fields[newKey] = currentVal;
        this.markAsDirty();
        this.triggerAutoSave();
        this.renderProperties();
      });
      
      // Event: Edit Value
      valInput.addEventListener('change', () => {
        const newVal = valInput.value.trim();
        if (newVal === val) return;
        this.activePage.fields[key] = newVal;
        this.markAsDirty();
        this.triggerAutoSave();
        this.renderPreview();
      });
      
      // Event: Delete property
      deleteBtn.addEventListener('click', () => {
        delete this.activePage.fields[key];
        this.markAsDirty();
        this.triggerAutoSave();
        this.renderProperties();
        this.renderPreview();
      });
      
      this.dom.propertiesList.appendChild(row);
    }
  }

  async renameActivePage(newTitle) {
    if (!this.activePage) return;
    const oldName = this.activePage.name;
    const newName = newTitle.replace(/[\\:*?"<>|]/g, '').trim();
    
    if (!newName || newName.toLowerCase() === oldName.toLowerCase()) {
      this.dom.activeNoteTitle.textContent = oldName;
      return;
    }
    
    const newKey = newName.toLowerCase();
    if (this.pages.has(newKey)) {
      alert(`A page named "${newName}" already exists.`);
      this.dom.activeNoteTitle.textContent = oldName;
      return;
    }

    await this.saveActivePageSync();
    
    const content = this.activePage.content;
    const tags = this.activePage.tags;
    const fields = this.activePage.fields || {};
    const oldKey = oldName.toLowerCase();
    
    try {
      let handleOrPath = null;
      if (this.isSandbox) {
        const pageObj = {
          name: newName,
          content: content,
          exists: true,
          handle: null,
          tags: tags,
          fields: fields
        };
        
        this.pages.delete(oldKey);
        this.pages.set(newKey, pageObj);
        this._updatePageNamesIndex(oldName, newName, pageObj);
      } else {
        const newFilename = newName.split('/').pop() + '.md';
        const newFolderParts = newName.split('/').slice(0, -1);
        
        if (this.dirHandle.isTauri && this.isTauri) {
          const fs = window.__TAURI__.fs;
          if (newFolderParts.length > 0) {
            const folderFullPath = `${this.dirHandle.path}/${newFolderParts.join('/')}`;
            await fs.mkdir(folderFullPath, { recursive: true });
          }
          const newFullPath = `${this.dirHandle.path}/${newName}.md`;
          const oldFullPath = this.activePage.handle;
          if (oldFullPath) {
            await fs.rename(oldFullPath, newFullPath);
          } else {
            await fs.writeTextFile(newFullPath, content);
          }
          handleOrPath = newFullPath;
        } else {
          let currentDir = this.dirHandle;
          for (const folderName of newFolderParts) {
            currentDir = await currentDir.getDirectoryHandle(folderName, { create: true });
          }
          const newFileHandle = await currentDir.getFileHandle(newFilename, { create: true });
          const writable = await newFileHandle.createWritable();
          await writable.write(content);
          await writable.close();
          handleOrPath = newFileHandle;
          
          let oldDir = this.dirHandle;
          const oldParts = oldName.split('/');
          const oldFilename = oldParts[oldParts.length - 1] + '.md';
          const oldFolderParts = oldParts.slice(0, -1);
          for (const folderName of oldFolderParts) {
            oldDir = await oldDir.getDirectoryHandle(folderName);
          }
          await oldDir.removeEntry(oldFilename);
        }
        
        const pageObj = {
          name: newName,
          content: content,
          exists: true,
          handle: handleOrPath,
          tags: tags,
          fields: fields
        };
        
        this.pages.delete(oldKey);
        this.pages.set(newKey, pageObj);
        this._updatePageNamesIndex(oldName, newName, pageObj);
      }
      
      this.activePage = this.pages.get(newKey);
      setSetting('lastOpenedPage', newName);
      this.dom.activeNoteTitle.textContent = newName;
      this.renderFileList();
      this.updateGraph();
      
      window.location.hash = `#/page/${encodeURIComponent(newName)}`;
      
    } catch (err) {
      alert('Failed to rename page file.');
      console.error(err);
      this.dom.activeNoteTitle.textContent = oldName;
    }
  }

  _updatePageNamesIndex(oldName, newName, pageObj) {
    const oldParts = oldName.toLowerCase().split('/');
    const oldFlat = oldParts[oldParts.length - 1];
    if (this.pageNamesIndex.has(oldFlat)) {
      const arr = this.pageNamesIndex.get(oldFlat);
      const idx = arr.findIndex(p => p.name.toLowerCase() === oldName.toLowerCase());
      if (idx !== -1) arr.splice(idx, 1);
      if (arr.length === 0) this.pageNamesIndex.delete(oldFlat);
    }
    
    const newParts = newName.toLowerCase().split('/');
    const newFlat = newParts[newParts.length - 1];
    if (!this.pageNamesIndex.has(newFlat)) {
      this.pageNamesIndex.set(newFlat, []);
    }
    this.pageNamesIndex.get(newFlat).push(pageObj);
  }
}

// Instantiate on load
window.addEventListener('DOMContentLoaded', () => {
  window.app = new NativeNodesApp();
});
