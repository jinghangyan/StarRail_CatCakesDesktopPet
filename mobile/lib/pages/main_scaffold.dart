import 'dart:async';

import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../api.dart';
import '../notify.dart';
import '../pet_events.dart';
import 'pet_page.dart';
import 'friends_tab.dart';
import 'groups_tab.dart';
import 'login_page.dart';

/// 主框架：底部导航「猫猫糕 / 好友 / 群组」，宠物页无需登录，聊天功能需要登录
class MainScaffold extends StatefulWidget {
  const MainScaffold({super.key});

  @override
  State<MainScaffold> createState() => _MainScaffoldState();
}

class _MainScaffoldState extends State<MainScaffold> {
  int _index = 0;
  RealtimeChannel? _inboxChannel;
  StreamSubscription<AuthState>? _authSub;

  /// Supabase 初始化失败（如服务器配置为空）时 instance 会抛异常，先探测
  static bool get _sbReady {
    try {
      Supabase.instance.client;
      return true;
    } catch (_) {
      return false;
    }
  }

  bool get _loggedIn =>
      _sbReady && Supabase.instance.client.auth.currentSession != null;

  @override
  void initState() {
    super.initState();
    if (!_sbReady) return;
    // 登录态变化时刷新（登录成功后好友/群组页自动解锁）
    _authSub = Supabase.instance.client.auth.onAuthStateChange.listen((_) {
      if (mounted) setState(() {});
      _syncInbox();
    });
    _syncInbox();
  }

  /// 登录后全局监听新消息：免打扰关闭时弹系统通知（App 在后台也有效）
  /// 走公共频道 + 轮询兜底（服务器开了 Realtime 授权时公共频道不推，轮询保底）
  void _syncInbox() {
    if (!_sbReady) return;
    if (_loggedIn && _inboxChannel == null) {
      _inboxChannel = Supabase.instance.client
          .channel('global-inbox-${DateTime.now().millisecondsSinceEpoch}')
          .onPostgresChanges(
            event: PostgresChangeEvent.insert,
            schema: 'public',
            table: 'messages',
            callback: (payload) => _onIncoming(payload.newRecord),
          )
          .subscribe();
      _startInboxPoll();
    } else if (!_loggedIn && _inboxChannel != null) {
      _inboxChannel!.unsubscribe();
      _inboxChannel = null;
      _inboxPoll?.cancel();
    }
  }

  Future<void> _onIncoming(Map<String, dynamic> m) async {
    final myId = Api.myIdOrNull;
    if (myId == null || m['sender_id'] == myId) return; // 未登录 / 自己发的
    if (!_seenIds.add(m['id'])) return; // realtime 和轮询去重
    if (_seenIds.length > 500) _seenIds.remove(_seenIds.first);
    final prefs = await SharedPreferences.getInstance();
    if (prefs.getBool('dnd') == true) return; // 免打扰
    final names = await Api.usernamesOf({m['sender_id'] as String});
    final who = names[m['sender_id']] ?? '有人';
    // 宠物页联动：做动作 + 流光 + 猫叫 + 气泡（和桌面端一致）
    petEventBus.value = PetEvent(who, m['kind'] as String, (m['content'] as String?) ?? '');
    if (m['kind'] == 'blink') {
      Notify.show('桌宠猫猫糕', '✨ $who 戳了戳你');
    } else {
      Notify.show(who, (m['content'] as String?) ?? '');
    }
  }

  // 轮询兜底：Realtime 不推时也能收到新消息（6 秒一次轻量查询）
  final Set<dynamic> _seenIds = {};
  Timer? _inboxPoll;
  String _pollTs = DateTime.now().toUtc().toIso8601String();

  void _startInboxPoll() {
    _inboxPoll?.cancel();
    _inboxPoll = Timer.periodic(const Duration(seconds: 6), (_) async {
      if (!_loggedIn) return;
      try {
        final rows = await Supabase.instance.client
            .from('messages')
            .select()
            .gt('created_at', _pollTs)
            .order('created_at');
        if (rows.isNotEmpty) {
          _pollTs = rows.last['created_at'] as String;
          for (final m in rows) {
            _onIncoming(m);
          }
        }
      } catch (_) {/* 网络抖动忽略 */}
    });
  }

  @override
  void dispose() {
    _authSub?.cancel();
    _inboxChannel?.unsubscribe();
    _inboxPoll?.cancel();
    super.dispose();
  }

  Widget _gate(Widget child) => _loggedIn ? child : const LoginPage();

  @override
  Widget build(BuildContext context) {
    final pages = [
      const PetPage(),
      _gate(const FriendsTab()),
      _gate(const GroupsTab()),
    ];
    return Scaffold(
      body: IndexedStack(index: _index, children: pages),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (i) => setState(() => _index = i),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.cruelty_free), label: '猫猫糕'),
          NavigationDestination(icon: Icon(Icons.people_outline), label: '好友'),
          NavigationDestination(icon: Icon(Icons.groups_outlined), label: '群组'),
        ],
      ),
    );
  }
}
