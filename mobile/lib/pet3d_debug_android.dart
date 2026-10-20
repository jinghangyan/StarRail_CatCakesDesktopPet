import 'package:webview_flutter_android/webview_flutter_android.dart';

/// 开启 WebView 的 Chrome DevTools 调试（adb forward + CDP 排障用）。
/// 内测期常开；手机 3.0.0 发布前按 HANDOFF 复查是否关闭。
void enableWebviewDebugging() {
  AndroidWebViewController.enableDebugging(true);
}
