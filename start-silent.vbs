Set WshShell = CreateObject("WScript.Shell")
Set objFSO = CreateObject("Scripting.FileSystemObject")

' Change to JobPilot directory
strPath = "C:\laragon\www\Job scrapper"
WshShell.CurrentDirectory = strPath

' Kill any existing PM2 processes completely silently
WshShell.Run "cmd /c pm2 kill", 0, True

' Wait 2 seconds
WScript.Sleep 2000

' Start PM2 with ecosystem config - completely hidden
WshShell.Run "cmd /c pm2 start ecosystem.config.cjs --update-env", 0, True

' Wait 1 second
WScript.Sleep 1000

' Save PM2 process list
WshShell.Run "cmd /c pm2 save --force", 0, True

' Done - no windows shown
