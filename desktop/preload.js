const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  getSchema: () => ipcRenderer.invoke('schema:get'),
  setConfig: (patch) => ipcRenderer.invoke('config:set', patch),
  setPrefs: (prefs) => ipcRenderer.send('prefs:set', prefs),
  dismissHint: () => ipcRenderer.send('hint:dismiss'),
  sendSession: (session) => ipcRenderer.send('session:updated', session),
  onSession: (cb) => ipcRenderer.on('session:updated', (_e, s) => cb(s)),
  onConfigChanged: (cb) => ipcRenderer.on('config:changed', () => cb()),
  onPrefsChanged: (cb) => ipcRenderer.on('prefs:changed', (_e, cfg) => cb(cfg)),
  onSizeChanged: (cb) => ipcRenderer.on('size:changed', (_e, px) => cb(px)),
  resizeWindow: (px, save) => ipcRenderer.send('win:resize', { px, save }),
  // 拖动/拉伸：渲染进程只发信号，位移由主进程自己跟踪光标计算（屏幕坐标单位闭环）
  dragBegin: () => ipcRenderer.send('win:drag-begin'),
  dragMove: () => ipcRenderer.send('win:drag-move'),
  dragEnd: () => ipcRenderer.send('win:drag-end'),
  resizeBegin: () => ipcRenderer.send('win:resize-begin'),
  resizeMove: () => ipcRenderer.send('win:resize-move'),
  resizeEnd: () => ipcRenderer.send('win:resize-end'),
  pickMeowFile: () => ipcRenderer.invoke('meow:pick-file'),
  onResizerToggle: (cb) => ipcRenderer.on('resizer:toggle', (_e, on) => cb(on)),
  openExternal: (url) => ipcRenderer.send('open:external', url),
  setMouseIgnore: (ignore) => ipcRenderer.send('mouse:ignore', ignore),
  getWinBounds: () => ipcRenderer.invoke('win:get-bounds'),
  setShape: (r) => ipcRenderer.invoke('win:shape', r),
  selectCake: (id) => ipcRenderer.send('cake:selected', id),
  onCakeChanged: (cb) => ipcRenderer.on('cake:changed', (_e, id) => cb(id)),
  previewAnim: (name) => ipcRenderer.send('anim:preview', name),
  onAnimPreview: (cb) => ipcRenderer.on('anim:preview', (_e, n) => cb(n)),
  debugLog: (line) => ipcRenderer.send('debug:log', line),
  // 诊断日志（设置页「记录诊断数据」开关 gated）：写入 userData/diag.log
  diagLog: (line) => ipcRenderer.send('diag:log', line),
  // 导出诊断包：汇总 config(脱敏)+diag.log+debug-shape.log 存成单个文本文件，返回保存路径
  exportDiag: () => ipcRenderer.invoke('diag:export'),
  togglePet: () => ipcRenderer.send('debug:toggle-pet'),
});
