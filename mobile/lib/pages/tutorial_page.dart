import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';

/// 联机教程：区分「加入朋友的服务器」和「自己建服务器」两种身份
class TutorialPage extends StatefulWidget {
  const TutorialPage({super.key});

  @override
  State<TutorialPage> createState() => _TutorialPageState();
}

class _TutorialPageState extends State<TutorialPage> {
  String _schema = '加载中…';
  bool _copied = false;
  bool _buildTab = false; // false=加入服务器 true=自己建

  @override
  void initState() {
    super.initState();
    rootBundle.loadString('assets/schema.sql').then((t) {
      if (mounted) setState(() => _schema = t);
    }).catchError((_) {
      if (mounted) setState(() => _schema = '（脚本加载失败）');
    });
  }

  Future<void> _copy() async {
    await Clipboard.setData(ClipboardData(text: _schema));
    setState(() => _copied = true);
    Future.delayed(const Duration(seconds: 2), () {
      if (mounted) setState(() => _copied = false);
    });
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('联机教程')),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          // 身份切换
          SegmentedButton<bool>(
            segments: const [
              ButtonSegment(value: false, label: Text('😸 加入朋友的服务器')),
              ButtonSegment(value: true, label: Text('🛠 自己建服务器')),
            ],
            selected: {_buildTab},
            onSelectionChanged: (s) => setState(() => _buildTab = s.first),
          ),
          const SizedBox(height: 20),
          if (!_buildTab) ...[
            _step(1, '找服主要两样东西',
                'Project URL（https://xxxx.supabase.co）和 Publishable key（sb_publishable_ 开头）。'),
            _step(2, '填进 App',
                kIsWeb ? '回到登录页 →「使用自己的服务器」，填入 URL 和 key，保存后刷新页面。' : '回到登录页 →「使用自己的服务器」，填入 URL 和 key，保存后重启 App。'),
            _step(3, '注册账号',
                '在登录页填邮箱密码点「注册」，把用户名告诉服主，互相加好友就能互戳了。'),
            Card(
              color: theme.colorScheme.tertiaryContainer,
              child: const Padding(
                padding: EdgeInsets.all(10),
                child: Text('💡 成员不需要注册 Supabase、不需要碰任何服务器设置，拿 URL 和 key 就能玩。',
                    style: TextStyle(fontSize: 12)),
              ),
            ),
          ] else ...[
            _step(1, '注册并创建项目',
                '打开 supabase.com 注册 → New Project，区域建议选 Singapore 或 Tokyo，免费套餐即可。',
                link: 'https://supabase.com'),
            _step(2, '执行建表脚本（仅这一次）',
                '项目里点左侧 SQL Editor → New query，把下方脚本全部粘贴进去 → Run。'),
            FilledButton.icon(
              onPressed: _copy,
              icon: const Icon(Icons.copy, size: 16),
              label: Text(_copied ? '已复制 ✓ 去 SQL Editor 粘贴执行' : '📋 复制建表脚本'),
            ),
            const SizedBox(height: 8),
            Container(
              height: 200,
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: const Color(0xFF2B2B3A),
                borderRadius: BorderRadius.circular(10),
              ),
              child: SingleChildScrollView(
                child: SelectableText(
                  _schema,
                  style: const TextStyle(
                    fontFamily: 'monospace',
                    fontSize: 10,
                    color: Color(0xFFD8E0EA),
                  ),
                ),
              ),
            ),
            const SizedBox(height: 16),
            _step(3, '拿到两个密钥',
                '打开项目主页，项目名下方的 Copy 按钮（或顶部 Connect 按钮）点开，里面就有 Project URL 和 Publishable key（sb_publishable_ 开头）。'),
            _step(4, '（可选）关闭邮箱验证',
                '左侧 Authentication → Sign In / Providers → 关闭 Confirm email，朋友注册后立即可用。'),
            _step(5, '自己登录 + 把密钥发给朋友',
                '回到登录页填入 URL 和 key 注册；再把这两个值发给朋友，让他们走「加入服务器」流程。'),
            Card(
              color: theme.colorScheme.tertiaryContainer,
              child: const Padding(
                padding: EdgeInsets.all(10),
                child: Text('💡 URL 和 Publishable key 是公开密钥，可以放心发给朋友；安全性由数据库规则（RLS）保证，建表脚本里已配好。',
                    style: TextStyle(fontSize: 12)),
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _step(int n, String title, String body, {String? link}) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          CircleAvatar(radius: 12, child: Text('$n', style: const TextStyle(fontSize: 12))),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: const TextStyle(fontWeight: FontWeight.w600)),
                const SizedBox(height: 2),
                Text(body, style: const TextStyle(fontSize: 13)),
                if (link != null)
                  InkWell(
                    onTap: () => launchUrl(Uri.parse(link)),
                    child: Text(link,
                        style: const TextStyle(
                            fontSize: 13,
                            color: Color(0xFFFF5C8A),
                            decoration: TextDecoration.underline)),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
