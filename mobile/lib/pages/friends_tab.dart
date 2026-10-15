import 'package:flutter/material.dart';

import '../api.dart';
import '../errors.dart';
import 'chat_page.dart';

class FriendsTab extends StatefulWidget {
  const FriendsTab({super.key});

  @override
  State<FriendsTab> createState() => _FriendsTabState();
}

class _FriendsTabState extends State<FriendsTab> {
  List<Map<String, dynamic>> _friends = [];
  bool _loading = true;
  String _myUsername = '';

  @override
  void initState() {
    super.initState();
    _refresh();
    _loadMyName();
  }

  Future<void> _loadMyName() async {
    final p = await Api.myProfile();
    if (mounted && p != null) setState(() => _myUsername = p['username'] ?? '');
  }

  Future<void> _editMyName() async {
    final ctrl = TextEditingController(text: _myUsername);
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('修改我的用户名'),
        content: TextField(
          controller: ctrl,
          decoration: const InputDecoration(hintText: '朋友用它搜到你，起个好记的'),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('取消')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('保存')),
        ],
      ),
    );
    if (ok == true && ctrl.text.trim().isNotEmpty) {
      try {
        await Api.updateUsername(ctrl.text.trim());
        _loadMyName();
      } catch (e) {
        if (mounted) {
          ScaffoldMessenger.of(context)
              .showSnackBar(SnackBar(content: Text(friendlyError(e))));
        }
      }
    }
  }

  Future<void> _refresh() async {
    try {
      final list = await Api.listFriends();
      if (mounted) setState(() { _friends = list; _loading = false; });
    } catch (e) {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _addFriend() async {
    final ctrl = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('添加好友'),
        content: TextField(
          controller: ctrl,
          decoration: const InputDecoration(hintText: '输入对方的用户名'),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('取消')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('添加')),
        ],
      ),
    );
    if (ok != true) return;
    Map<String, dynamic>? user;
    try {
      user = await Api.findUserByUsername(ctrl.text.trim());
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(friendlyError(e))));
      }
      return;
    }
    if (!mounted) return;
    if (user == null) {
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('找不到这个用户名')));
      return;
    }
    if (user['id'] == Api.myId) {
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('不能添加自己')));
      return;
    }
    try {
      await Api.addFriend(user['id']);
      _refresh();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(friendlyError(e))));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('好友'),
        actions: [
          Center(
            child: Padding(
              padding: const EdgeInsets.only(right: 12),
              child: ActionChip(
                avatar: const Icon(Icons.badge_outlined, size: 16),
                label: Text(
                  _myUsername.isEmpty ? '设置用户名' : _myUsername,
                  style: const TextStyle(fontSize: 12),
                ),
                onPressed: _editMyName,
              ),
            ),
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : Column(
              children: [
                if (_friends.isEmpty)
                  Padding(
                    padding: const EdgeInsets.all(16),
                    child: Text(
                      '你的用户名是「$_myUsername」，发给朋友就能互相添加；点右上角可以改成好记的名字',
                      style: const TextStyle(fontSize: 12, color: Colors.grey),
                      textAlign: TextAlign.center,
                    ),
                  ),
                Expanded(
                  child: _friends.isEmpty
                      ? const Center(child: Text('还没有好友，点右下角添加'))
                      : RefreshIndicator(
                          onRefresh: _refresh,
                          child: ListView.builder(
                            itemCount: _friends.length,
                            itemBuilder: (ctx, i) {
                              final f = _friends[i];
                              return ListTile(
                                leading: const CircleAvatar(child: Text('🐱')),
                                title: Text(f['username'] ?? '?'),
                                onTap: () => Navigator.of(context).push(
                                  MaterialPageRoute(
                                    builder: (_) => ChatPage.dm(
                                      peerId: f['id'],
                                      peerName: f['username'] ?? '?',
                                    ),
                                  ),
                                ),
                              );
                            },
                          ),
                        ),
                ),
              ],
            ),
      floatingActionButton: FloatingActionButton(
        onPressed: _addFriend,
        child: const Icon(Icons.person_add_alt),
      ),
    );
  }
}
