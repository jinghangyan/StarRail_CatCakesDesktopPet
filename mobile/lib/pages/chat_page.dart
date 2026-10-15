import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../api.dart';
import '../errors.dart';

/// 聊天页：私信（dm）或群聊（group）
/// 微信式分页：先进最近 30 条，滚到顶部再往前翻；
/// 看过的消息全部存档在本地，服务器清理旧消息后仍可从本地回看。
class ChatPage extends StatefulWidget {
  final String targetType; // 'dm' | 'group'
  final String targetId;
  final String title;
  final String? peerId; // dm 时的对方 id

  const ChatPage._({
    required this.targetType,
    required this.targetId,
    required this.title,
    this.peerId,
  });

  factory ChatPage.dm({required String peerId, required String peerName}) =>
      ChatPage._(targetType: 'dm', targetId: peerId, title: peerName, peerId: peerId);

  factory ChatPage.group({required String groupId, required String groupName}) =>
      ChatPage._(targetType: 'group', targetId: groupId, title: groupName);

  @override
  State<ChatPage> createState() => _ChatPageState();
}

class _ChatPageState extends State<ChatPage> {
  static const int pageSize = 30;

  final _input = TextEditingController();
  final _scroll = ScrollController();
  final List<Map<String, dynamic>> _msgs = []; // 按时间升序
  final Set<dynamic> _ids = {};
  Map<String, String> _names = {};
  bool _sendingBlink = false;
  bool _loadingMore = false;
  bool _noMore = false; // 服务器和本地都没有更早的了
  RealtimeChannel? _channel;

  String get _archiveKey => 'chat_${widget.targetType}_${widget.targetId}';

  @override
  void initState() {
    super.initState();
    _init();
    _scroll.addListener(_onScroll);
  }

  @override
  void dispose() {
    _channel?.unsubscribe();
    _chatPoll?.cancel();
    _scroll.dispose();
    _input.dispose();
    super.dispose();
  }

  bool _inConversation(Map<String, dynamic> m) {
    if (m['target_type'] != widget.targetType) return false;
    if (widget.targetType == 'group') return m['target_id'] == widget.targetId;
    final myId = Api.myIdOrNull;
    if (myId == null) return false;
    final s = m['sender_id'] as String;
    final t = m['target_id'] as String;
    return (s == myId && t == widget.peerId) ||
        (s == widget.peerId && t == myId);
  }

  // ---------- 本地存档 ----------

  Future<List<Map<String, dynamic>>> _loadArchive() async {
    final p = await SharedPreferences.getInstance();
    final raw = p.getString(_archiveKey);
    if (raw == null) return [];
    try {
      return List<Map<String, dynamic>>.from(jsonDecode(raw) as List);
    } catch (_) {
      return [];
    }
  }

  Future<void> _saveArchive() async {
    final p = await SharedPreferences.getInstance();
    // 上限 2000 条，防无限膨胀
    final list = _msgs.length > 2000 ? _msgs.sublist(_msgs.length - 2000) : _msgs;
    await p.setString(_archiveKey, jsonEncode(list));
  }

  // ---------- 加载 ----------

  Timer? _chatPoll;

  Future<void> _init() async {
    _loadNames();
    // 1. 先上本地存档（秒开）
    final archive = await _loadArchive();
    if (!mounted) return;
    for (final m in archive) {
      if (_ids.add(m['id'])) _msgs.add(m);
    }
    setState(() {});
    // 2. 先订阅新消息（订阅先于拉取，靠 _ids 去重，避免两者之间的消息缺口）
    if (!mounted) return;
    _subscribeChat();
    // 3. 拉服务器最新一页（不带 created_at 过滤，_ids 去重合并）
    await _loadMore(initial: true);
    // 4. 轮询兜底（Realtime 不推时 3 秒内也能收到）
    _chatPoll = Timer.periodic(const Duration(seconds: 3), (_) async {
      if (!mounted || _msgs.isEmpty) return;
      final myId = Api.myIdOrNull;
      if (myId == null) return;
      try {
        final rows = await Api.sb
            .from('messages')
            .select()
            .gt('created_at', _msgs.last['created_at'] as String)
            .order('created_at');
        for (final m in rows) {
          if (!mounted) return;
          if (_inConversation(m) && _ids.add(m['id'])) {
            setState(() => _msgs.add(m));
            _maybeFetchName(m['sender_id'] as String);
            _saveArchive();
          }
        }
      } catch (_) {/* 网络抖动忽略 */}
    });
  }

  // 公共频道订阅；服务器开了 Realtime 授权时不推消息，由轮询兜底
  void _subscribeChat() {
    if (!mounted) return;
    _channel = Api.sb
        .channel('chat-${DateTime.now().millisecondsSinceEpoch}')
        .onPostgresChanges(
          event: PostgresChangeEvent.insert,
          schema: 'public',
          table: 'messages',
          callback: (payload) {
            if (!mounted) return;
            final m = payload.newRecord;
            if (_inConversation(m) && _ids.add(m['id'])) {
              setState(() => _msgs.add(m));
              _maybeFetchName(m['sender_id'] as String);
              _saveArchive();
            }
          },
        )
        .subscribe();
  }

  Future<void> _loadNames() async {
    final myId = Api.myIdOrNull;
    if (myId == null) return;
    final ids = <String>{myId};
    if (widget.peerId != null) ids.add(widget.peerId!);
    final names = await Api.usernamesOf(ids);
    if (mounted) setState(() => _names = names);
  }

  void _maybeFetchName(String id) {
    if (_names.containsKey(id)) return;
    Api.usernamesOf({id}).then((more) {
      if (mounted && more.isNotEmpty) setState(() => _names.addAll(more));
    });
  }

  /// 往前翻一页：问服务器要更早的；服务器没有了就标记到头
  /// （存档已在 _init 全量合并，本地无更多可补）
  Future<void> _loadMore({bool initial = false}) async {
    if (_loadingMore || (_noMore && !initial)) return;
    _loadingMore = true;
    try {
      final myId = Api.myIdOrNull;
      if (myId == null) return;
      // 过滤下推到服务端（postgrest 要求过滤方法在 .order() 之前调用）
      var query =
          Api.sb.from('messages').select().eq('target_type', widget.targetType);
      if (widget.targetType == 'group') {
        query = query.eq('target_id', widget.targetId);
      } else {
        // dm：我和对方之间的消息
        final peerId = widget.peerId!;
        query = query.or(
            'and(sender_id.eq.$myId,target_id.eq.$peerId),and(sender_id.eq.$peerId,target_id.eq.$myId)');
      }
      // 翻页才带 lt 往旧拉；initial 拉的是最新一页，不带 created_at 过滤
      if (!initial && _msgs.isNotEmpty) {
        query = query.lt('created_at', _msgs.first['created_at'] as String);
      }
      final rows = List<Map<String, dynamic>>.from(
          await query.order('created_at', ascending: false).limit(pageSize));
      if (!mounted) return;
      setState(() {
        final fresh = rows.reversed.where((m) => _ids.add(m['id'])).toList();
        if (initial) {
          // 最新一页合并到末尾，保持整体按时间升序
          _msgs.addAll(fresh);
          if (fresh.isNotEmpty) {
            _msgs.sort((a, b) => (a['created_at'] as String)
                .compareTo(b['created_at'] as String));
          }
        } else {
          _msgs.insertAll(0, fresh);
        }
        // 用原始返回行数判断服务器是否没有更多了
        if (rows.length < pageSize) _noMore = true;
      });
      for (final m in rows) {
        _maybeFetchName(m['sender_id'] as String);
      }
      if (rows.isNotEmpty) _saveArchive();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(friendlyError(e))));
      }
    } finally {
      _loadingMore = false;
    }
  }

  void _onScroll() {
    // reverse 列表：滚动到「视觉顶部」= pixels 接近 maxScrollExtent
    if (_scroll.position.pixels > _scroll.position.maxScrollExtent - 60) {
      _loadMore();
    }
  }

  String _nameOf(String id) => _names[id] ?? (id == Api.myIdOrNull ? '我' : '对方');

  // ---------- 发送 ----------

  Future<void> _sendText() async {
    final text = _input.text.trim();
    if (text.isEmpty) return;
    _input.clear();
    try {
      await Api.sendText(
        targetType: widget.targetType,
        targetId: widget.targetId,
        content: text,
      );
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(friendlyError(e))));
      }
    }
  }

  Future<void> _sendBlink() async {
    if (_sendingBlink) return;
    setState(() => _sendingBlink = true);
    try {
      await Api.sendBlink(targetType: widget.targetType, targetId: widget.targetId);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('✨ 已发送闪烁提醒，对方的猫猫会一闪一闪'),
            duration: Duration(seconds: 1),
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(friendlyError(e))));
      }
    } finally {
      if (mounted) setState(() => _sendingBlink = false);
    }
  }

  // ---------- 构建 ----------

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(widget.title)),
      body: Column(
        children: [
          if (_noMore && _msgs.isNotEmpty)
            const Padding(
              padding: EdgeInsets.all(6),
              child: Text('— 没有更早的消息了 —',
                  style: TextStyle(fontSize: 11, color: Colors.grey)),
            ),
          Expanded(
            child: _msgs.isEmpty
                ? const Center(child: Text('还没有消息，发一条试试'))
                : ListView.builder(
                    controller: _scroll,
                    reverse: true, // 底部对齐，新消息在下面
                    padding: const EdgeInsets.all(12),
                    itemCount: _msgs.length,
                    itemBuilder: (ctx, i) {
                      final m = _msgs[_msgs.length - 1 - i]; // reverse 显示
                      final mine = m['sender_id'] == Api.myIdOrNull;
                      final isBlink = m['kind'] == 'blink';
                      return Align(
                        alignment:
                            mine ? Alignment.centerRight : Alignment.centerLeft,
                        child: Container(
                          margin: const EdgeInsets.symmetric(vertical: 4),
                          padding: const EdgeInsets.symmetric(
                              horizontal: 12, vertical: 8),
                          constraints: const BoxConstraints(maxWidth: 280),
                          decoration: BoxDecoration(
                            color: isBlink
                                ? Colors.amber.shade100
                                : mine
                                    ? Theme.of(context).colorScheme.primaryContainer
                                    : Theme.of(context)
                                        .colorScheme
                                        .surfaceContainerHighest,
                            borderRadius: BorderRadius.circular(14),
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              if (!mine)
                                Text(_nameOf(m['sender_id']),
                                    style: const TextStyle(
                                        fontSize: 11, color: Colors.black54)),
                              Text(isBlink
                                  ? (widget.targetType == 'group'
                                      ? '✨ 戳了戳大家'
                                      : '✨ 戳了戳${mine ? _nameOf(widget.targetId) : '你'}')
                                  : m['content'] ?? ''),
                            ],
                          ),
                        ),
                      );
                    },
                  ),
          ),
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(8, 4, 8, 8),
              child: Row(
                children: [
                  IconButton(
                    icon: _sendingBlink
                        ? const SizedBox(
                            width: 20, height: 20,
                            child: CircularProgressIndicator(strokeWidth: 2))
                        : const Text('✨', style: TextStyle(fontSize: 22)),
                    tooltip: '发送闪烁提醒',
                    onPressed: _sendBlink,
                  ),
                  Expanded(
                    child: TextField(
                      controller: _input,
                      decoration: const InputDecoration(
                        hintText: '发消息到对方的桌宠…',
                        border: OutlineInputBorder(),
                        isDense: true,
                      ),
                      onSubmitted: (_) => _sendText(),
                    ),
                  ),
                  IconButton(
                    icon: const Icon(Icons.send),
                    onPressed: _sendText,
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
