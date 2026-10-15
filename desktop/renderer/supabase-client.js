// Supabase 连接与消息接收：订阅 messages 表，收到消息后轮廓光 + 气泡 + 系统通知
(function () {
  let supabase = null;
  let channel = null;
  let myId = null;
  let hintDismissed = false;

  const hint = document.getElementById('hint');
  const hintText = document.getElementById('hintText');
  const hintClose = document.getElementById('hintClose');
  const bubble = document.getElementById('bubble');
  let bubbleTimer = null;

  function showHint(msg, respectDismiss) {
    if (respectDismiss && hintDismissed) return;
    hintText.textContent = msg;
    hint.style.display = 'flex';
  }
  function hideHint() {
    hint.style.display = 'none';
  }

  // 关闭叉：记住选择，以后不再提示（连接错误仍会提示）
  hintClose.onclick = () => {
    hintDismissed = true;
    hideHint();
    window.api.dismissHint();
  };

  function showBubble(text, ms) {
    bubble.textContent = text;
    bubble.classList.add('show');
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(() => bubble.classList.remove('show'), ms || 5000);
  }

  // 暴露给 interact.js（本地点击猫猫糕时触发）
  window.showPetBubble = showBubble;

  async function notify(title, body) {
    try {
      if (Notification.permission === 'granted') {
        new Notification(title, { body });
      } else if (Notification.permission !== 'denied') {
        const p = await Notification.requestPermission();
        if (p === 'granted') new Notification(title, { body });
      }
    } catch { /* 通知失败不影响轮廓光 */ }
  }

  async function senderName(id) {
    const { data } = await supabase.from('profiles').select('username').eq('id', id).maybeSingle();
    return data ? data.username : '有人';
  }

  async function onMessage(row) {
    if (!row || row.sender_id === myId) return; // 自己发的不重复提醒
    // 免打扰：收到消息静默处理
    const cfg = await window.api.getConfig();
    if (cfg.dnd === true) return;
    const name = await senderName(row.sender_id);
    const pet = window.pet3d && window.pet3d.available ? window.pet3d : null;
    if (row.kind === 'blink') {
      // 戳一戳 = 被打的反应（Hit）+ 眯眼笑 2.5s；Hit 剪辑缺失或 2D 模式时退回随机动作
      if (pet && pet.play('Hit')) {
        pet.setExpression('CloseEye');
        setTimeout(() => pet.clearExpression(), 2500);
      } else if (window.cakeAction) window.cakeAction();
      window.playMeow();
      window.cakeGlow(3000);
      showBubble(`✨ ${name} 戳了戳你`, 4000);
      notify('桌宠猫猫糕', `${name} 向你发送了提醒`);
    } else {
      // 收到文字消息 = 说话动作（Talk01）；剪辑缺失或 2D 模式退回随机动作
      if (!pet || !pet.play('Talk01')) { if (window.cakeAction) window.cakeAction(); }
      window.playMeow();
      window.cakeGlow(2000);
      showBubble(`${name}: ${row.content}`, 8000);
      notify(`桌宠猫猫糕 - ${name}`, row.content);
    }
  }

  // 连接序号锁：每次 connect 自增，await 后若序号已过期说明有更新的连接在进行，
  // 本次直接放弃，防止旧 channel 泄漏和重复订阅
  let connectSeq = 0;

  async function connect() {
    const seq = ++connectSeq;
    const stale = () => seq !== connectSeq;

    // 清理旧连接
    if (channel && supabase) { try { await supabase.removeChannel(channel); } catch {} }
    channel = null;
    if (stale()) return;

    // CDN 加载失败时 window.supabase 不存在，提示而不是静默崩
    if (!window.supabase) {
      showHint('网络异常，supabase 加载失败', false);
      return;
    }

    const cfg = await window.api.getConfig();
    if (stale()) return;
    hintDismissed = cfg.hintDismissed === true;

    if (!cfg.supabaseUrl || !cfg.anonKey) {
      showHint('未连接服务器：右键 → 登录 / 服务器', true);
      return;
    }

    supabase = window.supabase.createClient(cfg.supabaseUrl, cfg.anonKey);

    // 恢复登录态
    const { data: { session } } = await supabase.auth.getSession();
    if (stale()) return;
    if (!session) {
      showHint('未登录：右键 → 登录 / 服务器', true);
      return;
    }
    myId = session.user.id;
    hideHint();

    // 订阅消息表（公共频道；服务器开了 Realtime 授权时不推，由下方轮询兜底）
    channel = supabase
      .channel('pet-messages')
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => onMessage(payload.new))
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          showHint('连接中断，重试中…', false);
        } else if (status === 'SUBSCRIBED') {
          hideHint();
        }
      });

    // 轮询兜底：Realtime 不可用时也能收到消息（5 秒一次，轻量索引查询）
    // seenIds 同时给 realtime 和轮询去重，避免重复提醒
    const seenIds = new Set();
    const rawOnMessage = onMessage;
    onMessage = (row) => {
      if (!row || seenIds.has(row.id)) return;
      seenIds.add(row.id);
      if (seenIds.size > 500) seenIds.delete(seenIds.values().next().value);
      rawOnMessage(row);
    };
    let pollTs = new Date().toISOString();
    setInterval(async () => {
      if (!supabase || !myId) return;
      try {
        const { data } = await supabase.from('messages').select()
          .gt('created_at', pollTs).order('created_at');
        if (data && data.length) {
          pollTs = data[data.length - 1].created_at;
          for (const m of data) onMessage(m);
        }
      } catch { /* 网络抖动忽略，下一轮再说 */ }
    }, 5000);
  }

  // 登录页登录成功后，主进程会转发 session 过来
  window.api.onSession(async (session) => {
    if (!supabase) { await connect(); return; }
    await supabase.auth.setSession(session);
    connect();
  });

  window.api.onConfigChanged(() => connect());

  connect();
})();
