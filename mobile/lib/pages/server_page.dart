import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../config.dart' as builtin;

/// 自定义服务器：用户填自己的 Supabase URL 和 Publishable key
class ServerPage extends StatefulWidget {
  const ServerPage({super.key});

  @override
  State<ServerPage> createState() => _ServerPageState();
}

class _ServerPageState extends State<ServerPage> {
  final _url = TextEditingController();
  final _key = TextEditingController();
  String _status = '';
  bool _usingCustom = false;

  // 配置是启动时读一次的，改完要重载才生效；网页版没有「重启 App」，是刷新页面
  static const String _takeEffectHint = kIsWeb ? '刷新页面后生效' : '重启 App 后生效';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final p = await SharedPreferences.getInstance();
    setState(() {
      _url.text = p.getString('sbUrl') ?? builtin.supabaseUrl;
      _key.text = p.getString('sbKey') ?? builtin.supabaseAnonKey;
      _usingCustom = p.getString('sbUrl') != null;
    });
  }

  Future<void> _save() async {
    final p = await SharedPreferences.getInstance();
    await p.setString('sbUrl', _url.text.trim());
    await p.setString('sbKey', _key.text.trim());
    setState(() {
      _usingCustom = true;
      _status = '✅ 已保存，$_takeEffectHint';
    });
  }

  Future<void> _reset() async {
    final p = await SharedPreferences.getInstance();
    await p.remove('sbUrl');
    await p.remove('sbKey');
    setState(() {
      _url.text = builtin.supabaseUrl;
      _key.text = builtin.supabaseAnonKey;
      _usingCustom = false;
      _status = '✅ 已恢复默认服务器，$_takeEffectHint';
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('自己的服务器')),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          if (_usingCustom)
            const Card(
              color: Color(0xFFE8F5E9),
              child: Padding(
                padding: EdgeInsets.all(10),
                child: Text('当前使用：自定义服务器', style: TextStyle(fontSize: 13)),
              ),
            ),
          const SizedBox(height: 8),
          const Text('Supabase Project URL', style: TextStyle(fontSize: 12, color: Colors.grey)),
          const SizedBox(height: 4),
          TextField(
            controller: _url,
            decoration: const InputDecoration(
              hintText: 'https://你的项目.supabase.co',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 14),
          const Text('Publishable key', style: TextStyle(fontSize: 12, color: Colors.grey)),
          const SizedBox(height: 4),
          TextField(
            controller: _key,
            decoration: const InputDecoration(
              hintText: 'sb_publishable_...',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 20),
          FilledButton(onPressed: _save, child: const Text('保存')),
          const SizedBox(height: 8),
          OutlinedButton(onPressed: _reset, child: const Text('恢复默认服务器')),
          const SizedBox(height: 12),
          Text(_status, style: const TextStyle(color: Colors.green, fontSize: 13)),
          const SizedBox(height: 16),
          const Text(
            '还没有自己的服务器？返回上一页点「联机教程」，5 分钟就能免费搭一个。',
            style: TextStyle(fontSize: 12, color: Colors.grey),
          ),
        ],
      ),
    );
  }
}
