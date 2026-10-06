@echo off
cd /d "%~dp0"
python run_ui.py
if errorlevel 1 pause
