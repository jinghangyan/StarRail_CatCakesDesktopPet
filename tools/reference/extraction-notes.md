# 猫糕资产解包笔记（2026-09-07 本机 iOS 数据实证）

## 结论：一条筛选规则 `ruanmadecake` 全搞定

官方内部命名是 **RuanMadeCake**（阮梅造物）。4.2 的 27 只是同一基础模型的材质变体：

- 基础模型：`assets/asbres/characters/npc/special/ruanmadecake/art_npc_special_ruanmadecake_00.prefab`
- 材质变体：`npc/special/ruanmadecake/matierials/npc_special_ruanmadecake_00~39_body_mat.mat`（40 个，含 NPC 版，27 只收集款在其中）
- 变体贴图：`texture/npc_special_ruanmadecake_NN_color.tga`（00/01 为 _color_a + _color_rgb 双贴图）+ `decal1~4_NN_color.tga` 饰品花纹
- 动画：`animation/npc_ruanmadecake_00_adv_ani_roar01as.fbx` + `characterprefabs/.../ruanmadecake_00/...anicontroller.controller` + 表情 `emotion/special/00_common/ruanmadecake/`（brow/mouth）+ `emotionclip/.../emo_ruanmadecake_00_ani_blink.anim`
- 1.6 老活动相关名：CakeRace（活动代号）、Eff_Origin_..._RuanMadeCake_*（特效）；4.2 活动代号 CakeCatch（UI 资产居多，CakeCat1~6 只是 UI Animator 名，不是模型）
- 干扰项勿导：RuanMadeShaoMai（烧麦，另一种造物）

## 变体编号 ↔ 官方名映射

材质编号 00~39 与官方名的对应关系待确定（阶段 2 拿到贴图后与 tools/reference/roster.md 图鉴目视比对）。

## 技术备忘

- AssetMap 建索引用 `--map_type XML`（流式防 OOM）；JSON 走内存全量路径会炸
- `--types GameObject` 会开启 GameObject 全量解析（慢 40 倍）；默认（不带 --types）不解析 GameObject，所以索引里没有 GameObject 条目——**侦查别指望 GameObject 计数**，看 Mesh/Material/Texture2D 的名字就够
- 位置参数必须放在 `--types` 等 AllowMultipleArgumentsPerToken 选项之前会被吞——GUI 命令已按「选项在前、路径在后且 --types 后紧跟其他选项」排列，安全
- XML 写入遇到非法字符（资产名带控制符）会让 XmlWriter 进错误态废掉整个文件——已给 AnimeStudio 打 SanitizeXml 补丁（~/AnimeStudio/AnimeStudio/AssetsHelper.cs）
- 导出用 `--map_op Load,AssetMap`（单 Load 不含 AssetMap 位，会全量重扫）
- macOS 本机可跑 AnimeStudio CLI（本地 dotnet 9 SDK 在 tools/dotnet/，Oodle dylib 可用），但 FBX 导出是 Windows 原生库——模型导出仍需 Windows（同学跑 GUI exe）
- 本机 iOS 数据索引产物：tools/assetmap-ios/shards/shard*/out/shard*.xml（8 分片并行约 1.4h；all-names.txt 36.9 万唯一资产名 / all-containers.txt 全容器清单）

## 2026-09-10 补充：art prefab 真相（侦查纠错）

- **art prefab 里没有 Face 网格、没有配件网格**——之前笔记的归属判断有误：iOS block 里那个 "Face" mesh 是 PamChef（另一个 NPC）的。猫糕表情靠**眼睑骨骼（L/R_Upperlid/Lowerlid_01~15_JNT）+ emotion AnimationClip**（`emotion*/.../emo_ruanmadecake_00_*.fbx` 容器），不需要独立 Face 网格
- art prefab 唯一的 renderer 是 Body 的 SkinnedMeshRenderer，`m_Mesh` 是**跨 block 外部引用**（指向 model FBX 所在 block）；CLI 逐 block 隔离加载（Program.cs 加载→导出→Clear），`PPtr.TryGet` 失败 → `has no mesh, skipping`；产物里那些纯骨架 GLB 其实是 **Animator 导出路径**写的（无 MeshList 非空检查）
- 修复方案（未实施，优先级低——art prefab 修好也只多个同样的 Body 网格）：CLI 加 CABMap 依赖解析（`AssetsHelper.LoadCABMapInternal` + `assetsManager.ResolveDependencies = true`），或导出循环改为候选 block 一次性同会话加载
- 墨镜/帽子配件 mesh 在 catcake 相关 block 里**都没找到**：配件很可能纯贴图（画在身体 UV 上，20 号贴图有砂金粉镜片实证），pet3d.js 的配件挂载骨架留作备用（无配置时 no-op）
- iOS 数据 Mesh 深解析会 EndOfStream（Mesh.cs:515 SubMesh 阶段），本机只能侦查不能导 mesh；正式导出走 Windows

## 2026-09-10 补充：AnimationClip 修复（已打进管线 v6）

- **根因**：SR 的 `ClipMuscleConstant.m_IndexArray` 实际是 **int16[]**，上游按 typetree 哈希白名单门控，当前 SR 版本（Unity 2019.4.34f1）哈希 `AC7ACA4D7AF2D1C1A4498E0FC82DA456` 不在名单 → 按 int32 读 → 全字段错位 → EndOfStream/Overflow。决定性证据：m_MuscleClipSize 恒等于 int16 实际大小 + 2n+8（米哈游序列化器按 int32 算大小、按 int16 写数据）
- **补丁**（animestudio-build，第 6 个自维护补丁）：`AnimationClip.cs:1637` SR/ZZZ 恒按 int16 读；另 `CLI/Studio.cs:336` 容器遍历越界防御（iOS 损坏数据用，PC 不触发）
- **验证**：本机 iOS block 修复前 44/44 剪辑失败 → 修复后 15/15 完好剪辑全部解析成功（60fps、时长自洽、ACL blob 结构完整）。剩余 29 个 iOS 剪辑坏是 Ooze 解压损坏（本机 ooz 库问题），PC 官方 Oodle 无此问题
- 本机不能验证最后一步 ACL→曲线（AnimeStudio.ACL.SR 只有 Windows DLL，vendored C++ 源码头文件不自洽编不过）；PC 管线包自带该 DLL
- 管线已升 **v6**（PIPELINE_VERSION=6，强制同学端重导）

## 2026-09-10 补充②：.anim YAML 路径不可用 / 管线 v7

- **AnimationClipConverter（.anim YAML 导出）的 muscle 重建对动作剪辑大面积损坏**：非单位四元数（范数≈3，CatBody/Body_top 全灭），蒙皮撕裂的元凶。emo 眼睑剪辑是纯曲线没坏。逐轨道对比实锤：Roar01AS 的 .anim 版 vs GLB（FBX 烘焙）版 83/167 首帧不一致
- 结论：**动作剪辑只能走 FBX 烘焙路径**（ModelConverter）；.anim 只配给 emo 这种纯曲线剪辑用
- 管线 v7（补丁 7）：补丁 4 的剪辑注入原来只覆盖与 Animator 同 block 的剪辑（Jump/Hit/Move 等在 animation/*.fbx 的 block 里全漏）；改为导出前预收集全部候选 block 的剪辑跨 block 累积（AnimationClip 解析后是纯托管内存数据，源 block Clear 后仍可烘焙，无需 CABMap 依赖解析）
- **管线 v8 已交付全量剪辑（2026-09-10 晚）**：主 art prefab GLB 烘出 26 个剪辑（含 Jump/Landing/Hit/Falldown/Move/MoveAS + emo 组），桌宠端全部改用 GLB 版，.anim 转换的 .json 已删除（anim2clip.py 留档备用）。cakerace 容器的 prefab GLB 还带上了 Body 网格+3 skins+活动剪辑（CakeRace_Teleport/Find/CloseEye 三段）——以后想要活动限定动作去 `ui/ui3d/cakerace/` 那份里拿
- 桌宠端 .anim→three.js 转换器（`tools/anim2clip.py`）坐标系结论：position = (-x/100, y/100, z/100)（FBX 厘米制+X 镜像）、quaternion = (x,-y,-z,w)（X 镜像共轭）；路径哈希 = zlib.crc32（emo 剪辑相对 joint_face 扎根，需全后缀暴破）

## 2026-09-08 补充：配件/表情/动画（⚠️ 前两条已被 09-10 调查推翻，以上方新结论为准）

- ~~配件渲染网格在完整 art prefab 里~~（错：prefab 里没有任何配件 renderer）～配件画在身体贴图 UV 区域（20 号贴图找到砂金粉镜片）这条仍成立～
- ~~模型 block（shard4 bb947b8...）里有 Face 网格~~（错：那是 PamChef 的）～44 个 AnimationClip 确实在，但大多属同 block 其它 NPC，猫糕的是 `npc_ruanmadecake_00_adv_ani_roar01as` 等～
- art prefab 导出曾栈溢出 → 已修（HasMesh 断环补丁，GameObject.cs）；补丁版 DLL 已打进 GUI exe 内嵌工具
- iOS 数据局限：深度解析（动画曲线/完整 prefab 遍历）会 EndOfStream，只能侦查；正式导出走 PC（同学）
- PC 版动画清单比 iOS 更全：StandBy / Roar01AS / Roar01BS / Roar01Loop / Talk01
