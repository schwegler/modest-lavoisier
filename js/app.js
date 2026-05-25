/**
 * WikiFlow - Main Application Coordinator
 * 
 * Orchestrates filesystem access, in-memory sandbox demo mode,
 * routing, autosaving, PWA installer states, and visual graph binding.
 */

import { getSetting, setSetting, deleteSetting } from './db.js';

import { renderMarkdown, extractWikiLinks, extractTags, stripFrontmatter, escapeHTML } from './editor.js';
import { WikiGraph } from './graph.js';

class WikiFlowApp {
  constructor() {
    // App State
    this.dirHandle = null;
    this.pages = new Map(); // Lowercase Page Name -> { name, content, handle, exists }
    this.activePage = null;  // { name, content }
    this.theme = 'dark';
    this.layout = 'split'; // 'edit', 'split', 'preview'
    this.graphVisible = true;
    this.graphFullscreen = false;
    this.isSandbox = false;
    this.selectedTag = null;
    this.saveTimeout = null;

    // Check if running in Electron environment
    this.isElectron = navigator.userAgent.toLowerCase().includes('electron');
    if (this.isElectron) {
      document.body.classList.add('electron-window');
      const isMac = navigator.userAgent.toLowerCase().includes('macintosh') || navigator.userAgent.toLowerCase().includes('mac os x');
      if (isMac) {
        document.body.classList.add('electron-mac');
      } else {
        document.body.classList.add('electron-non-mac');
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
      
      layoutEditBtn: document.getElementById('layoutEditBtn'),
      layoutSplitBtn: document.getElementById('layoutSplitBtn'),
      layoutPreviewBtn: document.getElementById('layoutPreviewBtn'),
      toggleGraphBtn: document.getElementById('toggleGraphBtn'),
      exportHtmlBtn: document.getElementById('exportHtmlBtn'),
      themeToggleBtn: document.getElementById('themeToggleBtn'),
      themeIconSun: document.getElementById('themeIconSun'),
      themeIconMoon: document.getElementById('themeIconMoon'),
      
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
      helpModal: document.getElementById('helpModal')
    };

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
    } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
      this.setTheme('light');
    } else {
      this.setTheme('dark');
    }

    // Layout
    const savedLayout = await getSetting('layout');
    if (savedLayout) {
      this.setLayout(savedLayout);
    }

    // Graph visibility
    const savedGraphVisible = await getSetting('graphVisible');
    if (savedGraphVisible !== undefined) {
      this.setGraphVisibility(savedGraphVisible);
    }

    // Expanded folders state
    const savedExpanded = await getSetting('expandedFolders');
    this.expandedFolders = savedExpanded ? new Set(savedExpanded) : null;
  }

  /**
   * Theme configuration handler.
   */
  setTheme(theme) {
    this.theme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    setSetting('theme', theme);

    if (theme === 'dark') {
      this.dom.themeIconSun.style.display = 'block';
      this.dom.themeIconMoon.style.display = 'none';
    } else {
      this.dom.themeIconSun.style.display = 'none';
      this.dom.themeIconMoon.style.display = 'block';
    }

    if (this.graph) {
      this.graph.updateData(
        this.getGraphNodes(),
        this.getGraphLinks(),
        this.activePage ? this.activePage.name : null,
        this.theme === 'dark'
      );
    }
  }

  /**
   * Panel toggle handler.
   */
  setLayout(layout) {
    this.layout = layout;
    this.dom.workspacePanels.className = `workspace-panels ${layout}-only`;
    
    // Toggle active classes on toolbar buttons
    this.dom.layoutEditBtn.classList.toggle('active', layout === 'edit');
    this.dom.layoutSplitBtn.classList.toggle('active', layout === 'split');
    this.dom.layoutPreviewBtn.classList.toggle('active', layout === 'preview');

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

    // Layout Toolbar
    this.dom.layoutEditBtn.addEventListener('click', () => this.setLayout('edit'));
    this.dom.layoutSplitBtn.addEventListener('click', () => this.setLayout('split'));
    this.dom.layoutPreviewBtn.addEventListener('click', () => this.setLayout('preview'));
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

    // Modals Controls
    this.dom.helpModalBtn.addEventListener('click', () => this.dom.helpModal.showModal());
    this.dom.themeToggleBtn.addEventListener('click', () => {
      this.setTheme(this.theme === 'dark' ? 'light' : 'dark');
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
    this.dom.exportHtmlBtn.addEventListener('click', () => {
      window.print();
    });

    // Editor AutoSave & Sync Change Events
    this.dom.editorTextarea.addEventListener('input', () => {
      this.markAsDirty();
      this.triggerAutoSave();
    });

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
        // Only trigger focus if not focused in textarea
        if (document.activeElement !== this.dom.editorTextarea) {
          e.preventDefault();
          this.dom.searchInput.focus();
        }
      }

      // Graph Toggle: Cmd+G
      if (isCmd && e.key.toLowerCase() === 'g') {
        e.preventDefault();
        this.setGraphVisibility(!this.graphVisible);
      }

      // Theme Toggle: Cmd+I
      if (isCmd && e.key.toLowerCase() === 'i') {
        e.preventDefault();
        this.setTheme(this.theme === 'dark' ? 'light' : 'dark');
      }

      // Layout toggle: Alt+L
      if (e.altKey && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        const modes = ['edit', 'split', 'preview'];
        const nextIdx = (modes.indexOf(this.layout) + 1) % modes.length;
        this.setLayout(modes[nextIdx]);
      }
    });

    // Hash Router Listener
    window.addEventListener('hashchange', () => this.handleRouting());
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
      // Load first page in workspace by default
      if (this.pages.size > 0) {
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
      const handle = await window.showDirectoryPicker({
        mode: 'readwrite'
      });
      
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
    const demoNotes = [
      {
        name: 'Welcome',
        content: `---\ntags: [welcome, guide]\n---\n# Welcome to WikiFlow! 🌊\n\nWikiFlow is a premium, client-side note-taking workspace that turns your local directory into a wiki using standard Markdown files. \n\n### Key Highlights\n1. **Local Folder Integration**: Edits write directly to your local drive. No cloud accounts required!\n2. **Wiki Double-Brackets**: Link pages together by writing [[Wiki Links]].\n3. **Connection Graph**: A force-directed dynamic visualizer mapped on the right displays all your linked notes. Drag nodes and click to explore.\n\n### Getting Started\n* Click on [[Wiki Links]] to navigate.\n* Here is an unresolved link: [[Create Me]]. Clicking it will prompt you to create that page instantly!\n* Read the [[Tutorial]] to see formatting rules.\n* Checkout our nested guide: [[Style Guide]].`
      },
      {
        name: 'Tutorial',
        content: `---\ntags: [tutorial, markdown]\n---\n# WikiFlow Guide & Markdown Tips 📝\n\nWiki links are written using bracket indicators. Let's see some samples:\n\n* Standard Link: [[Welcome]]\n* Custom Label: [[Welcome|Go Back Welcome]]\n\n### Markdown Features\nWrite standard GFM Markdown like tables, checklists, blockquotes:\n\n| Feature | Supported | Premium Style |\n| :--- | :---: | :---: |\n| Tables | Yes | Light/Dark themed |\n| Checklists | Yes | Custom sliders |\n| Inline code | \`const a = 1\` | Monospaced block |\n\n> "Simple design, complex connections. Keep writing."`
      },
      {
        name: 'Guides/Style Guide',
        content: `---\ntags: [guides, style]\n---\n# Style Guide 🎨\n\nThis is a sample page nested inside a subfolder named \`Guides\`.\n\nNotice that you can link to it directly via [[Style Guide]] (flat lookup) or explicitly via [[Guides/Style Guide]].\n\n### Folder Organization\nOrganizing notes in directories keeps your workspace clean. The sidebar shows folders in a collapsible hierarchy.`
      }
    ];

    for (const note of demoNotes) {
      this.pages.set(note.name.toLowerCase(), {
        name: note.name,
        content: note.content,
        exists: true,
        handle: null,
        tags: extractTags(note.content)
      });
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
    await this.scanDirectory(this.dirHandle);
    
    this.showAppShell();
  }

  /**
   * Recursively scans for markdown files.
   */
  async scanDirectory(dirHandle, currentPath = '', promises = []) {
    const isRoot = currentPath === '';

    for await (const entry of dirHandle.values()) {
      const relativePath = currentPath ? `${currentPath}/${entry.name}` : entry.name;
      
      if (entry.kind === 'file' && entry.name.toLowerCase().endsWith('.md')) {
        promises.push((async () => {
          const file = await entry.getFile();
          const content = await file.text();
          const pageName = relativePath.slice(0, -3); // Strip .md

          this.pages.set(pageName.toLowerCase(), {
            name: pageName,
            content: content,
            exists: true,
            handle: entry,
            tags: extractTags(content)
          });
        })());
      } else if (entry.kind === 'directory') {
        if (entry.name.startsWith('.')) continue; // skip hidden/system directories
        await this.scanDirectory(entry, relativePath, promises);
      }

      if (promises.length >= 100) {
        await Promise.all(promises);
        promises.length = 0;
      }
    }

    if (isRoot && promises.length > 0) {
      await Promise.all(promises);
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

    const matchesFilters = (page) => {
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
    };

    if (filter) {
      // Flat filter list
      const list = Array.from(this.pages.values()).sort((a, b) => a.name.localeCompare(b.name));
      for (const page of list) {
        if (!matchesFilters(page)) {
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
      return;
    }

    // Build directory tree structure
    const root = { children: new Map(), files: [] };
    for (const page of this.pages.values()) {
      if (!matchesFilters(page)) {
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

    const renderNode = (node, container, pathPrefix = '') => {
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

        renderNode(dir, childrenUl, fullDirPath);
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
    };

    renderNode(root, this.dom.fileList);
  }

  /**
   * Renders selected markdown file into editor panel.
   */
  async loadPage(pageName) {
    // Check if there is an unsaved file changes, save them
    if (this.isDirty) {
      await this.saveActivePageSync();
    }

    const key = pageName.toLowerCase();
    const page = this.pages.get(key);
    if (!page) return;

    this.activePage = page;

    // Load editor text
    this.dom.editorTextarea.value = page.content;
    this.dom.activeNoteTitle.textContent = page.name;

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
    const text = this.dom.editorTextarea.value;
    
    // Formulate a set containing cased page names for wiki link resolving
    const existingNames = new Set(Array.from(this.pages.values()).map(p => p.name));
    
    const html = renderMarkdown(text, existingNames);
    
    const tags = extractTags(text);
    let tagsHTML = '';
    if (tags && tags.length > 0) {
      tagsHTML = `<div class="preview-tags-container">` +
        tags.map(tag => `<span class="tag-pill" data-tag="${escapeHTML(tag)}">#${escapeHTML(tag)}</span>`).join('') +
        `</div>`;
    }
    
    this.dom.previewContent.innerHTML = tagsHTML + html;

    // Add event listeners to tags in preview to filter by tag when clicked
    this.dom.previewContent.querySelectorAll('.tag-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        const tag = pill.getAttribute('data-tag');
        this.filterByTag(tag);
      });
    });
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
    
    const newContent = this.dom.editorTextarea.value;
    this.activePage.content = newContent;
    this.activePage.tags = extractTags(newContent);

    // Update in Map
    this.pages.get(this.activePage.name.toLowerCase()).content = newContent;
    this.pages.get(this.activePage.name.toLowerCase()).tags = this.activePage.tags;

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
        const writable = await handle.createWritable();
        await writable.write(newContent);
        await writable.close();
        
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
      this.pages.set(key, {
        name: cleanTitle,
        content: defaultContent,
        exists: true,
        handle: null,
        tags: []
      });
      
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
      let currentDir = this.dirHandle;
      for (const folderName of folderPathParts) {
        currentDir = await currentDir.getDirectoryHandle(folderName, { create: true });
      }
      const newFileHandle = await currentDir.getFileHandle(filename, { create: true });
      const writable = await newFileHandle.createWritable();
      await writable.write(defaultContent);
      await writable.close();

      this.pages.set(key, {
        name: cleanTitle,
        content: defaultContent,
        exists: true,
        handle: newFileHandle,
        tags: []
      });

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
    const suffix = '/' + key;
    for (const [existingKey, page] of this.pages.entries()) {
      if (existingKey.endsWith(suffix)) {
        return page.name; // Flat suffix match
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
}

// Instantiate on load
window.addEventListener('DOMContentLoaded', () => {
  new WikiFlowApp();
});
