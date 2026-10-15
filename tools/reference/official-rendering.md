# 官方猫糕渲染规格（拆包实证，2026-09-07）

> 来源：40 套官方材质 JSON dump（本机 iOS 数据，`tools/assetmap-ios/allmats/`）。
> 用途：three.js 端复刻官方渲染效果。参数已提取到 `desktop/renderer/models/skinparams.json`。

## 渲染特征（HSR NPC 卡通 shader，40 个变体参数完全一致）

| 特征 | 官方参数 | three.js 复刻方式 |
|---|---|---|
| 卡通阴影 | `_ShadowThreshold 0.5` + `_ShadowFeather 0.01`（NdotL 硬阶跃+微羽化） | 自定义 shader：`smoothstep(0.5-0.01, 0.5+0.01, NdotL)` |
| 阴影染色 | `_ShadowDiffuseColor` 每变体不同（乘在暗部） | 暗部 = albedo × shadowColor |
| 描边 | `_OutlineWidth 0.03`（inverted hull）+ `_OutlineColor0` 每变体不同（普遍是深色） | BackSide 壳沿法线外扩，常色输出 |
| 边缘光 | `_RimWidth0 0.4` + `_RimColor0` 每变体不同 | fresnel^系数 × rimColor 叠加 |
| 高光 | `_SpecularIntensity 1.27` + `_SpecularShininess 12.8`（Blinn 系） | `pow(spec, 12.8) × 1.27` |
| 双面 | `_CullMode 0`（关闭剔除） | `side: DoubleSide`（或 FrontSide 视效果） |
| 变体换色 | 00~05 用 `_MainTex + _AlphaTex` 双贴图（Color_A 底色 + Color_RGB 区域 mask + CustomColor2~13 调色）；03+ 用单 `_MainTex`（颜色已烘焙进贴图） | 桌面端直接用单 Color 贴图即可（00/01 例外：Color_A 是灰度底图，颜色在 RGB mask+CustomColor 里——我们手上的 skin 贴图对 00/01 槽位用的是 Color_A，显示会偏灰，这俩槽位是 1.6 老皮不在 27 名册内，无影响） |

## 变体差异参数（每变体 3 个颜色，其余全部一致）

- `_ShadowDiffuseColor` / `_RimColor0` / `_OutlineColor0`：已按 cake01~27 提取进 skinparams.json
- 全局共享：shadowThreshold=0.5, shadowFeather=0.01, rimWidth=0.4, specularIntensity=1.27, specularShininess=12.8, outlineWidth=0.03

## 桌面端实际落地的调整（2026-09-08 用户验收后）

- 色彩管线：全 gamma（贴图 NoColorSpace 直通、shader 不做 sRGB 编解码）——线性空间乘暗部会比 Unity gamma 语义暗一倍，「蒙雾」根因
- 光照：主光方向 (0.55, 0.75, 0.5)——贴脸光会整只平掉发白；带角度才有体积感
- 后期调色（游戏调色模拟，非官方参数）：提饱和 ×1.25 + pow(col, 1.22) 压中间调——用户验收标准是和游戏/2.0 一样浓郁
- 不用 rim/specular（会洗白眼球，用户明确要去掉）；描边常显（inverted hull 0.03，变体 outlineColor）

## 已知缺口

- **饰品 3D 配件未导出**：饰品系猫糕（帽子/眼镜/光环等）是独立网格，模型 GLB 里只有 Body。皮肤贴图画了部分配饰图案，立体配件需二次定向导出（命名待查，可能在同 block 的其他 FBX）。
- **官方动画未转换**：`npc_ruanmadecake_00_adv_ani_roar01as.fbx`（吼叫）等在导出清单里但 zip 只有 1 个 GLB——动画 FBX 疑似未随 GameObject 导出或转换失败，需要时单独定向导出（--types Animator 或 AnimationClip:Both）。
- 表情（眨眼 brow/mouth FBX）同上。
- 描边壳 vs 我们的流光壳：官方描边是**常时显示**的深色细边；我们的流光是交互时的彩色发光——两者不冲突，可以共存（两个壳或一个 shader 两个模式）。
