import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../api.dart';
import '../config.dart' as builtin;
import '../errors.dart';
import 'server_page.dart';
import 'tutorial_page.dart';

class LoginPage extends StatefulWidget {
  const LoginPage({super.key});

  @override
  State<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> {
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _confirm = TextEditingController();
  bool _busy = false;
  String _status = '';
  bool _noServer = false;

  @override
  void initState() {
    super.initState();
    _checkServer();
  }

  /// 内置和自定义服务器都没配时，提示先去配置
  Future<void> _checkServer() async {
    final p = await SharedPreferences.getInstance();
    final custom = p.getString('sbUrl') ?? '';
    if (custom.isEmpty && builtin.supabaseUrl.isEmpty) {
      setState(() {
        _noServer = true;
        _status = '⚠️ 还没有配置服务器，请先点下方「使用自己的服务器」填写地址';
      });
    }
  }

  Future<void> _run(Future<void> Function() action) async {
    if (_noServer) {
      setState(() => _status = '⚠️ 请先点下方「使用自己的服务器」填写服务器地址');
      return;
    }
    setState(() { _busy = true; _status = ''; });
    try {
      await action();
      // 登录成功后由 MainScaffold 监听登录态自动切换到好友/群组页
    } catch (e) {
      setState(() => _status = '❌ ${friendlyError(e)}');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Text('🐱', style: TextStyle(fontSize: 64)),
              const SizedBox(height: 8),
              Text('桌宠猫猫遥控器',
                  style: Theme.of(context).textTheme.headlineSmall),
              const SizedBox(height: 32),
              TextField(
                controller: _email,
                keyboardType: TextInputType.emailAddress,
                decoration: const InputDecoration(
                  labelText: '邮箱', border: OutlineInputBorder()),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _password,
                obscureText: true,
                decoration: const InputDecoration(
                  labelText: '密码（至少 6 位）', border: OutlineInputBorder()),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _confirm,
                obscureText: true,
                decoration: const InputDecoration(
                  labelText: '确认密码（注册时校验）', border: OutlineInputBorder()),
              ),
              const SizedBox(height: 20),
              Row(
                children: [
                  Expanded(
                    child: FilledButton(
                      onPressed: _busy ? null : () => _run(() async {
                        await Api.sb.auth.signInWithPassword(
                          email: _email.text.trim(),
                          password: _password.text,
                        );
                      }),
                      child: const Text('登录'),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: OutlinedButton(
                      onPressed: _busy ? null : () {
                        if (_password.text != _confirm.text) {
                          setState(() => _status = '❌ 两次输入的密码不一致');
                          return;
                        }
                        if (_password.text.length < 6) {
                          setState(() => _status = '❌ 密码至少 6 位');
                          return;
                        }
                        _run(() async {
                          final res = await Api.sb.auth.signUp(
                            email: _email.text.trim(),
                            password: _password.text,
                          );
                          // 开启了邮箱验证时不会直接建立会话，提示先去验证
                          if (res.session == null) {
                            setState(() =>
                                _status = '✅ 注册成功，请先到邮箱完成验证再登录');
                          }
                        });
                      },
                      child: const Text('注册'),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              Text(_status, style: const TextStyle(color: Colors.red)),
              const Spacer(),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                children: [
                  TextButton.icon(
                    onPressed: () => Navigator.of(context).push(
                      MaterialPageRoute(builder: (_) => const TutorialPage()),
                    ),
                    icon: const Icon(Icons.school_outlined, size: 18),
                    label: const Text('联机教程'),
                  ),
                  TextButton.icon(
                    onPressed: () => Navigator.of(context).push(
                      MaterialPageRoute(builder: (_) => const ServerPage()),
                    ),
                    icon: const Icon(Icons.dns_outlined, size: 18),
                    label: const Text('使用自己的服务器'),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
