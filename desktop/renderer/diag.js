// 诊断日志采集（设置页「记录诊断数据」开关）：开着才记录，主进程写 userData/diag.log
// 采集内容：未捕获错误/Promise 拒绝、GL 渲染器与性能模式基线、每 15s 真实帧率/内存采样、开关热切换
(function () {
  let enabled = false, samplerStarted = false;
  const log = (msg) => { if (enabled) window.api.diagLog(msg); };

  window.addEventListener('error', (e) => log(`[error] ${e.message} @ ${e.filename}:${e.lineno}`));
  window.addEventListener('unhandledrejection', (e) => log(`[unhandledrejection] ${String(e.reason).slice(0, 500)}`));

  function startSampler() {
    if (samplerStarted) return;
    samplerStarted = true;
    log(`[diag] ==== 诊断记录中（UA: ${navigator.userAgent}）====`);
    const waitPet = () => {
      if (!window.pet3d) return setTimeout(waitPet, 1000);
      window.pet3d.ready.then(() => {
        const d = window.pet3d.debugInfo();
        log(`[diag] GL: ${d.glRenderer} | softGL=${d.softGL} perfMode=${d.perfMode} eff=${d.effMode} ssaa=${d.effSSAA} fpsCap=${d.fpsCap} renderMode=${window.pet3d.renderMode}`);
        let last = d.frameCount;
        setInterval(() => {
          const dd = window.pet3d.debugInfo();
          const fps = ((dd.frameCount - last) / 15).toFixed(1);
          last = dd.frameCount;
          const mem = performance.memory ? ` mem=${(performance.memory.usedJSHeapSize / 1048576).toFixed(0)}MB` : '';
          log(`[diag] fps=${fps} eff=${dd.effMode} ssaa=${dd.effSSAA} cap=${dd.fpsCap} mode=${window.pet3d.renderMode}${mem}`);
        }, 15000);
      });
    };
    waitPet();
  }

  function applyFlag(v) {
    const was = enabled;
    enabled = v === true;
    if (enabled && !was) startSampler(); // 开关热切换：开着才启动采样，关了 log() 自然静默
  }

  window.api.getConfig().then((cfg) => applyFlag(cfg.diagLog));
  window.api.onPrefsChanged((cfg) => { if (cfg.diagLog != null) applyFlag(cfg.diagLog); });
})();
