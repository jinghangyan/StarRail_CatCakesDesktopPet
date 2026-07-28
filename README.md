# 桌宠猫猫糕 🐱

> StarRail CatCakes Desktop Pet —— 27 只猫猫糕住在你的桌面上

一只（其实是 27 只）住在电脑桌面上的猫猫糕，支持 **Windows** 和 **macOS**。可以点它、rua 它、看它伸懒腰，还能和朋友联机互戳——对方手机上点一下，你桌上的猫猫糕就会发光、喵一声。（需要服务器，作者也还没实现）

![平台](https://img.shields.io/badge/platform-Windows%20%7C%20macOS-blue)
![版本](https://img.shields.io/badge/version-1.0.0-ff8fa3)

## ✨ 功能一览


**🍮 Q 弹互动**

- 单击：随机做一个动作（果冻 duang、扭动、跳起转圈、开心跳、歪头杀）+ 轮廓流光 + 喵一声 + 说句话
- 待机：每过一会儿自己会伸懒腰、打瞌睡、左右看看，安静不打扰
- 拖动：按住就能带着它满屏幕跑，脚下还有小影子

**🎨 随你定制**

- 大小随心：四档预设大小 + 拖角自由拉伸
- 流光换色：彩虹 / 鎏金 / 樱花粉 / 冰蓝 / 星紫
- 叫声更换：7 个预设叫声 + 导入自己的音频
- 状态栏托盘：不占 Dock / 任务栏，顶部状态栏（macOS）或右下角托盘（Windows）一个小图标管全部

**📡 联机玩法（可选）**

和朋友互加好友后，手机 App 上点一下，对方电脑上的猫猫糕就会发光喵叫；还能发文字消息，从猫猫糕头顶的气泡里弹出来。支持私信和群组。（需要自己部署一个免费的 Supabase 后端，见下文）

## 📦 下载安装

去 [Releases](../../releases) 下载：

| 平台 | 文件 | 说明 |
|---|---|---|
| macOS (Apple Silicon) | `桌宠猫猫糕-x.x.x-arm64.dmg` | 拖进「应用程序」 |
| Windows (x64) | `桌宠猫猫糕 Setup x.x.x.exe` | 安装程序，带标准卸载 |

**首次打开提示**：安装包未做付费签名——

- macOS：如果提示「无法验证开发者」，到「系统设置 → 隐私与安全性」点「仍要打开」
- Windows：SmartScreen 提示时点「更多信息 → 仍要运行」


不登录也能当纯桌宠玩，顶部的提示条点 ✕ 关掉即可。

## 📡 联机配置（可选）

联机功能基于 [Supabase](https://supabase.com)（免费额度足够小圈子使用）：

1. 注册 Supabase，创建一个免费项目（区域选 Singapore / Tokyo）
2. 项目里打开 **SQL Editor**，把 [`supabase/schema.sql`](supabase/schema.sql) 全文粘贴执行一次
3. **Project Settings → API** 里复制 Project URL 和 anon public key
4. 猫猫糕右键 → **登录 / 服务器**，填入 URL 和 key，注册/登录账号
5. 手机端（`mobile/`，Flutter 工程）填入同一套配置，和朋友互加用户名即可互戳

> 提示：Supabase 默认注册需要邮箱验证。想即注册即用，可在 Authentication → Sign In / Providers 里关闭 Confirm email。

## 🛠 从源码构建

```bash
# 桌面端（Electron）
cd desktop
npm install
npm start            # 开发模式运行
npm run build:mac    # 打包 macOS dmg
npm run build:win    # 打包 Windows exe（需 x64）

# 手机端（Flutter，需自行安装 Flutter SDK 和 Android SDK / Xcode）
cd mobile
flutter pub get
flutter run          # 调试运行
flutter build apk    # 打包 Android APK
```

目录结构：

```
├── desktop/            # Electron 桌面端
│   ├── main.js         # 主进程：窗口、托盘、菜单、配置
│   └── renderer/       # 界面：猫猫糕动画、图鉴、台词编辑器、叫声设置等
│       ├── cakes/      # 27 只猫猫糕立绘（透明背景 WebP）
│       └── meows/      # 7 个预设叫声
├── mobile/             # Flutter 手机端（联机遥控器）
└── supabase/schema.sql # 联机后端建表脚本
```

## ❤️ 致谢

- 作者：**@渊源远愿**（[bilibili](https://space.bilibili.com/291097096)）
- 特别鸣谢：**@黎昼** **@Ricer_Chung** **@Kimi**
- QQ 交流群：**537022910**
- 猫猫糕形象来自游戏《崩坏：星穹铁道》，本项目为非官方同人作品，仅供学习交流

---

愿此行，终抵群星喵 ⭐
