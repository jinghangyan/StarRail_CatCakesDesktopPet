import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'config.dart' as builtin;
import 'custom.dart';
import 'notify.dart';
import 'pages/main_scaffold.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Custom.load(); // 用户自定义的名称和台词
  Notify.init(); // 系统通知（异步初始化，不阻塞启动）
  // 优先使用用户自定义的服务器，其次 App 内置的默认服务器
  final prefs = await SharedPreferences.getInstance();
  final url = prefs.getString('sbUrl') ?? builtin.supabaseUrl;
  final key = prefs.getString('sbKey') ?? builtin.supabaseAnonKey;
  try {
    await Supabase.initialize(url: url, publishableKey: key);
  } catch (_) {
    // 服务器配置无效也能进 App 玩猫猫糕，聊天功能会不可用
  }
  runApp(const CatPetApp());
}

class CatPetApp extends StatelessWidget {
  const CatPetApp({super.key});

  @override
  Widget build(BuildContext context) {
    const seed = Color(0xFFFF8FA3);
    return MaterialApp(
      title: '桌宠猫猫糕',
      // 跟随系统浅色/深色模式：浅色白底，深色黑底
      themeMode: ThemeMode.system,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: seed),
        useMaterial3: true,
        fontFamily: 'AppFont', // 内置精简中文字体，网页端不再依赖在线字体（防豆腐块）
      ),
      darkTheme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: seed,
          brightness: Brightness.dark,
        ),
        useMaterial3: true,
        fontFamily: 'AppFont',
      ),
      home: const MainScaffold(),
    );
  }
}
