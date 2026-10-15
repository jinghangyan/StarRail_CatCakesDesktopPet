// 窗口交互：透明区域鼠标穿透（点到下面的应用）；悬停猫猫糕本体才可交互；
// 拖动移动窗口；右下角手柄拉伸调大小；原地点击 → 动作 + 轮廓光 + 猫叫 + 台词
(function () {
  let dragging = false;
  let moved = false;
  let rotating = false; // Shift+拖动 = 旋转观看角度
  let rotateYaw0 = 0, rotatePitch0 = 0;
  let startX = 0, startY = 0;
  let lastX = 0, lastY = 0;

  // 拉伸状态（位移量由主进程跟踪光标计算，渲染进程不碰屏幕坐标）
  const resizer = document.getElementById('resizer');
  const hint = document.getElementById('hint');
  let resizing = false;

  // 手柄默认隐藏，配置开启才显示
  window.api.getConfig().then((cfg) => {
    if (cfg.resizeHandle) resizer.style.display = 'block';
  });
  window.api.onResizerToggle((on) => {
    resizer.style.display = on ? 'block' : 'none';
  });

  // ---- 鼠标穿透：只有悬停在可交互区域（猫猫糕本体 / 手柄 / 提示条）才接收鼠标 ----
  let ignoring = null; // null=未知 true=穿透中 false=接收中

  function inRect(el, x, y) {
    if (!el || getComputedStyle(el).display === 'none') return false;
    const r = el.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }

  function setIgnore(ig) {
    if (ignoring === ig) return;
    ignoring = ig;
    window.api.setMouseIgnore(ig);
    window.api.debugLog(`[ignore] -> ${ig} (dragging=${dragging} resizing=${resizing})`);
  }

  function updateIgnore(e) {
    // 拖动/拉伸过程中必须保持接收，否则窗口会丢鼠标
    if (dragging || resizing) { setIgnore(false); return; }
    const hit = (window.cakeHitTest && window.cakeHitTest(e.clientX, e.clientY)) ||
      inRect(resizer, e.clientX, e.clientY) ||
      inRect(hint, e.clientX, e.clientY);
    setIgnore(!hit);
  }

  resizer.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    e.stopPropagation(); // 不触发窗口拖动
    resizing = true;
    window.api.resizeBegin();
  });

  window.addEventListener('mousemove', (e) => {
    // 手势看门狗：拖动/拉伸中丢了 mouseup（窗口从光标下滑走、菜单模态吞掉等）时，
    // 下一次「无按键」的 mousemove 强制收尾——僵尸手势会让猫跟着光标满屏跑
    if ((dragging || resizing) && e.buttons === 0) {
      window.api.debugLog('[watchdog] 手势进行中但 buttons=0，强制复位');
      resetGesture();
    }
    updateIgnore(e);
    if (resizing) window.api.resizeMove(); // 位移量主进程从光标算（缩放屏单位闭环）
  });

  window.addEventListener('mouseup', () => {
    if (resizing) {
      resizing = false;
      window.api.resizeEnd(); // 松手才存配置
    }
  });

  // 当前猫猫糕的台词（自定义优先，其次专属默认，最后通用默认）
  let phrases = (window.PET_PHRASES && window.PET_PHRASES._default) || ['喵~'];

  async function loadPhrases() {
    const cfg = await window.api.getConfig();
    const id = window.currentCakeId || 'cake01';
    const custom = cfg.phrases && cfg.phrases[id];
    const specific = window.PET_PHRASES && window.PET_PHRASES[id];
    phrases = (custom && custom.length) ? custom
      : (specific && specific.length) ? specific
      : window.PET_PHRASES._default;
  }
  loadPhrases();
  window.api.onConfigChanged(loadPhrases); // 台词编辑器保存后刷新
  window.api.onCakeChanged(loadPhrases);   // 换猫后刷新

  function randomPhrase() {
    return phrases[Math.floor(Math.random() * phrases.length)];
  }

  window.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || e.target === resizer) return; // 右键留给菜单，手柄走拉伸
    // 只认点在猫本体上的按下：右键菜单开关 / 其它窗口（设置、联机）叠盖时，窗口可能
    // 短暂处于接收态，误落在透明区域的 mousedown 不能再把猫拖走（bug：右键后拖别的窗口猫跟着动）
    if (window.cakeHitTest && !window.cakeHitTest(e.clientX, e.clientY)) {
      window.api.debugLog(`[mousedown-reject] ${e.clientX},${e.clientY} 未命中（接收态但点在透明区）`);
      return;
    }
    window.api.debugLog(`[mousedown-accept] ${e.clientX},${e.clientY} shift=${e.shiftKey}`);
    // Shift+左键 = 旋转观看角度（3D 模式下）；普通左键 = 拖动窗口
    rotating = e.shiftKey && !!(window.pet3d && window.pet3d.available);
    if (rotating) {
      const v = window.pet3d.getViewAngle();
      rotateYaw0 = v.yaw;
      rotatePitch0 = v.pitch;
    }
    dragging = true;
    moved = false;
    startX = lastX = e.screenX;
    startY = lastY = e.screenY;
    if (!rotating) window.api.dragBegin(); // 主进程记录光标起点（位移主进程算）
  });

  window.addEventListener('mousemove', (e) => {
    if (!dragging || resizing) return;
    const totalDx = e.screenX - startX;
    const totalDy = e.screenY - startY;
    if (!moved && Math.abs(totalDx) + Math.abs(totalDy) > 6) {
      moved = true;
      // 开始拖着走（非旋转）：播官方移动动画（MoveAS→Move 循环）
      if (!rotating && window.pet3d && window.pet3d.available) window.pet3d.dragStart();
    }
    if (moved) {
      if (rotating) {
        // 旋转模型：横向 yaw 自由，纵向 pitch 由 pet3d 限制 ±30°
        window.pet3d.setViewAngle(rotateYaw0 + totalDx * 0.01, rotatePitch0 + totalDy * 0.01);
      } else {
        // 窗口位移由主进程跟踪光标计算（缩放屏下两边坐标单位可能不一致）
        window.api.dragMove();
        // 通知 3D 层还在动（拖静止超时它会自己停走路循环）
        if (window.pet3d && window.pet3d.dragPulse) window.pet3d.dragPulse();
      }
    }
    lastX = e.screenX;
    lastY = e.screenY;
  });

  window.addEventListener('mouseup', (e) => {
    // 旋转拖动结束：持久化视角；Shift+按下不算点击（不触发动作）
    if (rotating) {
      if (moved) window.pet3d.saveViewAngle();
      rotating = false;
      dragging = false;
      return;
    }
    // 主进程光标跟踪收尾
    if (dragging) window.api.dragEnd();
    // 拖着走结束：回 StandBy
    if (moved && window.pet3d && window.pet3d.available) window.pet3d.dragEnd();
    // 原地点击且点在猫猫糕本体上（透明区域已穿透，不会收到事件）
    if (dragging && !moved && !resizing &&
        (!window.cakeHitTest || window.cakeHitTest(e.clientX, e.clientY))) {
      // 随机动作 + 轮廓光 + 猫叫 + 专属台词
      window.cakeAction();
      window.cakeGlow(1500);
      window.playMeow();
      window.showPetBubble(randomPhrase(), 2000);
    }
    dragging = false;
  });

  // 状态硬化：窗口失焦 / 右键菜单弹出时，可能错过 mouseup（菜单模态吞掉），
  // 不把拖动/拉伸/旋转状态带出本次手势，避免「右键后拖别的窗口猫跟着动」
  function resetGesture() {
    if (dragging && !rotating) window.api.dragEnd();
    if (resizing) window.api.resizeEnd();
    dragging = resizing = rotating = false;
    moved = false;
  }
  window.addEventListener('blur', resetGesture);
  window.addEventListener('contextmenu', resetGesture);

  // 验收/排查用：当前手势状态
  window.__interactDebug = () => ({ dragging, resizing, rotating, moved });

  // 双击重置观看角度（会连带触发两次点击动作，桌宠场景下无伤大雅，不做去抖保住点击即时反馈）
  window.addEventListener('dblclick', (e) => {
    if (window.pet3d && window.pet3d.available &&
        (!window.cakeHitTest || window.cakeHitTest(e.clientX, e.clientY))) {
      window.pet3d.resetView();
    }
  });
})();
