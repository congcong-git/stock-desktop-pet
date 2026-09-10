@echo off
chcp 65001 >nul
title 牛来 · 授权签发工具
cd /d "%~dp0"

rem 界面产物不存在时先构建一次（仅首次或修改过界面时需要）
if not exist "dist\license-admin.js" (
  echo [首次使用] 正在构建界面，请稍候...
  call npm run build:renderer
  if errorlevel 1 (
    echo 构建失败，请确认已安装 Node 与依赖后重试。
    pause
    exit /b 1
  )
)

rem 直接用本地 Electron 启动，跳过构建，秒开
if exist "node_modules\electron\dist\electron.exe" (
  start "" "node_modules\electron\dist\electron.exe" tools\license-admin.js
) else (
  echo 未找到本地 Electron，改用 npx 启动...
  call npx electron tools\license-admin.js
)

exit /b 0
