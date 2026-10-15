#!/bin/bash
# 桌宠猫猫糕 - 安装辅助（解除 macOS 对未签名 App 的拦截）
APP_NAME="桌宠猫猫糕.app"

# 在常见位置找 App
TARGET=""
for p in "/Applications/$APP_NAME" \
         "$HOME/Applications/$APP_NAME" \
         "$HOME/Desktop/$APP_NAME" \
         "$HOME/Downloads/$APP_NAME" \
         "$(dirname "$0")/$APP_NAME"; do
  if [ -d "$p" ]; then TARGET="$p"; break; fi
done

if [ -z "$TARGET" ]; then
  echo "⚠️ 没找到 $APP_NAME"
  echo "请先把它拖进「应用程序」文件夹，再运行本脚本"
  echo ""
  read -r -p "按回车键关闭窗口…"
  exit 1
fi

# dmg 镜像里的 App 是只读的，解除不了，必须先拷出来
if [[ "$TARGET" == /Volumes/* ]]; then
  echo "⚠️ App 还在安装镜像里（只读，无法解除拦截）"
  echo "请先把它拖进「应用程序」文件夹，再运行本脚本"
  echo ""
  read -r -p "按回车键关闭窗口…"
  exit 1
fi

echo "找到：$TARGET"
xattr -cr "$TARGET" 2>&1

if [ $? -ne 0 ]; then
  echo ""
  echo "❌ 解除失败，请把上面的错误信息截图发给作者"
elif xattr -p com.apple.quarantine "$TARGET" >/dev/null 2>&1; then
  # 命令「成功」但标记还在 → 验证不通过
  echo ""
  echo "❌ 隔离标记没有被移除（可能是权限问题）"
  echo "请在终端执行：sudo xattr -cr \"$TARGET\""
else
  echo ""
  echo "✅ 已确认解除拦截（标记已验证移除），现在可以正常打开了"
fi

echo ""
read -r -p "按回车键关闭窗口…"
