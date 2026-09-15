# 4. Modelo de datos

Hay tres formas de estado en este proyecto, con vidas muy distintas — importa no confundirlas:

1. **Catálogo de canciones** — persistente, SQLite (`server/data/karaoke.db`).
2. **Configuración** — persistente, dos archivos JSON en disco (`config.json` en la raíz, `server/data/settings.json`).
3. **Estado de la sala/sesión** — efímero, solo en memoria del proceso (`Room`), se pierde por completo al reiniciar el servidor.

## 4.1 Catálogo y mensajes — SQLite (`server/data/karaoke.db`)

Dos tablas (ver `server/src/db.js`): `songs` (el catálogo, se reconstruye sola en cada indexado) y `messages` (lo que dejan los celulares, se acumula hasta que alguien lo borre).

### Tabla `songs`

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `INTEGER PRIMARY KEY AUTOINCREMENT` | |
| `folder_path` | `TEXT UNIQUE NOT NULL` | Ruta absoluta de la carpeta de la canción. Es la clave de upsert — re-escanear la misma carpeta actualiza la fila, no duplica. |
| `source_root` | `TEXT NOT NULL` | Cuál de las carpetas de biblioteca configuradas contenía esta canción (para saber de qué raíz vino cuando hay varias). |
| `title`, `artist` | `TEXT NOT NULL` | Del `#TITLE`/`#ARTIST` del `.txt`. |
| `language` | `TEXT` | Opcional. |
| `year` | `INTEGER` | Opcional. |
| `bpm` | `REAL NOT NULL` | |
| `gap` | `REAL NOT NULL` | Offset inicial en ms antes de que arranque la letra (formato USDX). |
| `videogap` | `REAL NOT NULL DEFAULT 0` | Offset del video respecto al audio. |
| `txt_path`, `mp3_path`, `cover_path`, `video_path` | `TEXT` | Rutas absolutas resueltas por el indexador; las tres últimas son `NULL` si ese archivo no existe en la carpeta. |
| `updated_at` | `TEXT NOT NULL` | `datetime('now')`, se actualiza en cada upsert. |

Se reconstruye completa en cada `reindexLibrary()` (arranque del servidor, `POST /api/reindex`, o al guardar `libraryPaths` desde Configuración): hace upsert de lo encontrado y borra (`removeMissingSongs`) las filas cuya carpeta ya no está en ninguna de las raíces configuradas.

### Tabla `messages`

Mensajes dejados desde el celular (ver [03-protocol.md](03-protocol.md), `/api/messages`). A diferencia de `songs`, **nada la reconstruye ni la limpia sola**: las filas viven hasta que alguien las borra desde `messages.html`.

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `INTEGER PRIMARY KEY AUTOINCREMENT` | |
| `type` | `TEXT NOT NULL` | `bug` \| `sync` \| `general` \| `song_request` (validado en `server/src/messages.js`, no por la DB). |
| `text` | `TEXT` | Cuerpo libre. Obligatorio para `bug`/`general`, opcional para los otros dos. |
| `song_id` | `INTEGER` | Solo para `sync`: qué canción está desincronizada. No es FK — si la canción desaparece del catálogo en un reindexado, la fila queda igual. |
| `song_title` | `TEXT` | Snapshot de `"Artista — Título"` al momento de reportar, justamente para que el mensaje siga siendo legible aunque `song_id` ya no exista. |
| `requested_title`, `requested_artist` | `TEXT` | Solo para `song_request`. `requested_title` es obligatorio. |
| `nickname` | `TEXT` | Quién lo dejó, recortado a 40 caracteres. Opcional. |
| `resolved` | `INTEGER NOT NULL DEFAULT 0` | 0/1, se cambia con `PATCH /api/messages/:id`. |
| `created_at` | `TEXT NOT NULL DEFAULT (datetime('now'))` | |

## 4.2 Configuración — archivos en disco

### `config.json` (raíz del repo, versionado, valores por defecto)

```json
{ "libraryPaths": ["./songs"] }
```

Solo se lee una vez, al arrancar (`config.js`), como valor de arranque de `libraryPaths` **si todavía no existe** `server/data/settings.json`. Después del primer arranque, es `settings.json` el que manda — editar `config.json` a mano no tiene efecto una vez que ya se guardó algo desde la UI.

### `server/data/settings.json` (no versionado, se crea solo, es lo que edita la UI de Configuración)

```json
{
  "libraryPaths": ["./songs", "Z:\\NAS\\Karaoke"],
  "lanIpOverride": null,
  "publicDomain": null,
  "cloudflareApiToken": null,
  "acmeEmail": null,
  "localMics": [{ "deviceId": "…", "label": "Bluetooth Mic" }],
  "micMonitor": { "enabled": false, "deviceId": null, "musicVolume": 70 }
}
```

Todos los campos son opcionales salvo `libraryPaths` (si falta, cae al default de `config.json`). `localMics` es la lista de micrófonos físicos **habilitados** para usar desde la Sala (no lleva nombre de cantante — eso se elige por turno en la Sala); el `deviceId` es el que expone `enumerateDevices()`, estable mientras el permiso de mic persista en ese navegador/origen. `micMonitor` controla el monitor de micrófono de la máquina de la Sala (hacer sonar un mic físico por los parlantes mientras corre la canción, bajando la música a `musicVolume`); se normaliza siempre con `normalizeMicMonitor()` (`server/src/settings.js`): `enabled` se castea a booleano, `deviceId` a string-o-`null`, y `musicVolume` se recorta a 0-100 cayendo a `70` si no es un número finito. `cloudflareApiToken` queda **en texto plano en este archivo** — es intencional (no hay otro almacén de secretos en este proyecto) pero vale la pena tenerlo presente si `server/data/` alguna vez se respalda o se comparte.

## 4.3 Estado de sesión — `Room` (en memoria, `server/src/room.js`)

Una única instancia global por proceso (`const room = new Room()` en `index.js`). No hay soporte de múltiples salas concurrentes.

```js
class Room {
  users;              // Map<userId, User>
  queue;               // userId[] — FIFO de cantantes/invitados esperando turno
  activeSingers;        // Set<userId> — en estado "called" o "singing" ahora mismo
  ranking;              // Entry[] — ordenado, mejor puntaje relativo primero
  lowLatencyMode;        // boolean
  nowPlaying;            // { userId, songId, songTitle, duetMode } | null
  disconnectTimers;      // Map<userId, Timeout> — cuentas regresivas de DISCONNECT_GRACE_MS
  mode;                  // 'karaoke' | 'ultrastar' | null — modo de sesión, lo fija la Sala
}
```

`mode` arranca en `null` (la Sala todavía no eligió; Sala y celulares muestran el selector) y solo la Sala lo cambia vía `setMode` — cualquier valor que no sea `'karaoke'`/`'ultrastar'` lo devuelve a `null`. Viaja en cada `roomState`.

### `User` (valor de `users.get(id)`)

| Campo | Tipo | Notas |
|---|---|---|
| `id` | `string` (UUID) | Generado con `randomUUID()` al `join`. Es el `userId` que viaja en el protocolo (ver [03-protocol.md](03-protocol.md)). |
| `nickname` | `string` | Elegido por el usuario, o `Invitado-xxxx` si vino vacío. |
| `role` | `"screen" \| "singer" \| "guest" \| "karaoke"` | Se fija en el `join`, salvo que el propio celular se cambie entre `singer`/`guest` con `setRole`. `karaoke` es especial: no viene de un `join` sino de `addKaraokeSinger()` (participante sin celular, `socket: null`, nunca puntúa, se elimina al terminar su turno). |
| `duetMode` | `"duo" \| "solo" \| null` | Para canciones de dos voces: si la canta entre dos o una sola persona. Lo manda el celular en `chooseSong` o lo cambia después con `setDuetMode`. |
| `state` | `"connected" \| "queued" \| "called" \| "singing" \| "scored"` | Máquina de estados del turno — ver abajo. |
| `songId`, `songTitle` | `number \| null`, `string \| null` | Canción elegida. `songTitle` ya viene formateado `"Artista — Título"`. |
| `lastScore` | `{ total, max } \| null` | Puntaje de la última vez que cantó en esta sesión. |
| `latencyMs` | `number \| null` | Última medición de RTT reportada por el propio celular. |
| `socket` | WebSocket | **Nunca se manda al cliente** — `toPublicList()` lo excluye explícitamente. |
| `connected` | `boolean` | `false` mientras está en el período de gracia de reconexión. |

Transiciones de `state`: `connected` → (elige canción) → `queued` → (`advanceQueue` la saca de la cola) → `called` → (el celular abre `/ws/sing` y empieza a mandar audio) → `singing` → (termina, con puntaje) → `scored`, o (se cae/aborta sin puntaje) → vuelve a `connected`.

### Cola y cantantes activos

- `queue`: FIFO simple de `userId`. Se entra por `enqueue()` (al elegir canción), se sale por `advanceQueue()`.
- `activeSingers`: tope duro de `MAX_ACTIVE_SINGERS = 4` — `advanceQueue()` no saca a nadie más de la cola si ya hay 4 en `called`/`singing`.
- `nowPlaying`: se setea al llamar a alguien (`advanceQueue`) para que la Sala sepa qué reproducir automáticamente; vuelve a `null` cuando `activeSingers` queda vacío (todos terminaron o se abandonaron).

### Reconexión

- `DISCONNECT_GRACE_MS = 90_000` (90s): si el socket de un `singer`/`guest` se cierra, el usuario **no se borra** — queda `connected: false` con un timer pendiente. Si llega un `rejoin` con ese `userId` antes de que expire, `reconnect()` reemplaza el `socket` y cancela el timer, preservando `state`, `queue` position, `songId`, todo. Si expira, recién ahí se llama `remove()`.
- La Sala (`role: "screen"`) no tiene este período de gracia — se borra de inmediato al cerrar el socket (ver [03-protocol.md](03-protocol.md)).

### Ranking

`ranking` es un array de `{ nickname, songTitle, total, max, at }`, uno por cada turno completado con puntaje (`finishTurn`). Se reordena en cada inserción por `total/max` descendente (porcentaje de acierto, no puntaje absoluto — así una canción con menos notas puntuables no queda en desventaja). `roomState` solo manda el top 10 (`ranking.slice(0, 10)`), aunque el array completo se sigue acumulando en memoria durante toda la sesión.

## 4.4 Modelo de puntuación — `ScoringSession` (efímero, uno por socket `/ws/sing` abierto)

No es estado de `Room`, vive solo dentro del handler de `/ws/sing/:songId` mientras ese socket está abierto (`server/src/index.js` + `server/src/scoring.js`):

```js
class ScoringSession {
  notes;       // Note[], ordenadas por startMs — ver abajo
  cursor;       // índice de la próxima nota candidata
  totalScore;   // acumulado
  maxScore;     // acumulado (solo suma cuando hay una nota activa)
}
```

`Note` (salida de `notesFromSongPayload`, a partir de las líneas `.txt` parseadas por `usdxParser.js`):

```js
{ startMs, endMs, pitchMidi, points }  // points: 1 (normal) | 2 (golden)
```

Solo entran acá las notas de tipo `normal`/`golden` — las líneas `freestyle`/`rap` del `.txt` se muestran en la letra pero nunca generan `Note` puntuable, así que nunca afectan `maxScore`.
