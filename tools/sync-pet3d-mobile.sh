#!/bin/bash
# 桌面端 pet3d 渲染器 → 手机端资产同步（pet3d.js / 模型 / 动画 / vendor 的真源都在 desktop/renderer/）
# 改了桌面端渲染器后跑一遍这个脚本，手机端资产即同步。皮肤走 webp q95（包体积 39.8MB→6.5MB）
set -e
cd "$(dirname "$0")/.."
DST=mobile/assets/pet3d
mkdir -p "$DST/models"

cp desktop/renderer/pet3d.js "$DST/"
cp desktop/renderer/models/cake.glb desktop/renderer/models/anims.json desktop/renderer/models/skinparams.json "$DST/models/"
rm -rf "$DST/models/anims" && cp -R desktop/renderer/models/anims "$DST/models/"
rm -rf "$DST/vendor" && cp -R desktop/renderer/vendor "$DST/"

PY=tools/.venv/bin/python; [ -x "$PY" ] || PY=python3
"$PY" - <<'EOF'
from PIL import Image
import os
src = 'desktop/renderer/models'
dst = 'mobile/assets/pet3d/models'
for f in sorted(os.listdir(src)):
    if f.startswith('skin') and f.endswith('.png'):
        Image.open(os.path.join(src, f)).save(
            os.path.join(dst, f[:-4] + '.webp'), 'WEBP', quality=95, method=4)
print('skins synced')
EOF
echo "sync-pet3d-mobile done"
