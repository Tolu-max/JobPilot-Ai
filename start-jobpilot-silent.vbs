Set WshShell = CreateObject("WScript.Shell")
' Start JobPilot completely hidden - no console windows
WshShell.CurrentDirectory = "C:\laragon\www\Job scrapper"
' Use node directly to avoid PM2 console windows
WshShell.Run "cmd /c node cli.js start", 0, False
' Exit immediately - runs in background
