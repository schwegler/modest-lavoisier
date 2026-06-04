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
    window.app = this;
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
    this.pinnedNotes = new Set();
    this.newNoteFolderPrefix = '';

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
      pinnedSection: document.getElementById('pinnedSection'),
      pinnedList: document.getElementById('pinnedList'),
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
      graphSearchInput: document.getElementById('graphSearchInput'),
      clearGraphSearchBtn: document.getElementById('clearGraphSearchBtn'),
      graphZoomInBtn: document.getElementById('graphZoomInBtn'),
      graphZoomOutBtn: document.getElementById('graphZoomOutBtn'),
      graphResetBtn: document.getElementById('graphResetBtn'),
      graphPlayPauseBtn: document.getElementById('graphPlayPauseBtn'),
      graphSettingsToggleBtn: document.getElementById('graphSettingsToggleBtn'),
      graphSettingsDrawer: document.getElementById('graphSettingsDrawer'),
      closeGraphSettingsBtn: document.getElementById('closeGraphSettingsBtn'),
      graphRepulsionSlider: document.getElementById('graphRepulsionSlider'),
      graphLinkDistSlider: document.getElementById('graphLinkDistSlider'),
      repulsionValue: document.getElementById('repulsionValue'),
      linkDistanceValue: document.getElementById('linkDistanceValue'),

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
      activeNoteTitleInput: document.getElementById('activeNoteTitleInput'),
      editorFormattingBar: document.getElementById('editorFormattingBar'),
      imageFileInput: document.getElementById('imageFileInput'),
      customContextMenu: document.getElementById('customContextMenu')
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
      },
      onSelectionChange: (view) => {
        this.updateFormattingBarPosition(view);
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
    // Theme (Default to system)
    const savedTheme = await getSetting('theme');
    this.setTheme(savedTheme || 'system');

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
    if (savedExpanded) {
      this.expandedFolders = new Set(savedExpanded);
    }

    // Pinned notes state
    const savedPinned = await getSetting('pinnedNotes');
    if (savedPinned) {
      this.pinnedNotes = new Set(savedPinned);
    }

    // Properties drawer collapsed state
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
    try {
      localStorage.setItem('theme', theme);
    } catch (e) {}

    if (this.dom.themeDropdownMenu) {
      this.dom.themeDropdownMenu.querySelectorAll('.dropdown-item').forEach(item => {
        const isActive = item.dataset.themeId === theme;
        item.classList.toggle('active', isActive);
        item.setAttribute('aria-selected', isActive ? 'true' : 'false');
      });
    }

    let isDark;
    if (theme === 'system') {
      isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    } else {
      isDark = ['dracula', 'onedark', 'nord', 'gruvbox-dark', 'solarized-dark', 'monokai', 'tokyonight', 'catppuccin', 'github-dark', 'dark'].includes(theme);
    }

    try {
      mermaid.initialize({
        theme: isDark ? 'dark' : 'default'
      });
    } catch (e) {}

    if (this.editor && typeof this.editor.setTheme === 'function') {
      this.editor.setTheme(theme);
    }

    if (this.graph) {
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
    
    // Toggle active class on toolbar toggle button and swap icon SVG
    if (this.dom.layoutToggleBtn) {
      this.dom.layoutToggleBtn.classList.toggle('active', layout === 'edit');
      
      if (layout === 'edit') {
        this.dom.layoutToggleBtn.innerHTML = `
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
            <circle cx="12" cy="12" r="3"></circle>
          </svg>
        `;
      } else {
        this.dom.layoutToggleBtn.innerHTML = `
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 20h9"></path>
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
          </svg>
        `;
      }
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
    // Listen for OS color scheme change
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (this.theme === 'system') {
        this.setTheme('system');
      }
    });

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
      setTimeout(() => {
        if (this.graph) {
          this.graph.resizeCanvas();
          this.graph.heatUp();
        }
      }, 250);
    });

    // Graph Overlay controls listeners
    this.dom.graphZoomInBtn.addEventListener('click', () => this.graph && this.graph.zoomIn());
    this.dom.graphZoomOutBtn.addEventListener('click', () => this.graph && this.graph.zoomOut());
    this.dom.graphResetBtn.addEventListener('click', () => this.graph && this.graph.resetView());

    this.dom.graphSearchInput.addEventListener('input', () => {
      if (!this.graph) return;
      const query = this.dom.graphSearchInput.value;
      this.graph.setSearchFilter(query);
      this.dom.clearGraphSearchBtn.style.display = query.trim() ? 'block' : 'none';
    });
    
    this.dom.clearGraphSearchBtn.addEventListener('click', () => {
      this.dom.graphSearchInput.value = '';
      if (this.graph) this.graph.setSearchFilter('');
      this.dom.clearGraphSearchBtn.style.display = 'none';
    });

    this.dom.graphPlayPauseBtn.addEventListener('click', () => {
      if (!this.graph) return;
      const isCurrentlyPlaying = this.graph.isPlaying;
      const newPlayState = !isCurrentlyPlaying;
      
      this.graph.togglePlay(newPlayState);
      this.dom.graphPlayPauseBtn.classList.toggle('active', newPlayState);
      this.dom.graphPlayPauseBtn.title = newPlayState ? 'Pause Physics' : 'Play Physics';
      
      const pauseIcon = this.dom.graphPlayPauseBtn.querySelector('.pause-icon');
      const playIcon = this.dom.graphPlayPauseBtn.querySelector('.play-icon');
      
      if (newPlayState) {
        pauseIcon.style.display = 'block';
        playIcon.style.display = 'none';
      } else {
        pauseIcon.style.display = 'none';
        playIcon.style.display = 'block';
      }
    });

    this.dom.graphSettingsToggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isHidden = this.dom.graphSettingsDrawer.style.display === 'none';
      this.dom.graphSettingsDrawer.style.display = isHidden ? 'flex' : 'none';
    });

    this.dom.closeGraphSettingsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.dom.graphSettingsDrawer.style.display = 'none';
    });

    document.addEventListener('click', (e) => {
      if (this.dom.graphSettingsDrawer && this.dom.graphSettingsDrawer.style.display !== 'none') {
        if (!this.dom.graphSettingsDrawer.contains(e.target) && e.target !== this.dom.graphSettingsToggleBtn && !this.dom.graphSettingsToggleBtn.contains(e.target)) {
          this.dom.graphSettingsDrawer.style.display = 'none';
        }
      }
      if (this.dom.customContextMenu) {
        this.dom.customContextMenu.style.display = 'none';
      }
    });

    if (this.dom.customContextMenu) {
      this.dom.customContextMenu.addEventListener('keydown', (e) => {
        const items = Array.from(this.dom.customContextMenu.querySelectorAll('.context-menu-item'));
        const activeIdx = items.indexOf(document.activeElement);

        if (e.key === 'ArrowDown') {
          e.preventDefault();
          const nextIdx = (activeIdx + 1) % items.length;
          items[nextIdx].focus();
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          const prevIdx = (activeIdx - 1 + items.length) % items.length;
          items[prevIdx].focus();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          this.dom.customContextMenu.style.display = 'none';
          if (this.contextMenuTrigger) {
            this.contextMenuTrigger.focus();
            this.contextMenuTrigger = null;
          }
        } else if (e.key === 'Tab') {
          this.dom.customContextMenu.style.display = 'none';
          if (this.contextMenuTrigger) {
            this.contextMenuTrigger.focus();
            this.contextMenuTrigger = null;
          }
        }
      });
    }

    document.addEventListener('contextmenu', (e) => {
      if (this.dom.customContextMenu && !e.target.closest('.folder-title') && !e.target.closest('.file-item') && !e.target.closest('.folder-item')) {
        this.dom.customContextMenu.style.display = 'none';
      }
    });

    // Root folder drop target
    this.dom.fileList.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    });
    this.dom.fileList.addEventListener('drop', async (e) => {
      e.preventDefault();
      const pageName = e.dataTransfer.getData('application/x-page-name') || e.dataTransfer.getData('text/plain');
      if (pageName && this.pages.has(pageName.toLowerCase())) {
        await this.movePageToFolder(pageName, '');
      }
    });

    // Workspace panels drop targets (excluding CodeMirror content area)
    this.dom.workspacePanels.addEventListener('dragover', (e) => {
      const types = e.dataTransfer.types;
      if (types && (types.includes('application/x-page-name') || types.includes('text/plain'))) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }
    });

    this.dom.workspacePanels.addEventListener('drop', (e) => {
      let pageName = e.dataTransfer.getData('application/x-page-name');
      if (!pageName) {
        const plainText = e.dataTransfer.getData('text/plain');
        if (plainText && this.pages.has(plainText.toLowerCase())) {
          pageName = plainText;
        }
      }
      if (!pageName) return;

      const isInsideCM = e.target.closest('.cm-editor');
      if (isInsideCM) {
        // Let CodeMirror handle it directly (already implemented in codemirror-editor.js)
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      let isImage = e.dataTransfer.getData('application/x-is-image') === 'true';
      if (!isImage && pageName) {
        const pageObj = this.pages.get(pageName.toLowerCase());
        if (pageObj && pageObj.isImage) {
          isImage = true;
        }
      }
      const insertText = isImage ? `![[${pageName}]]` : `[[${pageName}]]`;

      if (this.layout === 'preview') {
        this.appendToActivePageEnd(insertText);
      } else {
        const isInsidePreview = e.target.closest('#previewPanel');
        if (isInsidePreview) {
          this.appendToActivePageEnd(insertText);
        } else {
          this.insertAtCursorOrEnd(insertText);
        }
      }
    });

    this.setupFormattingToolbar();

    this.dom.graphRepulsionSlider.addEventListener('input', () => {
      const val = this.dom.graphRepulsionSlider.value;
      this.dom.repulsionValue.textContent = val;
      if (this.graph) this.graph.setRepulsion(val);
    });
    
    this.dom.graphLinkDistSlider.addEventListener('input', () => {
      const val = this.dom.graphLinkDistSlider.value;
      this.dom.linkDistanceValue.textContent = val;
      if (this.graph) this.graph.setLinkDistance(val);
    });

    // Initialize Theme Picker
    this.populateThemePicker();

    // Collapsible Properties Panel Header listener (Accessible)
    this.dom.propertiesHeader.tabIndex = 0;
    this.dom.propertiesHeader.setAttribute('role', 'button');
    this.dom.propertiesHeader.setAttribute('aria-expanded', this.dom.propertiesContainer.classList.contains('collapsed') ? 'false' : 'true');
    
    this.dom.propertiesHeader.addEventListener('click', () => {
      const collapsed = this.dom.propertiesContainer.classList.contains('collapsed');
      this.dom.propertiesContainer.classList.toggle('collapsed', !collapsed);
      this.dom.propertiesHeader.setAttribute('aria-expanded', collapsed ? 'true' : 'false');
      setSetting('propertiesCollapsed', !collapsed);
    });

    this.dom.propertiesHeader.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.dom.propertiesHeader.click();
      }
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
        const fullTitle = this.newNoteFolderPrefix ? `${this.newNoteFolderPrefix}/${title}` : title;
        this.createNewPage(fullTitle);
        this.dom.newNoteModal.close();
        this.dom.newNoteName.value = '';
        this.newNoteFolderPrefix = '';
      }
    });

    // Export Page Control
    this.dom.exportHtmlBtn.addEventListener('click', async () => {
      // Ensure preview content is up-to-date before printing
      await this.renderPreview();
      
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

    // Intercept clicks on external links and open them in default system browser in Tauri
    document.addEventListener('click', (e) => {
      const anchor = e.target.closest('a');
      if (!anchor) return;
      const href = anchor.getAttribute('href');
      if (href && (href.startsWith('http://') || href.startsWith('https://'))) {
        e.preventDefault();
        if (this.isTauri) {
          window.__TAURI__.core.invoke('open_external_url', { url: href }).catch(err => {
            console.error('Failed to open external link:', err);
            window.open(href, '_blank');
          });
        } else {
          window.open(href, '_blank');
        }
      }
    });

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

    // Populate mock images in Sandbox mode
    const sandboxImages = [
      { name: '3082743_0818bc.jpg', url: 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=800' },
      { name: 'Guides/sunset.png', url: 'https://images.unsplash.com/photo-1472214222555-d404758b1c42?w=800' }
    ];
    for (const img of sandboxImages) {
      const key = img.name.toLowerCase();
      const pageObj = {
        name: img.name,
        content: '',
        exists: true,
        isImage: true,
        handle: null,
        url: img.url,
        tags: [],
        fields: {}
      };
      this.pages.set(key, pageObj);
      const parts = key.split('/');
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
      
      const isFile = entry.kind === 'file';
      const isMarkdown = entry.name.toLowerCase().endsWith('.md');
      const isImage = /\.(png|jpg|jpeg|gif|webp|svg|bmp)$/i.test(entry.name);
      
      if (isFile && (isMarkdown || isImage)) {
        entries.push({ entry, relativePath, isImage });
      } else if (entry.kind === 'directory') {
        if (entry.name.startsWith('.')) continue; // skip hidden/system directories
        await this.scanDirectory(entry, relativePath, entries);
      }
    }

    if (isRoot && entries.length > 0) {
      const promises = [];
      for (const { entry, relativePath, isImage } of entries) {
        promises.push((async () => {
          const file = await entry.getFile();
          const pageName = isImage ? relativePath : relativePath.slice(0, -3);
          
          let pageObj;
          if (isImage) {
            pageObj = {
              name: pageName,
              content: '',
              exists: true,
              isImage: true,
              handle: entry,
              url: URL.createObjectURL(file),
              tags: [],
              fields: {}
            };
          } else {
            const content = await file.text();
            const fm = parseFrontmatter(content);
            pageObj = {
              name: pageName,
              content: content,
              exists: true,
              isImage: false,
              handle: entry,
              tags: fm.tags,
              fields: fm.fields
            };
          }
          
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

    const promises = [];

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;

      const relativePath = currentRelative ? `${currentRelative}/${entry.name}` : entry.name;

      if (entry.isDirectory) {
        promises.push(this._scanDirectoryTauri(basePath, relativePath));
      } else if (entry.isFile && (entry.name.toLowerCase().endsWith('.md') || /\.(png|jpg|jpeg|gif|webp|svg|bmp)$/i.test(entry.name))) {
        promises.push((async () => {
          try {
            const isImage = /\.(png|jpg|jpeg|gif|webp|svg|bmp)$/i.test(entry.name);
            const pageName = isImage ? relativePath : relativePath.slice(0, -3);
            const fileFullPath = `${basePath}/${relativePath}`;
            
            let pageObj;
            if (isImage) {
              const assetUrl = window.__TAURI__.core.convertFileSrc(fileFullPath);
              pageObj = {
                name: pageName,
                content: '',
                exists: true,
                isImage: true,
                handle: fileFullPath,
                url: assetUrl,
                tags: [],
                fields: {}
              };
            } else {
              const content = await fs.readTextFile(fileFullPath);
              const fm = parseFrontmatter(content);
              pageObj = {
                name: pageName,
                content: content,
                exists: true,
                isImage: false,
                handle: fileFullPath,
                tags: fm.tags,
                fields: fm.fields
              };
            }
            
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
        })());
      }

      // Batch promises to avoid memory issues and too many open files
      if (promises.length >= 100) {
        await Promise.all(promises);
        promises.length = 0;
      }
    }

    if (promises.length > 0) {
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

    this._renderPinnedList(filter, activeTag);

    if (filter) {
      this._renderFlatFileList(filter, activeTag);
      return;
    }

    this._renderDirectoryTree(activeTag);
  }

  _renderPinnedList(filter, activeTag) {
    if (!this.dom.pinnedList || !this.dom.pinnedSection) return;

    this.dom.pinnedList.innerHTML = '';
    
    if (this.pinnedNotes.size === 0) {
      this.dom.pinnedSection.style.display = 'none';
      return;
    }

    let visibleCount = 0;
    const pinnedPages = [];
    for (const key of this.pinnedNotes) {
      const page = this.pages.get(key);
      if (page) {
        pinnedPages.push(page);
      }
    }
    pinnedPages.sort((a, b) => a.name.localeCompare(b.name));

    for (const page of pinnedPages) {
      if (!this._matchesFilters(page, filter, activeTag)) {
        continue;
      }

      visibleCount++;
      const li = document.createElement('li');
      const isActive = this.activePage && page.name.toLowerCase() === this.activePage.name.toLowerCase();
      li.className = `file-item pinned-item ${isActive ? 'active' : ''}`;

      const iconHTML = page.isImage 
        ? `<svg class="file-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
             <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
             <circle cx="8.5" cy="8.5" r="1.5"></circle>
             <polyline points="21 15 16 10 5 21"></polyline>
           </svg>`
        : `<svg class="file-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
             <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
             <polyline points="14 2 14 8 20 8"></polyline>
             <line x1="16" y1="13" x2="8" y2="13"></line>
             <line x1="16" y1="17" x2="8" y2="17"></line>
           </svg>`;

      li.innerHTML = `
        ${iconHTML}
        <span class="file-name" style="flex-grow: 1; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHTML(page.name)}</span>
        <svg class="pinned-indicator-icon" viewBox="0 0 24 24" width="12" height="12" fill="currentColor" style="opacity: 0.6; flex-shrink: 0; margin-left: 6px;">
          <path d="M16 12V4c0-1.1-.9-2-2-2h-4c-1.1 0-2 .9-2 2v8l-2 2v2h14v-2l-2-2zM12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2z"/>
        </svg>
      `;

      li.tabIndex = 0;
      li.setAttribute('role', 'button');
      li.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          li.click();
        }
      });

      li.addEventListener('click', (e) => {
        e.stopPropagation();
        window.location.hash = `#/page/${encodeURIComponent(page.name)}`;
      });

      li.draggable = true;
      li.addEventListener('dragstart', (e) => {
        e.stopPropagation();
        e.dataTransfer.effectAllowed = 'all';
        e.dataTransfer.setData('text/plain', page.name);
        e.dataTransfer.setData('application/x-page-name', page.name);
        e.dataTransfer.setData('application/x-is-image', page.isImage ? 'true' : 'false');
      });

      li.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.showContextMenu(e, 'file', page);
      });

      this.dom.pinnedList.appendChild(li);
    }

    if (visibleCount > 0) {
      this.dom.pinnedSection.style.display = 'block';
    } else {
      this.dom.pinnedSection.style.display = 'none';
    }
  }

  togglePinNote(pageName) {
    const key = pageName.toLowerCase();
    if (this.pinnedNotes.has(key)) {
      this.pinnedNotes.delete(key);
    } else {
      this.pinnedNotes.add(key);
    }
    setSetting('pinnedNotes', Array.from(this.pinnedNotes));
    this.renderFileList();
  }

  appendToActivePageEnd(text) {
    if (!this.activePage) return;
    const view = this.editor.view;
    if (!view) return;
    const docLength = view.state.doc.length;
    let insertText = text;
    if (docLength > 0) {
      const currentDoc = view.state.doc.toString();
      if (!currentDoc.endsWith('\n')) {
        insertText = '\n' + text;
      }
    }
    view.dispatch({
      changes: { from: docLength, insert: insertText }
    });
    this.markAsDirty();
    this.triggerAutoSave();
    this.renderPreview();
  }

  insertAtCursorOrEnd(text) {
    if (!this.activePage) return;
    const view = this.editor.view;
    if (!view) return;
    const ranges = view.state.selection.ranges;
    if (ranges.length > 0 && view.hasFocus) {
      const range = ranges[0];
      view.dispatch({
        changes: { from: range.from, to: range.to, insert: text },
        selection: { anchor: range.from + text.length }
      });
      view.focus();
    } else {
      this.appendToActivePageEnd(text);
    }
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

      const iconHTML = page.isImage 
        ? `<svg class="file-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
             <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
             <circle cx="8.5" cy="8.5" r="1.5"></circle>
             <polyline points="21 15 16 10 5 21"></polyline>
           </svg>`
        : `<svg class="file-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
             <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
             <polyline points="14 2 14 8 20 8"></polyline>
             <line x1="16" y1="13" x2="8" y2="13"></line>
             <line x1="16" y1="17" x2="8" y2="17"></line>
           </svg>`;

      li.innerHTML = `
        ${iconHTML}
        <span>${escapeHTML(page.name)}</span>
      `;

      li.tabIndex = 0;
      li.setAttribute('role', 'button');
      li.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          li.click();
        }
      });

      li.addEventListener('click', () => {
        window.location.hash = `#/page/${encodeURIComponent(page.name)}`;
      });

      li.draggable = true;
      li.addEventListener('dragstart', (e) => {
        e.stopPropagation();
        e.dataTransfer.effectAllowed = 'all';
        e.dataTransfer.setData('text/plain', page.name);
        e.dataTransfer.setData('application/x-page-name', page.name);
        e.dataTransfer.setData('application/x-is-image', page.isImage ? 'true' : 'false');
      });

      li.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.showContextMenu(e, 'file', page);
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

      titleDiv.tabIndex = 0;
      titleDiv.setAttribute('role', 'button');
      titleDiv.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');

      titleDiv.addEventListener('click', (e) => {
        e.stopPropagation();
        const currentlyExpanded = this.expandedFolders.has(dirKey);
        if (currentlyExpanded) {
          this.expandedFolders.delete(dirKey);
          childrenUl.style.display = 'none';
          chevron.classList.remove('expanded');
          titleDiv.setAttribute('aria-expanded', 'false');
        } else {
          this.expandedFolders.add(dirKey);
          childrenUl.style.display = 'block';
          chevron.classList.add('expanded');
          titleDiv.setAttribute('aria-expanded', 'true');
        }
        setSetting('expandedFolders', Array.from(this.expandedFolders));
      });

      titleDiv.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          titleDiv.click();
        }
      });

      titleDiv.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        titleDiv.classList.add('drag-over');
      });
      titleDiv.addEventListener('dragleave', () => {
        titleDiv.classList.remove('drag-over');
      });
      titleDiv.addEventListener('drop', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        titleDiv.classList.remove('drag-over');
        const pageName = e.dataTransfer.getData('application/x-page-name') || e.dataTransfer.getData('text/plain');
        if (pageName && this.pages.has(pageName.toLowerCase())) {
          await this.movePageToFolder(pageName, fullDirPath);
        }
      });

      titleDiv.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.showContextMenu(e, 'folder', fullDirPath);
      });

      this._renderDirectoryNode(dir, childrenUl, fullDirPath);
      container.appendChild(folderLi);
    }

    for (const file of sortedFiles) {
      const fileLi = document.createElement('li');
      const isActive = this.activePage && file.name.toLowerCase() === this.activePage.name.toLowerCase();
      fileLi.className = `file-item ${isActive ? 'active' : ''}`;

      const displayTitle = file.name.split('/').pop();

      const iconHTML = file.isImage 
        ? `<svg class="file-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
             <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
             <circle cx="8.5" cy="8.5" r="1.5"></circle>
             <polyline points="21 15 16 10 5 21"></polyline>
           </svg>`
        : `<svg class="file-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
             <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
             <polyline points="14 2 14 8 20 8"></polyline>
             <line x1="16" y1="13" x2="8" y2="13"></line>
             <line x1="16" y1="17" x2="8" y2="17"></line>
           </svg>`;

      fileLi.innerHTML = `
        ${iconHTML}
        <span>${escapeHTML(displayTitle)}</span>
      `;

      fileLi.tabIndex = 0;
      fileLi.setAttribute('role', 'button');
      fileLi.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          fileLi.click();
        }
      });

      fileLi.addEventListener('click', (e) => {
        e.stopPropagation();
        window.location.hash = `#/page/${encodeURIComponent(file.name)}`;
      });

      fileLi.draggable = true;
      fileLi.addEventListener('dragstart', (e) => {
        e.stopPropagation();
        e.dataTransfer.effectAllowed = 'all';
        e.dataTransfer.setData('text/plain', file.name);
        e.dataTransfer.setData('application/x-page-name', file.name);
        e.dataTransfer.setData('application/x-is-image', file.isImage ? 'true' : 'false');
      });

      fileLi.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.showContextMenu(e, 'file', file);
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

    if (page.isImage) {
      await this.ensureBlobUrlForPage(page);
      this.setLayout('preview');
      this.dom.activeNoteTitle.textContent = page.name;
      this.editor.setMarkdown(`# Image Asset: ${page.name}\n\nThis is a binary image asset and cannot be edited directly.`);
      this.markAsClean();
      await this.renderPreview();
    } else {
      // Restore user's preferred layout for markdown pages
      const preferredLayout = await getSetting('layout') || 'edit';
      this.setLayout(preferredLayout);
      this.dom.activeNoteTitle.textContent = page.name;
      
      const contentText = stripFrontmatter(page.content);
      // Pre-load embedded image blobs before editor mounts/updates content
      await this.loadEmbeddedImages(contentText);
      
      this.editor.setMarkdown(contentText);
      this.renderProperties();
      this.markAsClean();
      await this.renderPreview();
    }
    
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

  async ensureBlobUrlForPage(page) {
    if (!page || !page.isImage) return;
    if (page.url && page.url.startsWith('blob:')) {
      return;
    }
    
    if (this.isTauri) {
      try {
        const fs = window.__TAURI__.fs;
        const bytes = await fs.readFile(page.handle);
        const ext = page.name.split('.').pop().toLowerCase();
        let mimeType = 'image/jpeg';
        if (ext === 'png') mimeType = 'image/png';
        else if (ext === 'gif') mimeType = 'image/gif';
        else if (ext === 'webp') mimeType = 'image/webp';
        else if (ext === 'svg') mimeType = 'image/svg+xml';
        else if (ext === 'bmp') mimeType = 'image/bmp';
        
        const blob = new Blob([bytes], { type: mimeType });
        const blobUrl = URL.createObjectURL(blob);
        page.url = blobUrl;
      } catch (err) {
        console.error('Failed to load local image binary for blob:', page.handle, err);
      }
    } else {
      if (page.handle && typeof page.handle.getFile === 'function') {
        try {
          const file = await page.handle.getFile();
          page.url = URL.createObjectURL(file);
        } catch (err) {
          console.error('Failed to load browser image file for blob:', page.name, err);
        }
      }
    }
  }

  async loadEmbeddedImages(markdownText) {
    if (!markdownText) return;
    
    const imagesToLoad = [];
    
    // 1. Match ![[image.png]]
    const wikiImageRegex = /!\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
    let match;
    while ((match = wikiImageRegex.exec(markdownText)) !== null) {
      imagesToLoad.push(match[1].trim());
    }
    
    // 2. Match ![alt](url)
    const mdImageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
    while ((match = mdImageRegex.exec(markdownText)) !== null) {
      const href = match[2].trim();
      if (!href.startsWith('http://') && !href.startsWith('https://') && !href.startsWith('data:')) {
        imagesToLoad.push(href);
      }
    }
    
    for (const imgPath of imagesToLoad) {
      const resolvedName = this.resolveWikiLink(imgPath);
      const foundPage = this.pages.get(resolvedName.toLowerCase());
      if (foundPage && foundPage.isImage) {
        await this.ensureBlobUrlForPage(foundPage);
      }
    }
  }

  /**
   * Refreshes preview parser.
   */
  async renderPreview() {
    if (!this.activePage) return;
    
    if (this.activePage.isImage) {
      await this.ensureBlobUrlForPage(this.activePage);
      const titleHTML = `<h1 class="image-preview-title">${escapeHTML(this.activePage.name)}</h1>`;
      const imgHTML = `
        <div class="image-preview-wrapper">
          <img src="${escapeHTML(this.activePage.url)}" alt="${escapeHTML(this.activePage.name)}" class="image-preview-element">
          <div class="image-preview-details">
            <span><strong>File Path:</strong> ${escapeHTML(this.activePage.name)}</span>
            <span><strong>Type:</strong> Image Asset</span>
          </div>
        </div>
      `;
      this.dom.previewContent.innerHTML = titleHTML + imgHTML;
      this.renderBacklinks();
      return;
    }

    const text = this.editor.getMarkdown();
    await this.loadEmbeddedImages(text);
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

    // Set up table sorting
    this.setupTableSorting();

    // Set up footnote listeners
    this.setupFootnoteListeners();

    // Render backlinks
    this.renderBacklinks();
  }

  setupFootnoteListeners() {
    this.dom.previewContent.querySelectorAll('.footnote-ref a').forEach(a => {
      a.addEventListener('click', (e) => {
        const href = a.getAttribute('href');
        if (href && href.startsWith('#fn-')) {
          const targetId = href.slice(1);
          const targetEl = this.dom.previewContent.querySelector(`#${targetId}`);
          
          if (!targetEl) {
            e.preventDefault();
            e.stopPropagation();
            
            const footnoteNum = href.slice(4);
            const currentMarkdown = this.editor.getMarkdown().trim();
            const noteTitle = this.activePage ? this.activePage.name : 'Untitled';
            
            let slug = '';
            if (noteTitle === "Big Brother 27 Premiere Date and Time") {
              slug = "bb27_premiere_date";
            } else {
              slug = noteTitle.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
            }
            
            const footnoteText = `\n\n[^${footnoteNum}]: [${noteTitle}](https://www.google.com/search?q=https://example.com/${slug})`;
            
            this.editor.setMarkdown(currentMarkdown + footnoteText);
            
            this.markAsDirty();
            this.triggerAutoSave();
            this.renderPreview();
            
            setTimeout(() => {
              const newDefEl = this.dom.previewContent.querySelector(`#${targetId}`);
              if (newDefEl) {
                newDefEl.scrollIntoView({ behavior: 'smooth' });
              }
            }, 100);
          }
        }
      });
    });
  }

  setupTableSorting() {
    const tables = this.dom.previewContent.querySelectorAll('table[data-sortable="true"]');
    tables.forEach(table => {
      const headers = table.querySelectorAll('thead th');
      const tbody = table.querySelector('tbody');
      if (!tbody) return;
      
      headers.forEach((th, index) => {
        th.style.cursor = 'pointer';
        th.classList.add('sortable-header');
        
        // Add indicator elements if not already present
        if (!th.querySelector('.sort-indicator')) {
          const span = document.createElement('span');
          span.className = 'sort-indicator';
          span.style.marginLeft = '6px';
          span.style.opacity = '0.4';
          span.innerHTML = '↕';
          th.appendChild(span);
        }
        
        th.addEventListener('click', () => {
          const currentOrder = th.getAttribute('data-sort-order') || 'none';
          let nextOrder = 'asc';
          if (currentOrder === 'asc') nextOrder = 'desc';
          else if (currentOrder === 'desc') nextOrder = 'asc';
          
          // Reset other headers
          headers.forEach((otherTh, otherIndex) => {
            if (otherIndex !== index) {
              otherTh.removeAttribute('data-sort-order');
              const indicator = otherTh.querySelector('.sort-indicator');
              if (indicator) {
                indicator.innerHTML = '↕';
                indicator.style.opacity = '0.4';
              }
            }
          });
          
          th.setAttribute('data-sort-order', nextOrder);
          const indicator = th.querySelector('.sort-indicator');
          if (indicator) {
            indicator.innerHTML = nextOrder === 'asc' ? '▲' : '▼';
            indicator.style.opacity = '1';
          }
          
          // Sort rows
          const rows = Array.from(tbody.querySelectorAll('tr'));
          rows.sort((rowA, rowB) => {
            const cellA = rowA.cells[index] ? rowA.cells[index].innerText.trim() : '';
            const cellB = rowB.cells[index] ? rowB.cells[index].innerText.trim() : '';
            
            const numA = Number(cellA.replace(/[^0-9.-]/g, ''));
            const numB = Number(cellB.replace(/[^0-9.-]/g, ''));
            if (!isNaN(numA) && !isNaN(numB) && cellA !== '' && cellB !== '') {
              return nextOrder === 'asc' ? numA - numB : numB - numA;
            }
            
            return nextOrder === 'asc' 
              ? cellA.localeCompare(cellB, undefined, { numeric: true, sensitivity: 'base' })
              : cellB.localeCompare(cellA, undefined, { numeric: true, sensitivity: 'base' });
          });
          
          rows.forEach(row => tbody.appendChild(row));
        });
      });
    });
  }

  /**
   * Computes list of pages that link to the active page.
   */
  getIncomingLinks() {
    if (!this.activePage) return [];
    const activeKey = this.activePage.name.toLowerCase();
    const incoming = [];
    
    for (const page of this.pages.values()) {
      if (page.name.toLowerCase() === activeKey) continue;
      
      const extracted = extractWikiLinks(page.content);
      for (const target of extracted) {
        const resolvedName = this.resolveWikiLink(target);
        if (resolvedName.toLowerCase() === activeKey) {
          incoming.push(page);
          break; // Avoid duplicates
        }
      }
    }
    return incoming;
  }

  /**
   * Renders the backlinks section at the bottom of the preview panel.
   */
  renderBacklinks() {
    const container = document.getElementById('backlinksContainer');
    if (!container) return;

    if (!this.activePage) {
      container.innerHTML = '';
      return;
    }

    const incoming = this.getIncomingLinks();
    if (incoming.length === 0) {
      container.innerHTML = `
        <div class="backlinks-section">
          <h3 class="backlinks-title">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
            </svg>
            Incoming Links (0)
          </h3>
          <div class="backlinks-empty">No notes link to this page yet.</div>
        </div>
      `;
      return;
    }

    let html = `
      <div class="backlinks-section">
        <h3 class="backlinks-title">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
          </svg>
          Incoming Links (${incoming.length})
        </h3>
        <ul class="backlinks-list">
    `;

    for (const page of incoming) {
      let cleanContent = stripFrontmatter(page.content);
      // Clean up title header if exists
      cleanContent = cleanContent.replace(/^\s*#\s+.*?\n/, '');
      let snippet = cleanContent.trim().slice(0, 160);
      if (snippet.length >= 160) {
        snippet += '...';
      }
      snippet = escapeHTML(snippet);

      html += `
        <li class="backlink-item" data-page="${escapeHTML(page.name)}">
          <div class="backlink-item-header">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
            </svg>
            <span class="backlink-page-name">${escapeHTML(page.name)}</span>
          </div>
          ${snippet ? `<div class="backlink-snippet">${snippet}</div>` : ''}
        </li>
      `;
    }

    html += `
        </ul>
      </div>
    `;

    container.innerHTML = html;

    // Click navigation
    container.querySelectorAll('.backlink-item').forEach(item => {
      item.addEventListener('click', () => {
        const pageName = item.getAttribute('data-page');
        window.location.hash = `#/page/${encodeURIComponent(pageName)}`;
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

  openNewNoteModal(folderPrefix = '') {
    this.newNoteFolderPrefix = folderPrefix;
    const titleEl = document.getElementById('newNoteModalTitle');
    const labelEl = this.dom.newNoteModal.querySelector('label[for="newNoteName"]');
    
    if (folderPrefix) {
      if (titleEl) titleEl.textContent = `Create Page in "${folderPrefix}"`;
      if (labelEl) labelEl.textContent = `Page Title (will create as "${folderPrefix}/<title>")`;
    } else {
      if (titleEl) titleEl.textContent = 'Create New Page';
      if (labelEl) labelEl.textContent = 'Page Title';
    }
    
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
      const active = idx === index;
      item.classList.toggle('active', active);
      item.setAttribute('aria-selected', active ? 'true' : 'false');
      if (active) {
        item.scrollIntoView({ block: 'nearest' });
      }
    });
  }

  showAutocomplete(tags) {
    const dropdown = this.dom.tagAutocompleteDropdown;
    dropdown.innerHTML = '';
    dropdown.style.display = 'block';
    dropdown.setAttribute('role', 'listbox');
    dropdown.setAttribute('aria-label', 'Tag suggestions');
    
    tags.forEach(tag => {
      const item = document.createElement('div');
      item.className = 'autocomplete-item';
      item.textContent = tag;
      item.setAttribute('data-tag', tag);
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', 'false');
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
      'system': { name: 'System Preference', mode: 'auto' },
      'light': { name: 'Light Mode', mode: 'light' },
      'dark': { name: 'Dark Mode', mode: 'dark' },
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
      const btn = document.createElement('button');
      btn.type = 'button';
      const isActive = this.theme === themeId;
      btn.className = `dropdown-item ${isActive ? 'active' : ''}`;
      btn.dataset.themeId = themeId;
      btn.textContent = themeData.name;
      btn.setAttribute('role', 'option');
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
      
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.setTheme(themeId);
        this.dom.themeDropdownMenu.style.display = 'none';
        this.dom.themePickerBtn.setAttribute('aria-expanded', 'false');
        this.dom.themePickerBtn.focus();
      });
      
      this.dom.themeDropdownMenu.appendChild(btn);
    }
    
    // Handle theme dropdown toggling
    this.dom.themePickerBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const visible = this.dom.themeDropdownMenu.style.display === 'flex';
      this.dom.themeDropdownMenu.style.display = visible ? 'none' : 'flex';
      this.dom.themePickerBtn.setAttribute('aria-expanded', visible ? 'false' : 'true');
      if (!visible) {
        // Focus the active item or first item
        const activeItem = this.dom.themeDropdownMenu.querySelector('.dropdown-item.active') || this.dom.themeDropdownMenu.querySelector('.dropdown-item');
        if (activeItem) activeItem.focus();
      }
    });

    // Keyboard navigation within the dropdown
    this.dom.themeDropdownMenu.addEventListener('keydown', (e) => {
      const items = Array.from(this.dom.themeDropdownMenu.querySelectorAll('.dropdown-item'));
      const activeIdx = items.indexOf(document.activeElement);
      
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const nextIdx = (activeIdx + 1) % items.length;
        items[nextIdx].focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prevIdx = (activeIdx - 1 + items.length) % items.length;
        items[prevIdx].focus();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.dom.themeDropdownMenu.style.display = 'none';
        this.dom.themePickerBtn.setAttribute('aria-expanded', 'false');
        this.dom.themePickerBtn.focus();
      } else if (e.key === 'Tab') {
        this.dom.themeDropdownMenu.style.display = 'none';
        this.dom.themePickerBtn.setAttribute('aria-expanded', 'false');
      }
    });
    
    document.addEventListener('click', () => {
      if (this.dom.themeDropdownMenu.style.display === 'flex') {
        this.dom.themeDropdownMenu.style.display = 'none';
        this.dom.themePickerBtn.setAttribute('aria-expanded', 'false');
      }
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
          <input type="text" class="property-key" value="${escapeHTML(key)}" placeholder="property name" aria-label="Property Name">
        </div>
        <div>
          <input type="text" class="property-val-input" value="${escapeHTML(val)}" placeholder="value" aria-label="Value for ${escapeHTML(key)}">
        </div>
        <div>
          <button class="delete-property-btn" title="Delete Property" aria-label="Delete property ${escapeHTML(key)}">
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
      
      if (this.pinnedNotes.has(oldKey)) {
        this.pinnedNotes.delete(oldKey);
        this.pinnedNotes.add(newKey);
        setSetting('pinnedNotes', Array.from(this.pinnedNotes));
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

  setupFormattingToolbar() {
    if (this.dom.editorFormattingBar) {
      this.dom.editorFormattingBar.addEventListener('mousedown', (e) => {
        // Prevent focus loss from editor when clicking on formatting toolbar
        e.preventDefault();
      });
    }

    const boldBtn = document.getElementById('formatBoldBtn');
    const italicBtn = document.getElementById('formatItalicBtn');
    const codeBtn = document.getElementById('formatCodeBtn');
    const headingBtn = document.getElementById('formatHeadingBtn');
    const linkBtn = document.getElementById('formatLinkBtn');
    const imageBtn = document.getElementById('formatImageBtn');
    const fileInput = document.getElementById('imageFileInput');

    if (boldBtn) boldBtn.addEventListener('click', () => this.editor && this.editor.insertFormatting('bold'));
    if (italicBtn) italicBtn.addEventListener('click', () => this.editor && this.editor.insertFormatting('italic'));
    if (codeBtn) codeBtn.addEventListener('click', () => this.editor && this.editor.insertFormatting('code'));
    if (headingBtn) headingBtn.addEventListener('click', () => this.editor && this.editor.insertFormatting('heading'));
    if (linkBtn) linkBtn.addEventListener('click', () => this.editor && this.editor.insertFormatting('link'));
    
    if (imageBtn) {
      imageBtn.addEventListener('click', () => {
        if (!this.activePage) return;
        if (this.isTauri) {
          this.selectAndImportTauriImage();
        } else {
          if (fileInput) fileInput.click();
        }
      });
    }

    if (fileInput) {
      fileInput.addEventListener('change', async () => {
        if (fileInput.files && fileInput.files.length > 0) {
          const file = fileInput.files[0];
          await this.importAndInsertImageFile(file);
          fileInput.value = ''; // clear
        }
      });
    }
  }

  updateFormattingBarPosition(view) {
    const bar = this.dom.editorFormattingBar;
    if (!bar) return;

    if (!view.hasFocus) {
      setTimeout(() => {
        const activeEl = document.activeElement;
        if (!view.hasFocus && (!activeEl || !bar.contains(activeEl))) {
          bar.style.opacity = '0';
          bar.style.pointerEvents = 'none';
        }
      }, 100);
      return;
    }

    bar.style.opacity = '1';
    bar.style.pointerEvents = 'auto';

    const selection = view.state.selection;
    const head = selection.main.head;
    
    const coords = view.coordsAtPos(head);
    if (!coords) return;

    const editorDom = view.dom;
    const editorRect = editorDom.getBoundingClientRect();

    const leftOffset = ((coords.left + coords.right) / 2) - editorRect.left;
    const topOffset = (coords.top - editorRect.top) - 40;

    const finalTop = Math.max(10, topOffset);

    bar.style.left = `${leftOffset}px`;
    bar.style.top = `${finalTop}px`;
  }

  async selectAndImportTauriImage() {
    try {
      const selected = await window.__TAURI__.dialog.open({
        filters: [{
          name: 'Images',
          extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp']
        }]
      });
      if (selected) {
        const selectedPath = typeof selected === 'string' ? selected : selected[0];
        if (selectedPath) {
          await this.importTauriImage(selectedPath);
        }
      }
    } catch (err) {
      console.error('Failed to open Tauri file dialog for image:', err);
    }
  }

  async importTauriImage(selectedPath) {
    if (!this.activePage) return;
    try {
      const fs = window.__TAURI__.fs;
      const fileName = selectedPath.split(/[/\\]/).pop();
      const workspacePath = this.dirHandle.path;
      
      const isOutside = !selectedPath.toLowerCase().startsWith(workspacePath.toLowerCase());
      let finalPageName;
      let finalPath;

      if (isOutside) {
        const attachmentsFolder = `${workspacePath}/Attachments`;
        await fs.mkdir(attachmentsFolder, { recursive: true });
        
        finalPath = `${attachmentsFolder}/${fileName}`;
        const bytes = await fs.readFile(selectedPath);
        await fs.writeFile(finalPath, bytes);
        finalPageName = `Attachments/${fileName}`;
      } else {
        const relative = selectedPath.slice(workspacePath.length + 1);
        finalPageName = relative.replace(/\\/g, '/');
        finalPath = selectedPath;
      }

      const key = finalPageName.toLowerCase();
      let pageObj = this.pages.get(key);
      if (!pageObj) {
        pageObj = {
          name: finalPageName,
          content: '',
          exists: true,
          isImage: true,
          handle: finalPath,
          url: window.__TAURI__.core.convertFileSrc(finalPath),
          tags: [],
          fields: {}
        };
        this.pages.set(key, pageObj);
        
        const flatName = fileName.toLowerCase();
        if (!this.pageNamesIndex.has(flatName)) {
          this.pageNamesIndex.set(flatName, []);
        }
        this.pageNamesIndex.get(flatName).push(pageObj);
        
        this.renderFileList();
      }

      await this.ensureBlobUrlForPage(pageObj);
      this.editor.insertText(`![[${finalPageName}]]`);
    } catch (err) {
      console.error('Failed to import Tauri image:', err);
      alert('Failed to import image: ' + err.message);
    }
  }

  async importAndInsertImageFile(file) {
    if (!this.activePage) return;
    try {
      const attachmentsDir = await this.dirHandle.getDirectoryHandle('Attachments', { create: true });
      const fileHandle = await attachmentsDir.getFileHandle(file.name, { create: true });
      
      const writable = await fileHandle.createWritable();
      await writable.write(file);
      await writable.close();

      const pageName = `Attachments/${file.name}`;
      const key = pageName.toLowerCase();
      
      let pageObj = this.pages.get(key);
      if (!pageObj) {
        pageObj = {
          name: pageName,
          content: '',
          exists: true,
          isImage: true,
          handle: fileHandle,
          url: URL.createObjectURL(file),
          tags: [],
          fields: {}
        };
        this.pages.set(key, pageObj);

        const flatName = file.name.toLowerCase();
        if (!this.pageNamesIndex.has(flatName)) {
          this.pageNamesIndex.set(flatName, []);
        }
        this.pageNamesIndex.get(flatName).push(pageObj);

        this.renderFileList();
      }

      this.editor.insertText(`![[${pageName}]]`);
    } catch (err) {
      console.error('Failed to import image in browser:', err);
      alert('Failed to import image: ' + err.message);
    }
  }

  async handleExternalImageDrop(file, dropEvent, cmView) {
    if (!this.activePage) return;
    try {
      const pos = cmView.posAtCoords({ x: dropEvent.clientX, y: dropEvent.clientY });
      if (pos === null) return;

      if (this.isTauri && file.path) {
        const fs = window.__TAURI__.fs;
        const fileName = file.name;
        const workspacePath = this.dirHandle.path;
        
        const isOutside = !file.path.toLowerCase().startsWith(workspacePath.toLowerCase());
        let finalPageName;
        let finalPath;

        if (isOutside) {
          const attachmentsFolder = `${workspacePath}/Attachments`;
          await fs.mkdir(attachmentsFolder, { recursive: true });
          
          finalPath = `${attachmentsFolder}/${fileName}`;
          const bytes = await fs.readFile(file.path);
          await fs.writeFile(finalPath, bytes);
          finalPageName = `Attachments/${fileName}`;
        } else {
          const relative = file.path.slice(workspacePath.length + 1);
          finalPageName = relative.replace(/\\/g, '/');
          finalPath = file.path;
        }

        const key = finalPageName.toLowerCase();
        let pageObj = this.pages.get(key);
        if (!pageObj) {
          pageObj = {
            name: finalPageName,
            content: '',
            exists: true,
            isImage: true,
            handle: finalPath,
            url: window.__TAURI__.core.convertFileSrc(finalPath),
            tags: [],
            fields: {}
          };
          this.pages.set(key, pageObj);
          
          const flatName = fileName.toLowerCase();
          if (!this.pageNamesIndex.has(flatName)) {
            this.pageNamesIndex.set(flatName, []);
          }
          this.pageNamesIndex.get(flatName).push(pageObj);
          
          this.renderFileList();
        }

        await this.ensureBlobUrlForPage(pageObj);

        const insertText = `![[${finalPageName}]]`;
        cmView.dispatch({
          changes: { from: pos, insert: insertText },
          selection: { anchor: pos + insertText.length }
        });
        cmView.focus();
      } else {
        const attachmentsDir = await this.dirHandle.getDirectoryHandle('Attachments', { create: true });
        const fileHandle = await attachmentsDir.getFileHandle(file.name, { create: true });
        
        const writable = await fileHandle.createWritable();
        await writable.write(file);
        await writable.close();

        const pageName = `Attachments/${file.name}`;
        const key = pageName.toLowerCase();
        
        let pageObj = this.pages.get(key);
        if (!pageObj) {
          pageObj = {
            name: pageName,
            content: '',
            exists: true,
            isImage: true,
            handle: fileHandle,
            url: URL.createObjectURL(file),
            tags: [],
            fields: {}
          };
          this.pages.set(key, pageObj);

          const flatName = file.name.toLowerCase();
          if (!this.pageNamesIndex.has(flatName)) {
            this.pageNamesIndex.set(flatName, []);
          }
          this.pageNamesIndex.get(flatName).push(pageObj);

          this.renderFileList();
        }

        const insertText = `![[${pageName}]]`;
        cmView.dispatch({
          changes: { from: pos, insert: insertText },
          selection: { anchor: pos + insertText.length }
        });
        cmView.focus();
      }
    } catch (err) {
      console.error('Failed to handle external image drop:', err);
    }
  }

  async movePageToFolder(pageName, targetFolder) {
    const key = pageName.toLowerCase();
    const page = this.pages.get(key);
    if (!page) return;

    const displayTitle = pageName.split('/').pop();
    const newName = targetFolder ? `${targetFolder}/${displayTitle}` : displayTitle;
    if (newName.toLowerCase() === pageName.toLowerCase()) return;

    const newKey = newName.toLowerCase();
    if (this.pages.has(newKey)) {
      alert(`A file named "${newName}" already exists in the destination folder.`);
      return;
    }

    try {
      if (this.isSandbox) {
        this.pages.delete(key);
        page.name = newName;
        this.pages.set(newKey, page);
        this._updatePageNamesIndex(pageName, newName, page);
      } else if (this.isTauri) {
        const fs = window.__TAURI__.fs;
        const isMarkdown = !page.isImage;
        const srcPath = page.handle;
        const destFolderParts = targetFolder.split('/').filter(Boolean);
        
        if (destFolderParts.length > 0) {
          const folderFullPath = `${this.dirHandle.path}/${destFolderParts.join('/')}`;
          await fs.mkdir(folderFullPath, { recursive: true });
        }
        
        const destPath = isMarkdown 
          ? `${this.dirHandle.path}/${newName}.md` 
          : `${this.dirHandle.path}/${newName}`;
          
        await fs.rename(srcPath, destPath);
        
        this.pages.delete(key);
        page.name = newName;
        page.handle = destPath;
        this.pages.set(newKey, page);
        this._updatePageNamesIndex(pageName, newName, page);
      } else {
        const isMarkdown = !page.isImage;
        const file = page.isImage ? await page.handle.getFile() : null;
        const content = page.isImage ? null : page.content;
        
        const destFolderParts = targetFolder.split('/').filter(Boolean);
        let currentDir = this.dirHandle;
        for (const folderName of destFolderParts) {
          currentDir = await currentDir.getDirectoryHandle(folderName, { create: true });
        }
        
        const destFileName = isMarkdown ? displayTitle + '.md' : displayTitle;
        const newFileHandle = await currentDir.getFileHandle(destFileName, { create: true });
        const writable = await newFileHandle.createWritable();
        if (isMarkdown) {
          await writable.write(content);
        } else {
          await writable.write(file);
        }
        await writable.close();
        
        const srcFolderParts = pageName.split('/').slice(0, -1);
        let srcDir = this.dirHandle;
        for (const folderName of srcFolderParts) {
          srcDir = await srcDir.getDirectoryHandle(folderName);
        }
        const srcFileName = isMarkdown ? displayTitle + '.md' : displayTitle;
        await srcDir.removeEntry(srcFileName);
        
        this.pages.delete(key);
        page.name = newName;
        page.handle = newFileHandle;
        this.pages.set(newKey, page);
        this._updatePageNamesIndex(pageName, newName, page);
      }

      if (this.activePage && this.activePage.name.toLowerCase() === pageName.toLowerCase()) {
        this.activePage = page;
        window.location.hash = `#/page/${encodeURIComponent(newName)}`;
      } else {
        this.renderFileList();
        this.updateGraph();
      }
    } catch (err) {
      console.error('Failed to move file to folder:', err);
      alert('Failed to move file: ' + err.message);
    }
  }

  async deletePage(page) {
    if (!page) return;
    const confirmDelete = confirm(`Are you sure you want to delete the file "${page.name}"? This action cannot be undone.`);
    if (!confirmDelete) return;

    try {
      const pageKey = page.name.toLowerCase();
      if (this.pinnedNotes.has(pageKey)) {
        this.pinnedNotes.delete(pageKey);
        setSetting('pinnedNotes', Array.from(this.pinnedNotes));
      }

      if (this.isSandbox) {
        this.pages.delete(page.name.toLowerCase());
        this._removePageFromIndex(page.name);
      } else if (this.isTauri) {
        const fs = window.__TAURI__.fs;
        await fs.remove(page.handle);
        this.pages.delete(page.name.toLowerCase());
        this._removePageFromIndex(page.name);
      } else {
        const parts = page.name.split('/');
        let currentDir = this.dirHandle;
        for (let i = 0; i < parts.length - 1; i++) {
          currentDir = await currentDir.getDirectoryHandle(parts[i]);
        }
        const fileName = page.isImage ? parts[parts.length - 1] : parts[parts.length - 1] + '.md';
        await currentDir.removeEntry(fileName);
        this.pages.delete(page.name.toLowerCase());
        this._removePageFromIndex(page.name);
      }

      if (this.activePage && this.activePage.name.toLowerCase() === page.name.toLowerCase()) {
        this.activePage = null;
        const remaining = Array.from(this.pages.keys());
        if (remaining.length > 0) {
          await this.loadPage(this.pages.get(remaining[0]).name);
        } else {
          this.editor.setMarkdown('');
          this.dom.previewContent.innerHTML = '';
          this.dom.activeNoteTitle.textContent = 'No page open';
        }
      } else {
        this.renderFileList();
        this.renderTagList();
        this.updateGraph();
      }
    } catch (err) {
      console.error('Failed to delete file:', page.name, err);
      alert('Failed to delete file: ' + err.message);
    }
  }

  async deleteFolder(folderPath) {
    const confirmDelete = confirm(`Are you sure you want to delete the folder "${folderPath}" and all of its contents? This action cannot be undone.`);
    if (!confirmDelete) return;

    try {
      const folderKey = folderPath.toLowerCase() + '/';
      const pagesToDelete = [];
      for (const [key, page] of this.pages.entries()) {
        if (key === folderPath.toLowerCase() || key.startsWith(folderKey)) {
          pagesToDelete.push(page);
        }
      }

      let pinnedChanged = false;
      for (const page of pagesToDelete) {
        const pageKey = page.name.toLowerCase();
        if (this.pinnedNotes.has(pageKey)) {
          this.pinnedNotes.delete(pageKey);
          pinnedChanged = true;
        }
      }
      if (pinnedChanged) {
        setSetting('pinnedNotes', Array.from(this.pinnedNotes));
      }

      if (this.isSandbox) {
        for (const page of pagesToDelete) {
          this.pages.delete(page.name.toLowerCase());
          this._removePageFromIndex(page.name);
        }
      } else if (this.isTauri) {
        const fs = window.__TAURI__.fs;
        const fullPath = `${this.dirHandle.path}/${folderPath}`;
        await fs.remove(fullPath, { recursive: true });
        for (const page of pagesToDelete) {
          this.pages.delete(page.name.toLowerCase());
          this._removePageFromIndex(page.name);
        }
      } else {
        const parts = folderPath.split('/');
        let currentDir = this.dirHandle;
        for (let i = 0; i < parts.length - 1; i++) {
          currentDir = await currentDir.getDirectoryHandle(parts[i]);
        }
        await currentDir.removeEntry(parts[parts.length - 1], { recursive: true });
        for (const page of pagesToDelete) {
          this.pages.delete(page.name.toLowerCase());
          this._removePageFromIndex(page.name);
        }
      }

      if (this.activePage && (this.activePage.name.toLowerCase() === folderPath.toLowerCase() || this.activePage.name.toLowerCase().startsWith(folderKey))) {
        this.activePage = null;
        const remaining = Array.from(this.pages.keys());
        if (remaining.length > 0) {
          await this.loadPage(this.pages.get(remaining[0]).name);
        } else {
          this.editor.setMarkdown('');
          this.dom.previewContent.innerHTML = '';
          this.dom.activeNoteTitle.textContent = 'No page open';
        }
      } else {
        this.renderFileList();
        this.renderTagList();
        this.updateGraph();
      }
    } catch (err) {
      console.error('Failed to delete folder:', folderPath, err);
      alert('Failed to delete folder: ' + err.message);
    }
  }

  showContextMenu(e, type, data) {
    const menu = this.dom.customContextMenu;
    if (!menu) return;

    // Track triggering element for focus recovery
    this.contextMenuTrigger = e.currentTarget || document.activeElement;

    menu.innerHTML = '';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'Context Options');
    
    if (type === 'folder') {
      const folderPath = data;
      const newNoteItem = document.createElement('button');
      newNoteItem.type = 'button';
      newNoteItem.className = 'context-menu-item';
      newNoteItem.setAttribute('role', 'menuitem');
      newNoteItem.innerHTML = `
        <svg aria-hidden="true" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right: 4px;">
          <line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line>
        </svg>
        New Note
      `;
      newNoteItem.addEventListener('click', () => {
        menu.style.display = 'none';
        this.openNewNoteModal(folderPath);
      });

      const deleteFolderItem = document.createElement('button');
      deleteFolderItem.type = 'button';
      deleteFolderItem.className = 'context-menu-item danger';
      deleteFolderItem.setAttribute('role', 'menuitem');
      deleteFolderItem.innerHTML = `
        <svg aria-hidden="true" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 4px;">
          <polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
        </svg>
        Delete Folder
      `;
      deleteFolderItem.addEventListener('click', () => {
        menu.style.display = 'none';
        this.deleteFolder(folderPath);
        if (this.contextMenuTrigger) this.contextMenuTrigger.focus();
      });

      menu.appendChild(newNoteItem);
      menu.appendChild(deleteFolderItem);
    } else if (type === 'file') {
      const pageObj = data;
      const pageKey = pageObj.name.toLowerCase();
      const isPinned = this.pinnedNotes.has(pageKey);

      const pinFileItem = document.createElement('button');
      pinFileItem.type = 'button';
      pinFileItem.className = 'context-menu-item';
      pinFileItem.setAttribute('role', 'menuitem');
      pinFileItem.innerHTML = isPinned
        ? `<svg aria-hidden="true" viewBox="0 0 24 24" width="14" height="14" fill="currentColor" stroke="currentColor" stroke-width="2" style="margin-right: 4.5px;">
             <path d="M16 12V4c0-1.1-.9-2-2-2h-4c-1.1 0-2 .9-2 2v8l-2 2v2h14v-2l-2-2zM12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2z"/>
           </svg>
           Unpin Note`
        : `<svg aria-hidden="true" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 4.5px;">
             <path d="M16 12V4c0-1.1-.9-2-2-2h-4c-1.1 0-2 .9-2 2v8l-2 2v2h14v-2l-2-2zM12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2z"/>
           </svg>
           Pin Note`;
      pinFileItem.addEventListener('click', () => {
        menu.style.display = 'none';
        this.togglePinNote(pageObj.name);
        if (this.contextMenuTrigger) this.contextMenuTrigger.focus();
      });

      const deleteFileItem = document.createElement('button');
      deleteFileItem.type = 'button';
      deleteFileItem.className = 'context-menu-item danger';
      deleteFileItem.setAttribute('role', 'menuitem');
      deleteFileItem.innerHTML = `
        <svg aria-hidden="true" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 4px;">
          <polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
        </svg>
        Delete Note
      `;
      deleteFileItem.addEventListener('click', () => {
        menu.style.display = 'none';
        this.deletePage(pageObj);
        if (this.contextMenuTrigger) this.contextMenuTrigger.focus();
      });

      const copyLinkItem = document.createElement('button');
      copyLinkItem.type = 'button';
      copyLinkItem.className = 'context-menu-item';
      copyLinkItem.setAttribute('role', 'menuitem');
      copyLinkItem.innerHTML = `
        <svg aria-hidden="true" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 4px;">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
        </svg>
        Copy Link
      `;
      copyLinkItem.addEventListener('click', async () => {
        menu.style.display = 'none';
        const linkText = pageObj.isImage ? `![[${pageObj.name}]]` : `[[${pageObj.name}]]`;
        try {
          await navigator.clipboard.writeText(linkText);
        } catch (err) {
          console.error('Failed to copy link:', err);
        }
        if (this.contextMenuTrigger) this.contextMenuTrigger.focus();
      });

      menu.appendChild(pinFileItem);
      menu.appendChild(copyLinkItem);
      menu.appendChild(deleteFileItem);
    }

    menu.style.display = 'block';
    
    const menuWidth = menu.offsetWidth || 150;
    const menuHeight = menu.offsetHeight || 100;
    let x = e.pageX;
    let y = e.pageY;
    
    if (x + menuWidth > window.innerWidth) {
      x = window.innerWidth - menuWidth - 10;
    }
    if (y + menuHeight > window.innerHeight) {
      y = window.innerHeight - menuHeight - 10;
    }
    
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;

    // Focus first option to support keyboard interaction immediately
    const firstItem = menu.querySelector('.context-menu-item');
    if (firstItem) firstItem.focus();
  }



  _removePageFromIndex(pageName) {
    const parts = pageName.toLowerCase().split('/');
    const flatName = parts[parts.length - 1];
    if (this.pageNamesIndex.has(flatName)) {
      const arr = this.pageNamesIndex.get(flatName);
      const idx = arr.findIndex(p => p.name.toLowerCase() === pageName.toLowerCase());
      if (idx !== -1) {
        arr.splice(idx, 1);
      }
      if (arr.length === 0) {
        this.pageNamesIndex.delete(flatName);
      }
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
