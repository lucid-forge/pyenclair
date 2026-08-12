@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0GENERER-TRADUCTIONS.ps1"
if errorlevel 1 (
  echo Impossible de synchroniser les fichiers de traductions.
  pause
  exit /b 1
)
start "" "%~dp0index.html"
