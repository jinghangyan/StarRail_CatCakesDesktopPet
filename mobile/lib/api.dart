import 'package:supabase_flutter/supabase_flutter.dart';

/// Supabase 操作封装
class Api {
  static SupabaseClient get sb => Supabase.instance.client;

  static String get myId => sb.auth.currentUser!.id;

  /// 未登录时返回 null，调用方先判空
  static String? get myIdOrNull => sb.auth.currentUser?.id;

  // ---------- 用户资料 ----------

  static Future<Map<String, dynamic>?> myProfile() async {
    final res = await sb.from('profiles').select().eq('id', myId).maybeSingle();
    return res;
  }

  static Future<void> updateUsername(String username) async {
    await sb.from('profiles').update({'username': username}).eq('id', myId);
  }

  static Future<Map<String, dynamic>?> findUserByUsername(String username) async {
    return await sb
        .from('profiles')
        .select()
        .eq('username', username)
        .maybeSingle();
  }

  // ---------- 好友 ----------

  /// 好友列表：我添加的 + 添加了我的，去重返回对方 profile
  static Future<List<Map<String, dynamic>>> listFriends() async {
    final rows = await sb
        .from('friendships')
        .select('user_id, friend_id')
        .or('user_id.eq.$myId,friend_id.eq.$myId');
    final ids = <String>{};
    for (final r in rows) {
      final a = r['user_id'] as String, b = r['friend_id'] as String;
      ids.add(a == myId ? b : a);
    }
    if (ids.isEmpty) return [];
    final profiles =
        await sb.from('profiles').select().inFilter('id', ids.toList());
    return List<Map<String, dynamic>>.from(profiles);
  }

  static Future<void> addFriend(String friendId) async {
    await sb.from('friendships').upsert({
      'user_id': myId,
      'friend_id': friendId,
    });
  }

  // ---------- 群组 ----------

  static Future<List<Map<String, dynamic>>> listGroups() async {
    final memberships = await sb
        .from('group_members')
        .select('group_id')
        .eq('user_id', myId);
    final ids =
        memberships.map<String>((m) => m['group_id'] as String).toList();
    if (ids.isEmpty) return [];
    final groups = await sb.from('groups').select().inFilter('id', ids);
    return List<Map<String, dynamic>>.from(groups);
  }

  static Future<String> createGroup(String name) async {
    final g = await sb
        .from('groups')
        .insert({'name': name, 'owner_id': myId})
        .select()
        .single();
    await sb.from('group_members').insert({'group_id': g['id'], 'user_id': myId});
    return g['id'] as String;
  }

  static Future<void> addGroupMember(String groupId, String userId) async {
    await sb.from('group_members').upsert({'group_id': groupId, 'user_id': userId});
  }

  // ---------- 消息 ----------

  static Future<void> sendText({required String targetType, required String targetId, required String content}) {
    return sb.from('messages').insert({
      'sender_id': myId,
      'target_type': targetType,
      'target_id': targetId,
      'kind': 'text',
      'content': content,
    });
  }

  static Future<void> sendBlink({required String targetType, required String targetId}) {
    return sb.from('messages').insert({
      'sender_id': myId,
      'target_type': targetType,
      'target_id': targetId,
      'kind': 'blink',
      'content': '',
    });
  }

  static Future<Map<String, String>> usernamesOf(Set<String> ids) async {
    if (ids.isEmpty) return {};
    final rows = await sb.from('profiles').select().inFilter('id', ids.toList());
    return {for (final r in rows) r['id'] as String: r['username'] as String};
  }
}
