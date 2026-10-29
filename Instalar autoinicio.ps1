# Instala el inicio automático del servidor de hematología con Windows.
# Crea un acceso directo en la carpeta de Inicio del usuario actual.
# Uso:  powershell -ExecutionPolicy Bypass -File .\Instalar autoinicio.ps1

$ErrorActionPreference = 'Stop'
$servidor = $PSScriptRoot
$script = Join-Path $servidor 'start.ps1'

if (-not (Test-Path $script)) {
    Write-Host "No se encontró start.ps1 en $servidor" -ForegroundColor Red
    exit 1
}

$ws = New-Object -ComObject WScript.Shell
$lnk = Join-Path ([Environment]::GetFolderPath('Startup')) 'Hematologia Servidor.lnk'

$sc = $ws.CreateShortcut($lnk)
$sc.TargetPath = 'powershell.exe'
$sc.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $script + '"'
$sc.WorkingDirectory = $servidor
$sc.Description = 'Servidor de resultados de hematología (se inicia con Windows)'
$sc.Save()

Write-Host ''
Write-Host '  Acceso directo creado:' -ForegroundColor Green
Write-Host "  $lnk"
Write-Host ''
Write-Host '  El servidor se iniciará automáticamente al iniciar sesión en Windows.'
Write-Host '  Panel: http://127.0.0.1:3000'
Write-Host ''
Write-Host '  Para quitarlo, borre ese acceso directo de la carpeta de Inicio.' -ForegroundColor DarkGray
Write-Host '  (Win+R  ->  shell:startup)'
Write-Host ''
