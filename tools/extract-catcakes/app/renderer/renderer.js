// 猫猫糕提取工具 - 渲染进程
const $ = (id) => document.getElementById(id);

let asbDir = null;
let running = false;

const STEPS_COUNT = 5;

function setCheck(id, state, detail) {
  const li = $(id);
  li.classList.remove('ok', 'fail');
  const icon = li.querySelector('.icon');
  if (state === 'ok') { li.classList.add('ok'); icon.textContent = '✅'; }
  else if (state === 'fail') { li.classList.add('fail'); icon.textContent = '❌'; }
  else if (state === 'unknown') { icon.textContent = '❔'; }
  else { icon.textContent = '⏳'; }
  if (detail !== undefined) li.querySelector('.detail').textContent = detail || '';
}

function appendLog(text) {
  const box = $('logbox');
  const div = document.createElement('div');
  div.textContent = text;
  box.appendChild(div);
  while (box.childElementCount > 800) box.removeChild(box.firstChild);
  box.scrollTop = box.scrollHeight;
}

function showDirResult(r) {
  const el = $('dir-result');
  el.classList.remove('hidden', 'err');
  if (!r.ok) {
    if (r.cancelled) { el.classList.add('hidden'); return; }
    el.classList.add('err');
    el.textContent = `❌ ${r.error}`;
    asbDir = null;
    updateStartBtn();
    return;
  }
  asbDir = r.path;
  el.textContent = `✅ ${r.path}（找到 ${r.blockCount} 个 .block 文件${r.adjusted ? '，已自动定位到 Asb\\Windows 层' : ''}）`;
  runPrecheck();
}

async function runPrecheck() {
  setCheck('chk-dotnet', 'wait');
  setCheck('chk-disk', 'wait');
  setCheck('chk-tools', 'wait');
  const r = await window.api.precheck(asbDir);

  setCheck('chk-dotnet', r.dotnet.ok ? 'ok' : 'fail', r.dotnet.detail);
  $('dotnet-fix').classList.toggle('hidden', r.dotnet.ok);

  if (r.disk.freeGB === null) setCheck('chk-disk', 'unknown', '无法检测');
  else setCheck('chk-disk', r.disk.ok ? 'ok' : 'fail', `剩余约 ${r.disk.freeGB} GB`);

  setCheck('chk-tools', r.tools.ok ? 'ok' : 'fail', r.tools.detail);
  updateStartBtn();
}

function updateStartBtn() {
  // 磁盘检测失败不阻塞；dotnet 缺失、目录未选时阻塞
  const dotnetOk = $('chk-dotnet').classList.contains('ok');
  $('btn-start').disabled = running || !asbDir || !dotnetOk;
}

function parseFilters() {
  const raw = $('filters').value.trim();
  if (!raw) return null; // 用默认
  return raw.split('\n').map((s) => s.trim()).filter(Boolean);
}

function resetSteps() {
  document.querySelectorAll('#steps li').forEach((li) => li.dataset.status = 'wait');
}

function setRunning(on) {
  running = on;
  $('btn-start').disabled = on || !asbDir;
  $('btn-cancel').classList.toggle('hidden', !on);
  $('progress-wrap').classList.toggle('hidden', !on);
}

function showDone(evt) {
  setRunning(false);
  const card = $('card-done');
  card.classList.remove('hidden');
  const body = $('done-body');
  if (evt.ok) {
    $('done-title').innerHTML = '<span class="badge">4</span> 🎉 提取完成！';
    body.innerHTML =
      `<p>成功转换 <span class="stat">${evt.stats.ok}</span> 个 GLB` +
      (evt.stats.bad ? `，失败 <span class="stat">${evt.stats.bad}</span> 个（原始 FBX 已保留）` : '') +
      (evt.stats.animCount ? `，另导出 <span class="stat">${evt.stats.animCount}</span> 个 .anim 动画文件（已一并打包）` : '') + '。</p>' +
      `<p>请把 <code>output\\catcakes-glb.zip</code> 发回给作者${evt.stats.bad ? '，output\\catcakes-glb 文件夹一并发回更好' : ''}。</p>`;
  } else if (evt.cancelled) {
    $('done-title').innerHTML = '<span class="badge">4</span> ⏸ 已取消';
    body.innerHTML = '<p>已取消。下次点「开始提取」会自动从断点继续。</p>';
  } else {
    $('done-title').innerHTML = '<span class="badge">4</span> 😿 出错了';
    body.innerHTML =
      `<div class="err-text">${escapeHtml(evt.error || '未知错误')}</div>` +
      '<p style="margin-top:8px">请点「复制诊断信息」或「导出诊断包」，连同日志一起发回给作者。</p>';
  }
  card.scrollIntoView({ behavior: 'smooth' });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- 事件绑定 ----------

$('btn-choose').onclick = async () => showDirResult(await window.api.chooseDir());
$('btn-autofind').onclick = async () => {
  $('dir-result').classList.remove('hidden', 'err');
  $('dir-result').textContent = '🔍 正在扫描常见安装路径…';
  showDirResult(await window.api.autoFind());
};

$('btn-winget').onclick = async () => {
  $('btn-winget').disabled = true;
  appendLog('[操作] 开始用 winget 安装 .NET 9 运行时…');
  const r = await window.api.installDotnet();
  $('btn-winget').disabled = false;
  if (r.ok) {
    setCheck('chk-dotnet', 'ok', '已安装 .NET 9 运行时');
    $('dotnet-fix').classList.add('hidden');
  } else {
    setCheck('chk-dotnet', 'fail', r.error || '安装失败');
  }
  updateStartBtn();
};

$('btn-dotnet-page').onclick = () => window.api.openDotnetPage();

$('btn-start').onclick = async () => {
  resetSteps();
  $('card-done').classList.add('hidden');
  $('recon-warning').classList.add('hidden');
  setRunning(true);
  const r = await window.api.start({ asbDir, filters: parseFilters() });
  if (!r.ok) { setRunning(false); appendLog(`[错误] ${r.error}`); }
};

$('btn-cancel').onclick = async () => {
  $('btn-cancel').disabled = true;
  await window.api.cancel();
  $('btn-cancel').disabled = false;
};

$('btn-recon-continue').onclick = () => {
  $('recon-warning').classList.add('hidden');
  window.api.reconChoice('continue');
};
$('btn-recon-diag').onclick = () => {
  $('recon-warning').classList.add('hidden');
  window.api.reconChoice('diag');
};

$('btn-open-output').onclick = () => window.api.openOutput();
$('btn-copy-diag').onclick = async (e) => {
  await window.api.copyDiagnostics();
  e.target.textContent = '✅ 已复制';
  setTimeout(() => { e.target.textContent = '📋 复制诊断信息'; }, 1500);
};
$('btn-export-diag').onclick = async (e) => {
  const p = await window.api.exportDiagnostics();
  e.target.textContent = '✅ 已导出到 output';
  appendLog(`[操作] 诊断包已导出：${p}`);
  setTimeout(() => { e.target.textContent = '🩺 导出诊断包'; }, 2000);
};

$('btn-crash-diag').onclick = async (e) => {
  const p = await window.api.exportDiagnostics();
  e.target.textContent = '✅ 已导出到 output';
  appendLog(`[操作] 诊断包已导出：${p}`);
  setTimeout(() => { e.target.textContent = '🩺 导出诊断包'; }, 2000);
};

// ---------- 主进程事件 ----------

window.api.onEvent((evt) => {
  switch (evt.type) {
    case 'log':
      appendLog(evt.text);
      break;
    case 'step': {
      const li = document.querySelector(`#steps li[data-step="${evt.index}"]`);
      if (li) li.dataset.status = evt.status;
      break;
    }
    case 'step-fail': {
      const cur = document.querySelector('#steps li[data-status="run"]');
      if (cur) cur.dataset.status = 'fail';
      break;
    }
    case 'progress': {
      const wrap = $('progress-wrap');
      const bar = $('progress-bar');
      wrap.classList.remove('hidden');
      if (evt.value === null || evt.value === undefined) {
        wrap.querySelector('.progress').classList.add('indeterminate');
      } else {
        wrap.querySelector('.progress').classList.remove('indeterminate');
        bar.style.width = `${Math.round(evt.value * 100)}%`;
      }
      $('progress-text').textContent = evt.text || '';
      break;
    }
    case 'recon-warning':
      $('recon-count').textContent = evt.hitCount;
      $('recon-warning').classList.remove('hidden');
      $('recon-warning').scrollIntoView({ behavior: 'smooth' });
      break;
    case 'last-crash':
      $('crash-banner').classList.remove('hidden');
      break;
    case 'done':
      showDone(evt);
      updateStartBtn();
      break;
  }
});

// ---------- 启动 ----------

(async () => {
  resetSteps();
  // 断点续跑提示
  const items = await window.api.detectResume();
  if (items.length) {
    $('resume-banner').classList.remove('hidden');
    $('resume-items').textContent = items.join('、');
  }
  // 启动即跑一次预检（工具/dotnet 与目录无关）
  runPrecheck();
})();
