# Servidor de resultados — Hematología (Diatron Aquarius 3)

Servidor **Node.js moderno** (ES Modules, Node ≥ 18.17) que escucha permanentemente el
analizador por **USB-Serie**, decodifica el protocolo propio de Diatron y muestra los
resultados en un **panel web** con parámetros, alertas e histogramas.

```
Equipo (Aquarius 3) ──USB-Serie 115200 8N1──► COM3 ──► Node.js (ESM) ──► Panel web (SSE)
```

Arquitectura modular:

| Módulo | Responsabilidad |
|---|---|
| `server.js` | Punto de entrada: cablea dependencias, arranca HTTP y serie |
| `src/config.js` | Configuración, validación, persistencia y listado de puertos |
| `src/protocol.js` | Constantes y `FrameParser` incremental del protocolo Diatron |
| `src/parse-report.js` | Informe de texto → objeto estructurado |
| `src/serial-manager.js` | Apertura, reconexión automática, decodificación y guardado |
| `src/store.js` | Almacén JSON de resultados |
| `src/status.js` | Estado en memoria (serie, equipo, configuración) |
| `src/bus.js` | Bus de eventos (`EventEmitter`) para SSE |
| `src/app.js` | Servidor HTTP, API REST, SSE y estáticos |
| `src/logger.js` / `src/util.js` | Log con rotación y utilidades |

El frontend también usa módulos ES: `public/app.js` (`type="module"`) importa
`public/js/format.js` y `public/js/graphs.js`.


## Cómo arrancar el servidor

**Opción 1 — doble clic (la más fácil):**

Abrir la carpeta `servidor` y ejecutar **`Iniciar servidor.bat`**. Se abre el panel solo.

**Opción 2 — PowerShell:**

```powershell
cd C:\Users\cesle\OneDrive\Escritorio\hematprg\servidor
node server.js        # o:  npm start
```

Panel: **http://127.0.0.1:3000**

**Opción 3 — con reinicio automático si el proceso se cae:**

```powershell
powershell -ExecutionPolicy Bypass -File .\start.ps1
```

**Opción 4 — que arranque solo al iniciar Windows:**

```powershell
powershell -ExecutionPolicy Bypass -File ".\Instalar autoinicio.ps1"
```

Crea un acceso directo en la carpeta de Inicio del usuario (no requiere administrador).
Para desinstalarlo, borrar ese acceso desde `Win+R` → `shell:startup`.

**Para detenerlo:** doble clic en **`Detener servidor.bat`**, o `Ctrl+C` / cerrar la ventana
si lo arrancó visible. Si arranca con Windows (oculto): Administrador de tareas → **Node.js** →
Finalizar tarea, o:

```powershell
Get-NetTCPConnection -LocalPort 3000 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

> Requiere Node.js 18.17+ (instalado: v24). La dependencia `serialport` ya está instalada
> en `node_modules/`. El puerto **COM3 debe estar libre** (cerrar otros programas que lo usen);
> si no está disponible, el servidor reintenta solo cada 3 s y el puerto se puede cambiar
> desde **⚙ Configuración**.

## Qué hace

- Abre **COM3 @ 115200 8N1** y se **reconecta solo** cada 3 s si el puerto no está,
  está ocupado o se desconecta el cable.
- Decodifica las tramas Diatron:
  `SOH + prefijo(2 bytes) + STX + texto + ETX + checksum(2 hex) + EOT`
  - prefijo: 1.er byte = secuencia, 2.º byte = tipo (`I` identificación, `N` informe)
  - checksum validado (suma de bytes desde el prefijo hasta ETX, `& 0xFF`).
- Guarda cada resultado en `data/resultados.json` (y la trama cruda en `data/raw/`).
- Publica en vivo los resultados al panel mediante **SSE** (`/api/eventos`).
- Interfaz web: lista de resultados, búsqueda, detalle del paciente, 22 parámetros con
  flags H/L, histogramas WBC/RBC/PLT, informe original, descarga JSON e impresión.
- Importa al primer arranque los resultados ya capturados en `../resultados/*.json`.

## Panel web

| Zona | Contenido |
|---|---|
| Cabecera | Estado del puerto serie, equipo detectado (modelo/firmware/serie), nº de resultados, botón **⚙ Configuración** |
| Izquierda | Lista de resultados con alertas y búsqueda por paciente/muestra/ID |
| Derecha | Detalle: cabecera del paciente, alertas, tabla de parámetros e histogramas |

### ⚙ Configuración de la conexión (desde el panel)

El botón **⚙ Configuración** de la cabecera abre un diálogo para editar:

| Campo | Detalle |
|---|---|
| **Puerto** | Se puede elegir de los detectados (🔄 actualiza la lista, con fabricante y nº de serie) o escribir uno manualmente |
| **Baudios** | 1200 … 921600 (configuración típica del Aquarius 3: **115200**) |
| **Bits de datos** | 5, 6, 7, 8 (típico **8**) |
| **Paridad** | ninguna, par, impar, mark, space (típico **ninguna**) |
| **Bits de parada** | 1, 1.5, 2 (típico **1**) |
| **Reintento (ms)** | Espera entre reintentos de apertura (200–300000, típico 3000) |
| **ACK al ENQ** | Responder ACK cuando el equipo pide transmitir (normalmente desactivado) |
| **Host / Puerto HTTP** | Interfaz y puerto del panel web (se aplican al **reiniciar** el servidor) |

Al pulsar **Aplicar y reconectar**:
1. se validan los valores;
2. se guardan en `data/config.json` (persisten entre reinicios);
3. los cambios del puerto serie se aplican **en caliente** (cierra y reabre el puerto sin reiniciar el servidor);
4. si se cambió host/puerto HTTP, se avisa que requiere reiniciar el servidor.

El botón **Restaurar** carga los valores por defecto sin guardarlos.
La configuración guardada en `data/config.json` tiene prioridad sobre las variables de entorno.

## API local

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/estado` | Estado de la conexión serie (incluye `config` y `reconnecting`) |
| GET | `/api/config` | Configuración actual + valores por defecto + puertos detectados |
| POST | `/api/config` | Guarda y aplica configuración (JSON con los campos del panel) |
| GET | `/api/puertos` | Lista los puertos serie disponibles (vía `serialport`) |
| GET | `/api/resultados` | Lista de resultados (`?q=` para buscar) |
| GET | `/api/resultados/:id` | Detalle completo de un resultado |
| DELETE | `/api/resultados/:id` | Borra un resultado del almacén |
| GET | `/api/equipo` | Identificación del analizador |
| GET | `/api/export.json` | Exporta todo (equipo + resultados) |
| GET | `/api/eventos` | Stream SSE (estado, equipo, resultado) |
| POST | `/api/dev/replay` | Solo pruebas: inyecta una trama cruda `{"hex":"01 49 ..."}` |

Ejemplo de cambio de configuración por API:

```powershell
Invoke-RestMethod -Uri http://127.0.0.1:3000/api/config -Method Post -ContentType 'application/json' `
  -Body '{"serialPath":"COM3","baudRate":115200,"dataBits":8,"parity":"none","stopBits":1}'
```

## Valores por defecto (variables de entorno)

Se usan al primer arranque o si no existe `data/config.json`:

| Variable | Por defecto | Descripción |
|---|---|---|
| `SERIAL_PORT` | `COM3` | Puerto serie |
| `BAUD` | `115200` | Velocidad |
| `PORT` | `3000` | Puerto HTTP |
| `HOST` | `127.0.0.1` | Interfaz de escucha |
| `SERIAL_ACK` | `0` | `1` = responder ACK a ENQ |
| `RECONNECT_MS` | `3000` | Espera entre reintentos de puerto |

Ejemplo: `$env:PORT='3001'; npm start`

## Estructura

```
servidor/
├─ server.js             # punto de entrada (ESM): cablea y arranca todo
├─ src/
│  ├─ app.js             # HTTP + API + SSE + estáticos
│  ├─ bus.js             # eventos internos (EventEmitter)
│  ├─ config.js          # configuración + puertos + persistencia
│  ├─ logger.js          # log con rotación
│  ├─ parse-report.js    # parser del informe
│  ├─ protocol.js        # FrameParser del protocolo Diatron
│  ├─ serial-manager.js  # apertura/reconexión/decodificación serie
│  ├─ status.js          # estado en memoria
│  ├─ store.js           # almacén JSON
│  └─ util.js            # utilidades (stamp, hex…)
├─ public/
│  ├─ index.html         # panel (carga app.js como módulo ES)
│  ├─ styles.css
│  ├─ app.js             # lógica del panel (type="module")
│  └─ js/
│     ├─ format.js       # formato y escape
│     └─ graphs.js       # histogramas en canvas
├─ Iniciar servidor.bat  # doble clic para arrancar
├─ Detener servidor.bat  # doble clic para detener
├─ Instalar autoinicio.ps1  # inicio automático con Windows
├─ start.ps1             # arranque con reinicio automático
├─ test_e2e.mjs          # prueba SSE/parser (borra solo sus propios datos)
├─ recuperar_resultados.mjs  # reconstruye resultados desde data/raw
├─ package.json          # "type": "module", Node >= 18.17
└─ data/
   ├─ config.json        # configuración guardada desde el panel
   ├─ resultados.json    # almacén de resultados
   ├─ servidor.pid       # PID del proceso en ejecución
   ├─ servidor.log       # log (rota a 2 MB)
   └─ raw/               # tramas crudas .bin/.hex
```

## Probar sin el equipo

Con el servidor arriba, inyectar una trama capturada:

```powershell
$hex = (([BitConverter]::ToString([IO.File]::ReadAllBytes('..\resultados\raw\20261028_173141_REPORT.bin'))) -replace '-','').ToLower()
Invoke-RestMethod -Uri http://127.0.0.1:3000/api/dev/replay -Method Post -ContentType 'application/json' -Body (@{hex=$hex} | ConvertTo-Json)
```

O ejecutar la prueba completa (crea un resultado de prueba, comprueba SSE y lo borra;
**no toca** los resultados reales):

```powershell
node test_e2e.mjs
```

Si alguna vez se pierde `data/resultados.json`, se puede reconstruir desde las tramas
crudas guardadas en `data/raw`:

```powershell
node recuperar_resultados.mjs
```

## Inicio automático con Windows (opcional)

Crear un acceso directo en la carpeta de Inicio que arranque `start.ps1` oculto:

```powershell
$ws = New-Object -ComObject WScript.Shell
$lnk = Join-Path ([Environment]::GetFolderPath('Startup')) 'Hematologia Servidor.lnk'
$sc = $ws.CreateShortcut($lnk)
$sc.TargetPath = 'powershell.exe'
$sc.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "C:\Users\cesle\OneDrive\Escritorio\hematprg\servidor\start.ps1"'
$sc.WorkingDirectory = 'C:\Users\cesle\OneDrive\Escritorio\hematprg\servidor'
$sc.Save()
```

## Seguridad

El panel escucha solo en `127.0.0.1` (no accesible desde la red) porque maneja datos
clínicos. Si algún día se necesita acceso desde otro equipo de la red, cambiar `HOST`
y añadir autenticación/HTTPS antes de exponerlo.

