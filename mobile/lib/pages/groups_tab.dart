import 'package:flutter/material.dart';

import '../api.dart';
import '../errors.dart';
import 'chat_page.dart';

class GroupsTab extends StatefulWidget {
  const GroupsTab({super.key});

  @override
  State<GroupsTab> createState() => _GroupsTabState();
}

class _GroupsTabState extends State<GroupsTab> {
  List<Map<String, dynamic>> _groups = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  Future<void> _refresh() async {
    try {
      final list = await Api.listGroups();
      if (mounted) setState(() { _groups = list; _loading = false; });
    } catch (e) {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _createGroup() async {
    final ctrl = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('创建群组'),
        content: TextField(
          controller: ctrl,
          decoration: const InputDecoration(hintText: '群名称'),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('取消')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('创建')),
        ],
      ),
    );
    if (ok == true && ctrl.text.trim().isNotEmpty) {
      try {
        await Api.createGroup(ctrl.text.trim());
        _refresh();
      } catch (e) {
        if (mounted) {
          ScaffoldMessenger.of(context)
              .showSnackBar(SnackBar(content: Text(friendlyError(e))));
        }
      }
    }
  }

  Future<void> _addMember(Map<String, dynamic> group) async {
    final ctrl = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('邀请加入「${group['name']}」'),
        content: TextField(
          controller: ctrl,
          decoration: const InputDecoration(hintText: '输入对方的用户名'),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('取消')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('邀请')),
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
    try {
      await Api.addGroupMember(group['id'], user['id']);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(friendlyError(e))));
      return;
    }
    if (!mounted) return;
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text('已邀请 ${user['username']}')));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _groups.isEmpty
              ? const Center(child: Text('还没有群组，点右下角创建'))
              : RefreshIndicator(
                  onRefresh: _refresh,
                  child: ListView.builder(
                    itemCount: _groups.length,
                    itemBuilder: (ctx, i) {
                      final g = _groups[i];
                      return ListTile(
                        leading: const CircleAvatar(child: Text('👥')),
                        title: Text(g['name'] ?? '?'),
                        trailing: IconButton(
                          icon: const Icon(Icons.person_add_alt),
                          tooltip: '邀请成员',
                          onPressed: () => _addMember(g),
                        ),
                        onTap: () => Navigator.of(context).push(
                          MaterialPageRoute(
                            builder: (_) => ChatPage.group(
                              groupId: g['id'],
                              groupName: g['name'] ?? '?',
                            ),
                          ),
                        ),
                      );
                    },
                  ),
                ),
      floatingActionButton: FloatingActionButton(
        onPressed: _createGroup,
        child: const Icon(Icons.group_add),
      ),
    );
  }
}
