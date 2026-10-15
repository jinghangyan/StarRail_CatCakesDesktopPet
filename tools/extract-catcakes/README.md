# 猫猫糕模型提取工具（Windows 用）

> 给帮忙跑工具的同学：这是从《崩坏：星穹铁道》本地游戏文件里提取「猫猫糕」3D 模型的一键工具。
> 模型仅供同人桌宠项目内部使用，**不要公开传播**。

## 傻瓜版：怎么跑（GUI，推荐）

1. 拿到 **`猫猫糕提取工具.exe`**（单文件，免安装），放到一个路径不带中文和空格的目录，比如 `D:\catcake\`
2. **双击运行**（如果 Windows SmartScreen 或杀毒软件拦截，选「仍要运行 / 允许」——解包工具经常被误报）
3. 点 **「自动寻找」** 找游戏目录；找不到就点「选择游戏目录」手动选到
   `...\StarRail_Data\StreamingAssets\Asb\Windows` 这一层（选上层目录也行，会自动往下找）
4. 环境预检如果提示缺少 **.NET 9 运行时**，点 **「一键安装（winget）」**（会联网下载，可能弹 UAC 确认框）
5. 点 **「开始提取」**，等进度条跑完
   - 「建索引」这步最慢（资产 15G+，4 分片并行扫描，一般 5~15 分钟），风扇起飞是正常的
   - 中途取消也没关系，下次打开会自动从断点继续
6. 跑完点「打开输出文件夹」，把 **`output\catcakes-glb.zip`** 发回来

## 如果出问题了

- 完成页有 **「复制诊断信息」** 和 **「导出诊断包」** 按钮，把结果发回给作者
- 手动排查的话，exe 同目录下会有 `work\run.log`（管线日志）、`work\app.log`（程序运行日志）和 `work\candidates.txt`（侦查清单）
- 想从头再来：关掉工具，删掉 exe 同目录的 `work` 和 `output` 文件夹再跑

## 崩溃了怎么办（窗口突然消失）

工具自带崩溃自诊断，崩了也能留下证据：

1. **直接重开工具**——如果上次是异常退出，首页顶部会出现红色横幅，点上面的 **「导出诊断包」**，把 `output\catcakes-diagnostics.zip` 发回给作者即可（里面含 app.log、崩溃 dump 等）
2. 也可以手动把 exe 同目录 `work\` 下的 **`app.log`** 和 **`crashes\` 文件夹**（如果存在）一并发回
3. 备用方法（能抓到第一手崩溃输出）：在 exe 所在文件夹的地址栏输入 `cmd` 回车，在黑窗口里执行：
   ```
   set ELECTRON_ENABLE_LOGGING=1 && 猫猫糕提取工具.exe
   ```
   窗口再消失后，把 cmd 窗口里最后的内容截图发回

## 你需要准备

1. 一台 **Windows** 电脑（Win10/11 均可）
2. 装好 **PC 版崩坏：星穹铁道**（国服国际服都行），并且游戏已更新到包含猫猫糕活动的版本（4.2+）
3. 大约 20GB 空闲磁盘空间
4. 第一次跑需要联网（装 .NET 9 运行时；内嵌解包工具已随 exe 打包，一般不用下载）

## 备用方案：命令行脚本（run.bat）

如果 GUI 在你的电脑上跑不起来，退回 PowerShell 版：

1. 把整个 `extract-catcakes` 文件夹拷到电脑上（路径不要有中文和空格，比如 `D:\extract-catcakes`）
2. 双击 **`run.bat`**，按中文提示一路回车即可（中途会打开记事本让你确认筛选规则，一般直接关掉按回车）
3. 脚本会自己下载 AnimeStudio / FBX2glTF（GUI 版已内嵌，脚本版需现下，所以要能访问 GitHub）
4. 跑完后把 **`output\catcakes-glb.zip`** 发回来

## 目录说明（跑完之后）

```
exe 同目录/
├── work/                 # 中间产物（索引、导出的 FBX、日志）
│   ├── run.log           # 完整运行日志
│   ├── candidates.txt    # 筛出来的疑似猫猫糕资产清单（默认规则 ruanmadecake，命中几百条为正常）
│   └── filters.txt       # 实际使用的筛选规则（默认单行 ruanmadecake；勿加 RuanMadeShaoMai 烧麦）
└── output/
    ├── catcakes-glb/     # 转换好的 GLB 模型 + 原始 PNG 贴图备份
    ├── catcakes-glb.zip  # ← 把这个发回来
    └── catcakes-diagnostics.zip  # （点了「导出诊断包」才有）
```

## 开发者：从源码构建 exe

```bash
cd app
ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/" npm install
ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/" \
ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/" \
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --win --x64
# 产物：app/dist/猫猫糕提取工具.exe
```
