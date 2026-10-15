import 'dart:convert';

import 'package:flutter/services.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'custom.dart';

/// 把当前猫的名字/台词同步给安卓桌面小组件。
/// 原生侧（CakeWidgetProvider）直接读 FlutterSharedPreferences，
/// 这里写的键会被读成 flutter.widgetName / flutter.widgetPhrases。
Future<void> syncWidget(String cakeId) async {
  final p = await SharedPreferences.getInstance();
  await p.setString('widgetName', Custom.nameOf(cakeId));
  await p.setString('widgetPhrases', jsonEncode(Custom.phrasesOf(cakeId)));
  try {
    await const MethodChannel('catpet/widget').invokeMethod('refresh');
  } catch (_) {
    // 非安卓平台或 channel 未就绪时静默忽略
  }
}
