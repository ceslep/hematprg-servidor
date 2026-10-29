# Arranca el servidor de resultados y lo reinicia si se cae.
# Uso:  powershell -ExecutionPolicy Bypass -File .\start.ps1

$ErrorActionPreference = 'Continue'
Set-Location $PSScriptRoot

# Configuración opcional (descomente y ajuste si hace falta)
# $env:SERIAL_PORT = 'COM3'
# $env:BAUD        = '115200'
# $env:PORT        = '3000'

Write-Host ''
Write-Host '  Hematología · Servidor de resultados' -ForegroundColor Cyan
Write-Host '  ------------------------------------' -ForegroundColor DarkGray
Write-Host ("  Puerto serie: {0} @ {1} 8N1" -f ($env:SERIAL_PORT ?? 'COM3'), ($env:BAUD ?? '115200'))
Write-Host ''

while ($true) {
    node server.js
    $code = $LASTEXITCODE
    Write-Host ''
    Write-Host "[start] El servidor terminó (código $code). Reiniciando en 5 segundos..." -ForegroundColor Yellow
    Start-Sleep -Seconds 5
}
