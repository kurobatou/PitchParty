# 3. Protocolo — API HTTP y WebSockets

Todo lo de esta página está tomado directo de `server/src/index.js` (única fuente de verdad del protocolo) y de los consumidores del lado del cliente (`app.js`, `join.js`). Si el código y este documento alguna vez no coinciden, gana el código.

## API HTTP

Base: `https://<ip-o-dominio>:<PORT>` (HTTPS siempre, ver [02-architecture.md](02-architecture.md); `PORT` por defecto `3000`).

| Método | Ruta | Descripción | Respuesta / notas |
|---|---|---|---|
| `GET` | `/api/songs` | Lista el catálogo completo. | `[{ id, title, artist, language, year, bpm, hasVideo, coverUrl }]` |
| `GET` | `/api/songs/:id` | Detalle de una canción, incluyendo letra parseada. | Como arriba + `videogap, gap, mp3Url, videoUrl, lines` (lines = salida de `parseUsdxTxt`). `404` si no existe. |
| `POST` | `/api/reindex` | Re-escanea todas las carpetas de biblioteca configuradas. | `{ indexed, skipped, removed, total }` |
| `GET` | `/api/settings` | Estado actual de configuración. | `{ libraryPaths, libraryPathStatus, lanIpOverride, detectedLanIp, effectiveLanIp, publicDomain, acmeEmail, cloudflareTokenSet, certInfo, localMics, micMonitor, phoneMic }` |
| `PUT` | `/api/settings` | Actualiza configuración (parcial — solo se tocan los campos presentes en el body). Si cambian `libraryPaths`, reindexá automáticamente. Si cambian `publicDomain`/`cloudflareApiToken`, intenta emitir/renovar el certificado Let's Encrypt ahí mismo (falla rápido si el token/dominio están mal). | Mismo shape que `GET` + `lanIpRestartRequired`, `certAttempt`, `certRestartRequired`, `reindex`. **El cambio de IP o de certificado solo aplica después de reiniciar el proceso** — el body puede pedir `libraryPaths` (array de strings), `lanIpOverride`, `publicDomain`, `cloudflareApiToken`, `acmeEmail`, `localMics` (array de `{deviceId, label?}` — micrófonos físicos habilitados; las entradas sin `deviceId` se descartan), `micMonitor` (`{enabled, deviceId, musicVolume}` — se normaliza con `normalizeMicMonitor`: `musicVolume` se recorta a 0-100 y cae a `70` si no es un número), y `phoneMic` (`{enabled, musicVolume}` — se normaliza con `normalizePhoneMic`, mismas reglas). La respuesta devuelve también `micMonitor` y `phoneMic` ya normalizados. **`phoneMic` aplica en caliente**: al guardarlo el servidor actualiza `Room.phoneMicEnabled` y hace broadcast de `roomState`, así que los celulares muestran/ocultan el botón sin reiniciar nada. |
| `POST` | `/api/messages` | Deja un mensaje desde el celular. `type` ∈ `bug`, `sync`, `general`, `song_request` (validación en `server/src/messages.js`). Campos requeridos según el tipo: `bug`/`general` → `text`; `sync` → `songId` (`text` opcional); `song_request` → `requestedTitle` (`requestedArtist`/`text` opcionales). `nickname` siempre opcional (se recorta a 40 caracteres). | La fila insertada. `400` si el payload no valida, o si un `sync` apunta a un `songId` que no existe en el catálogo. |
| `GET` | `/api/messages` | Lista todos los mensajes (para la bandeja `messages.html`). | `[{ id, type, text, song_id, song_title, requested_title, requested_artist, nickname, resolved, created_at }]` |
| `PATCH` | `/api/messages/:id` | Marca un mensaje como resuelto o no (`{ resolved: bool }`). | La fila actualizada, o `404` si ese id no existe. |
| `DELETE` | `/api/messages/resolved` | Borra **todos** los mensajes marcados como resueltos, de una. Nunca toca los pendientes. | `{ deleted: N }`. Si no hay ninguno resuelto devuelve `{ deleted: 0 }` con `200` — no es error. Convive con la ruta de abajo: Fastify resuelve el segmento estático (`resolved`) antes que el paramétrico (`:id`). |
| `DELETE` | `/api/messages/:id` | Borra un mensaje. | `204` siempre (borrar algo inexistente no es error). |
| `POST` | `/api/browse-folder` | Abre el selector de carpetas nativo del SO (usado por "Buscar carpeta..." en Configuración). | `{ path }`, o `501` si el SO no tiene un diálogo nativo disponible. |
| `GET` | `/api/qr?text=<url>` | Genera un QR para la URL indicada. | `{ dataUrl }` (PNG en base64, 320px). |
| `GET` | `/files/:id/:kind` | Sirve el archivo binario de una canción. `kind` ∈ `mp3`, `video`, `cover`. | Stream del archivo, o `404` si esa canción no tiene ese archivo. |

Todo lo demás (`server/public/*`) se sirve como estático desde la raíz (`@fastify/static`).

## WebSocket `/ws/room`

Canal de control de la sala. Lo usan tanto la Sala (`role: "screen"`) como cada celular (`role: "singer"` | `"guest"`). Un micrófono físico configurado en la Sala (ver `localmics.js`) abre un socket adicional y se une como `role: "singer"` — desde el servidor es indistinguible de un celular. Un socket puede mandar varios mensajes durante su vida; el servidor no espera un orden salvo que `join`/`rejoin` sea el primero.

### Cliente → servidor

| `type` | Campos | Quién lo manda | Efecto |
|---|---|---|---|
| `join` | `nickname?`, `role` (`"screen"` \| `"singer"` \| `"guest"`) | Cualquiera, al conectar por primera vez | Crea un usuario nuevo en `Room` (id `randomUUID()`), responde `welcome`, y hace broadcast de `roomState` a todos. El nombre pasa por las **mismas reglas que `setNickname`** (recortado y limitado a 24 caracteres); si queda vacío se asigna `Invitado-xxxx`. El `maxlength` del formulario no alcanza como garantía: un cliente WebSocket cualquiera puede mandar lo que quiera. |
| `rejoin` | `userId` | Un celular que se reconecta tras perder el socket | Si `userId` sigue vivo (dentro de `DISCONNECT_GRACE_MS` = 90s desde que se cayó), reclama su registro existente y responde `welcome` con `rejoined: true`. Si no, responde `rejoinFailed`. |
| `chooseSong` | `songId`, `duetMode?` (`"duo"` \| `"solo"`) | Cantante/invitado | Guarda la canción elegida en el usuario y lo encola (`Room.enqueue`) si `songId` es válido. `duetMode` dice cómo tocar una canción de dos voces (cualquier otro valor se guarda como `null`). Broadcast de `roomState`. |
| `setRole` | `role` (`"singer"` \| `"guest"`) | Un celular que cambia de idea a mitad de sesión | Cambia el rol sin tener que desconectarse y volver a unirse. Cualquier otro valor se ignora. Broadcast de `roomState`. |
| `setNickname` | `nickname` | Cualquier celular, en cualquier momento después de unirse | Renombra al usuario **en el lugar**: conserva su posición en la cola, su estado de turno y su canción. El nombre se recorta y se limita a 24 caracteres; si queda vacío se mantiene el anterior (nadie puede quedar sin nombre). Responde `nicknameChanged` a quien lo pidió y hace broadcast de `roomState`. |
| `setDuetMode` | `duetMode` (`"duo"` \| `"solo"`) | Un celular ya encolado con una canción de dueto | Cambia la elección dúo/solo mientras espera su turno. Broadcast de `roomState`. |
| `setMode` | `mode` (`"karaoke"` \| `"ultrastar"` \| `null`) | **Solo la Sala** | Fija el modo de la sesión para todos (o vuelve al selector con `null`). Cualquier valor desconocido equivale a `null`. Broadcast de `roomState`. |
| `addKaraokeSinger` | `nickname`, `songId` | **Solo la Sala** (modo Karaoke) | Encola a alguien sin celular como usuario de rol `karaoke` (sin socket, sin puntaje). Se ignora si el `songId` no existe. Broadcast de `roomState`. |
| `karaokeProgress` | `songId`, `positionMs` | **Solo la Sala** (modo Karaoke) | Retransmite la posición de reproducción a todos los conectados para que los celulares sincronicen la letra sin abrir un canal de puntuación. Es un relay directo: no toca el estado de `Room` ni dispara `roomState`. |
| `advanceQueue` | — | Cualquiera (Sala o celular — cualquier conectado puede avanzar la rotación) | Saca el siguiente de la cola y lo pasa a `called`, hasta el tope de `MAX_ACTIVE_SINGERS` (4). Broadcast de `roomState`. |
| `endTurn` | `userId` (el del cantante que termina) | **Solo la Sala** (`role === 'screen'`; el servidor ignora el mensaje de cualquier otro rol) | Avisa que la pantalla terminó de reproducir el turno de `userId` (fin natural o "Volver al catálogo"). Tres casos: si el destinatario es de rol `karaoke`, se lo **elimina** de la sala (no puntúa, no queda dando vueltas); si tiene un socket `/ws/sing` abierto, se lo corta con un `summary`; si no tiene ninguno de los dos (el celular todavía no abrió el micrófono), se marca el turno como abandonado para que no quede trabado en `called`. |
| `toggleLowLatency` | `enabled` (bool) | **Solo la Sala** | Prende/apaga `Room.lowLatencyMode` para toda la sala. Broadcast de `roomState`. |
| `ping` | `t0` (timestamp del cliente, `performance.now()`) | Cada celular, cada 5s (`join.js`, `startLatencyPing`) | El servidor responde `pong` de inmediato con el mismo `t0`. |
| `reportLatency` | `ms` | Cada celular, al recibir su `pong` (RTT redondeado) | Guarda `latencyMs` en el usuario. Broadcast de `roomState`. La Sala usa el peor `latencyMs` entre los cantantes activos para el indicador de red (umbrales: **≥150ms** = "algo de latencia", **≥300ms** = "latencia alta", ver `app.js`). |

### Servidor → cliente

| `type` | Campos | Cuándo |
|---|---|---|
| `welcome` | `userId`, `nickname`, y si es un `rejoin`: `rejoined: true, role` | Respuesta directa a `join`/`rejoin`. `nickname` viaja **siempre** (no solo en el `rejoin`): quien se une sin escribir nombre recibe así el `Invitado-xxxx` que le asignó el servidor, y muestra el mismo nombre que ve la Sala. |
| `nicknameChanged` | `nickname` | Respuesta directa a `setNickname`, solo al socket que lo pidió (el resto se entera por el `roomState` que va detrás). |
| `rejoinFailed` | — | Respuesta a un `rejoin` cuyo `userId` ya no existe (grace period vencido o el servidor reinició). El cliente limpia su sesión guardada y vuelve al formulario de unirse. |
| `pong` | `t0` (eco del que mandó el cliente) | Respuesta a `ping`. |
| `roomState` | `users`, `queue`, `ranking`, `lowLatencyMode`, `nowPlaying`, `mode`, `phoneMicEnabled` | Broadcast a **todos** los sockets conectados cada vez que cambia el estado de la sala. `mode` es el modo de sesión elegido por la Sala (`"karaoke"` \| `"ultrastar"` \| `null`); `nowPlaying` incluye `duetMode`. `phoneMicEnabled` es el interruptor global de "usar el celular como micrófono" (ver los WebSockets de audio más abajo); los celulares lo usan para decidir si ofrecen el botón. Ver [04-data-model.md](04-data-model.md) para la forma exacta de cada campo. Los usuarios de rol `karaoke` no tienen socket, así que el broadcast los saltea. |
| `karaokeProgress` | `songId`, `positionMs` | Relay de lo que manda la Sala en modo Karaoke, para que los celulares sincronicen la letra. No es estado de `Room`: no se reenvía a quien se conecta después, solo llega en vivo. |

### Cierre de socket

- Si el usuario era `role: "screen"`, se elimina de inmediato (la Sala no tiene posición de cola que valga la pena guardar).
- Si era `singer`/`guest`, entra en `DISCONNECT_GRACE_MS` (90s): queda marcado `connected: false` pero sigue existiendo, esperando un `rejoin`. Si no llega a tiempo, se elimina y se hace broadcast.

## WebSockets de micrófono desde el celular (modo Karaoke)

Par de canales que convierten un celular en **micrófono inalámbrico**: su voz sale por los parlantes de la máquina de la Sala. Es un relay tonto — el servidor **nunca decodifica el audio**, solo reenvía los frames tal cual. Existen únicamente para el modo Karaoke, donde `/ws/sing` no se usa porque no hay puntuación.

Están apagados por defecto: requieren `phoneMic.enabled` en la configuración (ver [04-data-model.md](04-data-model.md)), y además cada persona tiene que prender el botón en su propio celular.

### `/ws/mic/:userId` (celular → servidor)

- **Binario**: PCM16 mono, **16000 Hz**, little-endian — el mismo formato que `/ws/sing`, producido con los mismos helpers (`downsampleTo16k` + `floatTo16BitPCM` de `audioUtils.js`). Sin envoltorio.
- No hay mensajes JSON: el celular abre el socket cuando empieza a capturar y lo cierra al terminar su turno.

**Regla de una sola voz (se aplica en el servidor, no en el celular).** Por **cada frame** recibido, el servidor consulta `Room.canRelayMic(userId)` y descarta el audio salvo que se cumplan las dos condiciones: `phoneMicEnabled` está activo **y** ese `userId` es el del turno actual (`nowPlaying.userId`). Se revisa frame a frame, no al conectar, para que el corte siga al turno cuando cambia: un celular que se quedó con el socket abierto no puede pisar a quien está cantando. Los frames descartados se tiran en silencio (no hay error ni cierre de socket).

### `/ws/micmix` (servidor → Sala)

La Sala abre este socket para **recibir** el audio ya filtrado. Cada frame que sobrevive la regla de arriba se reenvía sin modificar a todos los oyentes conectados. No lleva identificador de origen: como solo puede sonar un celular a la vez, no hace falta distinguir fuentes ni mezclar.

La Sala mantiene un jitter buffer chico (~100 ms) antes de empezar a reproducir, para absorber saltos de WiFi; si se queda sin audio emite silencio y vuelve a llenar el buffer en vez de chasquear. Mientras llega audio, baja la música a `phoneMic.musicVolume` y la restaura cuando deja de llegar (ver `app.js`).

**Latencia esperada: ~0,2–0,3 s** de boca a parlante (WiFi + buffers). Es inherente al camino celular → servidor → Sala y está aceptado como compromiso de diseño; no se puede bajar mucho más sin cambiar a WebRTC. Si el celular está cerca de los parlantes puede haber acople (feedback), igual que con cualquier micrófono.

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
