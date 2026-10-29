@echo off
setlocal enabledelayedexpansion
title Hematologia - Servidor de resultados
cd /d "%~dp0"

REM Si ya hay un servidor corriendo (por el archivo de PID), solo abre el panel
if exist "data\servidor.pid" (
    set /p PIDACTUAL=<"data\servidor.pid"
    tasklist /fi "PID eq !PIDACTUAL!" /nh 2>nul | findstr /i "node.exe" >nul
    if not errorlevel 1 (
        echo.
        echo   Ya hay un servidor corriendo ^(PID !PIDACTUAL!^).
        echo   Abriendo el panel...
        start "" http://127.0.0.1:3000
        echo.
        pause
        exit /b 0
    )
    del "data\servidor.pid" >nul 2>&1
)

echo.
echo   ============================================
echo    HEMATOLOGIA - Servidor de resultados
echo   ============================================
echo.
echo   Panel:  http://127.0.0.1:3000
echo   Serie:  COM3 @ 115200 8N1
echo.
echo   Deje esta ventana abierta mientras usa el panel.
echo   Para detener el servidor: Ctrl+C o "Detener servidor.bat".
echo.
echo   La configuracion de puerto/baudios se cambia desde
echo   el boton "Configuracion" del panel.
echo.

REM Abre el panel 2 segundos después de arrancar
start "" /min cmd /c "ping -n 3 127.0.0.1 >nul & start "" http://127.0.0.1:3000"

node server.js

echo.
echo El servidor se detuvo.
pause
