Set WshShell = CreateObject("WScript.Shell")
' Restart all PM2 processes — completely hidden, no console window
WshShell.CurrentDirectory = "C:\laragon\www\Job scrapper"
WshShell.Run """C:\Users\USA\AppData\Roaming\npm\pm2.cmd"" start ecosystem.config.cjs --update-env", 0, True
WshShell.Run """C:\Users\USA\AppData\Roaming\npm\pm2.cmd"" save --force", 0, True
' Restart complete — no popup
