import 'dart:async';
import 'dart:convert';
import 'dart:math';
import 'dart:ui' as ui;

import 'package:audioplayers/audioplayers.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../custom.dart';
import '../data.dart';
import '../pet3d_view.dart';
import '../pet_events.dart';
import '../widget_sync.dart';
import 'edit_names_page.dart';

/// 猫猫糕主页：拖动换位、点击随机动作 + 流光 + 猫叫 + 台词、待机轻柔动作
class PetPage extends StatefulWidget {
  const PetPage({super.key});

  @override
  State<PetPage> createState() => _PetPageState();
}

class _PetPageState extends State<PetPage> with TickerProviderStateMixin {
  String _cakeId = 'cake20';
  Offset _pos = const Offset(80, 200);
  double _scale = 1.0;
  int _meow = 1; // 0 = 自定义

  // 3D 渲染（WebView 内嵌 pet3d.js，官方模型）；false 时走 2D 图片兜底
  bool _render3d = true;
  final _pet3dKey = GlobalKey<Pet3dViewState>();
  double _viewYaw = 0, _viewPitch = 0;

  double get _size => 170 * _scale;

  // 动作动画
  late final AnimationController _actCtrl;
  // 流光持续旋转
  late final AnimationController _glowCtrl;
  bool _glowOn = false;
  Timer? _glowTimer;

  // 气泡
  String _bubble = '';
  Timer? _bubbleTimer;

  // 待机
  Timer? _idleTimer;
  final _rng = Random();

  // 叫声
  final _player = AudioPlayer();

  // 点击动作集合（不连续三次重复）
  String? _lastAction;
  int _sameCount = 0;
  // 待机动作（不连续重复）
  String? _lastIdle;

  @override
  void initState() {
    super.initState();
    _actCtrl = AnimationController(vsync: this);
    // 流光控制器不常驻旋转，只在 _flashGlow 时 repeat，结束 stop，避免常驻动画耗电
    _glowCtrl =
        AnimationController(vsync: this, duration: const Duration(seconds: 2));
    _restore();
    _scheduleIdle();
    // 联机消息联动（收到好友消息时做反应）
    petEventBus.addListener(_onPetEvent);
    // 播放完成后重新预载，保证下次点击零延迟
    _player.onPlayerComplete.listen((_) => _preloadMeow());
  }

  Future<void> _restore() async {
    final p = await SharedPreferences.getInstance();
    setState(() {
      _cakeId = p.getString('cake') ?? 'cake20';
      _meow = p.getInt('meow') ?? 1;
      _scale = p.getDouble('cakeScale') ?? 1.0;
      _pos = Offset(p.getDouble('posX') ?? 80, p.getDouble('posY') ?? 200);
      _render3d = (p.getString('renderMode') ?? '3d') == '3d';
      _viewYaw = p.getDouble('viewYaw') ?? 0;
      _viewPitch = p.getDouble('viewPitch') ?? 0;
    });
    _preloadMeow();
    syncWidget(_cakeId); // 同步给桌面小组件（含名称/台词的最新自定义）
  }

  // 3D webview 里转动视角后持久化（glue 层 setConfig → cfg channel → 这里）
  Future<void> _saveView(double yaw, double pitch) async {
    _viewYaw = yaw;
    _viewPitch = pitch;
    final p = await SharedPreferences.getInstance();
    p.setDouble('viewYaw', yaw);
    p.setDouble('viewPitch', pitch);
  }

  Future<void> _save() async {
    final p = await SharedPreferences.getInstance();
    p.setString('cake', _cakeId);
    p.setInt('meow', _meow);
    p.setDouble('cakeScale', _scale);
    p.setDouble('posX', _pos.dx);
    p.setDouble('posY', _pos.dy);
  }

  @override
  void dispose() {
    petEventBus.removeListener(_onPetEvent);
    _actCtrl.dispose();
    _glowCtrl.dispose();
    _glowTimer?.cancel();
    _bubbleTimer?.cancel();
    _idleTimer?.cancel();
    _player.dispose();
    super.dispose();
  }

  // ---------- 动作 ----------

  _ActionSpec? _currentSpec;

  void _playAction(String name, {bool glow = true, bool sound = true, bool speak = true}) {
    if (_render3d) return; // 3D 模式动作由 webview 内 pet3d 全权负责（点按/待机/联机都在 glue 层）
    final spec = _actionSpecs[name]!;
    _actCtrl.stop();
    _actCtrl.duration = spec.duration;
    _currentSpec = spec;
    _actCtrl.forward(from: 0);
    if (glow) _flashGlow(spec.duration);
    if (sound) _playMeow();
    if (speak) _say();
  }

  String _pickClickAction() {
    // 点击动作：duang / wiggle / spin / hop / tilt，不连续三次重复
    const actions = ['duang', 'wiggle', 'spin', 'hop', 'tilt'];
    var pool = actions;
    if (_lastAction != null && _sameCount >= 2) {
      pool = actions.where((a) => a != _lastAction).toList();
    }
    final pick = pool[_rng.nextInt(pool.length)];
    _sameCount = pick == _lastAction ? _sameCount + 1 : 1;
    _lastAction = pick;
    return pick;
  }

  void _tap() {
    _playAction(_pickClickAction());
  }

  // 收到联机消息：像被点了一样做动作 + 流光 + 猫叫，气泡说出消息内容
  void _onPetEvent() {
    final e = petEventBus.value;
    if (e == null || !mounted) return;
    petEventBus.value = null; // 消费掉，防止重开页面重放
    if (_render3d) {
      _pet3dKey.currentState?.petEvent({'who': e.who, 'kind': e.kind, 'content': e.content});
      return;
    }
    _playAction(_pickClickAction(), glow: true, sound: true, speak: false);
    _sayText(e.kind == 'blink' ? '✨ ${e.who} 戳了戳你' : '${e.who}: ${e.content}');
  }

  void _scheduleIdle() {
    _idleTimer?.cancel();
    _idleTimer = Timer(Duration(milliseconds: 9000 + _rng.nextInt(13000)), () {
      // 待机动作（轻柔）：伸懒腰 / 摇晃 / 张望 / 蜷缩
      const idles = ['idleStretch', 'idleSway', 'idleLook', 'idleCurl'];
      final pool = idles.where((a) => a != _lastIdle).toList();
      final pick = pool[_rng.nextInt(pool.length)];
      _lastIdle = pick;
      if (mounted && !_actCtrl.isAnimating) {
        _playAction(pick, glow: false, sound: false, speak: false);
      }
      _scheduleIdle();
    });
  }

  void _flashGlow(Duration d) {
    setState(() => _glowOn = true);
    _glowCtrl.repeat();
    _glowTimer?.cancel();
    _glowTimer = Timer(d + const Duration(milliseconds: 300), () {
      _glowCtrl.stop();
      if (mounted) setState(() => _glowOn = false);
    });
  }

  // 预加载当前叫声，点击时即点即响（网页端每次重新 setSource 会有拉取/解码延迟）
  Future<void> _preloadMeow() async {
    try {
      if (_meow == 0) {
        final p = await SharedPreferences.getInstance();
        final b64 = p.getString('customMeowB64');
        if (b64 != null) {
          await _player.setSourceBytes(base64Decode(b64));
          return;
        }
      }
      await _player.setSource(
          AssetSource('meows/meow${_meow == 0 ? 1 : _meow}.m4a'));
    } catch (_) {}
  }

  Future<void> _playMeow() async {
    await _player.stop();
    if (_meow == 0) {
      final p = await SharedPreferences.getInstance();
      final b64 = p.getString('customMeowB64');
      if (b64 != null) {
        await _player.play(BytesSource(base64Decode(b64)));
        return;
      }
    }
    await _player.play(AssetSource('meows/meow${_meow == 0 ? 1 : _meow}.m4a'));
  }

  void _say() {
    final list = Custom.phrasesOf(_cakeId);
    _sayText(list[_rng.nextInt(list.length)]);
  }

  void _sayText(String text) {
    setState(() => _bubble = text);
    _bubbleTimer?.cancel();
    _bubbleTimer = Timer(const Duration(seconds: 2), () {
      if (mounted) setState(() => _bubble = '');
    });
  }

  // ---------- 换猫 / 叫声 / 大小 ----------

  void _openPicker() {
    showModalBottomSheet(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      builder: (ctx) => _PickerSheet(
        current: _cakeId,
        meow: _meow,
        scale: _scale,
        render3d: _render3d,
        onToggle3d: (v) async {
          setState(() => _render3d = v);
          final p = await SharedPreferences.getInstance();
          await p.setString('renderMode', v ? '3d' : '2d');
        },
        onNamesEdited: () {
          if (_render3d) {
            _pet3dKey.currentState?.setCake(_cakeId, Custom.nameOf(_cakeId), Custom.phrasesOf(_cakeId));
          }
        },
        onPick: (id) {
          setState(() => _cakeId = id);
          _save();
          syncWidget(id); // 小组件立即跟着换猫
          if (_render3d) {
            _pet3dKey.currentState?.setCake(id, Custom.nameOf(id), Custom.phrasesOf(id));
          }
        },
        onMeow: (n) {
          setState(() => _meow = n);
          _save();
          _playMeow(); // 试听，播完由 onPlayerComplete 自动预载新叫声
          _preloadMeow();
        },
        onScale: (s) {
          setState(() => _scale = s);
          _save();
        },
      ),
    );
  }

  // ---------- 构建 ----------

  @override
  Widget build(BuildContext context) {
    // 3D 模式：WebView 铺满（pet3d.js 官方模型实时渲染；点按/拖动旋转/台词/叫声都在里面）
    if (_render3d) {
      return Stack(
        children: [
          Positioned.fill(
            child: Pet3dView(
              key: _pet3dKey,
              cakeId: _cakeId,
              cakeName: Custom.nameOf(_cakeId),
              phrases: Custom.phrasesOf(_cakeId),
              viewYaw: _viewYaw,
              viewPitch: _viewPitch,
              onMeow: _playMeow,
              onViewChanged: _saveView,
            ),
          ),
          // 右上角：换猫/叫声/大小
          Positioned(
            right: 8,
            top: 8,
            child: SafeArea(
              child: IconButton.filledTonal(
                icon: const Text('🐱', style: TextStyle(fontSize: 20)),
                tooltip: '选择猫猫糕 / 叫声 / 大小',
                onPressed: _openPicker,
              ),
            ),
          ),
        ],
      );
    }
    final size = _size;
    return LayoutBuilder(builder: (ctx, constraints) {
      final pos = Offset(
        _pos.dx.clamp(0.0, max(0.0, constraints.maxWidth - size)),
        _pos.dy.clamp(0.0, max(0.0, constraints.maxHeight - size - 40)),
      );
      return Stack(
        children: [
          // 影子
          Positioned(
            left: pos.dx + size * 0.28,
            top: pos.dy + size - 8,
            child: Container(
              width: size * 0.44,
              height: 14 * _scale,
              decoration: BoxDecoration(
                color: Colors.black.withValues(alpha: 0.18),
                borderRadius: BorderRadius.circular(20),
              ),
            ),
          ),
          // 猫猫糕本体（含流光）
          Positioned(
            left: pos.dx,
            top: pos.dy,
            child: GestureDetector(
              onTap: _tap,
              onPanUpdate: (d) {
                setState(() => _pos += d.delta);
              },
              onPanEnd: (_) => _save(),
              child: SizedBox(
                width: size,
                height: size,
                child: AnimatedBuilder(
                  animation: Listenable.merge([_actCtrl, _glowCtrl]),
                  builder: (ctx, child) {
                    final spec = _currentSpec;
                    double sx = 1, sy = 1, rot = 0, dx = 0, dy = 0;
                    if (spec != null && _actCtrl.isAnimating) {
                      final t = _actCtrl.value;
                      sx = spec.scaleX.transform(t);
                      sy = spec.scaleY.transform(t);
                      rot = spec.rotate.transform(t);
                      dx = spec.dx.transform(t) * _scale;
                      dy = spec.dy.transform(t) * _scale;
                    }
                    return Transform.translate(
                      offset: Offset(dx, dy),
                      child: Transform.rotate(
                        angle: rot,
                        alignment: Alignment.bottomCenter,
                        child: Transform.scale(
                          scaleX: sx,
                          scaleY: sy,
                          alignment: Alignment.bottomCenter,
                          child: child,
                        ),
                      ),
                    );
                  },
                  child: Stack(
                    alignment: Alignment.center,
                    children: [
                      // 流动轮廓光：扫描渐变蒙版取猫猫糕剪影，放大一圈
                      // 仅在触发时构建（常驻构建 ImageFiltered/ShaderMask 费电）
                      if (_glowOn)
                        AnimatedBuilder(
                          animation: _glowCtrl,
                          builder: (ctx, child) => ImageFiltered(
                            imageFilter: ui.ImageFilter.blur(sigmaX: 4, sigmaY: 4),
                            child: ShaderMask(
                              blendMode: BlendMode.srcIn,
                              shaderCallback: (rect) => SweepGradient(
                                transform: GradientRotation(_glowCtrl.value * 2 * pi),
                                colors: const [
                                  Color(0xFFFFD54F),
                                  Color(0xFFFF8FA3),
                                  Color(0xFF80DEEA),
                                  Color(0xFFB39DFF),
                                  Color(0xFFFFD54F),
                                ],
                              ).createShader(rect),
                              child: child,
                            ),
                          ),
                          child: Transform.scale(
                            scale: 1.08,
                            child: Image.asset(cakeAsset(_cakeId)),
                          ),
                        ),
                      Image.asset(cakeAsset(_cakeId)),
                    ],
                  ),
                ),
              ),
            ),
          ),
          // 台词气泡
          if (_bubble.isNotEmpty)
            Positioned(
              left: (pos.dx + size / 2 - 90).clamp(8.0, constraints.maxWidth - 188),
              top: max(4.0, pos.dy - 56),
              child: Container(
                width: 180,
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                decoration: BoxDecoration(
                  color: Theme.of(context).colorScheme.surfaceContainerHighest,
                  borderRadius: BorderRadius.circular(12),
                  boxShadow: const [BoxShadow(blurRadius: 6, color: Colors.black26)],
                ),
                child: Text(
                  _bubble,
                  textAlign: TextAlign.center,
                  style: const TextStyle(fontSize: 13),
                ),
              ),
            ),
          // 右上角：换猫/叫声/大小
          Positioned(
            right: 8,
            top: 8,
            child: SafeArea(
              child: IconButton.filledTonal(
                icon: const Text('🐱', style: TextStyle(fontSize: 20)),
                tooltip: '选择猫猫糕 / 叫声 / 大小',
                onPressed: _openPicker,
              ),
            ),
          ),
        ],
      );
    });
  }
}

// ---------- 动作参数（与桌面端一致的节奏） ----------

class _ActionSpec {
  final Duration duration;
  final TweenSequence<double> scaleX;
  final TweenSequence<double> scaleY;
  final TweenSequence<double> rotate;
  final TweenSequence<double> dx;
  final TweenSequence<double> dy;
  const _ActionSpec(this.duration, this.scaleX, this.scaleY, this.rotate, this.dx, this.dy);
}

TweenSequence<double> _seq(List<(double, double)> points) {
  final items = <TweenSequenceItem<double>>[];
  double prev = points.first.$1;
  for (var i = 1; i < points.length; i++) {
    items.add(TweenSequenceItem(
      tween: Tween(begin: prev, end: points[i].$1).chain(CurveTween(curve: Curves.easeInOut)),
      weight: points[i].$2,
    ));
    prev = points[i].$1;
  }
  return TweenSequence(items);
}

TweenSequence<double> _const(double v) =>
    TweenSequence([TweenSequenceItem(tween: ConstantTween(v), weight: 1)]);

final Map<String, _ActionSpec> _actionSpecs = {
  'duang': _ActionSpec(
    const Duration(milliseconds: 650),
    _seq([(1.0, 0.0), (1.22, 0.25), (0.88, 0.45), (1.08, 0.62), (0.97, 0.78), (1.0, 1.0)]),
    _seq([(1.0, 0.0), (0.78, 0.25), (1.14, 0.45), (0.93, 0.62), (1.03, 0.78), (1.0, 1.0)]),
    _const(0), _const(0), _const(0),
  ),
  'wiggle': _ActionSpec(
    const Duration(milliseconds: 700),
    _seq([(1.0, 0.0), (1.05, 0.2), (0.96, 0.4), (1.03, 0.6), (1.0, 1.0)]),
    _seq([(1.0, 0.0), (0.95, 0.2), (1.04, 0.4), (0.97, 0.6), (1.0, 1.0)]),
    _seq([(0.0, 0.0), (-0.16, 0.2), (0.14, 0.4), (-0.10, 0.6), (0.05, 0.8), (0.0, 1.0)]),
    _const(0), _const(0),
  ),
  'spin': _ActionSpec(
    const Duration(milliseconds: 950),
    _seq([(1.0, 0.0), (1.15, 0.15), (0.8, 0.35), (0.8, 0.55), (1.1, 0.75), (1.0, 1.0)]),
    _seq([(1.0, 0.0), (0.85, 0.15), (0.8, 0.35), (0.8, 0.55), (0.9, 0.75), (1.0, 1.0)]),
    _seq([(0.0, 0.0), (0.0, 0.15), (2 * pi * 0.47, 0.35), (2 * pi, 0.55), (2 * pi, 1.0)]),
    _const(0),
    _seq([(0.0, 0.0), (3.0, 0.15), (-34.0, 0.35), (-34.0, 0.55), (1.0, 0.75), (0.0, 1.0)]),
  ),
  'hop': _ActionSpec(
    const Duration(milliseconds: 600),
    _seq([(1.0, 0.0), (1.15, 0.25), (0.92, 0.55), (1.06, 0.8), (1.0, 1.0)]),
    _seq([(1.0, 0.0), (0.85, 0.25), (1.08, 0.55), (0.94, 0.8), (1.0, 1.0)]),
    _const(0), _const(0),
    _seq([(0.0, 0.0), (4.0, 0.25), (-26.0, 0.55), (2.0, 0.8), (0.0, 1.0)]),
  ),
  'tilt': _ActionSpec(
    const Duration(seconds: 1),
    _const(1), _const(1),
    _seq([(0.0, 0.0), (-0.24, 0.3), (-0.24, 0.65), (0.0, 1.0)]),
    _const(0), _const(0),
  ),
  // ---- 待机（轻柔） ----
  'idleStretch': _ActionSpec(
    const Duration(milliseconds: 2400),
    _seq([(1.0, 0.0), (0.96, 0.3), (0.96, 0.55), (1.0, 1.0)]),
    _seq([(1.0, 0.0), (1.09, 0.3), (1.09, 0.55), (1.0, 1.0)]),
    _const(0), _const(0), _const(0),
  ),
  'idleSway': _ActionSpec(
    const Duration(milliseconds: 2800),
    _const(1), _const(1),
    _seq([(0.0, 0.0), (0.045, 0.25), (-0.045, 0.75), (0.0, 1.0)]),
    _const(0), _const(0),
  ),
  'idleLook': _ActionSpec(
    const Duration(milliseconds: 2600),
    _const(1), _const(1),
    _seq([(0.0, 0.0), (-0.05, 0.25), (-0.05, 0.5), (0.05, 0.75), (0.0, 1.0)]),
    _seq([(0.0, 0.0), (-5.0, 0.25), (-5.0, 0.5), (5.0, 0.75), (0.0, 1.0)]),
    _const(0),
  ),
  'idleCurl': _ActionSpec(
    const Duration(milliseconds: 2800),
    _seq([(1.0, 0.0), (0.94, 0.35), (0.94, 0.65), (1.0, 1.0)]),
    _seq([(1.0, 0.0), (0.90, 0.35), (0.90, 0.65), (1.0, 1.0)]),
    _const(0), _const(0), _const(0),
  ),
};

// ---------- 换猫 / 叫声 / 大小底部弹层 ----------

class _PickerSheet extends StatefulWidget {
  final String current;
  final int meow;
  final double scale;
  final bool render3d;
  final ValueChanged<String> onPick;
  final ValueChanged<int> onMeow;
  final ValueChanged<double> onScale;
  final ValueChanged<bool> onToggle3d;
  final VoidCallback onNamesEdited;

  const _PickerSheet({
    required this.current,
    required this.meow,
    required this.scale,
    required this.render3d,
    required this.onPick,
    required this.onMeow,
    required this.onScale,
    required this.onToggle3d,
    required this.onNamesEdited,
  });

  @override
  State<_PickerSheet> createState() => _PickerSheetState();
}

class _PickerSheetState extends State<_PickerSheet> {
  String? _customMeowName;
  // 弹层内部自己维护选中状态：底部弹层是独立路由，父组件 setState 不会重建它
  late int _meowSel = widget.meow;
  late double _scaleSel = widget.scale;
  late bool _render3d = widget.render3d;
  bool _dnd = false;

  @override
  void initState() {
    super.initState();
    SharedPreferences.getInstance().then((p) {
      if (!mounted) return;
      setState(() {
        _customMeowName = p.getString('customMeowName');
        _dnd = p.getBool('dnd') ?? false;
      });
    });
  }

  Future<void> _importMeow() async {
    final result = await FilePicker.platform.pickFiles(
      type: FileType.custom,
      allowedExtensions: ['mp3', 'wav', 'm4a', 'ogg'],
      withData: true,
    );
    final file = result?.files.first;
    if (file == null || file.bytes == null) return;
    if (!mounted) return;
    final p = await SharedPreferences.getInstance();
    await p.setString('customMeowB64', base64Encode(file.bytes!));
    await p.setString('customMeowName', file.name);
    if (!mounted) return;
    setState(() {
      _customMeowName = file.name;
      _meowSel = 0;
    });
    widget.onMeow(0); // 启用自定义叫声并试听
  }

  void _selectMeow(int n) {
    setState(() => _meowSel = n);
    widget.onMeow(n);
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // 3D 渲染开关（官方模型实时渲染；2D 更省电、支持拖动换位和缩放）
          SwitchListTile(
            dense: true,
            title: const Text('3D 渲染', style: TextStyle(fontSize: 14)),
            subtitle: const Text('官方模型实时渲染，拖动旋转视角；关掉用 2D 图片，更省电',
                style: TextStyle(fontSize: 11)),
            value: _render3d,
            onChanged: (v) {
              setState(() => _render3d = v);
              widget.onToggle3d(v);
            },
          ),
          // 免打扰
          SwitchListTile(
            dense: true,
            title: const Text('免打扰', style: TextStyle(fontSize: 14)),
            subtitle: const Text('收到消息不弹系统通知',
                style: TextStyle(fontSize: 11)),
            value: _dnd,
            onChanged: (v) async {
              setState(() => _dnd = v);
              final p = await SharedPreferences.getInstance();
              await p.setBool('dnd', v);
            },
          ),
          // 大小调节（仅 2D 模式；3D 猫糕大小由渲染器取景自适应）
          if (!_render3d)
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Row(
              children: [
                const Text('大小', style: TextStyle(fontSize: 13)),
                Expanded(
                  child: Slider(
                    value: _scaleSel,
                    min: 0.6,
                    max: 2.0,
                    onChanged: (s) {
                      setState(() => _scaleSel = s);
                      widget.onScale(s);
                    },
                  ),
                ),
                Text('${(_scaleSel * 100).round()}%',
                    style: const TextStyle(fontSize: 13)),
              ],
            ),
          ),
          // 叫声选择
          SizedBox(
            height: 40,
            child: ListView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 12),
              children: [
                for (var n = 1; n <= 7; n++)
                  Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: ChoiceChip(
                      label: Text('叫声 $n'),
                      selected: _meowSel == n,
                      onSelected: (_) => _selectMeow(n),
                    ),
                  ),
                Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: ChoiceChip(
                    label: Text(_customMeowName == null
                        ? '自定义'
                        : '自定义：$_customMeowName'),
                    selected: _meowSel == 0,
                    onSelected: _customMeowName == null
                        ? null
                        : (_) => _selectMeow(0),
                  ),
                ),
                ActionChip(
                  avatar: const Icon(Icons.upload_file, size: 16),
                  label: const Text('导入音频'),
                  onPressed: _importMeow,
                ),
              ],
            ),
          ),
          // 名称台词编辑入口
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
            child: SizedBox(
              width: double.infinity,
              child: OutlinedButton.icon(
                icon: const Icon(Icons.edit_note, size: 18),
                label: const Text('自定义名称和台词'),
                onPressed: () {
                  Navigator.pop(context);
                  Navigator.of(context).push(MaterialPageRoute(
                    builder: (_) => EditNamesPage(initialCake: widget.current),
                  )).then((_) => widget.onNamesEdited()); // 改完名称台词回来刷新 3D 台词
                },
              ),
            ),
          ),
          const Divider(),
          // 猫猫糕图鉴
          Flexible(
            child: GridView.builder(
              shrinkWrap: true,
              padding: const EdgeInsets.all(12),
              gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                crossAxisCount: 4,
                mainAxisSpacing: 8,
                crossAxisSpacing: 8,
              ),
              itemCount: cakeIds.length,
              itemBuilder: (ctx, i) {
                final id = cakeIds[i];
                final selected = id == widget.current;
                return InkWell(
                  borderRadius: BorderRadius.circular(12),
                  onTap: () {
                    widget.onPick(id);
                    Navigator.pop(ctx);
                  },
                  child: Container(
                    decoration: BoxDecoration(
                      border: Border.all(
                        color: selected ? Theme.of(ctx).colorScheme.primary : Colors.transparent,
                        width: 2,
                      ),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    padding: const EdgeInsets.all(4),
                    child: Column(
                      children: [
                        Expanded(child: Image.asset(cakeAsset(id))),
                        Text(Custom.nameOf(id),
                            style: const TextStyle(fontSize: 10),
                            overflow: TextOverflow.ellipsis),
                      ],
                    ),
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}
