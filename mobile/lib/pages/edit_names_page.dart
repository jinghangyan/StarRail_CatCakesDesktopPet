import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../custom.dart';
import '../data.dart';
import '../widget_sync.dart';

/// 自定义名称和台词编辑页（与桌面端编辑器一致：每只猫 1 个名字 + 最多 5 句台词）
class EditNamesPage extends StatefulWidget {
  final String initialCake;
  const EditNamesPage({super.key, this.initialCake = 'cake01'});

  @override
  State<EditNamesPage> createState() => _EditNamesPageState();
}

class _EditNamesPageState extends State<EditNamesPage> {
  late String _current = widget.initialCake;
  final _nameCtrl = TextEditingController();
  final List<TextEditingController> _lineCtrls =
      List.generate(5, (_) => TextEditingController());
  String _status = '';

  @override
  void initState() {
    super.initState();
    _render();
  }

  void _render() {
    _nameCtrl.text = Custom.names[_current] ?? cakeNames[_current] ?? '';
    final lines = Custom.phrasesOf(_current);
    for (var i = 0; i < 5; i++) {
      _lineCtrls[i].text = i < lines.length ? lines[i] : '';
    }
    setState(() {});
  }

  Future<void> _save() async {
    final lines = _lineCtrls
        .map((c) => c.text.trim())
        .where((s) => s.isNotEmpty)
        .toList();
    if (lines.isEmpty) {
      setState(() => _status = '❌ 至少写一句，或点「恢复默认」');
      return;
    }
    await Custom.setName(_current, _nameCtrl.text);
    await Custom.setPhrases(_current, lines);
    // 改的是当前显示的猫时，同步桌面小组件
    final cur = (await SharedPreferences.getInstance()).getString('cake');
    if (cur == _current) syncWidget(_current);
    setState(() => _status =
        '✅ 已保存「${Custom.nameOf(_current)}」的 ${lines.length} 句台词');
  }

  Future<void> _reset() async {
    await Custom.reset(_current);
    _render();
    final cur = (await SharedPreferences.getInstance()).getString('cake');
    if (cur == _current) syncWidget(_current);
    setState(() => _status = '✅ 已恢复默认名称和台词');
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('自定义名称和台词')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Row(
            children: [
              Image.asset(cakeAsset(_current), width: 56, height: 56),
              const SizedBox(width: 12),
              Expanded(
                child: DropdownButtonFormField<String>(
                  initialValue: _current,
                  decoration: const InputDecoration(
                    labelText: '选择猫猫糕',
                    border: OutlineInputBorder(),
                    isDense: true,
                  ),
                  items: [
                    for (final id in cakeIds)
                      DropdownMenuItem(
                        value: id,
                        child: Text(
                            '${Custom.nameOf(id)}（#${id.replaceAll('cake', '')}）'),
                      ),
                  ],
                  onChanged: (v) {
                    _current = v!;
                    _render();
                  },
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          TextField(
            controller: _nameCtrl,
            decoration: const InputDecoration(
              labelText: '名称（清空恢复默认名）',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 12),
          const Text('台词（第 4、5 句可留空）',
              style: TextStyle(fontSize: 12, color: Colors.grey)),
          for (var i = 0; i < 5; i++)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: TextField(
                controller: _lineCtrls[i],
                decoration: InputDecoration(
                  hintText: '第 ${i + 1} 句',
                  border: const OutlineInputBorder(),
                  isDense: true,
                ),
              ),
            ),
          const SizedBox(height: 16),
          Row(
            children: [
              Expanded(
                child: FilledButton(onPressed: _save, child: const Text('保存')),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: OutlinedButton(
                    onPressed: _reset, child: const Text('恢复默认')),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Text(_status, style: const TextStyle(fontSize: 13, color: Colors.green)),
        ],
      ),
    );
  }
}
