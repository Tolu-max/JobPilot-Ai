@echo off
setlocal
set "PM2=C:\Users\USA\AppData\Roaming\npm\pm2.cmd"
set "DIR=C:\laragon\www\Job scrapper"

if "%1"=="" goto help
if /i "%1"=="start"   goto start
if /i "%1"=="stop"    goto stop
if /i "%1"=="restart" goto restart
if /i "%1"=="status"  goto status
if /i "%1"=="logs"    goto logs
if /i "%1"=="tolu"    goto tolu
if /i "%1"=="sister"  goto sister
goto help

:start
echo Starting JobPilot AI (background, no windows)...
powershell -WindowStyle Hidden -Command "Start-Process '%PM2%' -ArgumentList 'start ecosystem.config.cjs --update-env' -WorkingDirectory '%DIR%' -NoNewWindow -Wait"
echo Done. Bot is running silently.
goto end

:stop
echo Stopping JobPilot AI...
"%PM2%" stop job-ai-agent
goto end

:restart
echo Restarting JobPilot AI...
"%PM2%" restart job-ai-agent --update-env
echo Done.
goto end

:status
"%PM2%" list
goto end

:logs
if /i "%2"=="tolu"   ( powershell -Command "Get-Content '%DIR%\logs\tolu.log' -Tail 30" & goto end )
if /i "%2"=="sister" ( powershell -Command "Get-Content '%DIR%\logs\sister.log' -Tail 30" & goto end )
"%PM2%" logs job-ai-agent --lines 30
goto end

:tolu
echo Checking Tolu's last results...
powershell -Command "Get-Content '%DIR%\logs\tolu.log' | Select-String 'APPLIED|FAILED|Queued|Run finished' | Select-Object -Last 10"
goto end

:sister
echo Checking Sister's last results...
powershell -Command "Get-Content '%DIR%\logs\sister.log' | Select-String 'APPLIED|FAILED|Queued|Run finished' | Select-Object -Last 10"
goto end

:help
echo.
echo  JobPilot AI Bot Manager
echo  -----------------------
echo  bot start          Start the bot silently in background
echo  bot stop           Stop the bot
echo  bot restart        Restart the bot (reloads .env)
echo  bot status         Show PM2 process status
echo  bot logs           Stream live PM2 logs
echo  bot logs tolu      Show Tolu's last 30 log lines
echo  bot logs sister    Show Sister's last 30 log lines
echo  bot tolu           Show Tolu's recent results (applied/failed)
echo  bot sister         Show Sister's recent results (applied/failed)
echo.

:end
endlocal
