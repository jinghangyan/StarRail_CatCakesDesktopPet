@echo off
chcp 65001 >nul
title 猫猫糕模型提取
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run.ps1" %*
echo.
pause
