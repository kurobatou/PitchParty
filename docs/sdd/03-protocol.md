# 3. Protocolo — API HTTP y WebSockets

Todo lo de esta página está tomado directo de `server/src/index.js` (única fuente de verdad del protocolo) y de los consumidores del lado del cliente (`app.js`, `join.js`). Si el código y este documento alguna vez no coinciden, gana el código.

## API HTTP

Base: `https://<ip-o-dominio>:<PORT>` (HTTPS siempre, ver [02-architecture.md](02-architecture.md); `PORT` por defecto `3000`).

| Método | Ruta | Descripción | Respuesta / notas |
|---|---|---|---|
| `GET` | `/api/songs` | Lista el catálogo completo. | `[{ id, title, artist, language, year, bpm, hasVideo, coverUrl }]` |
| `GET` | `/api/songs/:id` | Detalle de una canción, incluyendo letra parseada. | Como arriba + `videogap, gap, mp3Url, videoUrl, lines` (lines = salida de `parseUsdxTxt`). `404` si no existe. |
| `POST` | `/api/reindex` | Re-escanea todas las carpetas de biblioteca configuradas. | `{ indexed, skipped, removed, total }` |
| `GET` | `/api/settings` | Estado actual de configuración. | `{ libraryPaths, libraryPathStatus, lanIpOverride, detectedLanIp, effectiveLanIp, publicDomain, acmeEmail, cloudflareTokenSet, certInfo }` |
| `PUT` | `/api/settings` | Actualiza configuración (parcial — solo se tocan los campos presentes en el body). Si cambian `libraryPaths`, reindexá automáticamente. Si cambian `publicDomain`/`cloudflareApiToken`, intenta emitir/renovar el certificado Let's Encrypt ahí mismo (falla rápido si el token/dominio están mal). | Mismo shape que `GET` + `lanIpRestartRequired`, `certAttempt`, `certRestartRequired`, `reindex`. **El cambio de IP o de certificado solo aplica después de reiniciar el proceso** — el body puede pedir `libraryPaths` (array de strings), `lanIpOverride`, `publicDomain`, `cloudflareApiToken`, `acmeEmail`. |
| `POST` | `/api/browse-folder` | Abre el selector de carpetas nativo del SO (usado por "Buscar carpeta..." en Configuración). | `{ path }`, o `501` si el SO no tiene un diálogo nativo disponible. |
| `GET` | `/api/qr?text=<url>` | Genera un QR para la URL indicada. | `{ dataUrl }` (PNG en base64, 320px). |
| `GET` | `/files/:id/:kind` | Sirve el archivo binario de una canción. `kind` ∈ `mp3`, `video`, `cover`. | Stream del archivo, o `404` si esa canción no tiene ese archivo. |

Todo lo demás (`server/public/*`) se sirve como estático desde la raíz (`@fastify/static`).

## WebSocket `/ws/room`

Canal de control de la sala. Lo usan tanto la Sala (`role: "screen"`) como cada celular (`role: "singer"` | `"guest"`). Un socket puede mandar varios mensajes durante su vida; el servidor no espera un orden salvo que `join`/`rejoin` sea el primero.

### Cliente → servidor

| `type` | Campos | Quién lo manda | Efecto |
|---|---|---|---|
| `join` | `nickname?`, `role` (`"screen"` \| `"singer"` \| `"guest"`) | Cualquiera, al conectar por primera vez | Crea un usuario nuevo en `Room` (id `randomUUID()`), responde `welcome`, y hace broadcast de `roomState` a todos. |
| `rejoin` | `userId` | Un celular que se reconecta tras perder el socket | Si `userId` sigue vivo (dentro de `DISCONNECT_GRACE_MS` = 90s desde que se cayó), reclama su registro existente y responde `welcome` con `rejoined: true`. Si no, responde `rejoinFailed`. |
| `chooseSong` | `songId` | Cantante/invitado | Guarda la canción elegida en el usuario y lo encola (`Room.enqueue`) si `songId` es válido. Broadcast de `roomState`. |
| `advanceQueue` | — | Cualquiera (Sala o celular — cualquier conectado puede avanzar la rotación) | Saca el siguiente de la cola y lo pasa a `called`, hasta el tope de `MAX_ACTIVE_SINGERS` (4). Broadcast de `roomState`. |
| `endTurn` | `userId` (el del cantante que termina) | **Solo la Sala** (`role === 'screen'`; el servidor ignora el mensaje de cualquier otro rol) | Avisa que la pantalla terminó de reproducir el turno de `userId` (fin natural o "Volver al catálogo"). Si ese usuario tiene un socket `/ws/sing` abierto, lo corta con un `summary`; si no, marca el turno como abandonado. |
| `toggleLowLatency` | `enabled` (bool) | **Solo la Sala** | Prende/apaga `Room.lowLatencyMode` para toda la sala. Broadcast de `roomState`. |
| `ping` | `t0` (timestamp del cliente, `performance.now()`) | Cada celular, cada 5s (`join.js`, `startLatencyPing`) | El servidor responde `pong` de inmediato con el mismo `t0`. |
| `reportLatency` | `ms` | Cada celular, al recibir su `pong` (RTT redondeado) | Guarda `latencyMs` en el usuario. Broadcast de `roomState`. La Sala usa el peor `latencyMs` entre los cantantes activos para el indicador de red (umbrales: **≥150ms** = "algo de latencia", **≥300ms** = "latencia alta", ver `app.js`). |

### Servidor → cliente

| `type` | Campos | Cuándo |
|---|---|---|
| `welcome` | `userId`, y si es un `rejoin`: `rejoined: true, role, nickname` | Respuesta directa a `join`/`rejoin`. |
| `rejoinFailed` | — | Respuesta a un `rejoin` cuyo `userId` ya no existe (grace period vencido o el servidor reinició). El cliente limpia su sesión guardada y vuelve al formulario de unirse. |
| `pong` | `t0` (eco del que mandó el cliente) | Respuesta a `ping`. |
| `roomState` | `users`, `queue`, `ranking`, `lowLatencyMode`, `nowPlaying` | Broadcast a **todos** los sockets conectados cada vez que cambia el estado de la sala. Ver [04-data-model.md](04-data-model.md) para la forma exacta de cada campo. |

### Cierre de socket

- Si el usuario era `role: "screen"`, se elimina de inmediato (la Sala no tiene posición de cola que valga la pena guardar).
- Si era `singer`/`guest`, entra en `DISCONNECT_GRACE_MS` (90s): queda marcado `connected: false` pero sigue existiendo, esperando un `rejoin`. Si no llega a tiempo, se elimina y se hace broadcast.

## WebSocket `/ws/sing/:songId?userId=<roomUserId>`

Canal de audio + puntuación en vivo, uno por cantante activo. `songId` es el id de la canción (debe existir, si no el servidor cierra el socket con código `1008`). `userId` es opcional pero, si viene, liga esta sesión de canto al usuario correspondiente en `Room` (marca `singing`, y permite que la Sala la corte vía `endTurn`).

### Cliente → servidor

- **Binario**: PCM16 mono, **16000 Hz**, little-endian, en chunks de cualquier tamaño (el servidor los va acumulando en un buffer y procesa de a ventanas fijas de `ANALYSIS_WINDOW_SAMPLES = 2048` muestras, ≈128ms). No hay envoltorio, es el buffer de audio crudo.
- **JSON**: `{ "type": "stop" }` — corta la sesión manualmente y pide el resumen final (lo manda el propio celular al terminar la canción o si el usuario cancela).

### Servidor → cliente

Por cada ventana de 2048 muestras procesada, el servidor manda un mensaje `frame`:

```json
{
  "type": "frame",
  "elapsedMs": 4032.0,
  "detectedMidi": 62.3,
  "expectedMidi": 60,
  "hit": true,
  "points": 1,
  "totalScore": 14,
  "maxScore": 20
}
```

- `elapsedMs`: tiempo transcurrido de audio procesado (no de reloj real) desde que arrancó el socket.
- `detectedMidi`: nota MIDI (con decimales) estimada del audio, o `null` si el frame es silencio/no se detectó tono (`pitch.js`, RMS por debajo de umbral).
- `expectedMidi`: nota MIDI que el `.txt` esperaba en ese instante, o `null` si no hay ninguna nota activa (silencio entre frases — el cliente debe tratar esto como "sin nota", no como error).
- `hit`: `true` si `detectedMidi` está dentro de `HIT_TOLERANCE_SEMITONES = 2.5` semitonos de `expectedMidi`, **comparando solo la clase de tono** (`pitchClassDiff`, ignora la octava — ver `scoring.js`).
- `points`: 1 para notas `normal`, 2 para `golden`; 0 si no hubo acierto o no había nota esperada.
- `totalScore` / `maxScore`: acumulados de toda la sesión hasta este frame. Las líneas `freestyle`/`rap` del `.txt` nunca suman a `maxScore` (no son puntuables, solo se muestran).

Al terminar (por `stop` del cliente, o por `endTurn` recibido en `/ws/room` para el `userId` correspondiente), el servidor manda un único mensaje final y cierra la relación con `Room`:

```json
{ "type": "summary", "totalScore": 14, "maxScore": 20 }
```

Si el socket se cae sin haber mandado `stop` (conexión perdida a mitad de canción), el servidor **no** manda `summary`: marca el turno como abandonado en `Room` (`abandonTurn`) en vez de acreditar un puntaje final.

### Consumo típico en el cliente (`join.js`)

El "ecualizador de afinación en vivo" que ve el cantante en su celular es **100% derivado en el cliente** de estos mismos mensajes `frame` — no hay ningún campo adicional en el protocolo para eso. `join.js` mantiene un buffer circular de los últimos 24 frames (`hit` como `1`/`0`, solo cuando `expectedMidi !== null`), lo agrupa en 12 pares para las 12 barras, y calcula el `%` como el promedio del buffer completo. Ver `server/public/join.js` (`updateEqualizer`) si hace falta tocar esa lógica — no requiere cambios de protocolo.
