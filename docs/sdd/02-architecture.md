# 2. Arquitectura

## Diagrama

```
Celular — Cantante/Invitado (PWA, navegador)
  ├─ WebSocket /ws/room    (join, elegir canción, cola, ranking, latencia, avanzar rotación)
  └─ WebSocket /ws/sing/:songId  (solo cantante: sube PCM16 mono 16kHz, recibe frames de puntaje)
                    │
                    ▼
        ┌───────────────────────────────────────────┐
        │        Servidor Node.js — un solo proceso   │
        │        (Fastify, server/src/index.js)       │
        │                                              │
        │  - Catálogo + indexador (SQLite)             │
        │  - Sala/sesión + cola de turnos (Room, en    │
        │    memoria, sin persistencia)                │
        │  - Motor de puntuación (pitch.js + scoring.js,│
        │    JavaScript puro, corre inline por cada     │
        │    socket /ws/sing — sin proceso separado)   │
        │  - HTTPS (autofirmado o Let's Encrypt DNS-01) │
        │  - API REST: canciones, archivos, settings,  │
        │    QR, selector de carpeta nativo             │
        └───────────────────────┬─────────────────────┘
                                 │ HTTP (estáticos + audio/video/cover)
                                 │ WebSocket /ws/room (estado, letras, QR ya generado, latencia)
                                 ▼
        Pantalla principal — "Sala" (navegador de la TV o equipo por HDMI)

Biblioteca de canciones: una o más carpetas (local y/o NAS montado por el
SO) → indexadas a un catálogo único en SQLite (server/data/karaoke.db).
```

**Diferencia clave respecto al diseño original** (`plan_karaoke_v0.03.md`): ese documento proponía un servidor Node.js que delegaba la captura/puntuación de audio a un **motor en Python** (`aubio`/`numpy`), corriendo como contenedor/proceso separado y comunicándose por IPC/WebSocket interno, todo orquestado con Docker. Esa versión existió (preservada en la rama `alpha` del repo) pero fue reemplazada: el motor de pitch-detection (autocorrelación) y de scoring se **reescribió en JavaScript puro** (`server/src/pitch.js`, `server/src/scoring.js`) y corre en el mismo proceso Node que sirve el resto de la app. No hay Docker, no hay Python, no hay IPC entre procesos — todo es una sola app Node de punta a punta.

## Stack técnico

| Componente | Tecnología | Notas |
|---|---|---|
| Servidor HTTP + WebSocket | **Fastify 4** + `@fastify/static` + `@fastify/websocket` | Un solo proceso, se prende/apaga manualmente. |
| Base de datos de catálogo | **better-sqlite3** | Archivo en `server/data/karaoke.db`, no versionado. Requiere compilación nativa (o usa el binario `prebuilds/` que trae el paquete) — ver el callout de Windows en el README. |
| Motor de pitch detection | JS puro, autocorrelación sobre ventanas de 2048 muestras (~128ms a 16kHz) | `server/src/pitch.js`. Sin dependencias nativas de audio. |
| Motor de puntuación | JS puro | `server/src/scoring.js`. Tolerante a errores de octava (compara clase de tono, no tono absoluto). |
| Parser de canciones | JS puro, formato `.txt` de UltraStar Deluxe | `server/src/usdxParser.js` + `server/src/txtEncoding.js` (detección de encoding). |
| HTTPS autofirmado | `selfsigned` | `server/src/tls.js`, certificado por IP LAN detectada, cacheado en `server/data/`. |
| HTTPS real (opcional) | `acme-client` + API de Cloudflare (DNS-01) | `server/src/certManager.js` + `server/src/cloudflareDns.js`. No requiere exponer el servidor a internet. |
| QR de acceso | `qrcode` | Generado bajo demanda vía `/api/qr`. |
| Cliente Sala / celular / settings | HTML + CSS + JavaScript **plano**, sin build step, sin frameworks | `server/public/`. Módulos ES nativos (`type="module"`). |
| Tema visual | Variables CSS (OKLCH) + atributo `data-theme` en `<html>`, persistido en `localStorage` | `server/public/style.css` + `server/public/theme.js`. |

No hay bundler, transpilador ni gestor de paquetes del lado del cliente — los archivos de `server/public/` se sirven tal cual.

## Mapa de archivos — servidor (`server/src/`)

| Archivo | Responsabilidad |
|---|---|
| `index.js` | Punto de entrada. Arma Fastify, registra rutas HTTP y los dos WebSockets (`/ws/room`, `/ws/sing/:songId`), decide qué certificado HTTPS usar, orquesta el indexado inicial. Es el único lugar que conoce el protocolo completo — ver [03-protocol.md](03-protocol.md). |
| `config.js` | Lee `config.json` (raíz del repo): solo aporta el valor por defecto de `libraryPaths` en el primer arranque. |
| `settings.js` | Persiste/lee `server/data/settings.json`: carpetas de biblioteca vigentes, override de IP LAN, dominio público + token de Cloudflare + email para Let's Encrypt, y `localMics` (micrófonos físicos asignados a cantantes). Esto es lo que la UI de Configuración edita en caliente. |
| `db.js` | Apertura de SQLite + CRUD de la tabla `songs` (`upsertSong`, `removeMissingSongs`, `listSongs`, `getSongById`). |
| `indexer.js` | Escanea cada carpeta de biblioteca configurada (una subcarpeta = una canción, no recursivo), parsea su `.txt`, y hace upsert/removeMissing en SQLite. Se corre al arrancar y bajo demanda (`POST /api/reindex`, o al guardar `libraryPaths` desde Configuración). |
| `usdxParser.js` | Parser del formato de texto UltraStar Deluxe: metadata (`#TITLE`, `#BPM`, `#GAP`, etc.) + líneas de letra/notas. Expone `beatToMs` para convertir beats a milisegundos absolutos. |
| `txtEncoding.js` | Lee el `.txt` de una canción detectando su encoding real (los `.txt` de UltraStar no siempre son UTF-8). |
| `room.js` | Estado de la sala en memoria: usuarios conectados, cola de turnos, cantantes activos, ranking de la sesión, modo de baja latencia, reconexión con período de gracia. Ver [04-data-model.md](04-data-model.md) para el detalle campo por campo. |
| `pitch.js` | `detectPitch(samples, sampleRate)`: estima la frecuencia fundamental de una ventana de audio por autocorrelación, o `null` si es silencio. |
| `scoring.js` | `ScoringSession`: compara la nota detectada contra la esperada del `.txt` (tolerante a octava) y acumula puntaje frame a frame. `notesFromSongPayload` aplana las notas de una canción a la forma que consume la sesión. |
| `netinfo.js` | `detectLanIp()`: heurística para adivinar la IP LAN de este equipo al arrancar (usada para el certificado autofirmado y el QR). |
| `folderDialog.js` | `browseForFolder()`: abre el selector de carpetas nativo del sistema operativo (usado por el botón "Buscar carpeta..." de Configuración). Puede no estar disponible en todos los SO (responde 501 si no). |
| `tls.js` | Genera/cachea el certificado HTTPS autofirmado para la IP LAN detectada. |
| `certManager.js` | Orquesta la emisión/renovación de un certificado real de Let's Encrypt vía DNS-01, usando `cloudflareDns.js` para el reto. |
| `cloudflareDns.js` | Cliente mínimo de la API de Cloudflare: crear/borrar el registro TXT temporal que exige el reto DNS-01. |

## Mapa de archivos — cliente (`server/public/`)

| Archivo | Responsabilidad |
|---|---|
| `index.html` / `app.js` | La **Sala** (pantalla principal): catálogo con buscador y salto alfabético, reproductor (letra, progreso, fondo con video o con ondas de audio reales dibujadas en canvas), QR, lista de conectados, cola, ranking, indicador de latencia, toggle de baja latencia, toggle de tema. |
| `join.html` / `join.js` | Pantalla del **celular**: elegir apodo/rol, buscar canción, esperar en cola, cantar (captura de mic, envío de PCM16 por `/ws/sing`, letra previa/actual/siguiente, ecualizador de afinación en vivo derivado 100% en cliente de los frames de puntaje), avanzar cola, reconexión/rejoin con recuperación de sesión (`localStorage`). |
| `settings.html` / `settings.js` | Pantalla de **Configuración**: carpetas de biblioteca (con selector nativo o ruta a mano), IP LAN, dominio + token de Cloudflare para Let's Encrypt, y **habilitación** de micrófonos físicos (enumera `audioinput` vía `enumerateDevices` tras un permiso de mic; guarda los tildados como `{deviceId, label}` en `localMics`, sin nombre de cantante). Sin rediseño visual propio — hereda la paleta de `style.css` pasivamente. |
| `localmics.js` | Cargado por la **Sala**. Expone `window.localMics` (API que usa `app.js`) y gestiona: (a) agregar un cantante sin celular vía un modal (nombre + canción) que abre su **propio** `/ws/room` como `singer` y hace `chooseSong` → entra a la cola; (b) la captura de audio del turno. Justo antes del turno de un mic-singer, `app.js` muestra una pantalla de preparación (elegir/probar el mic con medidor de nivel); al "Empezar", `localmics.js` captura desde el `deviceId` elegido y streamea a `/ws/sing`, alineado con la cuenta atrás. El servidor no distingue un mic local de un celular. |
| `sing.html` / `sing.js` | Página de **debug/prueba de carga** del motor de puntuación (Fase 1 original), independiente de la Sala/join. Tiene su propio `<style>` embebido que no participa del sistema de temas — queda siempre oscura. No es parte del flujo real de un usuario final. |
| `style.css` | Hoja de estilos única para todas las páginas: tokens de tema (`:root` oscuro por defecto, `[data-theme="light"]`), y todas las reglas visuales de Sala/join/settings. |
| `theme.js` | `initTheme()`, `toggleTheme()`, `themeIcon()` — mecanismo compartido de tema claro/oscuro (atributo `data-theme` en `<html>` + `localStorage['pitchparty-theme']`). Importado por `app.js` y `join.js`. |
| `audioUtils.js` | Utilidades de audio del lado del cliente (resampleo/encoding PCM16 para el envío por WebSocket desde el celular). |

## Estructura de carpetas del repo

```
server/               Servidor Node (todo el backend + el motor de puntuación)
server/src/           Código del servidor (ver tabla arriba)
server/public/        Cliente web servido tal cual (sin build step)
server/data/          DB SQLite, settings.json, certificados — no versionado, se crea solo
songs/                Biblioteca de canciones UltraStar — no versionado, la aporta el usuario
config.json            libraryPaths por defecto (editable después desde la UI)
docs/sdd/              Esta especificación técnica
plan_karaoke_v0.03.md  Plan de producto original — histórico, ver docs/sdd/00-index.md
```
