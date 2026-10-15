// 猫猫糕形象：加载选中的图片、流动轮廓光、随机动作、待机自动动作、猫叫
(function () {
  const img = document.getElementById('cake');
  const stage = document.getElementById('stage');
  const edgeGlow = document.getElementById('edgeGlow');
  let glowTimer = null;

  // 3D 渲染层是否接管（WebGL 可用时 pet3d.available 为 true，否则走旧 2D 路径）
  function pet3dOn() {
    return !!(window.pet3d && window.pet3d.available);
  }

  // 触发轮廓光，ms 后自动消失
  window.cakeGlow = function (ms) {
    if (pet3dOn()) { window.pet3d.glow(ms); return; }
    edgeGlow.classList.add('on');
    clearTimeout(glowTimer);
    glowTimer = setTimeout(() => edgeGlow.classList.remove('on'), ms || 1500);
  };

  // ---- 猫叫：7 个预设（meows/meow1~7.m4a）+ 用户自定义导入 ----
  let meowCfg = { meow: 'preset1', customMeowFile: null, _userData: '' };
  const audioCache = {};

  function meowSrc() {
    if (meowCfg.meow === 'custom' && meowCfg.customMeowFile) {
      return 'meow://' + encodeURIComponent(meowCfg.customMeowFile);
    }
    const n = String(meowCfg.meow || 'preset1').replace('preset', '');
    return `meows/meow${n}.m4a`;
  }

  window.playMeow = function () {
    const src = meowSrc();
    let a = audioCache[src];
    if (!a) {
      a = new Audio(src);
      a.preload = 'auto';
      audioCache[src] = a;
    }
    a.currentTime = 0;
    a.play().catch(() => { delete audioCache[src]; }); // 文件缺失时安静跳过
  };

  async function loadMeowCfg() {
    const cfg = await window.api.getConfig();
    meowCfg = { meow: cfg.meow || 'preset1', customMeowFile: cfg.customMeowFile, _userData: cfg._userData };
  }
  loadMeowCfg();

  // ---- 点击动作：duang / 扭动 / 跳起转圈 / 跳一下 / 歪头 ----
  const ACTIONS = ['duang', 'wiggle', 'spin', 'hop', 'tilt'];
  let lastAction = null;
  let sameCount = 0;

  // 动作设置页配置的启用池（null = 从未配置过 → 全开；数组 = 用户配过，空数组 = 全关）
  let enabledActions = null;
  let enabledIdles = null;
  async function loadAnimPools() {
    const cfg = await window.api.getConfig();
    enabledActions = Array.isArray(cfg.enabledActions) ? cfg.enabledActions : null;
    enabledIdles = Array.isArray(cfg.enabledIdles) ? cfg.enabledIdles : null;
  }
  loadAnimPools();
  window.api.onPrefsChanged(loadAnimPools);   // 动作设置页改开关即时生效
  window.api.onConfigChanged(loadAnimPools);

  function pickAction() {
    const base0 = ACTIONS.filter((a) => !enabledActions || enabledActions.includes('act-' + a));
    if (enabledActions && !base0.length) return null; // 用户把点击动作全关了
    const base = base0.length ? base0 : ACTIONS;
    // 不会连续三次触发同一种：已连续两次时从候选里排除它
    let pool = base;
    if (lastAction && sameCount >= 2) {
      pool = base.filter((a) => a !== lastAction);
      if (!pool.length) pool = base; // 只剩一种时硬排除会抽空
    }
    const pick = pool[Math.floor(Math.random() * pool.length)];
    sameCount = pick === lastAction ? sameCount + 1 : 1;
    lastAction = pick;
    return pick;
  }

  // ---- 待机动作（轻柔）：伸懒腰 / 轻轻摇晃 / 左右看看 / 蜷缩打盹 ----
  // （Falldown 摔倒剪辑从本机平视角度看是脸埋进地里，观感不对，已撤出待机池）
  const IDLE_ACTIONS = ['idle-stretch', 'idle-sway', 'idle-look', 'idle-curl'];
  let lastIdle = null;

  function pickIdleAction() {
    // 不和上一次重复即可；按动作设置页的启用池过滤；
    // idle-fall 只有 3D 官方剪辑，2D 模式或剪辑缺失时跳过（无对应 CSS 动画）
    const base0 = IDLE_ACTIONS.filter((a) => !enabledIdles || enabledIdles.includes(a));
    if (enabledIdles && !base0.length) return null; // 用户把待机动作全关了
    const base = base0.length ? base0 : IDLE_ACTIONS;
    let pool = base.filter((a) => a !== lastIdle);
    if (!pool.length) pool = base;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    lastIdle = pick;
    return pick;
  }

  let currentClass = null;
  function playAction(cls) {
    if (pet3dOn()) {
      // 3D 路径：pet3d.play 自动打断旧动作，结束回调替代 animationend
      currentClass = cls;
      const ok = window.pet3d.play(cls, () => {
        if (cls === 'idle-curl') window.pet3d.clearExpression();
        if (currentClass === cls) currentClass = null;
      });
      // 蜷缩打盹时闭眼（眯眼表情保持，动作结束复位）。
      // 必须在 play() 之后再设：play 打断旧动作会同步触发旧回调里的 clearExpression，
      // 先设的话新表情会被旧回调顺手清掉（连续预览打盹第二次不闭眼的原因）
      if (ok && cls === 'idle-curl') window.pet3d.setExpression('CloseEye');
      return;
    }
    if (currentClass) stage.classList.remove(currentClass);
    void stage.offsetWidth; // 强制重排以重启动画
    stage.classList.add(cls);
    currentClass = cls;
  }

  window.cakeAction = function () {
    const a = pickAction();
    if (a) playAction('act-' + a); // 点击动作全关时跳过动作，保留轮廓光/猫叫/台词反馈
  };
  // 动作设置页的「预览」：立即做一次该动作
  window.api.onAnimPreview((name) => playAction(name));
  // 动作动画播完就摘掉类（影子的动画结束事件也会冒泡到这里，只认 #cake 上的）
  img.addEventListener('animationend', (e) => {
    if (currentClass && e.target === img && e.animationName !== 'float') {
      stage.classList.remove(currentClass);
      currentClass = null;
    }
  });

    // ---- 待机随机自动动作：每 9~22 秒自己做个轻柔动作 ----
  function scheduleIdle() {
    const delay = 9000 + Math.random() * 13000;
    setTimeout(() => {
      if (!document.hidden && !currentClass) {
        const a = pickIdleAction();
        if (a) playAction(a); // 待机动作全关时安静待着
      }
      scheduleIdle();
    }, delay);
  }
  scheduleIdle();

  // 切换形象（id 形如 'cake07'），轮廓光蒙版同步换
  // 2D 图片目录：'2d-art' 用官方侧视立绘（cakes-art/），'2d' 用模型正面渲染图（cakes/）；
  // 立绘只有 27 只（cake28/29 是新猫），缺失时一次性回退到正视图
  let art2d = false;
  function cakeImgUrl(id) { return (art2d ? 'cakes-art/' : 'cakes/') + id + '.webp'; }

  window.setCake = function (id) {
    const url = cakeImgUrl(id);
    img.onload = buildAlphaMap;
    img.onerror = () => { img.onerror = null; img.src = `cakes/${id}.webp`; };
    img.src = url;
    window.currentCakeId = id;
    if (window.pet3d) window.pet3d.setCake(id); // 3D 层换模型（内部判 available）
    const cssUrl = `url("${url}")`;
    edgeGlow.style.webkitMaskImage = cssUrl;
    edgeGlow.style.maskImage = cssUrl;
  };

  // ---- 像素级命中检测：只有点在猫猫糕本体（非透明像素）上才算点中 ----
  let alphaData = null;
  let alphaW = 0, alphaH = 0;

  function buildAlphaMap() {
    try {
      const w = img.naturalWidth, h = img.naturalHeight;
      if (!w || !h) return;
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const cx = c.getContext('2d', { willReadFrequently: true });
      cx.drawImage(img, 0, 0);
      alphaData = cx.getImageData(0, 0, w, h);
      alphaW = w; alphaH = h;
    } catch {
      alphaData = null; // 读取失败时退化为矩形判定
    }
  }

  window.cakeHitTest = function (clientX, clientY) {
    if (pet3dOn()) return window.pet3d.hitTest(clientX, clientY); // 3D：Raycaster 精判
    const rect = img.getBoundingClientRect();
    if (clientX < rect.left || clientX > rect.right ||
        clientY < rect.top || clientY > rect.bottom) return false;
    if (!alphaData) return true; // 矩形范围内都算
    const px = Math.floor((clientX - rect.left) / rect.width * alphaW);
    const py = Math.floor((clientY - rect.top) / rect.height * alphaH);
    return alphaData.data[(py * alphaW + px) * 4 + 3] > 40;
  };

  // ---- 流光颜色 ----
  const GLOW_COLORS = {
    rainbow: '#ffd54f, #ff8fa3, #80deea, #b39dff, #ffd54f',
    gold: '#fff3b0, #ffd54f, #ff9e3d, #fff3b0',
    pink: '#ffd6e8, #ff8fb3, #ff5c8a, #ffd6e8',
    ice: '#d0f4ff, #7fd8ff, #4aa8ff, #d0f4ff',
    purple: '#e6d6ff, #b39dff, #7c5cff, #e6d6ff',
  };
  function applyGlowColor(name) {
    if (window.pet3d) window.pet3d.setGlowColor(name); // 3D 层同步换色
    const stops = GLOW_COLORS[name] || GLOW_COLORS.rainbow;
    edgeGlow.style.background = `conic-gradient(from var(--ga), ${stops})`;
  }

  // 启动时读取配置里的形象和颜色
  window.api.getConfig().then((cfg) => {
    art2d = cfg.renderMode === '2d-art';
    window.setCake(cfg.cake || 'cake01');
    applyGlowColor(cfg.glowColor);
  });

  // 设置里改了偏好（如流光颜色、叫声、2D 立绘/正视切换）
  window.api.onPrefsChanged((cfg) => {
    applyGlowColor(cfg.glowColor);
    loadMeowCfg();
    const a = cfg.renderMode === '2d-art';
    if (a !== art2d) { // 2D 立绘/正视切换：换当前猫的图片源（3D 模式下 img 不可见，换了也无害）
      art2d = a;
      if (window.currentCakeId) window.setCake(window.currentCakeId);
    }
  });

  // ---- 窗口大小：3D 模式 canvas 铺满窗口、#app 恒不缩放（pet3d 驱动）；
  // 2D 兜底保留旧体系：基准容器整体 scale，内部元素相对位置不变，缩放后重贴窗口 ----
  let curPetSize = 240;
  function applyZoom(px) {
    curPetSize = px || 240;
    const app = document.getElementById('app');
    if (pet3dOn()) {
      app.style.transform = 'none'; // 3D：#app 不缩放不平移，覆盖物相对窗口定位
      return;
    }
    app.style.transform = `scale(${curPetSize / 240})`;
    if (window.pet3d && window.pet3d.refreshShape2D) window.pet3d.refreshShape2D();
  }
  window.cakeApplyZoom = () => applyZoom(curPetSize); // WebGL 上下文丢失回退 2D 时恢复 scale 用
  window.api.getConfig().then((cfg) => applyZoom(cfg.petSize));
  window.api.onSizeChanged((px) => applyZoom(px));

  // 选择器里换了形象
  window.api.onCakeChanged((id) => window.setCake(id));
})();
