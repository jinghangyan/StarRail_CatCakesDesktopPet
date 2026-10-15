import 'package:flutter/foundation.dart';

/// 收到联机消息时通知宠物页做反应（动作/流光/猫叫/气泡）
class PetEvent {
  final String who;
  final String kind; // 'blink' | 'text'
  final String content;
  const PetEvent(this.who, this.kind, this.content);
}

/// 全局事件总线：MainScaffold 收到消息时写入，PetPage 监听消费
final petEventBus = ValueNotifier<PetEvent?>(null);
