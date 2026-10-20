import 'dart:io';

import 'package:flutter/services.dart' show rootBundle;

/// 宠物 3D 资产的本地 HTTP 服务（dart:io 版；web 走 stub，见 pet3d_server_stub.dart）。
///
/// 为什么需要它：Android WebView 在 file:// 下按 CORS 拦截 ES module
/// （pet3d.js 是 module），把资产经 127.0.0.1 以 http 源提供即可正常加载。
/// 只监听回环地址、随机端口、路径白名单（/pet3d/ 和 /meows/）+ 防目录穿越。
class Pet3dServer {
  static HttpServer? _server;

  static const _mime = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.glb': 'model/gltf-binary',
    '.webp': 'image/webp',
    '.png': 'image/png',
    '.m4a': 'audio/mp4',
  };

  static Future<int> ensureStarted() async {
    final s = _server;
    if (s != null) return s.port;
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    _server = server;
    server.listen((req) async {
      try {
        final path = Uri.decodeComponent(req.uri.path);
        if (!path.startsWith('/pet3d/') && !path.startsWith('/meows/')) {
          req.response.statusCode = 403;
          await req.response.close();
          return;
        }
        final clean = path
            .split('/')
            .where((seg) => seg.isNotEmpty && seg != '.' && seg != '..')
            .join('/');
        final ext = '.${clean.split('.').last}';
        final data = await rootBundle.load('assets/$clean');
        req.response.headers.contentType =
            ContentType.parse(_mime[ext] ?? 'application/octet-stream');
        req.response.add(data.buffer.asUint8List());
        await req.response.close();
      } catch (_) {
        req.response.statusCode = 404;
        await req.response.close();
      }
    });
    return server.port;
  }
}
