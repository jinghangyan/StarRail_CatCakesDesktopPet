const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  chooseDir: () => ipcRenderer.invoke('choose-dir'),
  autoFind: () => ipcRenderer.invoke('auto-find'),
  precheck: (asbDir) => ipcRenderer.invoke('precheck', asbDir),
  installDotnet: () => ipcRenderer.invoke('install-dotnet'),
  openDotnetPage: () => ipcRenderer.invoke('open-dotnet-page'),
  start: (opts) => ipcRenderer.invoke('start', opts),
  cancel: () => ipcRenderer.invoke('cancel'),
  reconChoice: (choice) => ipcRenderer.invoke('recon-choice', choice),
  exportDiagnostics: () => ipcRenderer.invoke('export-diagnostics'),
  copyDiagnostics: () => ipcRenderer.invoke('copy-diagnostics'),
  openOutput: () => ipcRenderer.invoke('open-output'),
  detectResume: () => ipcRenderer.invoke('detect-resume'),
  onEvent: (cb) => ipcRenderer.on('evt', (_e, obj) => cb(obj)),
});
