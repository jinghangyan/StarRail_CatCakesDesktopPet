import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';

/// 3D 猫糕视图：WebView 内嵌桌面端 pet3d.js 渲染器（官方模型/动画/卡通渲染原样复用）。
/// 通信：
///   出（JS→Flutter）：'meow' 播猫叫、'cfg' 持久化视角
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
  InAppWebViewController? _ctrl;

  /// 换猫（名称/台词跟着最新自定义走）
  void setCake(String id, String name, List<String> phrases) {
    // phrasesJson 形参是「装 JSON 的字符串」，所以要二次编码
    _ctrl?.evaluateJavascript(
        source:
            'setCakeData(${jsonEncode(id)}, ${jsonEncode(name)}, ${jsonEncode(jsonEncode(phrases))})');
  }

  /// 联机事件：{'who': 名字, 'kind': 'blink'|'text', 'content': 内容}
  void petEvent(Map<String, String> e) {
    _ctrl?.evaluateJavascript(
        source: 'onPetEvent(${jsonEncode(jsonEncode(e))})');
  }

  @override
  Widget build(BuildContext context) {
    return InAppWebView(
      initialFile: 'assets/pet3d/pet_mobile.html',
      initialSettings: InAppWebViewSettings(
        transparentBackground: true,
        disableContextMenu: true,
        supportZoom: false,
        useWideViewPort: false,
        mediaPlaybackRequiresUserGesture: false,
      ),
      onWebViewCreated: (c) {
        _ctrl = c;
        c.addJavaScriptHandler(
            handlerName: 'meow', callback: (_) => widget.onMeow());
        c.addJavaScriptHandler(
            handlerName: 'cfg',
            callback: (args) {
              if (args.isEmpty) return;
              try {
                final m = jsonDecode(args[0] as String) as Map;
                widget.onViewChanged(
                    (m['viewYaw'] as num?)?.toDouble() ?? 0,
                    (m['viewPitch'] as num?)?.toDouble() ?? 0);
              } catch (_) {}
            });
      },
      onLoadStop: (c, url) {
        setCake(widget.cakeId, widget.cakeName, widget.phrases);
        c.evaluateJavascript(
            source:
                '__applyFlutterCfg(${jsonEncode(jsonEncode({'viewYaw': widget.viewYaw, 'viewPitch': widget.viewPitch}))})');
      },
    );
  }
}
