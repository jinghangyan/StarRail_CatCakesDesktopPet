import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import 'data.dart';

/// 用户自定义数据：名称、台词（存在本地，优先级高于出厂默认）
class Custom {
  static Map<String, String> names = {};
  static Map<String, List<String>> phrases = {};

  static Future<void> load() async {
    final p = await SharedPreferences.getInstance();
    final n = p.getString('customNames');
    final ph = p.getString('customPhrases');
    names = n == null
        ? {}
        : Map<String, String>.from(jsonDecode(n) as Map);
    phrases = ph == null
        ? {}
        : (jsonDecode(ph) as Map).map(
            (k, v) => MapEntry(k as String, List<String>.from(v as List)));
  }

  static Future<void> _saveNames() async {
    final p = await SharedPreferences.getInstance();
    await p.setString('customNames', jsonEncode(names));
  }

  static Future<void> _savePhrases() async {
    final p = await SharedPreferences.getInstance();
    await p.setString('customPhrases', jsonEncode(phrases));
  }

  /// 有效名称：自定义 > 出厂默认
  static String nameOf(String id) => names[id] ?? cakeName(id);

  /// 有效台词：自定义 > 出厂默认
  static List<String> phrasesOf(String id) =>
      (phrases[id] != null && phrases[id]!.isNotEmpty)
          ? phrases[id]!
          : cakePhrases[id] ?? defaultPhrases;

  static Future<void> setName(String id, String? name) async {
    if (name == null || name.trim().isEmpty) {
      names.remove(id);
    } else {
      names[id] = name.trim();
    }
    await _saveNames();
  }

  static Future<void> setPhrases(String id, List<String> lines) async {
    if (lines.isEmpty) {
      phrases.remove(id);
    } else {
      phrases[id] = lines;
    }
    await _savePhrases();
  }

  static Future<void> reset(String id) async {
    names.remove(id);
    phrases.remove(id);
    await _saveNames();
    await _savePhrases();
  }
}
