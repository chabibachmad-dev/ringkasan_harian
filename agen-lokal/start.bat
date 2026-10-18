@echo off
chcp 65001 >nul
title Agen Lokal
cd /d "%~dp0"
:ulang
node src\index.js
echo.
echo [%date% %time%] Agen berhenti. Mulai ulang dalam 10 detik... (tutup jendela ini untuk menghentikan)
timeout /t 10 /nobreak >nul
goto ulang
