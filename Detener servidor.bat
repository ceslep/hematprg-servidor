@echo off
setlocal enabledelayedexpansion
title Hematologia - Detener servidor
cd /d "%~dp0"

set PUERTO=%~1
if "%PUERTO%"=="" set PUERTO=3000
set FOUND=0

echo.
echo   Deteniendo servidor de hematologia...
echo.

REM 1) Por archivo de PID (lo escribe el propio servidor al arrancar)
if exist "data\servidor.pid" (
    set /p PID=<"data\servidor.pid"
    tasklist /fi "PID eq !PID!" /nh 2>nul | findstr /i "node.exe" >nul
    if not errorlevel 1 (
        echo   Deteniendo proceso PID !PID!...
        taskkill /f /pid !PID! >nul 2>&1
        set FOUND=1
    )
    del "data\servidor.pid" >nul 2>&1
)

REM 2) Respaldo: buscar quien escucha en el puerto
if "!FOUND!"=="0" (
    for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:"127.0.0.1:%PUERTO% "') do (
        if not "%%p"=="0" (
            echo   Deteniendo proceso PID %%p...
            taskkill /f /pid %%p >nul 2>&1
            set FOUND=1
        )
    )
)

if "!FOUND!"=="0" (
    echo   No hay ningun servidor corriendo.
) else (
    echo.
    echo   Servidor detenido.
)
echo.
ping -n 3 127.0.0.1 >nul
