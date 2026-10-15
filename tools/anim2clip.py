#!/usr/bin/env python3
# Emo .anim (Unity YAML, AnimeStudio 导出) → THREE.AnimationClip JSON
# 路径哈希用骨架层级暴破（CRC32 = zlib.crc32，路径相对 prefab 根）
import json, struct, zlib, re, sys, os

GLB = os.path.expanduser('~/cat-pet/tools/import5/assets/asbres/characters/npc/special/ruanmadecake/Art_NPC_Special_RuanMadeCake_00.glb')

def build_crcmap():
    with open(GLB, 'rb') as fh:
        fh.read(12); clen, _ = struct.unpack('<II', fh.read(8)); j = json.loads(fh.read(clen))
    nodes = j['nodes']; m = {}
    def walk(i, prefix):
        name = nodes[i].get('name', '?')
        p = prefix + '/' + name if prefix else name
        # 全部后缀变体：emo 剪辑相对 joint_face 重扎根，动作剪辑相对 prefab 根
        segs = p.split('/')
        for k in range(1, len(segs)):
            m.setdefault(zlib.crc32('/'.join(segs[k:]).encode('ascii')), '/'.join(segs[k:]))
        for c in nodes[i].get('children', []): walk(c, p)
    for r in j['scenes'][0]['nodes']: walk(r, '')
    return m

CRCMAP = build_crcmap()

def parse_curves(text, section, ncomp):
    # 截取 section: 到下一个顶层 m_XxxCurves:/m_ 字段
    m = re.search(rf'^  {section}:\n(.*?)^  m_\w', text, re.S | re.M)
    if not m: return []
    sec = m.group(1)
    curves = []
    # 每条曲线块以 "  - curve:" 开始，以 "path: xxx" 结束
    for block in re.split(r'\n  - (?=curve:)', sec):
        pm = re.search(r'path: (\S+)', block)
        if not pm: continue
        keys = []
        for km in re.finditer(r'time: ([-\d.e]+)\n\s+value: \{([^}]+)\}', block):
            t = float(km.group(1))
            comps = dict(re.findall(r'(\w+): ([-\d.e]+)', km.group(2)))
            order = ['x', 'y', 'z', 'w'][:ncomp]
            keys.append((t, [float(comps[c]) for c in order]))
        if keys: curves.append((pm.group(1), keys))
    return curves

def convert(anim_path, out_path, clip_name):
    text = open(anim_path, encoding='utf-8').read()
    tracks = []
    unresolved = set()
    for section, ncomp, suffix, ttype in [
        ('m_RotationCurves', 4, 'quaternion', 'quaternion'),
        ('m_PositionCurves', 3, 'position', 'vector'),
        ('m_ScaleCurves', 3, 'scale', 'vector'),
    ]:
        for path, keys in parse_curves(text, section, ncomp):
            hm = re.match(r'path_(\d+)$', path)
            if hm:
                full = CRCMAP.get(int(hm.group(1)))
            else:
                full = path  # 剪辑与 Animator 同 block 导出时路径是明文
            if not full:
                unresolved.add(path); continue
            node = full.split('/')[-1]
            # 坐标系转换（与 cake.glb 同空间，实测 bind 值校准）：
            # position: .anim 是 FBX 厘米制且 X 镜像 → (-x/100, y/100, z/100)
            # quaternion: X 镜像共轭 → (x, -y, -z, w)；scale 不变
            if suffix == 'position':
                times = [k[0] for k in keys]
                values = [c for k in keys for c in (-k[1][0] / 100, k[1][1] / 100, k[1][2] / 100)]
            elif suffix == 'quaternion':
                # AnimeStudio YAML 路径的 muscle 重建对部分关节会产出非单位四元数垃圾
                # （如 Body_top [0.98, 2.46, 1.29, 0.22]，范数≈3）：坏 key 整键丢弃，
                # 其余归一化 + 强制相邻同号（防插值穿零）；全坏则轨道丢弃（该关节保持待机姿态）
                clean = []
                prev = None
                dropped = 0
                for t, v in keys:
                    v = [v[0], -v[1], -v[2], v[3]]  # X 镜像共轭
                    norm = sum(c * c for c in v) ** 0.5
                    if abs(norm - 1) > 0.05:
                        dropped += 1
                        continue
                    q = [c / norm for c in v]
                    if prev and sum(a * b for a, b in zip(q, prev)) < 0:
                        q = [-c for c in q]
                    prev = q
                    clean.append((t, q))
                if dropped:
                    print(f'    ⚠ {node}.quaternion 丢弃坏 key {dropped}/{len(keys)}')
                keys = clean
                if not keys:
                    continue
                times = [k[0] for k in keys]
                values = [c for k in keys for c in k[1]]
            else:
                times = [k[0] for k in keys]
                values = [v for k in keys for v in k[1]]
            tracks.append({'name': f'{node}.{suffix}', 'type': ttype, 'times': times, 'values': values})
    dur = max((t['times'][-1] for t in tracks), default=0)
    clip = {'name': clip_name, 'duration': dur, 'tracks': tracks, 'blendMode': 2500, 'uuid': '00000000-0000-0000-0000-000000000001'}
    json.dump(clip, open(out_path, 'w'), separators=(',', ':'))
    print(f'{os.path.basename(anim_path)}: tracks={len(tracks)} dur={dur:.2f}s unresolved={sorted(unresolved) or "无"} -> {out_path}')

if __name__ == '__main__':
    base = os.path.expanduser('~/cat-pet/tools/import5/assets/asbres/characters')
    out = os.path.expanduser('~/cat-pet/desktop/renderer/models/anims')
    jobs = [
        # 表情（emo 剪辑组）：眨眼自动播，眯眼笑/复位给互动表情用
        ('emotionclip/special/ruanmadecake_00/Emo_RuanMadeCake_00_Ani_Blink.anim', 'blink.json', 'Blink'),
        ('emotion/special/ruanmadecake_00/Emo_RuanMadeCake_00_Close01_Eye.anim', 'close-eye.json', 'CloseEye'),
        ('emotion/special/ruanmadecake_00/Emo_RuanMadeCake_00_Default_Eye.anim', 'default-eye.json', 'DefaultEye'),
        # 动作补充（GLB 动画库里没有、只有 .anim 的那些）
        ('npc/special/ruanmadecake/animation/NPC_RuanMadeCake_00_Adv_Ani_Jump01.anim', 'jump.json', 'Jump'),
        ('npc/special/ruanmadecake/animation/NPC_RuanMadeCake_00_Adv_Ani_Landing01.anim', 'landing.json', 'Landing'),
        ('npc/special/ruanmadecake/animation/NPC_RuanMadeCake_00_Adv_Ani_Hit01.anim', 'hit.json', 'Hit'),
        ('npc/special/ruanmadecake/animation/NPC_RuanMadeCake_00_Adv_Ani_Falldown01Loop.anim', 'falldown.json', 'Falldown'),
        ('npc/special/ruanmadecake/animation/NPC_RuanMadeCake_00_Adv_Ani_Move01.anim', 'move.json', 'Move'),
        ('npc/special/ruanmadecake/animation/NPC_RuanMadeCake_00_Adv_Ani_Move01AS.anim', 'moveas.json', 'MoveAS'),
    ]
    for src, dst, name in jobs:
        convert(f'{base}/{src}', f'{out}/{dst}', name)
