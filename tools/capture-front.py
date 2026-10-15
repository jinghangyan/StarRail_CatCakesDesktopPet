#!/usr/bin/env python3
"""重截猫猫糕「2D·正视」渲染图（desktop/renderer/cakes/cakeNN.webp）。

用法：
  cd ~/cat-pet/desktop && npm start -- --remote-debugging-port=9222   # 先把桌宠跑起来
  ~/cat-pet/tools/.venv/bin/python ~/cat-pet/tools/capture-front.py cake01          # 试截一只到 /tmp
  ~/cat-pet/tools/.venv/bin/python ~/cat-pet/tools/capture-front.py --all --write   # 全量 29 只写入 renderer/cakes/

原理（HANDOFF 的 CDP 姿势）：
  - CDP 连宠物窗（index.html），pet3d.setViewAngle(0,0) 保证严格正视（不动用户持久化配置）
  - 逐只 window.setCake(cakeNN)，等模型加载后 Page.captureScreenshot
  - Pillow 按 alpha 包围盒裁剪、居中贴回 512x512 透明底、存 webp
  - 结束后恢复用户的猫 / 视角 / 显示模式 / DOM 覆盖层
"""
import base64
import json
import sys
import time
import urllib.request
from pathlib import Path

import websocket
from PIL import Image
from io import BytesIO

ROOT = Path(__file__).resolve().parent.parent
CAKES_DIR = ROOT / 'desktop/renderer/cakes'
CDP = 'http://localhost:9222'
HIDE_IDS = ['drag', 'shadow', 'edgeGlow', 'cake', 'bubble', 'hint', 'resizer']
CANVAS = 512   # 输出尺寸
CONTENT = 470  # 内容最长边（留边，和旧图观感一致）

_id = 0
_ws = None


def connect():
    global _ws
    tabs = json.load(urllib.request.urlopen(CDP + '/json'))
    pet = next(t for t in tabs if t.get('type') == 'page' and 'index.html' in t.get('url', ''))
    _ws = websocket.create_connection(pet['webSocketDebuggerUrl'], suppress_origin=True, timeout=30)
    cmd('Page.enable')


def cmd(method, **params):
    global _id
    _id += 1
    _ws.send(json.dumps({'id': _id, 'method': method, 'params': params}))
    while True:
        msg = json.loads(_ws.recv())
        if msg.get('id') == _id:
            if 'error' in msg:
                raise RuntimeError(f"{method}: {msg['error']}")
            return msg.get('result', {})


def js(expr):
    r = cmd('Runtime.evaluate', expression=expr, returnByValue=True, awaitPromise=True)
    return r.get('result', {}).get('value')


def shot():
    data = cmd('Page.captureScreenshot', format='png')['data']
    return Image.open(BytesIO(base64.b64decode(data))).convert('RGBA')


def to_webp(png, out):
    """alpha 包围盒裁剪 → 等比缩到 CONTENT → 居中贴 512x512 透明底 → webp"""
    bbox = png.split()[3].getbbox()
    if not bbox:
        raise RuntimeError('截图为空（猫没渲染出来？）')
    crop = png.crop(bbox)
    scale = CONTENT / max(crop.size)
    crop = crop.resize((round(crop.width * scale), round(crop.height * scale)), Image.LANCZOS)
    canvas = Image.new('RGBA', (CANVAS, CANVAS), (0, 0, 0, 0))
    canvas.paste(crop, ((CANVAS - crop.width) // 2, (CANVAS - crop.height) // 2), crop)
    canvas.save(out, 'webp', quality=92)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    write = '--write' in sys.argv
    out_arg = next((a.split('=', 1)[1] for a in sys.argv[1:] if a.startswith('--out=')), None)
    ids = args if args else [f'cake{i:02d}' for i in range(1, 30)]
    out_dir = Path(out_arg) if out_arg else (CAKES_DIR if write else Path('/tmp/capture-front'))
    out_dir.mkdir(parents=True, exist_ok=True)

    connect()
    # 保存现场（全是不落盘的内存态切换，用户配置不动）
    saved = js('JSON.stringify({cake: window.currentCakeId, view: pet3d.getViewAngle(), mode: pet3d.renderMode, petSize: pet3d.debugInfo().petSize})')
    saved = json.loads(saved)
    print('保存现场:', saved)
    js('pet3d.setRenderMode("3d"); pet3d.setViewAngle(0, 0); void 0')
    js('window.api.resizeWindow(560, false); void 0')  # 临时调大取景（不落盘），截图更清楚
    js(''.join(f'document.getElementById("{i}").style.visibility="hidden";' for i in HIDE_IDS) + 'void 0')
    time.sleep(2.5)  # 等 3D 布局/相机/窗口重贴稳定
    js('pet3d.setAnimFrozen(true); void 0')  # 冻结动画：每只都截 StandBy 第 0 帧，姿态统一不眨眼

    try:
        for cid in ids:
            js(f'window.setCake("{cid}"); void 0')
            time.sleep(2 if cid == ids[0] else 1.2)  # 首只要等 base 模型+皮肤加载
            js('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))')  # 等两帧
            png = shot()
            out = out_dir / f'{cid}.webp'
            to_webp(png, out)
            print('OK', cid, '->', out)
    finally:
        # 恢复现场
        js(f'window.setCake("{saved["cake"]}"); void 0')
        js(f'pet3d.setViewAngle({saved["view"]["yaw"]}, {saved["view"]["pitch"]}); void 0')
        js(f'pet3d.setRenderMode("{saved["mode"]}"); void 0')
        js(f'window.api.resizeWindow({saved["petSize"]}, false); void 0')
        js('pet3d.setAnimFrozen(false); void 0')
        js(''.join(f'document.getElementById("{i}").style.visibility="";' for i in HIDE_IDS) + 'void 0')
        print('已恢复现场')


if __name__ == '__main__':
    main()
