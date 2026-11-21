@echo off
cd /d "%~dp0"
start "" /b powershell -NoProfile -Command "Start-Sleep -Milliseconds 850; Start-Process 'http://127.0.0.1:4173'"
node --env-file-if-exists=.env server.mjs
pause
