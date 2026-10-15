# 桌宠猫猫糕 · 项目交接文档

> 给新会话的 AI/开发者：读完这份文档即可无缝接手。最后更新：2026-10-12

## 项目是什么

桌面宠物应用「桌宠猫猫糕」：29 只猫猫糕（崩坏：星穹铁道官方模型，3D 渲染）住在电脑桌面上，可点击互动（动作/轮廓流光/猫叫/说台词）、Shift+拖动旋转视角；支持联机——朋友间互发消息和「戳一戳」，对方桌宠会做出反应（像微信一样）。四端：macOS、Windows、Android、iOS（PWA 网页版）。

- GitHub 仓库：https://github.com/jinghangyan/StarRail_CatCakesDesktopPet （Public，gh-pages 分支托管网页版）
- 作者：@渊源远愿（B站 space.bilibili.com/291097096），QQ 群 537022910

## 技术栈

- 桌面端：Electron 33（无构建工具，纯 HTML/CSS/JS + CDN 加载 supabase-js）+ **Three.js r0.185.1（renderer/vendor/three/ 本地化）3D 渲染官方猫糕模型**
- 手机端：Flutter 3.44（Android APK + Web PWA），**仍是 2D**（v3.0.0 只做了桌面端 3D）
- 后端：Supabase 免费版（用户自建的私有项目，配置不在代码库里，由每个使用者在 App 内自行填写）
- 托管：GitHub Releases（安装包）+ GitHub Pages / Cloudflare Pages（网页版）
- 解包工具链：AnimeStudio（上游 master + 自维护补丁，见下）+ FBX2glTF，打成一个 Windows GUI exe 由有 PC 版星铁的朋友执行

## 目录结构（项目根：~/cat-pet）

```
cat-pet/
├── README.md                  # 项目说明（含版本号规则）
├── HANDOFF.md                 # 本文件
├── supabase/                  # 建表脚本 + 三段修复 SQL（用户已执行）
├── desktop/                   # Electron 桌面端
│   ├── main.js / preload.js   # 主进程（含 cake:// 协议、win:shape 异形窗口 IPC、单实例锁）
│   ├── renderer/
│   │   ├── index.html(宠物窗) social.html(联机窗) settings/login/picker/phrases/meows/about/tutorial/anims.html
│   │   ├── pet3d.js           # ★ 3D 渲染引擎（官方 toon shader、动作、包络取景，详见下文架构）
│   │   ├── vendor/three/      # three.module.min.js + GLTFLoader/SkeletonUtils 等（r0.185.1）
│   │   ├── models/            # cake.glb（官方基础模型）+ skin01~29.png（2048 皮肤）+ skinparams.json（变体参数）
│   │   ├── cakes/             # 2D·正视渲染图 webp（cake01~29，capture-front.py 冻结动画正视重截；picker 2D·正视缩略图 + 2D 兜底渲染）
│   │   ├── cakes-art/         # 2D·官方侧视立绘 webp（cake01~27，用户提供的 2.x 资产；cake28/29 无立绘自动回退正视图）
│   │   ├── cakes3d/           # 3D 渲染缩略图 webp（cake01~29，picker 的 3D 模式缩略图）
│   │   ├── meows/ assets/ schema.sql phrases.js names.js
│   │   └── cake.js / interact.js / supabase-client.js
│   ├── build/                 # icon.png 修复安装.command 安装说明.txt（打进 dmg）
│   └── dist/
├── mobile/                    # Flutter 手机端（2D 不变）
└── tools/
    ├── capture-front.py       # 2D·正视图重截（CDP 驱动 + pet3d.setAnimFrozen 冻结动画，--write 写入 renderer/cakes/）
    ├── extract-catcakes/      # ★ 解包工具（GUI exe：app/dist/猫猫糕提取工具.exe；run.bat/ps1 备用）
    │   └── app/               # Electron GUI（管线：分片并行建索引→侦查→两条导出→FBX2glTF→tar 打包）
    ├── animestudio-build/     # ★ AnimeStudio 上游 master(02994d5c) + 桌宠补丁的源码副本（发布工具链用）
    ├── reference/             # roster.md（官方名册）图鉴图×2 skin-mapping.md official-rendering.md extraction-notes.md
    ├── assetmap-ios/          # 本机 iOS 数据侦查产物（shard XML、all-names.txt、all-containers.txt、材质 dump）
    ├── dotnet/                # 本地 .NET 9 SDK（构建 AnimeStudio 用，不进 git）
    └── .venv/                 # Python 环境（Pillow 等，拼贴图/处理用）
```

## 当前版本与状态

- 版本号规则：X 大功能 / Y 小功能 / Z 修 bug；四端同号；tag 为 vX.Y.Z
- 当前 Release：**v2.0.1**；**v3.0.0 已打包待内测（2026-09-10 晚）**：
  - `desktop/dist/桌宠猫猫糕-3.0.0-arm64.dmg`（152MB，已注入修复安装.command+安装说明）+ `desktop/dist/桌宠猫猫糕 Setup 3.0.0.exe`（124MB nsis）
  - 用户正在内测；**bug 反馈在新会话修**；内测通过后走 Release 上传（需用户提供新 GitHub token，README/发版说明到时再写）
  - package.json 已升 3.0.0；**手机端已同步升 3.0.0（2026-09-24）**：cakeIds 补 cake28/29（名称走「猫猫糕 #N」回退、台词走 defaultPhrases 回退，等用户 App 内命名）、立绘用正视渲染图 webp 顶替（无侧视立绘，同桌面端回退策略）、pubspec version 3.0.0+3、描述改 29 只。台词/叫声两端已逐字核对一致无需同步
- 桌面端 3D 化已完成的部分：
  - **官方模型+皮肤**：1 个基础模型 GLB（95 节点骨架）+ 29 只皮肤（cake01~27 官方名册 + cake28/29 两只新猫待用户命名）。皮肤编号映射在 `tools/reference/skin-mapping.md`（含用户实机修正的 4 处连环错位：蓝莓罐子→23、白桃布丁→24、蝶豆花慕斯→28、藤萝饼→05）
  - **官方动画**（models/anims/ + anims.json）：StandBy 常驻待机循环、Blink 自动眨眼（emo 剪辑转换）、点击动作映射 Roar01AS/BS/Loop/Talk01（交叉淡入淡出）；资产来自管线 v6（AnimationClip int16 修复）
  - **官方渲染复刻**（`tools/reference/official-rendering.md` 有完整规格）：NdotL 0.5 硬阶跃卡通阴影 + 暗部乘变体 shadowColor + 常时描边（inverted hull，变体 outlineColor）；全 gamma 管线；主光带角度 (0.55,0.75,0.5)；用户可调的调色（gradeSat 默认 1.25 / gradeGamma 默认 1.22）；**无 rim 无高光**（用户要求像游戏一样干净）
  - **窗口架构**：canvas 铺满窗口 + 相机 fit 世界坐标静态包络（computeEnvelope 角点法）+ 窗口=包络冻结（动作/旋转期间不变形不抖动）；别再走「DOM 偏移+CSS scale+setBounds」多层坐标链（血泪坑 16）
  - **交互**：点击动作 5 种 + 待机 4 种（程序化）、Shift+拖动旋转（viewYaw/viewPitch 持久化）、双击复位、轮廓流光（Fresnel 壳）、raycast 命中穿透
  - **设置页**（380×640）：显示模式三选一（renderMode：`3d` 官方模型实时渲染 / `2d` 正视渲染图 / `2d-art` 官方侧视立绘，可逆）、视角滑块小节、3D 显示调色滑块；右键菜单有视角操作提示灰字
  - **2D 双图源**（2026-09-11，内测反馈「2D 没用用户给的 webp」）：`cakes-art/` = 用户提供的官方侧视立绘 27 只（源自 mobile/assets/cakes，编号与 names.js 名册 1:1）；`cakes/` = `tools/capture-front.py` 重截的正视渲染图 29 只（viewYaw/Pitch=0 + `pet3d.setAnimFrozen(true)` 冻结 StandBy 第 0 帧，姿态统一不眨眼）。cake.js 按 renderMode 选目录、onerror 一次性回退（cake28/29 无立绘→正视图）、prefs 变化热切；picker 缩略图三模式各自主源+兜底
  - **picker**：数据驱动（从 skinparams.json 推导猫数）、缩略图按 renderMode 三套（cakes-art/ vs cakes/ vs cakes3d/，互兜底）
  - 主进程新增：cake:// 协议（fetch 模型/皮肤参数）、win:shape IPC、单实例锁
- 待办（按优先级）：
  1. ~~等同学跑最后一遍解包~~ ✅ **已完成（2026-09-10）**：第二包（tools/import5/）拿到全部 5 个官方动画（StandBy 2.77s / Roar01AS 1.10s / Roar01BS 0.23s / Roar01Loop 1.70s / Talk01 2.90s，全部驱动 68 个眼睑关节）+ emo .anim 剪辑组（含 Blink）。AnimationClip 解析 bug（int16 索引）已修复并打进管线 v6
  2. ✅ **官方动画已接入 pet3d.js 并 CDP 验收（2026-09-10）**：
     - 资产已就位：`models/anims/ruanmadecake-anims.glb`（5 剪辑动画库，源自主 art prefab）+ `models/anims/blink.json`（emo 眨眼剪辑）+ `models/anims.json` 清单（支持 `文件.glb#剪辑名` 和 `.json` 两种来源；.json 走 `THREE.AnimationClip.parse`）
     - StandBy 常驻打底循环、Blink 每 3~7 秒自动播（截图验收眼全闭/睁开正常）、点击动作映射 Roar/Talk（交叉淡入淡出）、hitTest/包络无回归
     - main.js 的 cake:// 协议已支持 models/ 子目录（原来 basename 会拍扁 anims/）
     - `tools/anim2clip.py`：.anim (Unity YAML) → THREE clip JSON 转换器。路径哈希 = zlib.crc32（**全部后缀变体**暴破：emo 剪辑相对 joint_face 扎根、动作剪辑相对 prefab 根；明文路径直接透传）。8 个剪辑已转完
     - 配件挂载骨架保留但预期用不上（配件纯贴图）；cake-full.glb 机制保留（art prefab 无网格，暂时用不到）
  3. ✅ **全部表情/动作剪辑接入完成（2026-09-10 晚，管线 v8 产物验收全绿）**：
     - ✅ 已实现并 CDP 验收：Roar 三段连播（act-wiggle = AS→Loop→BS）、Talk01（act-tilt + 收到文字消息）、**表情层**（独立 exprMixer 后 update 覆写眼睑：CloseEye 眯眼保持 / DefaultEye 复位 / Blink 挪到表情层）、idle-curl 打盹闭眼、程序化腾空叠加（spec.proc）、`pet3d.play()` 返回 bool + `hasClip()` 供接线方降级
     - ✅ **动作源互斥轮换（用户反馈「待机像海绵」后定的规则）**：同一时刻只用一个动作源——程序化动作（含待机/duang/spin）启动时 StandBy 淡出、播完淡回（startProc/resumeStandby/chainRunning 门控）；官方剪辑连播同理。不再骨架+程序双层叠加
     - ✅ **管线 v8 产物验收**：主 art prefab GLB（2.58MB）烘出 **26 个剪辑全齐**（5 主动画 + Jump/Landing/Hit/Falldown/Move/MoveAS + emo 组 Blink/Close01_Eye/Default_Eye 等），四元数零坏 key、全部轨道目标匹配 cake.glb、无 root motion 甩飞。anims.json 14 个 key 全部指向 GLB（.anim 转换的 .json 已全部删除弃用——AnimeStudio 的 YAML 路径 muscle 重建数据损坏不可救）；art prefab 网格靠依赖解析在 cakerace 副本里带上了 Body（主 prefab 那份还是 Animator 路径产物所以没网格，但桌宠什么都不缺——cake.glb 本来就有全骨架+Body）
     - ✅ 全部功能 CDP 截图验收：戳一戳（Hit 后仰+眯眼笑）、act-hop（Jump+Landing+hop-lift 纯升空叠加，腾空翻转明显）、拖动走路（MoveAS→Move 循环，松手回待机）；（Falldown 摔倒剪辑平视角度脸埋地里观感不对，用户实机否决，已从待机池/设置页/manifest 撤出）、GLB 版眨眼/眯眼/复位
     - 转换器 `tools/anim2clip.py` 已带：全后缀 CRC32 路径暴破、明文路径透传、坐标系转换（**position = (-x/100, y/100, z/100)，quaternion = (x,-y,-z,w) X 镜像共轭**——与 cake.glb bind 值实测校准）、坏四元数 key 过滤。只有数据干净的剪辑可用它
     - 📋 剪辑到齐后的接线（代码已就绪，manifest 加 key 即激活）：戳一戳 → Hit+眯眼笑 2.5s（supabase-client.js，已带 cakeAction 降级）；拖动窗口 → MoveAS→Move 循环（pet3d.dragStart/dragEnd，interact.js 已接）；待机池 idle-fall → Falldown（cake.js 已带 hasClip 门控）；act-hop → Jump+Landing+程序化腾空
     - ✅ **动作设置页 anims.html**（托盘菜单「动作设置」，560×500）：待机/点击两列，每动作小开关+预览按钮（点一下立即做一次）。开关存 config.enabledActions/enabledIdles，cake.js 随机池按池过滤（空池回全开）；预览走 `anim:preview` IPC 转发宠物窗。3D 专属的「摔一跤」带 3D 标（2D/剪辑缺失时自动不出现在池里）
  4. ~~**v3.0.0 发版**~~ ✅ **已发布（2026-10-15）**：
     - **桌面端 v3.0.0** Release 已上线（dmg+exe 已传）；**手机端 v2.1.0** 单独 Release（2D 线从此独立编号，3D 化落地后回归同号，README 已注明）；tag v3.0.0 @基线提交、v2.1.0 @release/mobile-2.1.0 分支
     - **git 基建已就绪**：~/Projects/software/cat-pet 已 init 并推 GitHub（main=源码，替换了原先误传的 web 构建产物；gh-pages 仍是网页版部署分支，已推 v2.1.0 网页版并实测 200）。推送凭证用钥匙串里存的（40 字符 token，git push 和 Releases API 都验证可用）
     - 手机端 v2.1.0 从 `release/mobile-2.1.0` 分支（基线提交+版本号 bump）构建，与主线 3D 开发隔离
     - 内测包仍在 ~/Desktop/内测/（含 网页版-cloudflare-2.1.0.zip，Cloudflare 部署由用户手动传）
     - **已修待验证清单（同学 Windows + 用户 Mac）**：① 缩放屏窗口坐标链（内容坐标系锚定+resize 钉回+主进程光标闭环）② 右键后拖别的窗猫跟着动（手势门禁+看门狗）③ 内存 2.5GB（校准风暴副产品，校准已拆）④ 转圈+吼叫叠播（chainGen 代际+isRunning 守卫；同学后来说看错但隐患真实）⑤ 长按拖静止后一直跳（dragPulse 350ms 超时停走路）⑥ 气泡盖脑袋（改静态包络顶部锚点）⑦ 连预览打盹不闭眼（setExpression 必须在 play 之后，否则被旧动作的 clearExpression 清掉）⑧ phrases 页选不出 cake28/29（改 skinparams 数据驱动）⑨ picker 3D 缩略图角度乱（cakes3d 已用 capture-front.py 重截）⑩ 动作全关回全开（空数组现在=全关，anims.html/cake.js 同步）⑪ **待诊断**：任务管理器聚焦时猫不可交互（日志已备，复现后发 debug-shape.log）⑫ about 页版本号忘升（已改 v3.0.0，2026-09-22）⑬ **i7-2700K 用户 CPU 占用高（2026-09-22 已修）**：老核显走 SwiftShader 软渲染是病根（见坑 28）——pet3d 新增 detectSoftGL 探测 + perfMode 五档（auto/saver/balanced/high/custom，auto 在软渲染机自动落 saver：SSAA 1.0+限 20fps，负载降约 6~7 倍；设置页每档写明清晰度倍率+帧率；custom 档给清晰度 0.5~2.0× + 帧率 15~60 两个滑块，存 perfCustomSSAA/perfCustomFPS；CDP 实测限帧 20.0/30.0/15.0 fps 整、prefs 实时切换生效、2D 模式下置灰）+ 设置页「强制 GPU 渲染（实验）」开关（forceGpu → 主进程启动时 ignore-gpu-blocklist，重启生效，独显被误伤时能救回硬渲；debugInfo() 带 glRenderer/softGL/effMode 让用户发截图即可确诊）⑭ **诊断日志开关+一键导出（2026-09-22）**：设置页「记录诊断数据」（config.diagLog，renderer/diag.js 采集：未捕获错误/unhandledrejection、GL 基线、每 15s 真实帧率+JS 堆内存采样，主进程写 userData/diag.log，开关热切换不用重启）+「导出诊断包」（diag:export IPC：环境信息+config 脱敏（supabaseUrl/anonKey/email 等键名正则剔除，已实测零泄漏）+diag.log+debug-shape.log 合成单个 txt，showSaveDialog 存桌面）。用户工作流：有 bug 开开关→复现→导出发作者→关开关。⑮ **昵称撞车提示张冠李戴（2026-09-24 已修）**：手机端 errors.dart 把所有 duplicate key 都翻成「已经添加过了」——改用户名撞到唯一约束时也这么说；已按约束名区分（username→「这个用户名已经被占用了，换一个吧」），桌面端 social.html 同款修复（原来直接显示英文 PG 错误原文）。⑯ **网页版服务器页提示「重启 App」（2026-09-24 已修，黎昼反馈）**：server_page/tutorial_page 的生效提示按 kIsWeb 分流（网页→「刷新页面后生效」）
  5. ~~手机端同步（名称/新猫）~~ ✅ **已完成（2026-09-24，见上）**；**安卓桌面小组件 ✅（2026-10-12）**：纯原生 Kotlin（CakeWidgetProvider），零插件零 Flutter 引擎参与——点猫挤压弹跳三段帧（Matrix scaleY 0.8→1.12→1.0，Handler 链 150/250ms）+ 随机台词 3 秒后回猫名；猫图直接读 APK 内 `flutter_assets/assets/cakes/`（webp，零重复打包）；数据走 FlutterSharedPreferences（flutter.cake / flutter.widgetName / flutter.widgetPhrases，由 lib/widget_sync.dart 在换猫/载入/改名时写入）；MainActivity 有 `catpet/widget` MethodChannel（refresh → 发 APPWIDGET_UPDATE）。**卓易通（华为纯血鸿蒙容器）大概率加不了小组件**（容器内 App 无法向鸿蒙桌面注册 AppWidget），等用户实测反馈。手机端 3D 化（已定路线：WebView 复用 pet3d.js）/ 安卓悬浮窗活猫——单独排期（v4.0.0 级）
  6. 白桃布丁等新猫名称由用户在 App 内自行命名

## 解包工具链（给新会话的完整上下文）

**为什么需要它**：官方模型/贴图/动画来自游戏资产解包（用户知情承担 DMCA 风险）。Mac 本机不能做 FBX 导出（AnimeStudio 的 FBX 库是 Windows 原生），所以打成一个 Windows exe 让有 PC 版星铁的朋友跑。

**当前版本**：管线 v7 = 上游 master + 7 个自维护补丁。源码在 `tools/animestudio-build/`（改完 `dotnet publish AnimeStudio.CLI -c Release -f net9.0-windows -r win-x64 --self-contained false`，产物拷进 `app/tools/animestudio/AnimeStudio-patched/`，native 库发布包自带），然后 `cd tools/extract-catcakes/app && electron-builder --win --x64`（镜像环境变量见构建命令节）。

**补丁清单**（移植/升级上游时必须重打）：
1. `AssetsHelper.cs` SanitizeXml：资产名非法字符会废掉整个 XML 索引（流式+内存路径全部写出点都包了）
2. `GameObject.cs` HasMesh visited-set 断环（猫糕 art prefab 子节点成环必栈溢出）
3. `Program.cs`：`--types` 带 GameObject 时不再压制 Animator 导出
4. `Exporter.cs`/`Studio.cs`：导出 GameObject/Animator 时显式注入匹配的 AnimationClip（猫糕 prefab 的 Animator 不引用 controller）
5. csproj 去 RuntimeIdentifier win-x64 硬编码（本机测试需要便携 dll）
6. `AnimationClip.cs`：SR/ZZZ 的 `ClipMuscleConstant.m_IndexArray` 恒按 int16 读（上游 typetree 哈希白名单漏了当前 SR 版本，按 int32 读全字段错位；另 `CLI/Studio.cs` 容器遍历越界防御）
7. `CLI/Program.cs`/`Studio.cs`/`Exporter.cs`：跨 block 剪辑预收集注入（补丁 4 原来只注入与 Animator 同 block 的剪辑，Jump/Hit/Move 等在 animation/*.fbx 所在 block 全漏；改为导出前先预收集全部候选 block 的剪辑累积去重，并加 `injected N clips, baked M animations` 验收日志）
8. `CLI/CommandLine.cs`/`Program.cs`/`Exporter.cs` + `AssetsHelper.cs`/`AssetsManager.cs`：跨 block 依赖解析进 CLI——新选项 `--build_cabmap <bin>`（一次性建 CAB 依赖索引，建完即退）和 `--resolve_dependencies <bin>`（导出时加载并启用 ResolveDependencies）。art prefab 的 Body 网格是跨 block 外部引用，不开就 "has no mesh, skipping"。bin 烙了建图目录（BaseFolder），导出输入目录必须相同；游戏大更新后删 bin 重建。附送诊断：丢网格时打 `unresolved mesh -> <CAB> externalLoaded=… headerPresent=…` 区分死因；CABMap 已加载时跳过 externals 扫盘兜底（原来每 block 递归扫盘分钟级白等）

**管线知识**（都踩过真机）：建索引必须 `--map_type XML`（JSON 内存全量会 OOM）；导出 `--map_op Load,AssetMap`（单 Load 会全量重扫）；`--types` 会吞位置参数；分片并行建索引要把分片目录建在游戏所在卷（硬链接同卷）+ 每分片独立工具副本（CNKeys.json 启动写锁竞争）；`--names` 文件路径转正斜杠；zip 用 tar.exe（Compress-Archive 超 260 字符炸）；GUI exe 打包双目标 zip+portable（portable 自解压到 %TEMP% 有概率缺 ffmpeg.dll——杀软/残留锁争抢，zip 解压一次免此坑，优先发 zip）；导出 FBX 清单在转换前必须刷新；断点续跑用 PIPELINE_VERSION 指纹（改管线 +1 强制重导）；**两套索引**：AssetMap（XML，分片并行 ~1.4h）按资产名筛选，CAB map（`--build_cabmap`，几分钟，work\sr_cabs.bin）做跨 block 依赖解析——游戏更新后两个都要重建；依赖解析只给 pass 1（GameObject）开，pass 2（动画）开了纯拖慢；依赖闭包是传递的（prefab→model→材质→贴图），pass 1 会因此从 ~1 分钟涨到 10~30 分钟量级，属预期。

**资产命名**：猫糕 = `RuanMadeCake`（阮梅造物），容器 `assets/asbres/characters/npc/special/ruanmadecake/`。1 基础模型 + 40 材质变体（00~39）+ 皮肤贴图（00/01 双贴图调色系统，03+ 单贴图烘焙）+ Decal1~4 配件贴图 + 动画（StandBy/Roar01AS/BS/Loop/Talk01 + emo 表情剪辑在 `emotion*/` 容器）。干扰项 RuanMadeShaoMai（烧麦）勿导。4.2 活动代号 CakeCatch（UI 资产），1.6 老活动代号 CakeRace。配件（墨镜/帽子）纯画在身体贴图 UV 区域（无独立网格）；表情靠眼睑骨骼+emo 剪辑（无 Face 网格，09-10 已纠错）。**细节全在 `tools/reference/extraction-notes.md`**。

**iOS 数据（本机 `~/Library/Containers/com.miHoYo.hkrpg/`）**：只能做侦查（资产名/容器/材质参数），深度解析会 EndOfStream（上游 master 也救不了 iOS 封装差异）；正式导出走 PC 版。

## 构建/打包命令（重要：含国内镜像和 Java 版本坑）

```bash
# 桌面端（Electron）
export PATH="/opt/homebrew/bin:$PATH"
cd ~/cat-pet/desktop
npm start                    # 开发调试
ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/" \
ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/" \
CSC_IDENTITY_AUTO_DISCOVERY=false npm run build:mac   # dmg+zip（见下方 dmg 重打包说明）
CSC_IDENTITY_AUTO_DISCOVERY=false npm run build:win   # 即 electron-builder --win --x64

# dmg 需要手动重打包以注入修复脚本（build:mac 完成后）：
STAGE=$(mktemp -d) && cp -R "dist/mac-arm64/桌宠猫猫糕.app" "$STAGE/" \
  && cp build/修复安装.command build/安装说明.txt "$STAGE/" \
  && ln -s /Applications "$STAGE/应用程序" \
  && hdiutil create -volname "桌宠猫猫糕 <版本>" -srcfolder "$STAGE" -ov -format UDZO "dist/桌宠猫猫糕-<版本>-arm64.dmg"

# 内测包统一放 ~/Desktop/内测/（2026-09-14 起，用户要求）：dmg + exe 构建完拷过去

# 手机端（Flutter）
export JAVA_HOME=/opt/homebrew/opt/openjdk@21   # 必须用 21，openjdk26 太新 Gradle 不认
cd ~/cat-pet/mobile
flutter build apk --release                                      # Android
flutter build web --release                                      # Cloudflare/根路径版 → build/web
flutter build web --release --base-href=/StarRail_CatCakesDesktopPet/   # GitHub Pages 子路径版
# 打 zip 时注意：cd build/web && zip -qr ../web-root.zip .（不要多包一层 web/ 目录！）

# 解包 GUI exe（Windows 交叉打包）
cd ~/cat-pet/tools/extract-catcakes/app
ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/" \
ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/" \
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --win --x64   # → dist/猫猫糕提取工具.exe

# AnimeStudio 工具链重建（改补丁后）
export DOTNET_ROOT=~/cat-pet/tools/dotnet PATH=~/cat-pet/tools/dotnet:$PATH
cd ~/cat-pet/tools/animestudio-build
dotnet build AnimeStudio.CLI -c Release -f net9.0        # 本机测试（便携 dll 可直接 dotnet 跑）
dotnet publish AnimeStudio.CLI -c Release -f net9.0-windows -r win-x64 --self-contained false -o /tmp/as-win
cp -R /tmp/as-win/* ~/cat-pet/tools/extract-catcakes/app/tools/animestudio/AnimeStudio-patched/
```

## 测试/调试手段（本机实测有效的姿势）

- **CDP 驱动 Electron**：`npm start -- --enable-logging --remote-debugging-port=9222`，websocket 连接带 `suppress_origin=True`（python websocket-client）；渲染进程 console 进 stderr；`pet3d.debugInfo()`/`pet3d.getViewAngle()`/`pet3d.setAnimFrozen(v)`（截图冻结动画）等调试接口可用
- **调试钩子**：`OPEN_ANIMS=1` / `OPEN_SETTINGS=1` 环境变量启动即开对应设置页（main.js whenReady 里）；子窗口 CDP 截图若超时，先 `osascript -e 'tell application "Electron" to activate'` 激活再 `Page.bringToFront`
- **真实帧率测量**：`debugInfo().frameCount` 两次采样差÷间隔 = 实际渲染 fps（验证限帧；rAF 本身永远满帧跑，空转不算）
- **真光标测试**：主进程跟光标的链路要用 `Quartz.CGWarpMouseCursorPosition` 挪真光标（pyobjc，tools/.venv 已装）配合 CDP 注事件；纯 CDP 合成事件不挪 OS 光标
- **坐标排障日志**：win:shape 全链路 + 拖动/拉伸光标 + 穿透切换 + mousedown 门禁 + hide/show 都写 `userData/debug-shape.log`（渲染进程走 `debug:log` IPC）；主进程还有 `debug:toggle-pet` 隐藏/显示钩子（preload `togglePet()`）
- **截图验收**：CDP `Page.captureScreenshot` + ReadMediaFile 自检；picker 等子窗口可 `Page.navigate` 直接导航到对应 html
- **性能/真实性**：真实鼠标链路用 CDP `Input.dispatchMouseEvent`（modifiers=8 是 Shift）；窗口 bounds 用主进程侧记录验证
- Python 环境：tools/.venv（Pillow、websocket-client）； pip 用清华镜像
- 本机网络：jsdelivr 被代理拦（SSL 自签）走 npmmirror；github raw/api 可直连但慢；nightly.link 只支持 GET 不支持 HEAD

## 踩过的坑（新会话别再踩）

1. **Android release 必须显式声明 INTERNET 权限**（已加在 main/AndroidManifest.xml）
2. **Supabase RLS 自引用递归**：必须用 `is_group_member()` security definer 函数（schema.sql 已是修复版）
3. **Supabase 新版项目默认开 Realtime Authorization**：客户端改为公共频道 + 轮询兜底（桌面宠物窗 5s、桌面聊天 3s、手机聊天 3s、手机全局通知 6s）
4. **Electron 不支持 window.prompt()**：改名/邀请用内嵌输入条（social.html inlinePrompt）
5. **Electron 透明窗口**：鼠标穿透 setIgnoreMouseEvents(true,{forward:true}) + 悬停命中检测；2D 模式缩放用容器 transform: scale（zoom 在 Windows 上有 bug）
6. **file:// 下 fetch 本地文件失败**：schema.sql 由主进程 IPC 提供（schema:get）
7. **file:// 跨目录播放音频被拦**：自定义叫声走 meow:// 自定义协议
8. **file_picker 要 compileSdk 36 + coreLibraryDesugaring**（flutter_local_notifications）
9. **Flutter Web 中文豆腐块**：已内置 AppFont.otf 精简字体。新增 UI 文案若用了新汉字，重新生成字体子集：
   `pyftsubset /tmp/NotoSansCJKsc-Regular.otf --text-file=<字符集> --output-file=assets/AppFont.otf --layout-features='*'`
10. **Gradle 只认 Java 21**：/opt/homebrew/opt/openjdk@21
11. **网页上传 GitHub 有总大小限制**：用 git 推送 gh-pages 分支
12. **macOS 未签名 App「已损坏」**：xattr -cr 解决，dmg 里带 修复安装.command
13. **Electron file:// 下 fetch 自定义协议要额外权限**：registerSchemesAsPrivileged 必须加 `standard:true, supportFetchAPI:true, stream:true`（meow:// 只喂 <audio> 不需要；GLTFLoader 走 fetch 需要）
14. **three.js 发光壳别在 traverse 回调里 add 子节点**：会壳套壳无限递归，先收集 mesh 再统一 add
15. **本机代理会拦 jsdelivr**（SSL 自签）：npm 包资源走 npmmirror tgz
16. **桌宠 3D 定位别用「DOM 偏移 + CSS scale + setBounds」多层坐标链**（连续 4 轮修不好的血泪）：正确架构是 **canvas 铺满窗口 + 相机 fit 世界坐标包络 + 窗口=包络尺寸冻结**（pet3d.js computeEnvelope 角点法/fitCamera/layout）。2D 兜底模式仍走旧 scale 体系，applyZoom 按 pet3dOn() 分流
17. **macOS setBounds 同改 y+height 会吞 y**：拆 setPosition + setSize；invoke 后立即 getBounds 返回 stale 值
18. **AnimeStudio 的坑一箩筐**：GameObject 导出要 HasModel()（无网格跳过）；`--types` 会吞位置参数；GameObject/Animator 同列时 Animator 被压制（已补丁解除）；剪辑要显式注入（已补丁）；FilterValidator 会把文件路径当正则（新版 System.CommandLine，上游 master 已修）；详见上方「补丁清单」
19. **iOS 端 .block 不能做深度解析**：侦查可以，完整解析 EndOfStream（iOS 专属封装差异，上游 master 也一样）。模型/动画/配件导出必须走 PC 版数据
20. **依赖混装会 TypeLoadException**：换工具链就整套换（同一次构建保证版本一致），别只换个别 DLL；CI nightly 产物有保留期会过期
21. **宠物窗 webPreferences 必须 backgroundThrottling:false**：设置/联机等其它窗口聚焦或盖住宠物窗时 Chromium 把它的 rAF 节流成慢动作（dt 钳制 0.1s 后动画变慢放，「卡住→抽搐」观感）。桌宠常驻必须关节流
22. **AnimationMixer 总权重 <1 时往绑定姿势填**：一次性剪辑播完直接 stop()，骨骼瞬间回落 bind pose 闪一下（「抽搐」）。收尾要 clampWhenFinished 定格末帧 + 与 StandBy 交叉淡出再 stop（playChain 已这么干）
23. **index.html 的 supabase-js 必须带 async**：jsdelivr 被代理拦时可能不是快速失败而是挂起，经典 script 会阻塞 defer 队列里的 pet3d.js 模块 → 整只猫不出现（supabase-client.js 连接时自检 window.supabase，async 安全）。同理别给宠物窗加任何会挂起的同步外链脚本
24. **窗口几何只走内容坐标系，别碰 getBounds 做相对叠加**（同学 Windows 150% 缩放实测：getBounds 混入 DWM 隐形边框且随焦点漂移 +2→+32/+30，任何基于它的校准/补偿都会把垃圾放大成失控，窗口两分钟走到右下角）：win:shape 只收目标内容尺寸 {w,h}（CSS px），主进程 getContentBounds/setContentSize 定尺寸 + setPosition 加内容位移差（同坐标系差值，边框项自动抵消），底边中心锚定幂等；拖动/拉伸只发信号，位移主进程 screen.getCursorScreenPoint 闭环；**别再造「单位自校准」机制**（两版校准都死在测量值本身不稳定上）；全链路日志在 `userData/debug-shape.log`（渲染进程走 `debug:log` IPC），Windows 排障让同学发这个文件
25. **win:shape 要幂等**：layout() 曾用 innerWidth/innerHeight（当前真实尺寸）算偏移，窗口未落地前连发把同一偏移叠加两遍（2d↔3d 每切一次下移一段）；现在的锚定语义天然幂等（同尺寸同锚点=同结果），别再回到「相对偏移」语义
26. **手势状态要防「丢 mouseup」**：右键菜单模态吞 mouseup、窗口从光标下滑走、其它窗叠盖，都会把 dragging/resizing 卡住（僵尸手势：猫跟光标满屏跑/反复触发 resize 风暴）——mousedown 门禁（必须命中猫本体才开拖）+ blur/contextmenu 复位 + **mousemove 看门狗（e.buttons===0 时强制 resetGesture）**；验收用 `window.__interactDebug()` 看手势状态
27. **CDP 合成事件不挪 OS 光标**：主进程跟光标的拖动/拉伸要用 `Quartz.CGWarpMouseCursorPosition`（pyobjc，tools/.venv 已装）同步挪真光标配合 CDP 注事件，否则测的是错的链路
28. **老核显（HD 3000 等）被 Chromium 拉黑走 SwiftShader 软渲染**：3D 常驻满帧渲染全靠 CPU 作画，占用直接爆炸（i7-2700K 用户实测）。兜底三件套：detectSoftGL() 探测（probe 上下文读 WEBGL_debug_renderer_info，匹配 swiftshader/llvmpipe/software/ANGLE (Google)）→ perfMode 性能模式（auto 软渲染自动落 saver：SSAA 1.0 + 限 20fps；**antialias 是 WebGL 上下文创建参数，只能 init 时按 softGL 决策，运行时改不了**）→ 「强制 GPU 渲染」实验开关（ignore-gpu-blocklist 必须 app ready 前 appendSwitch，所以改完要重启）。debugInfo().glRenderer 是远程确诊的关键证据
29. **Flutter asset 原生侧可读**：APK 里真实路径是 `flutter_assets/` + pubspec 声明路径（如 `flutter_assets/assets/cakes/cake01.webp`），Kotlin `context.assets.open` 直接读，webview 外复用图片不用重复打包进 res
30. **RemoteViews 小组件做不了真动画**：没有 rAF/属性动画，点击反应的极限是「帧替换」——Kotlin 侧 Matrix 缩放生成挤压/拉伸 Bitmap + Handler 链切帧；数据别走网络，读 FlutterSharedPreferences（Flutter 写入的键带 `flutter.` 前缀）

## GitHub 操作（用户授权的工作方式）

- 用户给过 classic token（repo 权限）用于推送 gh-pages 和发 Release——**注意：该 token 曾贴在聊天里，已建议用户吊销重生成；新会话应先问用户要新 token**
- gh-pages 分支：网页版部署（根目录直接是 index.html，有 .nojekyll）
- 发 Release 流程：创建 release（body 写更新说明：新功能+修bug+下载说明）→ uploads.github.com 传资产（中文文件名需 URL 编码）
- GitHub 连不上时：用户的 Mac 装有 /Applications/Steam++.app（Watt Toolkit），`open -a Steam++` 唤起加速后重试

## Supabase 服务器（用户私有，已配好）

- 项目：dltujlrtzbafx zbrlapx（Desktop Cat），免费计划
- 已执行：schema.sql + 三段 fix SQL + pg_cron 7 天消息清理（用户确认启用过扩展；如未生效检查 Database→Extensions）
- Confirm email：建议用户关闭（注册免验证），不确定最终状态
- 所有 App 的服务器配置由使用者在应用内填写（「使用自己的服务器」），代码库不含任何真实配置
- 表：profiles / friendships / groups / group_members / messages（target_type: dm|group，kind: blink|text）

## 尚未完成/待验证（2.x 时代遗留）

- iOS 网页版 GitHub Pages 访问稳定性待用户实测；备选 Cloudflare Pages（build/web-root.zip 直接传）
- 端到端联测（互发消息、戳一戳、群聊）待用户最终确认
- iOS 原生 ipa：需要 Xcode + Apple 账号，未做（PWA 顶替）
- Android 真后台推送（FCM/厂商推送）未做
- Supabase Realtime 如想恢复实时性：可改回私有频道 + realtime.broadcast_changes 触发器方案（当前轮询已够用）

## 用户偏好与工作方式

- 中文交流；喜欢可爱的文案风格；对 UI 美观度有要求
- 重视服务器成本（免费计划极致优化）
- 发版说明要写清「修了哪些 bug、更新了哪些功能」
- Release 和 gh-pages 部署授权由我直接操作（需新 token）
- 3D 化的资产方针：**严格官方资产，不做手搓模型**（占位模型已被用户否决并删除）；用户会实机验收视觉细节（影调/描边/裁切都要过他的眼）
- 解包由用户的朋友（Windows + PC 版星铁）跑 GUI exe 执行，诊断包（一键导出 candidates/filters/run.log/app.log/崩溃 dump）是排障主力
