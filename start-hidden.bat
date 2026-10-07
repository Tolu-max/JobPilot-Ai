@echo off
REM Start JobPilot completely hidden using VBS wrapper
start /min wscript.exe "%~dp0start-silent.vbs"
exit