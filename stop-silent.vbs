Set WshShell = CreateObject("WScript.Shell")
WshShell.Run """C:\Users\USA\AppData\Roaming\npm\pm2.cmd"" stop all", 0, True
WshShell.Run """C:\Users\USA\AppData\Roaming\npm\pm2.cmd"" kill", 0, True
WshShell.Popup "JobPilot AI stopped.", 3, "JobPilot AI", 64
