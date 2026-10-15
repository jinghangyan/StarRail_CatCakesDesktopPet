// 手机端 3D 宠物页的 glue 层：把桌面端 pet3d.js 嫁接到 Android WebView
// 职责：cake:// fetch 垫片、window.api 垫片（配置走 localStorage + Flutter channel）、
//       触控手势（点=动作+流光+台词+猫叫，拖=旋转视角，双击=复位）、待机池、联机事件
// 本文件是经典脚本，先于 pet3d.js（module，deferred）执行，垫片必须先就位。
(function () {
  'use strict';

  // ---- cake:// 协议垫片：桌面端是自定义协议（file:// fetch 限制），webview 里映射成相对路径 ----
  // 注意 three 的 FileLoader 传的是 Request 对象不是字符串，两种都要处理
  const _fetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url);
    if (url && url.startsWith('cake://')) {
      const mapped = url.slice('cake://'.length).replace(/^models\/?/, 'models/');
      input = typeof input === 'string' ? mapped : new Request(mapped, input);
    }
    return _fetch(input, init);
  };

  // ---- Flutter 通道；独立浏览器预览时全部走本地兜底 ----
  // 兼容两种宿主：flutter_inappwebview（callHandler）/ webview_flutter（JavaScriptChannel → window.<name>.postMessage）
  const callFlutter = (handler, arg) => {
    try {
      if (window.flutter_inappwebview) {
        window.flutter_inappwebview.callHandler(handler, arg);
        return;
      }
      const ch = window[handler];
      if (ch && ch.postMessage) ch.postMessage(arg == null ? '' : String(arg));
    } catch { /* 忽略 */ }
  };

  // ---- window.api 垫片（pet3d.js 只用到这些方法；窗口控制类全部 noop）----
  const CFG_KEY = 'petMobileCfg';
  let cfg = {};
  try { cfg = JSON.parse(localStorage.getItem(CFG_KEY) || '{}'); } catch { cfg = {}; }
  const prefsCbs = [];
  function saveCfg() {
    try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch { /* 忽略 */ }
    callFlutter('cfg', JSON.stringify(cfg)); // 同步给 Flutter 写 SharedPreferences（跨 webview 重建持久化）
  }
  window.api = {
    getConfig: () => Promise.resolve({
      renderMode: '3d',
      perfMode: 'balanced', // 手机 DPR 高，默认 SSAA 1.0 + 30fps 省电档；硬机可在设置改
      petSize: 240,
      ...cfg,
    }),
    setConfig: (patch) => { Object.assign(cfg, patch); saveCfg(); },
    setPrefs: (patch) => { Object.assign(cfg, patch); saveCfg(); },
    onPrefsChanged: (cb) => prefsCbs.push(cb),
    onConfigChanged: () => {},
    onSizeChanged: () => {},
    onCakeChanged: () => {},
    onAnimPreview: () => {},
    setShape: () => Promise.resolve(null), // 窗口尺寸由 Flutter 容器决定，异形窗口语义不存在
    debugLog: (line) => console.log('[pet-mobile]', line),
    dismissHint: () => {},
    // 窗口拖/拉 IPC 在移动端不存在（拖动=旋转视角，由本文件手势处理）
    dragBegin: () => {}, dragMove: () => {}, dragEnd: () => {},
    resizeBegin: () => {}, resizeMove: () => {}, resizeEnd: () => {},
    resizeWindow: () => {},
    setMouseIgnore: () => {},
  };
  // Flutter 侧改配置（换猫/视角/性能模式）后调它广播
  window.__applyFlutterCfg = (json) => {
    try { cfg = { ...cfg, ...JSON.parse(json) }; } catch { return; }
    try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch { /* 忽略 */ }
    prefsCbs.forEach((cb) => cb(cfg));
  };

  // ---- 台词/名字数据（Flutter 注入；独立浏览器预览时用兜底）----
  let phrases = ['喵~', '喵呜！', '蹭蹭你', '干嘛呀', '₍^._.^₎ ⟆'];
  window.setCakeData = (id, name, phrasesJson) => {
    window.currentCakeId = id;
    try {
      const list = JSON.parse(phrasesJson);
      if (Array.isArray(list) && list.length) phrases = list;
    } catch { /* 保留旧台词 */ }
    if (window.pet3d) window.pet3d.setCake(id);
  };
  const randomPhrase = () => phrases[Math.floor(Math.random() * phrases.length)];

  // ---- 台词气泡 ----
  const bubble = document.getElementById('bubble');
  let bubbleTimer = null;
  function showBubble(text, ms) {
    bubble.textContent = text;
    bubble.classList.add('show');
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(() => bubble.classList.remove('show'), ms || 2500);
  }

  // ---- 猫叫：Flutter 原生播放（含用户自定义叫声）；独立浏览器预览时随机预设兜底 ----
  function meow() {
    if (window.flutter_inappwebview || (window.meow && window.meow.postMessage)) {
      callFlutter('meow');
      return;
    }
    try {
      new Audio('../meows/meow' + (1 + Math.floor(Math.random() * 7)) + '.m4a').play().catch(() => {});
    } catch { /* 忽略 */ }
  }

  // ---- 动作池（与桌面端 cake.js 一致）：点击 5 种 + 待机 4 种 ----
  const ACTIONS = ['duang', 'wiggle', 'spin', 'hop', 'tilt'];
  const IDLE_ACTIONS = ['idle-stretch', 'idle-sway', 'idle-look', 'idle-curl'];
  let lastAction = null, sameCount = 0, lastIdle = null;

  function pickAction() {
    let pool = ACTIONS;
    if (lastAction && sameCount >= 2) {
      pool = ACTIONS.filter((a) => a !== lastAction);
      if (!pool.length) pool = ACTIONS;
    }
    const pick = pool[Math.floor(Math.random() * pool.length)];
    sameCount = pick === lastAction ? sameCount + 1 : 1;
    lastAction = pick;
    return pick;
  }
  function pickIdle() {
    let pool = IDLE_ACTIONS.filter((a) => a !== lastIdle);
    if (!pool.length) pool = IDLE_ACTIONS;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    lastIdle = pick;
    return pick;
  }

  let currentAction = null;
  function playAction(cls) {
    if (!window.pet3d || !window.pet3d.available) return;
    currentAction = cls;
    const ok = window.pet3d.play(cls, () => {
      if (cls === 'idle-curl') window.pet3d.clearExpression();
      if (currentAction === cls) currentAction = null;
    });
    // 蜷缩打盹闭眼：必须在 play() 之后再设（play 打断旧动作会触发旧回调的 clearExpression）
    if (ok && cls === 'idle-curl') window.pet3d.setExpression('CloseEye');
  }

  function tapFeedback() {
    playAction('act-' + pickAction());
    window.pet3d.glow(1500);
    meow();
    showBubble(randomPhrase(), 2000);
  }

  // ---- 待机：每 9~22 秒自动做个轻柔动作 ----
  function scheduleIdle() {
    setTimeout(() => {
      if (!document.hidden && !currentAction) playAction(pickIdle());
      scheduleIdle();
    }, 9000 + Math.random() * 13000);
  }

  // ---- 手势：点=动作，单指拖=旋转视角，双击=复位 ----
  let tracking = false, moved = false, hit = false;
  let startX = 0, startY = 0, yaw0 = 0, pitch0 = 0, downT = 0, lastTapT = 0;

  window.addEventListener('pointerdown', (e) => {
    if (!window.pet3d || !window.pet3d.available) return;
    hit = window.pet3d.hitTest(e.clientX, e.clientY);
    if (!hit) return; // 点在透明区：不拦截（Flutter 侧其它 UI 照常）
    tracking = true; moved = false;
    startX = e.clientX; startY = e.clientY; downT = performance.now();
    const v = window.pet3d.getViewAngle();
    yaw0 = v.yaw; pitch0 = v.pitch;
  });
  window.addEventListener('pointermove', (e) => {
    if (!tracking) return;
    const dx = e.clientX - startX, dy = e.clientY - startY;
    if (!moved && Math.abs(dx) + Math.abs(dy) > 10) moved = true;
    if (moved) window.pet3d.setViewAngle(yaw0 + dx * 0.008, pitch0 + dy * 0.008);
  });
  window.addEventListener('pointerup', (e) => {
    if (!tracking) return;
    tracking = false;
    if (moved) { window.pet3d.saveViewAngle(); return; }
    if (!hit || performance.now() - downT > 500) return;
    // 双击复位（两次点击动作照触发，和桌面端一致不做去抖）
    const now = performance.now();
    if (now - lastTapT < 350) { window.pet3d.resetView(); lastTapT = 0; return; }
    lastTapT = now;
    tapFeedback();
  });
  window.addEventListener('pointercancel', () => { tracking = false; });
  window.addEventListener('contextmenu', (e) => e.preventDefault()); // 长按不弹菜单

  // ---- 联机事件（Flutter 注入：收到戳一戳/消息时猫糕做反应）----
  window.onPetEvent = (json) => {
    let e;
    try { e = JSON.parse(json); } catch { return; }
    if (!window.pet3d || !window.pet3d.available) return;
    playAction('act-' + pickAction());
    window.pet3d.glow(1500);
    meow();
    showBubble(e.kind === 'blink' ? `✨ ${e.who} 戳了戳你` : `${e.who}: ${e.content}`, 4000);
  };

  // pet3d ready 后启动待机循环
  const waitReady = () => {
    if (!window.pet3d) return setTimeout(waitReady, 200);
    window.pet3d.ready.then(() => scheduleIdle());
  };
  waitReady();
})();
