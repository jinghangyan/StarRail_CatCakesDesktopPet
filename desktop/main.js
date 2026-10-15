const { app, BrowserWindow, Menu, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

// Windows/Linux 下去掉默认应用菜单栏（File/Edit/View…），
// 避免用户从 View 菜单误开开发者工具；macOS 保留系统菜单
if (process.platform !== 'darwin') Menu.setApplicationMenu(null);

const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function mergeConfig(patch) {
  const cfg = { ...readConfig(), ...patch };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
  return cfg;
}

// 实验开关「强制 GPU 渲染」（设置页可开，默认关）：老 GPU 被 Chromium 黑名单误伤走 SwiftShader 时
// 强行尝试硬件 WebGL。commandLine 开关必须在 app ready 前追加，所以改了要重启才生效。
// 只有 HD 3000 这类纯老核显的机器强行开也建不了硬件 WebGL（ANGLE 要 D3D11 FL11），
// 那时上下文创建失败会走 pet3d 的 2D 回退，用户关掉开关即可还原。
if (readConfig().forceGpu) app.commandLine.appendSwitch('ignore-gpu-blocklist');

let petWin = null;
let settingsWin = null;
let loginWin = null;
let pickerWin = null;

function applyPrefs(cfg) {
  if (!petWin || petWin.isDestroyed()) return;
  const onTop = cfg.alwaysOnTop !== false; // 默认置顶
  petWin.setAlwaysOnTop(onTop, 'screen-saver');
  // 仅打包后注册开机自启：dev 模式下 exe 是 node_modules 里的裸 Electron，
  // 注册它会让开机弹出 Electron 默认窗口而不是桌宠
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: cfg.autoLaunch === true });
}

function createPetWindow() {
  const size = readConfig().petSize || 240;
  petWin = new BrowserWindow({
    width: size,
    height: Math.round(size * 250 / 240),
    transparent: true,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // 桌宠常驻：别的窗口（设置/联机）聚焦或盖住宠物窗时，Chromium 会把 rAF 节流成慢动作
      //（动画 dt 有 0.1s 钳制，表现就是「卡住→抽搐」），必须关掉后台节流
      backgroundThrottling: false,
    },
  });

  petWin.setAlwaysOnTop(true, 'screen-saver');
  applyPrefs(readConfig());
  petWin.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // 默认鼠标穿透（透明区域能点到下面的应用），
  // 渲染进程检测到悬停在猫猫糕本体上时会切回接收模式
  petWin.setIgnoreMouseEvents(true, { forward: true });

  // 右键菜单
  petWin.webContents.on('context-menu', () => {
    dlog('[context-menu] popup');
    buildPetMenu().popup();
  });
  // 隐藏/显示闪动排障：看 hide/show 期间有没有意外的 shape 或事件
  petWin.on('hide', () => dlog('[petWin] hide'));
  petWin.on('show', () => dlog('[petWin] show'));
}

// 猫猫糕右键菜单 / 状态栏托盘菜单（内容一致）
const SIZE_OPTIONS = [
  { label: '小', px: 170 },
  { label: '标准', px: 240 },
  { label: '大', px: 320 },
  { label: '特大', px: 420 },
];

function setPetSize(px) {
  mergeConfig({ petSize: px });
  if (petWin && !petWin.isDestroyed()) {
    // 不直接 setSize：渲染进程收到后重新缩放模型，再通过 win:shape 把窗口贴到模型边界
    petWin.webContents.send('size:changed', px);
  }
}

function buildPetMenu() {
  const visible = petWin && !petWin.isDestroyed() && petWin.isVisible();
  const curSize = readConfig().petSize || 240;
  return Menu.buildFromTemplate([
    {
      label: visible ? '隐藏猫猫糕' : '显示猫猫糕',
      click: () => {
        if (!petWin || petWin.isDestroyed()) return;
        visible ? petWin.hide() : petWin.show();
      },
    },
    {
      label: '预设大小',
      submenu: SIZE_OPTIONS.map((o) => ({
        label: o.label,
        type: 'radio',
        checked: curSize === o.px,
        click: () => setPetSize(o.px),
      })),
    },
    {
      label: '自定义大小（显示拖角手柄）',
      type: 'checkbox',
      checked: readConfig().resizeHandle === true,
      click: (item) => {
        mergeConfig({ resizeHandle: item.checked });
        if (petWin && !petWin.isDestroyed()) {
          petWin.webContents.send('resizer:toggle', item.checked);
        }
      },
    },
    {
      label: '免打扰（收到消息不提醒）',
      type: 'checkbox',
      checked: readConfig().dnd === true,
      click: (item) => {
        mergeConfig({ dnd: item.checked });
        if (petWin && !petWin.isDestroyed()) petWin.webContents.send('config:changed');
      },
    },
    { type: 'separator' },
    { label: '选择猫猫糕', click: openPicker },
    { label: '自定义名称和台词', click: openPhrases },
    { label: '叫声设置', click: openMeows },
    { label: '动作设置', click: openAnims },
    { label: '设置', click: openSettings },
    // 视角操作的可见提示（隐藏手势，菜单里放一行说明；3D 才有效所以置灰不可点）
    { label: '视角：Shift+拖动旋转 · 双击复位', enabled: false },
    { label: '登录 / 服务器', click: openLogin },
    { label: '联机（好友 / 群组）', click: openSend },
    { label: '联机教程', click: openTutorial },
    { type: 'separator' },
    { label: '关于作者', click: openAbout },
    { label: '退出', click: () => app.quit() },
  ]);
}

// macOS 顶部状态栏 / Windows 托盘图标
let tray = null;
function createTray() {
  const { Tray, nativeImage, nativeTheme } = require('electron');
  const blackIcon = nativeImage.createFromPath(
    path.join(__dirname, 'renderer', 'assets', 'trayIcon.png'));
  const whiteIcon = nativeImage.createFromPath(
    path.join(__dirname, 'renderer', 'assets', 'trayIcon-white.png'));

  if (process.platform === 'darwin') {
    // macOS：黑白剪影设为模板图，深色/浅色菜单栏下自动反色，始终清晰
    blackIcon.setTemplateImage(true);
    tray = new Tray(blackIcon.resize({ width: 20, height: 20 }));
  } else {
    // Windows：跟随任务栏主题选图标色，深色任务栏用白图标、浅色用黑图标
    const pick = () =>
      (nativeTheme.shouldUseDarkColors ? whiteIcon : blackIcon).resize({ width: 20, height: 20 });
    tray = new Tray(pick());
    nativeTheme.on('updated', () => tray.setImage(pick()));
  }
  tray.setToolTip('桌宠猫猫糕');
  // 左键或右键都弹出菜单
  tray.on('click', () => tray.popUpContextMenu(buildPetMenu()));
  tray.on('right-click', () => tray.popUpContextMenu(buildPetMenu()));
}

// closed 监听只在新建窗口时挂一次（onClosed 回调），避免重复打开时叠加监听
function makeWindow(win, w, h, title, file, onClosed) {
  if (win && !win.isDestroyed()) { win.focus(); return win; }
  win = new BrowserWindow({
    width: w,
    height: h,
    title,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', file));
  if (onClosed) win.on('closed', onClosed);
  return win;
}

function openSettings() {
  settingsWin = makeWindow(settingsWin, 380, 640, '设置', 'settings.html',
    () => { settingsWin = null; });
}

function openLogin() {
  loginWin = makeWindow(loginWin, 420, 480, '登录 / 服务器', 'login.html',
    () => { loginWin = null; });
}

function openPicker() {
  pickerWin = makeWindow(pickerWin, 560, 700, '选择猫猫糕', 'picker.html',
    () => { pickerWin = null; });
}

let phrasesWin = null;
function openPhrases() {
  phrasesWin = makeWindow(phrasesWin, 420, 520, '自定义名称和台词', 'phrases.html',
    () => { phrasesWin = null; });
}

let meowsWin = null;
function openMeows() {
  meowsWin = makeWindow(meowsWin, 380, 480, '叫声设置', 'meows.html',
    () => { meowsWin = null; });
}

let animsWin = null;
function openAnims() {
  animsWin = makeWindow(animsWin, 560, 500, '动作设置', 'anims.html',
    () => { animsWin = null; });
}

let aboutWin = null;
function openAbout() {
  aboutWin = makeWindow(aboutWin, 360, 500, '关于作者', 'about.html',
    () => { aboutWin = null; });
}

let tutorialWin = null;
function openTutorial() {
  tutorialWin = makeWindow(tutorialWin, 520, 640, '联机教程', 'tutorial.html',
    () => { tutorialWin = null; });
}

let sendWin = null;
function openSend() {
  sendWin = makeWindow(sendWin, 520, 600, '联机', 'social.html',
    () => { sendWin = null; });
}

// IPC：教程页读取建表脚本（file:// 下 fetch 本地文件会失败，改走主进程读盘）
ipcMain.handle('schema:get', () =>
  fs.readFileSync(path.join(__dirname, 'renderer', 'schema.sql'), 'utf8'));

// IPC：用系统浏览器打开链接（仅允许 http/https）
ipcMain.on('open:external', (_e, url) => {
  if (typeof url === 'string' && /^https?:\/\//.test(url)) {
    require('electron').shell.openExternal(url);
  }
});

// IPC：配置读写（set 为合并写入，不会覆盖其他字段）
ipcMain.handle('config:get', () => ({
  ...readConfig(),
  _userData: app.getPath('userData'),
}));
ipcMain.handle('config:set', (_e, patch) => {
  mergeConfig(patch);
  if (petWin && !petWin.isDestroyed()) petWin.webContents.send('config:changed');
  // 设置页开着时同步刷新（如 Shift+手势/双击改的视角要回显到滑块）
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send('config:changed');
});

// IPC：导入自定义叫声（拷贝到 userData，打包后也可写）
ipcMain.handle('meow:pick-file', async () => {
  const { dialog } = require('electron');
  const r = await dialog.showOpenDialog({
    title: '选择叫声音频',
    filters: [{ name: '音频文件', extensions: ['mp3', 'wav', 'm4a', 'ogg'] }],
    properties: ['openFile'],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  const destName = 'custom-meow' + path.extname(r.filePaths[0]);
  fs.copyFileSync(r.filePaths[0], path.join(app.getPath('userData'), destName));
  const cfg = mergeConfig({ meow: 'custom', customMeowFile: destName });
  if (petWin && !petWin.isDestroyed()) petWin.webContents.send('prefs:changed', cfg);
  return destName;
});

// IPC：拖角自由调整大小（save=true 时才写配置，避免拖动过程中狂写文件）
ipcMain.on('win:resize', (_e, { px, save }) => {
  if (!petWin || petWin.isDestroyed()) return;
  // 不直接 setSize：窗口边界由渲染进程 win:shape 贴着模型驱动
  petWin.webContents.send('size:changed', px);
  if (save) mergeConfig({ petSize: px });
});

// IPC：异形窗口——渲染进程算绝对屏幕 bounds（自己跟踪窗口位置，避免相对坐标积分漂移），
// setBounds 后返回实际 bounds 供校正；setBounds 默认无动画（animate 参数仅 macOS 有效，不传）
ipcMain.handle('win:get-bounds', () => {
  if (!petWin || petWin.isDestroyed()) return null;
  return petWin.getBounds();
});
// ---- 调试日志：写 userData/debug-shape.log，Windows 缩放屏坐标问题排障用 ----
const DEBUG_LOG = path.join(app.getPath('userData'), 'debug-shape.log');
function dlog(msg) {
  try {
    if (fs.existsSync(DEBUG_LOG) && fs.statSync(DEBUG_LOG).size > 512 * 1024) {
      fs.truncateSync(DEBUG_LOG, 256 * 1024); // 截头保留尾部
    }
    fs.appendFileSync(DEBUG_LOG, new Date().toISOString() + ' ' + msg + '\n');
  } catch { }
}
ipcMain.on('debug:log', (_e, line) => dlog('[renderer] ' + String(line)));

// ---- 诊断日志（设置页「记录诊断数据」开关）：写 userData/diag.log，一键导出发作者排障 ----
const DIAG_LOG = path.join(app.getPath('userData'), 'diag.log');
function diagWrite(msg) {
  try {
    if (fs.existsSync(DIAG_LOG) && fs.statSync(DIAG_LOG).size > 512 * 1024) {
      fs.truncateSync(DIAG_LOG, 256 * 1024); // 截头保留尾部
    }
    fs.appendFileSync(DIAG_LOG, new Date().toISOString() + ' ' + msg + '\n');
  } catch { }
}
ipcMain.on('diag:log', (_e, line) => {
  if (!readConfig().diagLog) return; // 开关关着直接丢（渲染进程侧也会自检，双保险）
  diagWrite('[renderer] ' + String(line));
});

// 导出诊断包：环境信息 + config(脱敏) + diag.log + debug-shape.log 合成单个文本文件
ipcMain.handle('diag:export', async (e) => {
  const { dialog } = require('electron');
  const cfg = readConfig();
  const sanitized = {};
  for (const [k, v] of Object.entries(cfg)) {
    if (/supabase|url|key|token|secret|password|session|email|qq/i.test(k)) continue; // 服务器配置/账号信息不进诊断包
    sanitized[k] = v;
  }
  const readTail = (p, max = 256 * 1024) => {
    try {
      const s = fs.statSync(p);
      const fd = fs.openSync(p, 'r');
      const start = Math.max(0, s.size - max);
      const buf = Buffer.alloc(Math.min(s.size, max));
      fs.readSync(fd, buf, 0, buf.length, start);
      fs.closeSync(fd);
      return (start > 0 ? '…（前面截断）…\n' : '') + buf.toString('utf8');
    } catch { return '（无）'; }
  };
  const pad = (t) => `----- ${t} `.padEnd(60, '-') + '\n';
  const now = new Date();
  const content =
    '===== 桌宠猫猫糕诊断包 =====\n' +
    `导出时间: ${now.toISOString()}\n` +
    `版本: app ${app.getVersion()} / Electron ${process.versions.electron} / Chrome ${process.versions.chrome}\n` +
    `平台: ${process.platform} ${process.arch} / OS ${require('os').release()}\n\n` +
    pad('config.json（已脱敏）') + JSON.stringify(sanitized, null, 2) + '\n\n' +
    pad('diag.log（诊断日志）') + readTail(DIAG_LOG) + '\n\n' +
    pad('debug-shape.log（坐标/手势日志）') + readTail(DEBUG_LOG);
  const stamp = now.toISOString().slice(0, 16).replace(/[-:T]/g, '');
  const win = BrowserWindow.fromWebContents(e.sender);
  const r = await dialog.showSaveDialog(win, {
    title: '导出诊断包',
    defaultPath: path.join(app.getPath('desktop'), `猫猫糕诊断包-${stamp}.txt`),
  });
  if (r.canceled || !r.filePath) return { ok: false, canceled: true };
  fs.writeFileSync(r.filePath, content, 'utf8');
  return { ok: true, path: r.filePath };
});

// IPC：异形窗口——渲染进程只发「目标内容尺寸 {w,h}」（CSS px），
// 位置由主进程按「内容区底边中心锚定」自己算（猫的落脚点不动）。
// 别再让渲染进程发偏移量、也别读 getBounds 做相对叠加：实测同学 Windows（150% 缩放）
// getBounds 会混入 DWM 隐形边框且数值随焦点状态漂移（+2 → +32/+30），任何基于它的
// 校准/补偿都会把垃圾放大成失控（窗口两步走到右下角）。内容坐标系
//（getContentBounds/setContentSize）与 Chromium 视口同源，天然自洽；
// 位置修正用 setPosition 加「内容位移差」——同一坐标系内的差值，边框项自动抵消。
ipcMain.handle('win:shape', (_e, r) => {
  if (!petWin || petWin.isDestroyed()) return null;
  if (!r || !isFinite(r.w + r.h)) return null;
  const w = Math.min(900, Math.max(60, Math.round(r.w)));
  const h = Math.min(900, Math.max(60, Math.round(r.h)));
  const cb = petWin.getContentBounds();
  // 幂等收敛：目标≈当前内容尺寸就完全不动（连位置也不碰）。
  // 150% 缩放下 625 DIP 物理取整只能落 626/628，没有这道闸渲染进程会每帧重发 shape
  // （守卫永远不过），每次重锚定又读到异步 resize 的半落地值 → 位置 +2/帧蠕变
  // （托柄缩放后随机位移）+ 和 drag-move 在屏幕边缘互钳（抖动拉不动）
  if (Math.abs(cb.width - w) <= 2 && Math.abs(cb.height - h) <= 2) return cb;
  const anchorCX = cb.x + cb.width / 2;  // 内容底边中心（猫的落脚点）
  const anchorBY = cb.y + cb.height;
  petWin.setContentSize(w, h);
  const cb2 = petWin.getContentBounds(); // 尺寸落地后的内容实际位置（锚点因平台而异，实测）
  let nx = Math.round(anchorCX - w / 2); // 期望的内容左上角
  let ny = Math.round(anchorBY - h);
  // clamp 到所在屏幕 workArea：猫贴屏幕边缘时窗口永不出屏（猫被「推」回屏内）
  const { screen } = require('electron');
  const area = screen.getDisplayMatching({ x: nx, y: ny, width: w, height: h }).workArea;
  nx = Math.min(Math.max(nx, area.x), area.x + area.width - w);
  ny = Math.min(Math.max(ny, area.y), area.y + area.height - h);
  const [fx, fy] = petWin.getPosition();
  petWin.setPosition(Math.round(fx + (nx - cb2.x)), Math.round(fy + (ny - cb2.y)));
  const fin = petWin.getContentBounds();
  dlog(`[win:shape] req=${w}x${h} contentBefore=${JSON.stringify(cb)} afterSize=${JSON.stringify(cb2)} final=${JSON.stringify(fin)} area=${JSON.stringify(area)}`);
  return fin;
});

// IPC：切换鼠标穿透（渲染进程按悬停位置控制）
ipcMain.on('mouse:ignore', (_e, ignore) => {
  if (!petWin || petWin.isDestroyed()) return;
  dlog(`[mouse:ignore] ${ignore}`);
  petWin.setIgnoreMouseEvents(ignore, { forward: true });
});

// IPC：偏好设置（开机自启 / 窗口置顶）
ipcMain.on('prefs:set', (_e, prefs) => {
  const cfg = mergeConfig(prefs);
  applyPrefs(cfg);
  // 通知宠物窗口偏好变了（如流光颜色）
  if (petWin && !petWin.isDestroyed()) petWin.webContents.send('prefs:changed', cfg);
});

// IPC：提示条被用户关闭，不再打扰
ipcMain.on('hint:dismiss', () => mergeConfig({ hintDismissed: true }));

// 调试钩子：隐藏/显示宠物窗（隐藏→显示的闪动问题排障用）
ipcMain.on('debug:toggle-pet', () => {
  if (!petWin || petWin.isDestroyed()) return;
  petWin.isVisible() ? petWin.hide() : petWin.show();
});

// IPC：登录页登录成功后把 session 转发给宠物窗口
ipcMain.on('session:updated', (_e, session) => {
  if (petWin && !petWin.isDestroyed()) petWin.webContents.send('session:updated', session);
});

// IPC：动作设置页的「预览」→ 转发给宠物窗口立即做一次该动作
ipcMain.on('anim:preview', (_e, name) => {
  if (typeof name !== 'string' || !/^[a-z0-9-]{1,32}$/i.test(name)) return;
  if (petWin && !petWin.isDestroyed()) petWin.webContents.send('anim:preview', name);
});

// IPC：选择器换了猫猫糕形象 → 存配置并通知宠物窗口
ipcMain.on('cake:selected', (_e, id) => {
  mergeConfig({ cake: id });
  if (petWin && !petWin.isDestroyed()) petWin.webContents.send('cake:changed', id);
});

// IPC：手动拖拽移动窗口（interact.js 区分点击和拖动）。
// 主进程自己跟踪光标位移（screen.getCursorScreenPoint，屏幕坐标在主进程内闭环），
// 不用渲染进程上报的 screenX 增量——Windows 显示缩放 >100% / 多屏混 DPI 时两边
// 单位可能不一致，曾表现为越拖越大、松手瞬移到右下角（错误单位被 workArea clamp 拍到角落）
let dragOrigin = null; // { cx, cy, cbx, cby, cw, ch, fdx, fdy }
let dragLogN = 0;      // drag-move 节流日志计数
ipcMain.on('win:drag-begin', () => {
  if (!petWin || petWin.isDestroyed()) return;
  const { screen } = require('electron');
  const c = screen.getCursorScreenPoint();
  const [wx, wy] = petWin.getPosition();
  const cb = petWin.getContentBounds();
  // 记内容区坐标 + 外框偏移（拖动全程用内容坐标系，和 win:shape 同源）
  dragOrigin = { cx: c.x, cy: c.y, cbx: cb.x, cby: cb.y, cw: cb.width, ch: cb.height,
    fdx: cb.x - wx, fdy: cb.y - wy };
  dlog(`[drag-begin] cursor=${c.x},${c.y} winPos=${wx},${wy} content=${cb.x},${cb.y} ${cb.width}x${cb.height}`);
});
ipcMain.on('win:drag-move', () => {
  if (!petWin || petWin.isDestroyed() || !dragOrigin) return;
  const { screen } = require('electron');
  const c = screen.getCursorScreenPoint();
  // 与 win:shape 同一套钳制：内容区完整收进 workArea（拖到边缘精确停靠，不再留 40px 悬边）。
  // 原来这里按外框尺寸留 40px 悬边、win:shape 按内容区全收进，两套钳制在屏幕边缘互相打架
  //（150% 缩放 shape 风暴期间表现为边缘抖动/停不下来/随机位移）
  const area = screen.getDisplayMatching(
    { x: dragOrigin.cbx, y: dragOrigin.cby, width: dragOrigin.cw, height: dragOrigin.ch }).workArea;
  const ncx = Math.min(Math.max(dragOrigin.cbx + (c.x - dragOrigin.cx), area.x),
    area.x + area.width - dragOrigin.cw);
  const ncy = Math.min(Math.max(dragOrigin.cby + (c.y - dragOrigin.cy), area.y),
    area.y + area.height - dragOrigin.ch);
  petWin.setPosition(Math.round(ncx - dragOrigin.fdx), Math.round(ncy - dragOrigin.fdy));
  if (++dragLogN % 15 === 1) dlog(`[drag-move] cursor=${c.x},${c.y} -> content=${ncx},${ncy} size=${dragOrigin.cw}x${dragOrigin.ch}`);
});
ipcMain.on('win:drag-end', () => { dragOrigin = null; });

// IPC：拖角拉伸同理——位移量由主进程从光标算，渲染进程不跨进程传坐标
let resizeOrigin = null; // { cx, size, lastPx }
ipcMain.on('win:resize-begin', () => {
  if (!petWin || petWin.isDestroyed()) return;
  const { screen } = require('electron');
  resizeOrigin = { cx: screen.getCursorScreenPoint().x, size: readConfig().petSize || 240, lastPx: null };
  dlog(`[resize-begin] cursorX=${resizeOrigin.cx} size=${resizeOrigin.size}`);
});
ipcMain.on('win:resize-move', () => {
  if (!petWin || petWin.isDestroyed() || !resizeOrigin) return;
  const { screen } = require('electron');
  // 等比拉伸：宽随光标水平位移变化，限制 120~600
  const cx = screen.getCursorScreenPoint().x;
  const px = Math.min(600, Math.max(120, resizeOrigin.size + Math.round(cx - resizeOrigin.cx)));
  dlog(`[resize-move] cursorX=${cx} originX=${resizeOrigin.cx} size0=${resizeOrigin.size} px=${px}`);
  resizeOrigin.lastPx = px;
  petWin.webContents.send('size:changed', px);
});
ipcMain.on('win:resize-end', () => {
  if (resizeOrigin && resizeOrigin.lastPx != null) mergeConfig({ petSize: resizeOrigin.lastPx });
  resizeOrigin = null;
});

// 自定义协议：让渲染进程能播放 userData 里的自定义叫声
//（file:// 跨目录加载会被 Chromium 拦截，所以走 meow:// 协议）
const { protocol, net } = require('electron');
const { pathToFileURL } = require('url');
protocol.registerSchemesAsPrivileged([
  { scheme: 'meow', privileges: { stream: true } },
  // cake:// 要给渲染进程 fetch() 加载 3D 模型用，需 standard + supportFetchAPI
  { scheme: 'cake', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

// 单实例锁：重复启动时聚焦已有宠物窗而不是再开一只（测试期曾叠出两只猫）
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
app.on('second-instance', () => {
  if (petWin) {
    if (!petWin.isVisible()) petWin.show();
    petWin.focus();
  }
});

app.whenReady().then(() => {
  protocol.handle('meow', (request) => {
    // 只允许取 userData 根目录下的文件名，防目录穿越
    const name = path.basename(decodeURIComponent(request.url.slice('meow://'.length)));
    return net.fetch(pathToFileURL(path.join(app.getPath('userData'), name)).toString());
  });

  // 自定义协议：让渲染进程能 fetch 到 renderer/models 里的 glTF 模型
  //（file:// 下 fetch 本地文件被拦；GLTFLoader 走 cake://models/cake01.glb）
  protocol.handle('cake', (request) => {
    // host 段 'models' 仅为路径美观；允许 models/ 下的子目录（anims/ 等），拒绝目录穿越
    const rel = decodeURIComponent(request.url.slice('cake://'.length)).replace(/^models\/?/, '');
    const base = path.join(__dirname, 'renderer', 'models');
    const p = path.normalize(path.join(base, rel));
    if (!p.startsWith(base + path.sep)) return new Response('forbidden', { status: 403 });
    return net.fetch(pathToFileURL(p).toString());
  });

  // 桌宠不占用 Dock 栏图标，改用顶部状态栏托盘
  if (process.platform === 'darwin') app.dock.hide();
  createTray();
  createPetWindow();
  if (process.env.OPEN_ANIMS) openAnims(); // 调试钩子：启动即开动作设置页
  if (process.env.OPEN_SETTINGS) openSettings(); // 调试钩子：启动即开设置页

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createPetWindow();
  });
});
} // end requestSingleInstanceLock else

app.on('window-all-closed', () => {
  // 桌宠常驻后台，不自动退出（用户从右键菜单退出）
});
