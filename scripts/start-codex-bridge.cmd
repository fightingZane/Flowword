@echo off
rem Start the project-local bridge without installing a Windows service
cd /d "%~dp0.."
node scripts\codex-bridge.mjs
pause
