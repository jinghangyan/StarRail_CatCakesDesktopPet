import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';

/// 3D 猫糕视图：WebView 内嵌桌面端 pet3d.js 渲染器（官方模型/动画/卡通渲染原样复用）。
/// 用官方 webview_flutter：loadFlutterAsset 经 WebViewAssetLoader 整目录服务本地资产，
/// 相对路径（pet3d.js / models/ / vendor/）都能解析。
/// 通信：
///   出（JS→Flutter）：JavaScriptChannel 'meow' 播猫叫、'cfg' 持久化视角
///   入（Flutter→JS）：setCakeData 换猫/名称/台词、onPetEvent 联机反应、__applyFlutterCfg 配置
class Pet3dView extends StatefulWidget {
  final String cakeId;
  final String cakeName;
  final List<String> phrases;
  final double viewYaw;
  final double viewPitch;
  final VoidCallback onMeow;
  final void Function(double yaw, double pitch) onViewChanged;

  const Pet3dView({
    super.key,
    required this.cakeId,
    required this.cakeName,
    required this.phrases,
    required this.viewYaw,
    required this.viewPitch,
    required this.onMeow,
    required this.onViewChanged,
  });

  @override
  State<Pet3dView> createState() => Pet3dViewState();
}

class Pet3dViewState extends State<Pet3dView> {
  late final WebViewController _ctrl;
  bool _loaded = false;

  /// 换猫（名称/台词跟着最新自定义走）
  void setCake(String id, String name, List<String> phrases) {
    if (!_loaded) return;
    // phrasesJson 形参是「装 JSON 的字符串」，所以要二次编码
    _ctrl.runJavaScript(
        'setCakeData(${jsonEncode(id)}, ${jsonEncode(name)}, ${jsonEncode(jsonEncode(phrases))})');
  }

  /// 联机事件：{'who': 名字, 'kind': 'blink'|'text', 'content': 内容}
  void petEvent(Map<String, String> e) {
    if (!_loaded) return;
    _ctrl.runJavaScript('onPetEvent(${jsonEncode(jsonEncode(e))})');
  }

  @override
  void initState() {
    super.initState();
    _ctrl = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(Colors.transparent)
      ..addJavaScriptChannel('meow', onMessageReceived: (_) => widget.onMeow())
      ..addJavaScriptChannel('cfg', onMessageReceived: (msg) {
        try {
          final m = jsonDecode(msg.message) as Map;
          widget.onViewChanged((m['viewYaw'] as num?)?.toDouble() ?? 0,
              (m['viewPitch'] as num?)?.toDouble() ?? 0);
        } catch (_) {}
      })
      ..setNavigationController(NavigationController(
        onPageFinished: (_) {
          _loaded = true;
          // 页面就绪后注入：当前猫（名称/台词）+ 持久化的视角
          setCake(widget.cakeId, widget.cakeName, widget.phrases);
          _ctrl.runJavaScript(
              '__applyFlutterCfg(${jsonEncode(jsonEncode({'viewYaw': widget.viewYaw, 'viewPitch': widget.viewPitch}))})');
        },
      ))
      ..loadFlutterAsset('assets/pet3d/pet_mobile.html');
  }

  @override
  Widget build(BuildContext context) => WebViewWidget(controller: _ctrl);
}
