@echo off
title Wizard Duel Launcher
color 0A

echo.
echo  =============================================
echo        WIZARD DUEL - Starting servers...
echo  =============================================
echo.

:: Find IP-adresse
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
    for /f "tokens=1" %%b in ("%%a") do set IP=%%b
)

echo  Din IP: %IP%
echo.
echo  Bridge:     http://%IP%:3000
echo  Hjemmeside: http://localhost:5173?bridge=%IP%:3000
echo.
echo  =============================================
echo.

:: Start bridge server i nyt vindue
echo [1/2] Starter Bridge server...
start "Wizard Duel Bridge" cmd /k "cd /d %~dp0opla-wizard-bridge && npm start"

:: Vent lidt så bridge når at starte
timeout /t 2 /nobreak > nul

:: Start React frontend i nyt vindue
echo [2/2] Starter Frontend...
start "Wizard Duel Frontend" cmd /k "cd /d %~dp0wizard-duel && npm run dev"

echo.
echo  Begge servere er startet!
echo.
echo  Tryk en tast for at lukke dette vindue...
echo  (Luk de andre vinduer for at stoppe serverne)
pause > nul


