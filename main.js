/**
 * Native Nodes - Electron Main Process
 * 
 * Sets up a secure custom protocol (app://) for ESM and Service Worker support,
 * and creates a frameless macOS BrowserWindow with traffic lights integrated.
 */

// Workaround for Playwright v1.40.0 compatibility with Electron 28+
if (typeof process !== 'undefined' && process.mainModule === undefined) {
  process.mainModule = module;
}

const { app, BrowserWindow, protocol, session, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

// Register app:// scheme as secure and supporting Service Workers / Fetch
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      secure: true,
      standard: true,
      allowServiceWorkers: true,
      supportFetchAPI: true,
      corsEnabled: true
    }
  }
]);


// IPC Handlers for Node FS
ipcMain.handle('select-notes-folder', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory']
  });

  if (!result.canceled) {
    return result.filePaths[0];
  }
  return null;
});

async function readDirectoryRecursive(dirPath, rootPath = dirPath) {
  let results = [];
  const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;

    const fullPath = path.join(dirPath, entry.name);
    const relativePath = path.relative(rootPath, fullPath).replace(/\\/g, '/');

    if (entry.isDirectory()) {
      results = results.concat(await readDirectoryRecursive(fullPath, rootPath));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      const content = await fs.promises.readFile(fullPath, 'utf8');
      results.push({
        name: entry.name,
        relativePath: relativePath,
        fullPath: fullPath,
        content: content
      });
    }
  }
  return results;
}

ipcMain.handle('read-directory', async (event, folderPath) => {
  try {
    return await readDirectoryRecursive(folderPath);
  } catch (err) {
    console.error('Error reading directory:', err);
    throw err;
  }
});

ipcMain.handle('save-file', async (event, filePath, content) => {
  try {
    await fs.promises.writeFile(filePath, content, 'utf8');
    return true;
  } catch (err) {
    console.error('Error saving file:', err);
    throw err;
  }
});

ipcMain.handle('create-file', async (event, folderPath, filename, content) => {
  try {
    const fullPath = path.join(folderPath, filename);
    await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.promises.writeFile(fullPath, content, 'utf8');
    return fullPath;
  } catch (err) {
    console.error('Error creating file:', err);
    throw err;
  }
});


let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 840,
    minWidth: 800,
    minHeight: 600,
    icon: path.join(__dirname, 'icon-512.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      sandbox: true
    },
    title: 'Native Nodes',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default', // Embeds macOS traffic lights only on macOS
    backgroundColor: '#090d16'     // Matching deep dark blue-slate theme
  });

  // Load the app using custom protocol
  mainWindow.loadURL('app://local/index.html');

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Initialize Custom Protocol Handler
app.whenReady().then(() => {
  // Allow fileSystem permissions for local workspace directory sync
  session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    if (permission === 'fileSystem') {
      return true;
    }
    return false;
  });

  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    if (permission === 'fileSystem') {
      return callback(true);
    }
    callback(false);
  });

  // Allow file operations on restricted paths (like user home directories) when selected by user
  session.defaultSession.on('file-system-access-restricted', (event, details, callback) => {
    callback('allow');
  });

  protocol.handle('app', (request) => {
    const parsedUrl = new URL(request.url);
    let pathname = parsedUrl.pathname;

    // Default to index.html for root path
    if (pathname === '/' || !pathname) {
      pathname = '/index.html';
    }

    // Resolve absolute path on disk
    const filePath = path.normalize(path.join(__dirname, pathname));

    // Security check: prevent directory traversal outside app boundaries
    if (!filePath.startsWith(__dirname)) {
      return new Response('Access Denied', { status: 403 });
    }

    try {
      const data = fs.readFileSync(filePath);
      const ext = path.extname(filePath).toLowerCase();

      // Mime-type mapping
      let contentType = 'application/octet-stream';
      if (ext === '.html') contentType = 'text/html; charset=utf-8';
      else if (ext === '.js') contentType = 'text/javascript; charset=utf-8';
      else if (ext === '.css') contentType = 'text/css; charset=utf-8';
      else if (ext === '.svg') contentType = 'image/svg+xml';
      else if (ext === '.png') contentType = 'image/png';
      else if (ext === '.json') contentType = 'application/json';

      return new Response(data, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'no-cache'
        }
      });
    } catch (err) {
      console.error(`Electron Protocol Error [404] serving: ${pathname}`, err);
      return new Response('Not Found', { status: 404 });
    }
  });

  createWindow();
});

// Quit when all windows are closed, except on macOS
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});
