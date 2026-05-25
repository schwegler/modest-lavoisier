const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  selectFolder: () => ipcRenderer.invoke('select-notes-folder'),
  readDirectory: (folderPath) => ipcRenderer.invoke('read-directory', folderPath),
  saveFile: (filePath, content) => ipcRenderer.invoke('save-file', filePath, content),
  createFile: (folderPath, filename, content) => ipcRenderer.invoke('create-file', folderPath, filename, content)
});
