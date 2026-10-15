import 'package:flutter_local_notifications/flutter_local_notifications.dart';

/// 系统通知（App 退到后台也能弹出；iOS 网页版不支持，自动静默）
class Notify {
  static final _plugin = FlutterLocalNotificationsPlugin();
  static bool _ready = false;

  static Future<void> init() async {
    try {
      const android = AndroidInitializationSettings('@mipmap/ic_launcher');
      await _plugin.initialize(const InitializationSettings(android: android));
      // Android 13+ 需要运行时通知权限
      await _plugin
          .resolvePlatformSpecificImplementation<
              AndroidFlutterLocalNotificationsPlugin>()
          ?.requestNotificationsPermission();
      _ready = true;
    } catch (_) {
      _ready = false;
    }
  }

  static Future<void> show(String title, String body) async {
    if (!_ready) return;
    try {
      await _plugin.show(
        DateTime.now().millisecondsSinceEpoch % 100000,
        title,
        body,
        const NotificationDetails(
          android: AndroidNotificationDetails(
            'messages',
            '消息通知',
            importance: Importance.high,
            priority: Priority.high,
          ),
        ),
      );
    } catch (_) {}
  }
}
