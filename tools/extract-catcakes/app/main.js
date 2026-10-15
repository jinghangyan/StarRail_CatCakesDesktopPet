// 猫猫糕模型提取工具 - Electron 主进程
// 管线移植自 ../run.ps1（AnimeStudio CLI + FBX2glTF 一条龙）。
// 与 ps1 版的差异：索引用 XML 流式（JSON 全量入内存会 OOM）+ 4 分片并行 + FBX→GLB worker 池；
// 单进程命令不带 --silent 实时回显日志，分片进程带 --silent 降噪。
const { app, BrowserWindow, ipcMain, dialog, shell, clipboard, crashReporter } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const readline = require('readline');
const { once } = require('events');
const { spawn, execFile } = require('child_process');

const isWin = process.platform === 'win32';

// ---------- 崩溃自诊断（必须在 ready 之前初始化） ----------

function rootDir() {
  if (app.isPackaged) {
    // portable exe：放在 exe 同级目录，方便同学找到 output
    return process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(app.getPath('exe'));
  }
  return __dirname;
}
function workDir() { return path.join(rootDir(), 'work'); }

// minidump 收进 work/crashes（setPath 必须在 ready 前）
const crashDumpsDir = path.join(workDir(), 'crashes');
try { fs.mkdirSync(crashDumpsDir, { recursive: true }); app.setPath('crashDumps', crashDumpsDir); } catch { /* ignore */ }
try {
  crashReporter.start({ productName: 'catcake-extractor', companyName: 'catcake', uploadToServer: false });
} catch { /* ignore */ }

// 全局应用日志 work/app.log（追加模式；从启动第一行起）
let appLogPath = null;
function appLog(msg) {
  try {
    if (!appLogPath) {
      fs.mkdirSync(workDir(), { recursive: true });
      appLogPath = path.join(workDir(), 'app.log');
    }
    fs.appendFileSync(appLogPath, `[${new Date().toISOString()}] ${msg}\n`);
  } catch { /* ignore */ }
}

// 每次启动写分隔头（时间 / 系统 / 内存 / CPU / 版本 / exe 路径）
(function writeSessionHeader() {
  const cpu = (os.cpus()[0] && os.cpus()[0].model) || 'unknown';
  let ver = 'dev'; try { ver = app.getVersion(); } catch { /* ignore */ }
  let exe = ''; try { exe = app.getPath('exe'); } catch { /* ignore */ }
  appLog('');
  appLog('========== 会话开始 ==========');
  appLog(`时间=${new Date().toLocaleString('zh-CN')} 平台=${process.platform} ${os.release()} (${process.arch})`);
  appLog(`内存=${Math.round(os.totalmem() / (1024 ** 3))}GB CPU=${cpu} 核心数=${os.cpus().length}`);
  appLog(`版本=${ver} exe=${exe} packaged=${app.isPackaged} electron=${process.versions.electron} node=${process.versions.node}`);
})();

// console 输出镜像进 app.log
for (const m of ['log', 'info', 'warn', 'error']) {
  const orig = console[m].bind(console);
  console[m] = (...a) => { orig(...a); appLog(`[console.${m}] ${a.map((x) => String(x)).join(' ')}`); };
}

// 主进程异常兜底：写日志 + 弹框，别让进程无声消失
process.on('uncaughtException', (err) => {
  appLog(`[uncaughtException] ${err && err.stack ? err.stack : String(err)}`);
  try {
    dialog.showErrorBox('猫猫糕提取工具出错了',
      `主进程遇到未捕获的异常（已记录，程序会尽量继续运行）：\n\n${err && err.message ? err.message : String(err)}\n\n日志位置：${appLogPath || 'work\\app.log'}\n如果窗口消失或反复出错，请把 work 文件夹里的 app.log 和 crashes 发回给作者。`);
  } catch { /* ready 前弹不了框就算了 */ }
});
process.on('unhandledRejection', (reason) => {
  const stack = reason && reason.stack ? reason.stack : String(reason);
  appLog(`[unhandledRejection] ${stack}`);
});

const AS_URL = 'https://nightly.link/Escartem/AnimeStudio/workflows/build/master/AnimeStudio-net9.zip';
const F2G_URL = 'https://github.com/godotengine/FBX2glTF/releases/download/v0.13.1/FBX2glTF-windows-x86_64.zip';
// 已实证：猫糕官方内部命名 RuanMadeCake（容器 assets/asbres/characters/npc/special/ruanmadecake/ 一族）
// 索引默认不解析 GameObject，侦查只看命中条目数（正常几百条）；干扰项 RuanMadeShaoMai（烧麦）不导
const DEFAULT_RECON_KW = 'ruanmadecake';
const DEFAULT_FILTERS = ['ruanmadecake'];
// 导出类型拆两条命令依次跑（同一 filters、同一 exportDir）：
// --types 带 GameObject 时 AnimeStudio 会把 Animator 强制设为只解析不导出
//（AnimeStudio.CLI/Program.cs: GameObject.CanExport() → SetType(Animator, true, false)），
// 动画烘不进 FBX，所以动画必须单独跑一条不带 GameObject 的命令
// 管线版本号：导出方式变化时 +1（断点续跑比对用，版本不一致强制重导）
const PIPELINE_VERSION = 8; // v8 = 跨 block 依赖解析（art prefab 导出带网格/材质）；v7 = 跨 block 剪辑预收集注入；v6 = AnimationClip SR int16 修复；v5 = 上游 master + 全套补丁
const EXPORT_TYPES_MODEL = ['GameObject', 'Texture2D'];   // 模型贴图（FBX 来源）
const EXPORT_TYPES_ANIM = ['Animator', 'AnimationClip'];  // 动画：Animator 烘进 FBX，AnimationClip 导 .anim YAML 备选
const EXPORT_TYPES_DESC = `v${PIPELINE_VERSION} ` + [...EXPORT_TYPES_MODEL, ...EXPORT_TYPES_ANIM].join(' '); // 断点续跑参数比对用
const MIN_HITS = 50;         // 命中少于此值弹出诊断提示（ruanmadecake 正常命中几百条）
const MIN_FREE_GB = 20;

// 常见安装路径变体（相对盘符根目录）
const AUTOFIND_SUBS = [
  'Program Files\\Star Rail\\Game\\StarRail_Data\\StreamingAssets\\Asb\\Windows',
  'Program Files (x86)\\Star Rail\\Game\\StarRail_Data\\StreamingAssets\\Asb\\Windows',
  'Star Rail\\Game\\StarRail_Data\\StreamingAssets\\Asb\\Windows',
  'Games\\Star Rail\\Game\\StarRail_Data\\StreamingAssets\\Asb\\Windows',
  '崩坏：星穹铁道\\Game\\StarRail_Data\\StreamingAssets\\Asb\\Windows',
  'StarRail\\Game\\StarRail_Data\\StreamingAssets\\Asb\\Windows',
  'Honkai Star Rail\\Game\\StarRail_Data\\StreamingAssets\\Asb\\Windows',
  'HonkaiStarRail\\Game\\StarRail_Data\\StreamingAssets\\Asb\\Windows',
  'miHoYo\\Star Rail\\Game\\StarRail_Data\\StreamingAssets\\Asb\\Windows',
  'HoYoverse\\Star Rail\\Game\\StarRail_Data\\StreamingAssets\\Asb\\Windows',
];
// 用户选了上层目录时自动往下补全的层级
const DESCEND_SUFFIXES = [
  ['StarRail_Data', 'StreamingAssets', 'Asb', 'Windows'],
  ['StreamingAssets', 'Asb', 'Windows'],
  ['Asb', 'Windows'],
  ['Game', 'StarRail_Data', 'StreamingAssets', 'Asb', 'Windows'],
];

let mainWindow = null;
const currentChildren = new Set(); // 正在跑的子进程（取消用；分片建索引时最多 4 个并行）
let cancelled = false;
let reconWaiter = null;    // 侦查命中偏少时等用户选择
let logFile = null;

// ---------- 基础工具 ----------

function outDir() { return path.join(rootDir(), 'output'); }
function embeddedToolsDir() {
  return app.isPackaged ? path.join(process.resourcesPath, 'tools') : path.join(__dirname, 'tools');
}

function send(obj) { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('evt', obj); }

function log(msg) {
  const line = `[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] ${msg}`;
  send({ type: 'log', text: line });
  if (logFile) { try { fs.appendFileSync(logFile, line + '\n'); } catch { /* ignore */ } }
  appLog(`[run] ${msg}`); // 管线日志镜像进 app.log
}

function setStep(index, status) { appLog(`[step] #${index} -> ${status}`); send({ type: 'step', index, status }); } // status: wait|run|ok|fail
function setProgress(value, text) { send({ type: 'progress', value, text }); } // value: null=不定 0..1=确定

function findFileRecursive(dir, pred) {
  if (!dir || !fs.existsSync(dir)) return null;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (pred(e.name)) return p;
    }
  }
  return null;
}

function countBlocks(dir) {
  try { return fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.block')).length; }
  catch { return 0; }
}

// 把用户选的目录解析到 Asb\Windows 这一层；解析不了返回 null
function resolveAsbDir(dir) {
  if (!dir || !fs.existsSync(dir)) return null;
  if (countBlocks(dir) > 0) return dir;
  for (const suffix of DESCEND_SUFFIXES) {
    const p = path.join(dir, ...suffix);
    if (fs.existsSync(p) && countBlocks(p) > 0) return p;
  }
  return null;
}

function autoFindAsb() {
  if (!isWin) return null;
  for (const d of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
    const root = `${d}:\\`;
    if (!fs.existsSync(root)) continue;
    for (const sub of AUTOFIND_SUBS) {
      const p = path.join(root, sub);
      if (fs.existsSync(p) && countBlocks(p) > 0) return p;
    }
  }
  return null;
}

// 运行子进程并实时回传日志，resolve 退出码；出错 reject
function runProc(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    log(`> ${cmd} ${args.map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' ')}`);
    let child;
    try {
      child = spawn(cmd, args, { cwd: opts.cwd, windowsHide: true });
    } catch (err) { return reject(err); }
    currentChildren.add(child);
    const onData = (d) => {
      for (const line of d.toString().split(/\r?\n/)) {
        if (line.trim()) log(line.trimEnd());
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', (err) => { currentChildren.delete(child); reject(err); });
    child.on('close', (code) => { currentChildren.delete(child); resolve(code); });
  });
}

function capture(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, timeout: 30000 }, (err, stdout, stderr) => {
      resolve(err ? '' : (stdout || '') + (stderr || ''));
    });
  });
}

class CancelledError extends Error { constructor() { super('已取消'); this.cancelled = true; } }
function throwIfCancelled() { if (cancelled) throw new CancelledError(); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function killAllChildren() {
  const kills = [];
  for (const child of currentChildren) {
    try {
      if (isWin) kills.push(capture('taskkill', ['/pid', String(child.pid), '/T', '/F']));
      else child.kill('SIGKILL');
    } catch { /* ignore */ }
  }
  await Promise.all(kills);
}

// 等所有子进程退出（taskkill 后文件句柄释放有延迟，清目录前必须等，否则 EBUSY）
async function waitChildrenExit(timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (currentChildren.size && Date.now() < deadline) await sleep(200);
  if (currentChildren.size) appLog(`[proc] 警告：等待超时仍有 ${currentChildren.size} 个子进程未退出`);
}

// 打 zip：优先 tar.exe（Win10+ 自带的 bsdtar，-a 按 .zip 后缀自动选格式，支持 >260 字符长路径）。
// 产物目录是镜像容器路径（assets\asbres\characters\...\texture\...），超 260 字符时
// Compress-Archive 会抛 ZipArchiveHelper 错误；tar 不可用再回退 Compress-Archive
async function makeZip(zipPath, srcDir) {
  if (isWin) {
    let tarOk = false;
    try {
      const code = await runProc('tar.exe', ['-a', '-c', '-f', zipPath, '-C', srcDir, '.']);
      tarOk = code === 0 && fs.existsSync(zipPath);
    } catch { tarOk = false; }
    if (tarOk) return;
    log('tar.exe 打包失败或不可用，回退 Compress-Archive（路径过长可能报错）…');
    try { fs.unlinkSync(zipPath); } catch { /* ignore */ } // tar 失败可能留半成品
    const code = await runProc('powershell', ['-NoProfile', '-Command',
      `Compress-Archive -Path '${srcDir}\\*' -DestinationPath '${zipPath}' -Force`]);
    if (code !== 0) throw new Error('打包 zip 失败，详情见日志');
  } else {
    const code = await runProc('zip', ['-r', '-q', zipPath, '.'], { cwd: srcDir });
    if (code !== 0) throw new Error('打包 zip 失败，详情见日志');
  }
}

// ---------- 环境预检 ----------

async function checkDotNet() {
  const out = await capture('dotnet', ['--list-runtimes']);
  if (!out) return { ok: false, detail: '未检测到 dotnet 命令' };
  if (/Microsoft\.NETCore\.App 9\./.test(out)) return { ok: true, detail: '已安装 .NET 9 运行时' };
  return { ok: false, detail: '未安装 .NET 9 运行时' };
}

async function diskFreeGB(targetDir) {
  try {
    if (isWin) {
      const letter = path.parse(path.resolve(targetDir)).root.replace(/[:\\]/g, '');
      const out = await capture('powershell', ['-NoProfile', '-Command', `(Get-PSDrive -Name ${letter}).Free`]);
      const bytes = parseFloat(out.trim());
      if (Number.isFinite(bytes)) return bytes / (1024 ** 3);
      return -1;
    }
    const out = await capture('df', ['-k', targetDir]);
    const lines = out.trim().split('\n');
    if (lines.length < 2) return -1;
    const m = lines.pop().split(/\s+/);
    const kb = parseInt(m[3], 10);
    return Number.isFinite(kb) ? (kb * 1024) / (1024 ** 3) : -1;
  } catch { return -1; }
}

function checkTools() {
  const cli = findFileRecursive(embeddedToolsDir(), (n) => n.toLowerCase() === 'animestudio.cli.exe');
  const f2g = findFileRecursive(embeddedToolsDir(), (n) => /^fbx2gltf.*\.exe$/i.test(n));
  if (cli && f2g) return { ok: true, detail: '内嵌工具完整（AnimeStudio + FBX2glTF）', cli, f2g };
  const missing = [!cli && 'AnimeStudio', !f2g && 'FBX2glTF'].filter(Boolean).join('、');
  return { ok: false, detail: `内嵌工具缺失：${missing}，开跑时会尝试联网下载`, cli, f2g };
}

// ---------- 工具准备（优先内嵌，回退在线下载） ----------

async function downloadAndExtract(url, zipPath, destDir) {
  fs.mkdirSync(path.dirname(zipPath), { recursive: true });
  fs.mkdirSync(destDir, { recursive: true });
  if (isWin) {
    const code = await runProc('powershell', ['-NoProfile', '-Command',
      `Invoke-WebRequest -Uri '${url}' -OutFile '${zipPath}'`]);
    if (code !== 0 || !fs.existsSync(zipPath)) throw new Error(`下载失败：${url}`);
    const code2 = await runProc('powershell', ['-NoProfile', '-Command',
      `Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force`]);
    if (code2 !== 0) throw new Error(`解压失败：${zipPath}`);
  } else {
    const code = await runProc('curl', ['-L', '-o', zipPath, url]);
    if (code !== 0 || !fs.existsSync(zipPath)) throw new Error(`下载失败：${url}`);
    const code2 = await runProc('unzip', ['-o', zipPath, '-d', destDir]);
    if (code2 !== 0) throw new Error(`解压失败：${zipPath}`);
  }
  try { fs.unlinkSync(zipPath); } catch { /* ignore */ }
}

async function ensureTools() {
  const embedded = embeddedToolsDir();
  let cli = findFileRecursive(embedded, (n) => n.toLowerCase() === 'animestudio.cli.exe');
  if (!cli) cli = findFileRecursive(path.join(workDir(), 'tools'), (n) => n.toLowerCase() === 'animestudio.cli.exe');
  if (!cli) {
    log('内嵌 AnimeStudio 缺失，联网下载（约 12MB）…');
    await downloadAndExtract(AS_URL, path.join(workDir(), 'tools', 'animestudio.zip'), path.join(workDir(), 'tools', 'animestudio'));
    cli = findFileRecursive(path.join(workDir(), 'tools'), (n) => n.toLowerCase() === 'animestudio.cli.exe');
    if (!cli) throw new Error('下载解压后没找到 AnimeStudio.CLI.exe');
  }
  log(`AnimeStudio CLI：${cli}`);

  let f2g = findFileRecursive(embedded, (n) => /^fbx2gltf.*\.exe$/i.test(n));
  if (!f2g) f2g = findFileRecursive(path.join(workDir(), 'tools'), (n) => /^fbx2gltf.*\.exe$/i.test(n));
  if (!f2g) {
    log('内嵌 FBX2glTF 缺失，联网下载…');
    await downloadAndExtract(F2G_URL, path.join(workDir(), 'tools', 'fbx2gltf.zip'), path.join(workDir(), 'tools', 'fbx2gltf'));
    f2g = findFileRecursive(path.join(workDir(), 'tools'), (n) => /^fbx2gltf.*\.exe$/i.test(n));
    if (!f2g) throw new Error('下载解压后没找到 FBX2glTF.exe');
  }
  log(`FBX2glTF：${f2g}`);
  return { cli, f2g };
}

// ---------- 主管线 ----------

function listFilesRecursive(dir, pred) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (pred(e.name)) out.push(p);
    }
  }
  return out;
}

function mapXmlPath() { return path.join(workDir(), 'out', 'sr_map.xml'); }
function findMapXml() { const p = mapXmlPath(); return fs.existsSync(p) ? p : null; }

function detectResume() {
  const items = [];
  if (findMapXml()) items.push('资产索引 sr_map.xml');
  const exportDir = path.join(workDir(), 'export');
  if (listFilesRecursive(exportDir, (n) => n.toLowerCase().endsWith('.fbx')).length > 0) items.push('已导出的模型');
  if (listFilesRecursive(path.join(outDir(), 'catcakes-glb'), (n) => n.toLowerCase().endsWith('.glb')).length > 0) items.push('已转换的 GLB');
  if (fs.existsSync(path.join(outDir(), 'catcakes-glb.zip'))) items.push('已打包的 zip');
  return items;
}

// ---------- XML 索引（流式，避免 JSON 全量入内存 OOM） ----------
// 格式对照 AnimeStudio AssetsHelper.BuildAssetMapStreaming（XmlWriter Indent）：
// <Assets filename=... createdAt=...> 根，每个 <Asset> 块内按 Name→Container→Type→PathID→Source 单行元素

function unescapeXml(s) {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, '&');
}

// 带错误兜底的逐行读取器：stream/readline 的 'error' 不挂监听会变成 uncaughtException
function trackedLineReader(filePath, highWaterMark) {
  const input = fs.createReadStream(filePath, highWaterMark ? { highWaterMark } : undefined);
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  let streamErr = null;
  input.on('error', (e) => { streamErr = e; try { rl.close(); } catch { /* ignore */ } });
  rl.on('error', (e) => { if (!streamErr) streamErr = e; });
  return { rl, getError: () => streamErr };
}

// 流式逐块扫描 <Asset>，onAsset({Name,Container,Type,PathID,Source})
async function scanAssetXml(xmlPath, onAsset) {
  const { rl, getError } = trackedLineReader(xmlPath);
  let cur = null;
  for await (const line of rl) {
    if (line.includes('<Asset>')) { cur = {}; continue; }
    if (line.includes('</Asset>')) { if (cur) onAsset(cur); cur = null; continue; }
    if (!cur) continue;
    for (const tag of ['Name', 'Container', 'Type', 'PathID', 'Source']) {
      const selfClose = line.match(new RegExp(`<${tag}\\s*/>`));
      if (selfClose) { cur[tag] = ''; break; }
      const m = line.match(new RegExp(`<${tag}(?:\\s[^>]*)?>(.*)</${tag}>`));
      if (m) { cur[tag] = unescapeXml(m[1]); break; }
    }
  }
  const err = getError();
  if (err) throw new Error(`读取索引失败：${err.message}`);
}

// 把分片临时路径前缀的 Source 值重写回真实资产目录（不区分大小写；无特征前缀则原样返回）
// 形如 D:\catcake-shards-xxx\shardN\input\<相对路径> → <asbDir>\<相对路径>
function rewriteShardSourceValue(value, asbDir) {
  const lower = value.toLowerCase();
  const keyIdx = lower.indexOf('catcake-shards-');
  if (keyIdx < 0) return value;
  const inputIdx = lower.indexOf('\\input\\', keyIdx);
  if (inputIdx < 0) return value;
  return asbDir + path.sep + value.slice(inputIdx + '\\input\\'.length);
}

// 合并一行的处理（内容驱动，不做格式假设）：
// - 剥行首 BOM（\ufeff，XmlWriter 产物带 UTF-8 BOM；v4 靠 trim 误打误撞剥掉，v5 优化掉 trim 后回归）
// - 剥行尾 \r（防御 CRLF 残留）
// - 任何位置出现 <?xml / <Assets / </Assets 标记的行，trimStart 确认是行首元素后丢弃
// - <Source> 行做分片前缀重写；其余行透传
function mergeLine(rawLine, asbDir) {
  let s = rawLine;
  if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
  if (s.length && s.charCodeAt(s.length - 1) === 0x0D) s = s.slice(0, -1);
  if (s.length === 0) return null;
  if (s.includes('<') && (s.includes('<?xml') || s.includes('<Assets') || s.includes('</Assets'))) {
    const t = s.trimStart();
    if (t.startsWith('<?xml') || t.startsWith('<Assets') || t.startsWith('</Assets')) return null;
  }
  if (asbDir && s.includes('<Source>')) {
    const i = s.indexOf('<Source>') + '<Source>'.length;
    const e = s.lastIndexOf('</Source>');
    if (e > i) {
      const v = s.slice(i, e);
      const nv = rewriteShardSourceValue(v, asbDir);
      if (nv !== v) return s.slice(0, i) + nv + s.slice(e);
    }
  }
  return s;
}

// 流式合并分片 XML：写一个 <Assets> 根，把各分片的 <Asset> 块原样拷入（剥根元素和 XML 声明）；
// asbDir 非空时把分片临时路径的 <Source> 重写回真实资产目录（硬链接目录合并后即删，不重写导出会炸）
async function mergeShardXmls(shardXmls, outPath, asbDir) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const t0 = Date.now();
  const out = fs.createWriteStream(outPath, { highWaterMark: 1024 * 1024 });
  let outErr = null;
  out.on('error', (e) => { outErr = e; }); // 不挂会变成 uncaughtException
  try {
    out.write(`<?xml version="1.0" encoding="utf-8"?>\n<Assets filename="${outPath}" createdAt="${new Date().toISOString()}">\n`);
    for (const sx of shardXmls) {
      if (outErr) throw new Error(`写入合并索引失败：${outErr.message}`);
      const { rl, getError } = trackedLineReader(sx, 1024 * 1024);
      for await (const line of rl) {
        const outLine = mergeLine(line, asbDir);
        if (outLine === null) continue;
        if (!out.write(outLine + '\n')) await once(out, 'drain');
      }
      const readErr = getError();
      if (readErr) throw new Error(`读取分片索引失败（${path.basename(sx)}）：${readErr.message}`);
    }
  } finally {
    out.end('</Assets>\n');
    try { await once(out, 'finish'); } catch { /* error 事件已由 outErr 捕获 */ }
  }
  if (outErr) throw new Error(`写入合并索引失败：${outErr.message}`);
  appLog(`[merge] 合并 ${shardXmls.length} 个分片耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  await validateMergedMap(outPath); // 合并产物自检，不合格别带进导出步
}

// 合并产物自检：第一行（剥 BOM）必须是声明；全文 <?xml 恰好 1 次、</Assets> 恰好 1 次
async function validateMergedMap(mapXml) {
  const { rl, getError } = trackedLineReader(mapXml, 1024 * 1024);
  let lineNo = 0;
  let declCount = 0;
  let closeCount = 0;
  let firstOk = false;
  for await (const rawLine of rl) {
    let s = rawLine;
    if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
    if (s.length && s.charCodeAt(s.length - 1) === 0x0D) s = s.slice(0, -1);
    lineNo++;
    if (lineNo === 1) firstOk = s.startsWith('<?xml');
    if (s.includes('<?xml')) declCount++;
    if (s.includes('</Assets>')) closeCount++;
  }
  const err = getError();
  if (err) throw new Error(`索引合并校验失败：读取产物出错（${err.message}）`);
  if (!firstOk || declCount !== 1 || closeCount !== 1) {
    throw new Error(`索引合并校验失败（首行声明=${firstOk}，<?xml 出现 ${declCount} 次，</Assets> 出现 ${closeCount} 次），请导出诊断包发回给作者`);
  }
}

// 检测存量索引是否残留分片临时路径（旧版 bug：Source 记的是 catcake-shards 硬链接路径）
// 只看 <Source> 行（根元素的 filename 属性含此字样无害，XmlReader 不读它）
async function mapNeedsRepair(mapXml) {
  const { rl, getError } = trackedLineReader(mapXml, 1024 * 1024);
  let found = false;
  try {
    for await (const line of rl) {
      if (line.includes('<Source>') && line.toLowerCase().includes('catcake-shards-')) { found = true; break; }
    }
  } catch { /* ignore */ } finally { try { rl.close(); } catch { /* ignore */ } }
  return found && !getError();
}

// 就地修复存量索引的 Source 路径：流式读、写临时文件、同目录 rename 原子替换。返回修复条数
async function repairMapXmlSources(mapXml, asbDir) {
  const t0 = Date.now();
  const tmp = `${mapXml}.tmp`;
  const out = fs.createWriteStream(tmp, { highWaterMark: 1024 * 1024 });
  let outErr = null;
  out.on('error', (e) => { outErr = e; });
  let fixed = 0;
  try {
    const { rl, getError } = trackedLineReader(mapXml, 1024 * 1024);
    for await (const rawLine of rl) {
      let outLine = rawLine;
      if (outLine.charCodeAt(0) === 0xFEFF) outLine = outLine.slice(1); // BOM
      if (outLine.length && outLine.charCodeAt(outLine.length - 1) === 0x0D) outLine = outLine.slice(0, -1); // \r
      if (outLine.includes('<Source>')) {
        // 不在此处预筛 catcake-shards（大小写敏感会漏大写残留），交给 rewriteShardSourceValue 判断
        const s = outLine.indexOf('<Source>') + '<Source>'.length;
        const e = outLine.lastIndexOf('</Source>');
        if (e > s) {
          const v = outLine.slice(s, e);
          const nv = rewriteShardSourceValue(v, asbDir);
          if (nv !== v) { outLine = outLine.slice(0, s) + nv + outLine.slice(e); fixed++; }
        }
      }
      if (!out.write(outLine + '\n')) await once(out, 'drain');
    }
    const readErr = getError();
    if (readErr) throw new Error(`读取旧索引失败：${readErr.message}`);
  } finally {
    out.end();
    try { await once(out, 'finish'); } catch { /* ignore */ }
  }
  if (outErr) {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    throw new Error(`修复索引写入失败：${outErr.message}`);
  }
  fs.renameSync(tmp, mapXml); // 同目录原子替换
  appLog(`[repair] 旧索引 Source 就地修复 ${fixed} 条，耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return fixed;
}

// ---------- 分片临时目录（建在游戏所在卷，保证硬链接同卷） ----------

let shardTempDir = null; // 当前会话使用的分片临时根目录（<游戏盘>:\catcake-shards-xxx）

function cleanupShardTemp(reason) {
  if (!shardTempDir) return;
  try {
    fs.rmSync(shardTempDir, { recursive: true, force: true });
    appLog(`[shard] 已清理临时分片目录（${reason}）：${shardTempDir}`);
  } catch (e) {
    appLog(`[shard] 清理临时分片目录失败（${reason}）：${e.message}（下次启动会再清）`);
  }
  shardTempDir = null;
}

// 启动时清理上次残留（Windows：扫各盘符根部的 catcake-shards-* 目录）
function cleanupStaleShardTemps() {
  if (!isWin) return;
  for (const d of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
    const root = `${d}:\\`;
    let entries;
    try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { continue; } // 无权限/光驱跳过
    for (const e of entries) {
      if (e.isDirectory() && e.name.startsWith('catcake-shards-')) {
        const p = path.join(root, e.name);
        try { fs.rmSync(p, { recursive: true, force: true }); appLog(`[shard] 清理上次残留：${p}`); }
        catch (err) { appLog(`[shard] 残留清理失败：${p}（${err.message}）`); }
      }
    }
  }
}

// 分片并行建索引：4 个 CLI 进程；分片目录建在游戏盘上（硬链接必须同卷），失败回退单进程全量
async function buildAssetMap(cli, asbDir, work) {
  const SHARDS = 4;
  const outXml = mapXmlPath();

  const blocks = listFilesRecursive(asbDir, (n) => n.toLowerCase().endsWith('.block'))
    .map((p) => ({ p, size: fs.statSync(p).size }));
  if (!blocks.length) throw new Error('资产目录下没有找到 .block 文件');
  // 按大小降序贪心分组（LPT），每组总大小接近
  blocks.sort((a, b) => b.size - a.size);
  const groups = Array.from({ length: SHARDS }, () => ({ total: 0, files: [] }));
  for (const b of blocks) {
    const g = groups.reduce((m, x) => (x.total < m.total ? x : m));
    g.files.push(b.p); g.total += b.size;
  }

  const fmtGB = (n) => (n / (1024 ** 3)).toFixed(2);

  // 分片临时目录：游戏盘根部的 catcake-shards-<随机串>（硬链接永远同卷，根除跨盘失败）
  const gameRoot = path.parse(path.resolve(asbDir)).root;
  let sharded = true;
  let failReason = '';

  // 防御：游戏盘剩余空间不足 2GB 直接走单进程
  const freeGB = await diskFreeGB(gameRoot);
  if (freeGB >= 0 && freeGB < 2) {
    sharded = false;
    failReason = `游戏盘剩余空间不足 2GB（约 ${freeGB.toFixed(1)}GB）`;
  }

  if (sharded && !shardTempDir) {
    shardTempDir = path.join(gameRoot, `catcake-shards-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`);
  }
  const shardDirOf = (i) => path.join(shardTempDir, `shard${i}`);
  const shardXml = (i) => path.join(shardDirOf(i), 'out', `shard${i}.xml`);

  // 建目录 + 硬链接输入（保持相对路径避免同名冲突）；失败则回退单进程
  if (sharded) {
    try {
      fs.mkdirSync(shardTempDir, { recursive: true });
      for (let i = 0; i < SHARDS; i++) {
        for (const f of groups[i].files) {
          const dst = path.join(shardDirOf(i), 'input', path.relative(asbDir, f));
          if (fs.existsSync(dst)) continue;
          fs.mkdirSync(path.dirname(dst), { recursive: true });
          fs.linkSync(f, dst);
        }
      }
    } catch (e) {
      sharded = false;
      failReason = `在游戏盘建立分片目录/硬链接失败：${e.message}`;
      cleanupShardTemp('分片建立失败');
    }
  }

  if (!sharded) {
    log(`分片失败原因：${failReason}，回退单进程全量模式`);
    appLog(`[shard] 分片失败原因：${failReason}，回退单进程`);
    log('扫描游戏资产建立索引（资产 15G+，可能要 10~30 分钟，请耐心等待）…');
    const code = await runProc(cli, ['--game', 'SR', '--map_op', 'AssetMap', '--map_type', 'XML',
      '--map_name', 'sr_map', asbDir, path.join(work, 'out')], { cwd: work });
    throwIfCancelled();
    if (code !== 0) throw new Error(`建索引失败（退出码 ${code}），详情见日志`);
    if (!fs.existsSync(outXml)) throw new Error('跑完了但找不到 sr_map.xml，请导出诊断包发回给作者');
    return;
  }

  log(`分 4 片并行建索引（${blocks.length} 个 .block，共 ${fmtGB(blocks.reduce((s, b) => s + b.size, 0))}GB）…`);
  appLog(`[shard] 分片目录：${shardTempDir}`);
  for (let i = 0; i < SHARDS; i++) {
    appLog(`[shard] 分片 ${i}：${groups[i].files.length} 个文件，共 ${fmtGB(groups[i].total)}GB`);
  }

  // 每分片复制独立工具目录：AnimeStudio.CLI 启动时 GameManager 静态初始化会写
  // 工具目录下 bin\CNKeys.json（无共享锁），多进程共用同一目录必炸（退出码 3762504530）
  const toolsSrc = path.dirname(cli);
  const shardCli = [];
  try {
    for (let i = 0; i < SHARDS; i++) {
      const dst = path.join(shardDirOf(i), 'tools');
      if (!fs.existsSync(path.join(dst, path.basename(cli)))) {
        appLog(`[shard] 复制工具目录到分片 ${i}：${toolsSrc} -> ${dst}`);
        fs.cpSync(toolsSrc, dst, { recursive: true });
      }
      shardCli.push(path.join(dst, path.basename(cli)));
    }
  } catch (e) {
    appLog(`[shard] 分片失败原因：复制独立工具目录失败：${e.message}，回退单进程`);
    log(`复制独立工具目录失败（${e.message}），回退单进程全量模式`);
    cleanupShardTemp('工具目录复制失败');
    const code = await runProc(cli, ['--game', 'SR', '--map_op', 'AssetMap', '--map_type', 'XML',
      '--map_name', 'sr_map', asbDir, path.join(work, 'out')], { cwd: work });
    throwIfCancelled();
    if (code !== 0) throw new Error(`建索引失败（退出码 ${code}），详情见日志`);
    if (!fs.existsSync(outXml)) throw new Error('跑完了但找不到 sr_map.xml，请导出诊断包发回给作者');
    return;
  }

  let doneCount = 0;
  setProgress(null, `建索引：分片完成 0/${SHARDS}`);
  await Promise.all(groups.map((g, i) => (async () => {
    if (fs.existsSync(shardXml(i))) {
      log(`分片 ${i} 产物已存在，跳过`);
      appLog(`[shard] 分片 ${i} 产物已存在，跳过启动`);
    } else {
      const shardDir = shardDirOf(i);
      fs.mkdirSync(path.join(shardDir, 'out'), { recursive: true });
      if (i > 0) await sleep(500 * i); // 错开启动，双保险
      appLog(`[shard] 启动分片进程 ${i}（${groups[i].files.length} 个文件，${fmtGB(groups[i].total)}GB，工具：${shardCli[i]}）`);
      const code = await runProc(shardCli[i], ['--game', 'SR', '--map_op', 'AssetMap', '--map_type', 'XML',
        '--map_name', `shard${i}`, '--silent',
        path.join(shardDir, 'input'), path.join(shardDir, 'out')], { cwd: shardDir });
      throwIfCancelled();
      if (code !== 0) throw new Error(`分片 ${i} 建索引失败（退出码 ${code}），详情见日志`);
      if (!fs.existsSync(shardXml(i))) throw new Error(`分片 ${i} 跑完了但找不到 shard${i}.xml，请导出诊断包发回给作者`);
    }
    doneCount++;
    setProgress(null, `建索引：分片完成 ${doneCount}/${SHARDS}`);
    log(`分片 ${i} 完成（${doneCount}/${SHARDS}）`);
  })()));

  setProgress(null, '合并分片索引…');
  await mergeShardXmls(groups.map((_, i) => shardXml(i)), outXml, asbDir);
  if (!fs.existsSync(outXml)) throw new Error('合并分片索引失败：sr_map.xml 不存在');
  cleanupShardTemp('索引完成'); // 分片中间产物只在建索引期间有用，合并完即清（Source 已重写回真实路径）
}

async function pipeline(asbDir, uiFilters) {
  const work = workDir();
  const out = outDir();
  fs.mkdirSync(work, { recursive: true });
  fs.mkdirSync(out, { recursive: true });
  logFile = path.join(work, 'run.log');

  const STEPS = ['建索引', '筛选侦查', '导出模型', '转换 GLB', '打包 zip'];
  const stats = { ok: 0, bad: 0, hitCount: 0, animCount: 0, zipPath: path.join(out, 'catcakes-glb.zip') };

  try {
    log('====== 开始提取 ======');
    log(`资产目录：${asbDir}（${countBlocks(asbDir)} 个 .block 文件）`);
    const resume = detectResume();
    if (resume.length) log(`检测到上次进度（${resume.join('、')}），对应步骤将跳过`);
    else log('未检测到上次进度（work 目录为空或已被清理），从头开始');

    // ---- 准备工具 ----
    const { cli, f2g } = await ensureTools();
    throwIfCancelled();

    const dn = await checkDotNet();
    if (!dn.ok) throw new Error('缺少 .NET 9 运行时，请回到上一步点「一键安装」或手动安装后重试');

    // ---- 步骤 0：建索引（XML 流式，4 分片并行） ----
    setStep(0, 'run'); setProgress(null, STEPS[0]);
    let mapXml = findMapXml();
    if (mapXml) {
      log(`索引已存在，跳过建索引：${mapXml}`);
      // 旧版 bug 兼容：索引里的 Source 可能还指着已删除的分片硬链接目录，就地修复
      if (await mapNeedsRepair(mapXml)) {
        log('检测到旧索引路径残留（分片临时目录），正在就地修复 Source 路径…');
        const fixed = await repairMapXmlSources(mapXml, asbDir);
        log(`检测到旧索引路径残留，已就地修复（${fixed} 条 Source）`);
      }
    } else {
      await buildAssetMap(cli, asbDir, work);
      throwIfCancelled();
      mapXml = findMapXml();
      if (!mapXml) throw new Error('跑完了但找不到 sr_map.xml，请导出诊断包发回给作者');
    }
    setStep(0, 'ok'); log(`索引完成：${mapXml}`);

    // ---- 步骤 1：筛选侦查（流式扫 XML） ----
    setStep(1, 'run'); setProgress(null, STEPS[1]);
    const exportDir = path.join(work, 'export');
    const filters = (uiFilters && uiFilters.length) ? uiFilters : DEFAULT_FILTERS;

    // 导出参数（类型/筛选规则）与上次不一致 → 清空旧产物重导，避免旧产物污染
    let exportDone = listFilesRecursive(exportDir, (n) => n.toLowerCase().endsWith('.fbx')).length > 0;
    if (exportDone) {
      let prev = null;
      try { prev = JSON.parse(fs.readFileSync(path.join(work, 'export-params.json'), 'utf8')); } catch { /* ignore */ }
      const same = prev && prev.types === EXPORT_TYPES_DESC && prev.filters === filters.join('\n');
      if (!same) {
        log('导出参数（类型/筛选规则）与上次不一致，清空旧产物重新导出');
        appLog(`[export] 参数变化，清空旧导出产物（旧：${prev ? JSON.stringify(prev) : '无记录'}）`);
        try { fs.rmSync(exportDir, { recursive: true, force: true }); } catch { /* ignore */ }
        try { fs.rmSync(path.join(out, 'catcakes-glb'), { recursive: true, force: true }); } catch { /* ignore */ }
        try { fs.unlinkSync(stats.zipPath); } catch { /* ignore */ }
        exportDone = false;
      }
    }

    const candFile = path.join(work, 'candidates.txt');
    if (exportDone && fs.existsSync(candFile)) {
      log('已有侦查结果和导出产物，跳过侦查');
      stats.hitCount = MIN_HITS; // 不阻塞
    } else {
      const kw = (uiFilters && uiFilters.length) ? uiFilters.join('|') : DEFAULT_RECON_KW;
      let re;
      try { re = new RegExp(kw, 'i'); }
      catch { throw new Error(`筛选规则不是合法的正则表达式：${kw}`); }
      const hitLines = [];
      await scanAssetXml(mapXml, (a) => {
        if (re.test(a.Name || '') || re.test(a.Container || '')) {
          hitLines.push(`${a.Type || ''}\t${a.Name || ''}\t${a.Container || ''}`);
        }
      });
      stats.hitCount = hitLines.length;
      fs.writeFileSync(candFile, hitLines.join('\r\n'), 'utf8');
      log(`命中 ${stats.hitCount} 条（ruanmadecake 正常应有几百条），清单已写入 work\\candidates.txt`);
    }
    throwIfCancelled();
    if (stats.hitCount < MIN_HITS) {
      send({ type: 'recon-warning', hitCount: stats.hitCount });
      const choice = await new Promise((resolve) => { reconWaiter = resolve; });
      reconWaiter = null;
      throwIfCancelled();
      if (choice === 'diag') {
        const p = await exportDiagnostics();
        log(`诊断包已导出：${p}`);
        throw new Error('已导出诊断包，请把它发回给作者确认筛选规则后重跑');
      }
      log('用户选择继续提取');
    }
    setStep(1, 'ok');

    // ---- 步骤 2：导出模型 ----
    setStep(2, 'run'); setProgress(null, STEPS[2]);
    let fbxList = listFilesRecursive(exportDir, (n) => n.toLowerCase().endsWith('.fbx'));
    if (fbxList.length > 0) {
      log(`导出产物已存在（${fbxList.length} 个 FBX），跳过导出`);
    } else {
      const filtersFile = path.join(work, 'filters.txt');
      fs.writeFileSync(filtersFile, filters.join('\r\n'), 'utf8');
      log(`筛选规则：${filters.join(' / ')}`);

      // 依赖索引（CAB map，管线补丁 8）：art prefab 的网格/材质是跨 block 外部引用，
      // 不开依赖解析会整体丢网格（"has no mesh, skipping"）。一次性构建可复用；
      // 游戏大更新后需删掉 work\sr_cabs.bin 重建（bin 里烙了资产目录，目录也不能变）
      const cabBin = path.join(work, 'sr_cabs.bin');
      if (!fs.existsSync(cabBin)) {
        setProgress(null, '构建依赖索引（一次性，约几分钟）…');
        log('构建依赖索引（CAB map）…');
        const codeCab = await runProc(cli, ['--game', 'SR', '--build_cabmap', cabBin, asbDir, work], { cwd: work });
        throwIfCancelled();
        if (codeCab !== 0 || !fs.existsSync(cabBin)) {
          throw new Error(`构建依赖索引失败（退出码 ${codeCab}），详情见日志`);
        }
        log('依赖索引完成：' + cabBin);
      } else {
        log('依赖索引已存在，跳过构建：' + cabBin);
      }

      // --map_op 必须同时带 Load+AssetMap 才会走 ParseAssetMap（Program.cs:158-168）；
      // map_name 传 XML 完整路径（ParseAssetMap 直接 File.OpenRead）。
      // 参数顺序坑：--types 是 AllowMultipleArgumentsPerToken 会吞掉后面的位置参数，
      // 必须紧跟 --names 等其他选项，两个位置路径放最后。
      // --names 传文件路径用正斜杠（新版 System.CommandLine 会把反斜杠路径当正则误杀；正斜杠 Windows 也能读）
      const exportArgs = (types, extra = []) => ['--game', 'SR', '--map_op', 'Load,AssetMap', '--map_type', 'XML',
        '--map_name', mapXml,
        '--types', ...types, '--names', filtersFile.replace(/\\/g, '/'),
        '--group_assets', 'ByContainer', ...extra, asbDir, exportDir];

      // 第一条：导出模型贴图（GameObject + Texture2D → FBX）。开依赖解析拉全跨 block 网格/材质；
      // 第二条动画 pass 不需要（剪辑自包含，开了只会拖慢）
      log('导出模型贴图（GameObject + Texture2D，带依赖解析）…');
      const code1 = await runProc(cli, exportArgs(EXPORT_TYPES_MODEL, ['--resolve_dependencies', cabBin]), { cwd: work });
      throwIfCancelled();
      if (code1 !== 0) throw new Error(`导出模型贴图失败（退出码 ${code1}），详情见日志`);
      fbxList = listFilesRecursive(exportDir, (n) => n.toLowerCase().endsWith('.fbx'));
      if (!fbxList.length) throw new Error('没有导出任何 FBX，筛选规则可能不对。请导出诊断包发回给作者');

      // 第二条：导出动画（Animator + AnimationClip）。必须单独跑：--types 带 GameObject 时
      // Animator 会被强制只解析不导出，动画烘不进 FBX。失败/无产出只记警告，不影响模型贴图
      const beforeAnim = new Set(listFilesRecursive(exportDir, () => true));
      log('导出动画（Animator + AnimationClip）…');
      const code2 = await runProc(cli, exportArgs(EXPORT_TYPES_ANIM), { cwd: work });
      throwIfCancelled();
      const newAnimFiles = listFilesRecursive(exportDir, () => true).filter((f) => !beforeAnim.has(f));
      if (code2 !== 0 || !newAnimFiles.length) {
        log(`警告：导出动画没有产出（退出码 ${code2}），动画可能缺失，模型贴图不受影响`);
      } else {
        log(`导出动画完成：新增 ${newAnimFiles.length} 个文件`);
      }

      // 记录本次导出参数，供下次断点续跑对比（变了要重导）
      try {
        fs.writeFileSync(path.join(work, 'export-params.json'),
          JSON.stringify({ types: EXPORT_TYPES_DESC, filters: filters.join('\n') }), 'utf8');
      } catch { /* ignore */ }
    }
    // 第二条命令的 Animator FBX 也在 exportDir 里——转换前必须刷新 FBX 清单
    fbxList = listFilesRecursive(exportDir, (n) => n.toLowerCase().endsWith('.fbx'));
    stats.animCount = listFilesRecursive(exportDir, (n) => n.toLowerCase().endsWith('.anim')).length;
    setStep(2, 'ok'); log(`导出完成：${fbxList.length} 个 FBX（另 ${stats.animCount} 个 .anim 动画文件）`);

    // ---- 步骤 3：FBX → GLB（worker 池并行） ----
    setStep(3, 'run');
    const glbDir = path.join(out, 'catcakes-glb');
    fs.mkdirSync(glbDir, { recursive: true });
    const exportRoot = exportDir;
    const POOL = Math.min(os.cpus().length, 8);
    log(`并行转换：${POOL} 个 worker`);
    let nextIdx = 0;
    let doneN = 0;
    const convertOne = async (fbx) => {
      const rel = path.dirname(fbx).substring(exportRoot.length).replace(/^[/\\]/, '');
      const targetDir = path.join(glbDir, rel);
      fs.mkdirSync(targetDir, { recursive: true });
      const target = path.join(targetDir, path.basename(fbx, path.extname(fbx)));
      if (fs.existsSync(`${target}.glb`)) {
        stats.ok++;
      } else {
        const code = await runProc(f2g, ['--binary', '--input', fbx, '--output', target]);
        if (cancelled) return;
        if (code === 0 && fs.existsSync(`${target}.glb`)) {
          stats.ok++;
        } else {
          stats.bad++;
          try { fs.copyFileSync(fbx, path.join(targetDir, path.basename(fbx))); } catch { /* ignore */ }
          log(`转换失败：${path.basename(fbx)}（原始 FBX 已保留）`);
        }
      }
      // 同目录 PNG 贴图一并拷过去
      try {
        for (const f of fs.readdirSync(path.dirname(fbx))) {
          if (f.toLowerCase().endsWith('.png')) fs.copyFileSync(path.join(path.dirname(fbx), f), path.join(targetDir, f));
        }
      } catch { /* ignore */ }
    };
    await Promise.all(Array.from({ length: POOL }, async () => {
      while (nextIdx < fbxList.length && !cancelled) {
        const fbx = fbxList[nextIdx++];
        await convertOne(fbx);
        doneN++;
        setProgress(doneN / fbxList.length, `转换 GLB ${doneN}/${fbxList.length}`);
      }
    }));
    throwIfCancelled();
    // 散落的贴图和 .anim 动画整棵拷一份，防止漏（.anim 随 zip 一并发回，验证 YAML 路线）
    for (const extra of listFilesRecursive(exportRoot, (n) => /\.(png|anim)$/i.test(n))) {
      const rel = path.dirname(extra).substring(exportRoot.length).replace(/^[/\\]/, '');
      const td = path.join(glbDir, rel);
      fs.mkdirSync(td, { recursive: true });
      try { fs.copyFileSync(extra, path.join(td, path.basename(extra))); } catch { /* ignore */ }
    }
    setStep(3, 'ok'); log(`转换完成：成功 ${stats.ok} 个，失败 ${stats.bad} 个`);

    // ---- 步骤 4：打包 zip ----
    setStep(4, 'run'); setProgress(null, STEPS[4]);
    if (fs.existsSync(stats.zipPath)) {
      log(`zip 已存在，跳过重打包：${stats.zipPath}`);
    } else {
      await makeZip(stats.zipPath, glbDir);
      if (!fs.existsSync(stats.zipPath)) throw new Error('打包 zip 失败：产物不存在');
    }
    setStep(4, 'ok');
    setProgress(1, '完成');
    log(`全部完成！产物：${stats.zipPath}`);
    send({ type: 'done', ok: true, stats });
  } catch (err) {
    if (err.cancelled) {
      log('已取消。已完成的步骤会保留，下次开跑自动续跑。');
      send({ type: 'done', ok: false, cancelled: true, error: '已取消', stats });
    } else {
      for (let i = 0; i < STEPS.length; i++) { /* 标记当前失败步由渲染端按 run 态处理 */ }
      send({ type: 'step-fail' });
      log(`出错：${err.message}`);
      send({ type: 'done', ok: false, error: err.message, stats });
    }
  } finally {
    // 失败/取消出口保证不遗留子进程：先杀光再等退出，最后才清游戏盘上的分片目录（防 EBUSY）
    if (currentChildren.size) {
      appLog(`[proc] 管线结束，清理 ${currentChildren.size} 个遗留子进程`);
      await killAllChildren();
      await waitChildrenExit(10000);
    }
    cleanupShardTemp('提取结束/取消');
  }
}

// ---------- 诊断 ----------

async function exportDiagnostics() {
  const out = outDir();
  fs.mkdirSync(out, { recursive: true });
  const zipPath = path.join(out, 'catcakes-diagnostics.zip');
  const files = ['candidates.txt', 'filters.txt', 'run.log', 'app.log']
    .map((f) => path.join(workDir(), f))
    .filter((f) => fs.existsSync(f));
  // 崩溃 minidump 一并打包（如果有）
  try {
    for (const f of fs.readdirSync(crashDumpsDir)) {
      if (f.toLowerCase().endsWith('.dmp')) files.push(path.join(crashDumpsDir, f));
    }
  } catch { /* ignore */ }
  // 与产物 zip 走同一封装：先把散落文件归拢到暂存目录再打（tar.exe 只接受目录）
  const staging = path.join(workDir(), 'diag-staging');
  try { fs.rmSync(staging, { recursive: true, force: true }); } catch { /* ignore */ }
  try { fs.unlinkSync(zipPath); } catch { /* ignore */ }
  if (files.length) {
    fs.mkdirSync(staging, { recursive: true });
    for (const f of files) {
      try { fs.copyFileSync(f, path.join(staging, path.basename(f))); } catch { /* ignore */ }
    }
    await makeZip(zipPath, staging);
    try { fs.rmSync(staging, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  appLog(`[diag] 诊断包已导出：${zipPath}（含 ${files.length} 个文件）`);
  return zipPath;
}

async function diagnosticsText() {
  const dn = await checkDotNet();
  const lines = [
    '=== 猫猫糕提取工具 诊断信息 ===',
    `时间：${new Date().toLocaleString('zh-CN')}`,
    `系统：${process.platform} ${process.arch}`,
    `.NET 9：${dn.ok ? 'OK' : '缺失'}（${dn.detail}）`,
    '',
    '--- 日志摘要（末尾 80 行）---',
  ];
  try {
    const content = fs.readFileSync(path.join(workDir(), 'run.log'), 'utf8');
    lines.push(...content.trim().split('\n').slice(-80));
  } catch { lines.push('（无日志）'); }
  return lines.join('\n');
}

// ---------- IPC ----------

ipcMain.handle('choose-dir', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: '选择游戏资产目录（…\\StarRail_Data\\StreamingAssets\\Asb\\Windows）',
    properties: ['openDirectory'],
  });
  if (r.canceled || !r.filePaths.length) return { ok: false, cancelled: true };
  const picked = r.filePaths[0];
  const asb = resolveAsbDir(picked);
  if (!asb) return { ok: false, error: '这个目录里没有 .block 文件，也没能在下层找到 Asb\\Windows。请确认选的是游戏目录。' };
  return { ok: true, path: asb, adjusted: asb !== picked, blockCount: countBlocks(asb) };
});

ipcMain.handle('auto-find', async () => {
  const asb = autoFindAsb();
  if (!asb) return { ok: false, error: '没在常见路径找到游戏，请手动选择目录' };
  return { ok: true, path: asb, blockCount: countBlocks(asb) };
});

ipcMain.handle('precheck', async (_e, asbDir) => {
  const dn = await checkDotNet();
  const freeGB = asbDir ? await diskFreeGB(asbDir) : -1;
  const tools = checkTools();
  return {
    dotnet: dn,
    disk: { ok: freeGB < 0 ? null : freeGB >= MIN_FREE_GB, freeGB: freeGB < 0 ? null : Math.round(freeGB) },
    tools: { ok: tools.ok, detail: tools.detail },
  };
});

ipcMain.handle('install-dotnet', async () => {
  if (!isWin) return { ok: false, error: '当前系统不支持一键安装，请手动下载' };
  log('用 winget 安装 .NET 9 运行时（可能弹 UAC 确认框）…');
  try {
    await runProc('winget', ['install', '--id', 'Microsoft.DotNet.Runtime.9', '-e',
      '--accept-source-agreements', '--accept-package-agreements']);
  } catch (err) { return { ok: false, error: String(err.message || err) }; }
  const dn = await checkDotNet();
  return { ok: dn.ok, error: dn.ok ? null : '安装后仍未检测到 .NET 9，可能需要重启终端或手动安装' };
});

ipcMain.handle('open-dotnet-page', () => {
  shell.openExternal('https://dotnet.microsoft.com/download/dotnet/9.0');
});

ipcMain.handle('start', async (_e, { asbDir, filters }) => {
  if (pipeline.running) return { ok: false, error: '已在运行中' };
  cancelled = false;
  pipeline.running = true;
  pipeline(asbDir, filters).finally(() => { pipeline.running = false; });
  return { ok: true };
});

ipcMain.handle('cancel', async () => {
  cancelled = true;
  if (reconWaiter) { reconWaiter('cancel'); reconWaiter = null; }
  await killAllChildren();
  return { ok: true };
});

ipcMain.handle('recon-choice', (_e, choice) => {
  if (reconWaiter) { reconWaiter(choice); reconWaiter = null; }
});

ipcMain.handle('export-diagnostics', () => exportDiagnostics());
ipcMain.handle('copy-diagnostics', async () => {
  clipboard.writeText(await diagnosticsText());
});
ipcMain.handle('open-output', () => {
  fs.mkdirSync(outDir(), { recursive: true });
  shell.openPath(outDir());
});
ipcMain.handle('detect-resume', () => detectResume());

// ---------- 窗口 ----------

// 异常退出哨兵：ready 时创建，正常退出（will-quit）时删除；下次启动还在 = 上次崩了
function sessionLockPath() { return path.join(workDir(), 'session.lock'); }
let lastSessionCrashed = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 720,
    height: 600,
    minWidth: 640,
    minHeight: 520,
    title: '猫猫糕提取工具',
    backgroundColor: '#fff0f3',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.setMenuBarVisibility(false);

  // 渲染进程崩溃/卡死监听
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    appLog(`[render-process-gone] reason=${details.reason} exitCode=${details.exitCode}`);
    try {
      dialog.showErrorBox('界面进程崩溃了',
        `原因：${details.reason}（退出码 ${details.exitCode}）\n\n已记录到 work\\app.log。请重启本工具；反复崩溃请把 work 文件夹发回给作者。`);
    } catch { /* ignore */ }
  });
  mainWindow.webContents.on('unresponsive', () => {
    appLog('[renderer] unresponsive（界面卡死）');
  });
  mainWindow.webContents.on('responsive', () => {
    appLog('[renderer] responsive again（界面恢复）');
  });
  mainWindow.webContents.on('console-message', (_e, _level, message) => {
    appLog(`[renderer.console] ${message}`);
  });

  mainWindow.webContents.on('did-finish-load', () => {
    if (lastSessionCrashed) send({ type: 'last-crash' });
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

// GPU 等子进程崩溃也记
app.on('child-process-gone', (_e, details) => {
  appLog(`[child-process-gone] type=${details.type} reason=${details.reason} exitCode=${details.exitCode}`);
});

app.whenReady().then(() => {
  // 哨兵：先看上次是否异常退出，再创建本次的 lock
  try {
    fs.mkdirSync(workDir(), { recursive: true });
    lastSessionCrashed = fs.existsSync(sessionLockPath());
    if (lastSessionCrashed) appLog('[sentinel] 检测到上次异常退出（session.lock 残留）');
    fs.writeFileSync(sessionLockPath(), String(process.pid));
  } catch (e) { appLog(`[sentinel] 哨兵写入失败：${e.message}`); }

  cleanupStaleShardTemps(); // 清上次残留在游戏盘上的分片临时目录

  appLog('[app] ready，创建主窗口');
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('will-quit', () => {
  try { fs.unlinkSync(sessionLockPath()); appLog('[app] 正常退出，哨兵已删除'); } catch { /* ignore */ }
});

app.on('window-all-closed', () => {
  cancelled = true;
  killAllChildren()
    .then(() => waitChildrenExit(10000))
    .finally(() => {
      cleanupShardTemp('关窗');
      if (process.platform !== 'darwin') app.quit();
    });
});
