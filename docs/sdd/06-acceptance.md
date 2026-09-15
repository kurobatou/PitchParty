# 6. Criterios de aceptación

Lista numerada y verificable de lo que el sistema **debe** cumplir. Existe para dos cosas:

1. Que un test pueda decir "cubro el criterio #12" en vez de "testea la sala".
2. Que cuando se toque el comportamiento, haya un lugar concreto que actualizar (y que revisar) además del código.

La columna **Verificación** dice cómo se comprueba hoy:

- `test:<archivo>` — hay un test automatizado que lo cubre (`server/test/`).
- `manual (curl)` — se comprueba contra el servidor corriendo, sin navegador. Se puede desde cualquier máquina.
- `manual (navegador)` — hay que mirarlo en un navegador, pero **no** necesita micrófono ni celulares: se puede verificar desde la máquina de desarrollo (ver la nota sobre el certificado de desarrollo en [`AGENTS.md`](../../AGENTS.md)).
- `manual (Mac)` — solo en el MacBook: necesita micrófono real, celulares conectándose, o la red de la fiesta.
- `manual` a secas — pendiente de clasificar.

> Los criterios describen lo que ya está implementado. Lo que todavía no existe va en [07-next.md](07-next.md), no acá.

## 6.1 Catálogo e indexado

| # | Criterio | Verificación |
|---|---|---|
| 1 | Dado un `.txt` de UltraStar válido, cuando se parsea, entonces se extraen `title`, `artist`, `language`, `year`, `bpm` y `gap`. | `test:usdxParser` |
| 2 | Dado un `.txt` con decimales escritos con coma (`BPM:340,5`), cuando se parsea, entonces se interpretan como número igual que con punto. | `test:usdxParser` |
| 3 | Dado un `.txt` con una línea `E`, cuando se parsea, entonces todo lo que venga después se ignora. | `test:usdxParser` |
| 4 | Dado un `.txt` con sílabas que empiezan o terminan con espacio, cuando se parsea, entonces esos espacios se preservan (las palabras no se pegan). | `test:usdxParser` |
| 5 | Dado un `.txt` en modo `RELATIVE`, cuando se parsea, entonces los beats se desplazan y se acumulan a través de cada `linebreak`. | `test:usdxParser` |
| 6 | Dado un beat, un BPM y un GAP, cuando se convierte a milisegundos, entonces `ms = gap + beat * (60000 / (bpm * 4))`. | `test:usdxParser` |
| 7 | Dado un `.txt` con marcadores `P1`/`P2` o cabecera `DUETSINGERP2`, cuando se parsea, entonces la canción queda marcada como dueto y las notas quedan separadas por voz. | `test:usdxParser` |
| 8 | Dado un `.txt` sin marcadores de voz, cuando se parsea, entonces no es dueto y todas las notas quedan en la voz 1. | `test:usdxParser` |
| 9 | Dada una carpeta de biblioteca configurada, cuando se reindexa, entonces cada subcarpeta con `.txt` se inserta o actualiza por `folder_path`, y las filas cuya carpeta ya no existe se borran. | manual |
| 10 | Dado un `.txt` que no está en UTF-8 (o tiene BOM), cuando se lee, entonces se detecta su encoding real y los acentos no se rompen. | manual |

## 6.2 Puntuación (modo UltraStar)

| # | Criterio | Verificación |
|---|---|---|
| 11 | Dado un tono puro de 220 Hz o 440 Hz, cuando se analiza una ventana de audio, entonces la frecuencia detectada cae dentro de ~3%. | `test:pitch` |
| 12 | Dado silencio (RMS bajo el umbral) o una ventana vacía, cuando se analiza, entonces la detección devuelve `null` en vez de inventar un tono. | `test:pitch` |
| 13 | Dada una nota cantada dentro de `HIT_TOLERANCE_SEMITONES` (2.5) de la esperada, cuando se puntúa el frame, entonces cuenta como acierto y suma sus puntos (1 normal, 2 golden). | `test:scoring` |
| 14 | Dada una nota cantada una octava arriba o abajo de la esperada, cuando se puntúa, entonces **igual cuenta como acierto** (se compara clase de tono, no tono absoluto). | `test:scoring` |
| 15 | Dado un frame desafinado o en silencio mientras hay una nota activa, cuando se puntúa, entonces no suma a `totalScore` pero **sí** suma a `maxScore`. | `test:scoring` |
| 16 | Dado un frame donde no hay ninguna nota activa (silencio entre frases), cuando se puntúa, entonces `expectedMidi` es `null` y `maxScore` no cambia. | `test:scoring` |
| 17 | Dadas las líneas `freestyle`/`rap` de un `.txt`, cuando se arma la lista de notas puntuables, entonces quedan afuera y nunca afectan `maxScore`. | `test:scoring` |
| 18 | Dado un stream de audio del celular, cuando el servidor acumula 2048 muestras (≈128 ms a 16 kHz), entonces emite exactamente un mensaje `frame` con el estado acumulado. | manual (Mac) |

## 6.3 Sala, cola y turnos

| # | Criterio | Verificación |
|---|---|---|
| 19 | Dado un `join` sin apodo, cuando se crea el usuario, entonces recibe un id único y un apodo de respaldo (`Invitado-xxxx`). | `test:room` |
| 20 | Dado un usuario que elige canción dos veces, cuando se encola, entonces ocupa **un solo** lugar en la cola (no se duplica). | `test:room` |
| 21 | Dado que ya hay `MAX_ACTIVE_SINGERS` (4) turnos activos, cuando se pide avanzar la cola, entonces no se llama a nadie más. | `test:room` |
| 22 | Dada una cola vacía, cuando se pide avanzar, entonces no pasa nada (devuelve `null`, sin romper). | `test:room` |
| 23 | Dado un turno terminado con puntaje, cuando se cierra, entonces entra al ranking ordenado por **porcentaje** (`total/max`), no por puntaje absoluto. | `test:room` |
| 24 | Dado que el último cantante activo termina o abandona, cuando se libera el turno, entonces `nowPlaying` vuelve a `null`. | `test:room` |
| 25 | Dado un `roomState`, cuando se arma el payload, entonces no incluye a la Sala (`role: screen`) en la lista de usuarios ni expone ningún `socket`. | `test:room` |
| 26 | Dado un celular que pierde el socket, cuando se cierra, entonces queda `connected: false` con un timer de `DISCONNECT_GRACE_MS` (90 s) pendiente, sin perder su lugar en la cola. | `test:room` |
| 27 | Dado un `rejoin` con un `userId` vivo, cuando llega dentro del período de gracia, entonces recupera apodo, rol, canción y posición en la cola, y se cancela el timer. | `test:room` |
| 28 | Dado un `rejoin` con un `userId` que ya no existe, cuando llega, entonces el servidor responde `rejoinFailed` y el cliente vuelve al formulario de unirse. | `test:room` |
| 29 | Dado un socket viejo que reporta su cierre **después** de que el usuario ya reconectó con otro, cuando llega ese `close`, entonces se ignora (no borra a un usuario que está conectado). | manual |
| 30 | Dado un invitado que quiere cantar, cuando manda `setRole: singer`, entonces cambia de rol sin tener que desconectarse y volver a unirse. | manual (Mac) |
| 66 | Dado un `join` sin apodo, cuando el servidor responde `welcome`, entonces incluye el `nickname` asignado (`Invitado-xxxx`), y el celular muestra ese mismo nombre que ve la Sala. | manual (navegador) |
| 67 | Dado un usuario encolado, cuando manda `setNickname`, entonces cambia su nombre **sin perder** su posición en la cola ni su estado de turno. | `test:room` |
| 68 | Dado un `setNickname` con espacios sobrantes o más de 24 caracteres, cuando se aplica, entonces el nombre se recorta y se limita a 24. | `test:room` |
| 69 | Dado un `setNickname` vacío o solo con espacios, cuando se aplica, entonces se conserva el nombre anterior (nadie queda sin nombre). | `test:room` |
| 70 | Dado un `setNickname` de un `userId` inexistente, cuando se procesa, entonces no rompe ni crea usuarios (devuelve `null`). | `test:room` |
| 71 | Dado un usuario ya unido, cuando toca su propio nombre en el encabezado del celular, entonces se abre el modal de renombrado con el nombre actual precargado. | manual (navegador) |
| 72 | Dado un `join` con un nombre con espacios sobrantes o más de 24 caracteres, cuando se crea el usuario, entonces se aplican las **mismas** reglas que en `setNickname` — el `maxlength` del formulario no se toma como garantía. | `test:room` |

## 6.4 Modos, duetos y participantes sin celular

| # | Criterio | Verificación |
|---|---|---|
| 31 | Dado un `setMode` de la Sala, cuando el valor es `karaoke` o `ultrastar`, entonces se acepta; cualquier otro valor deja el modo en `null` (selector visible). | `test:room` |
| 32 | Dado un `setMode` mandado por algo que no es la Sala, cuando llega, entonces se ignora. | manual (Mac) |
| 33 | Dado el modo Karaoke, cuando la Sala encola a alguien sin celular, entonces se crea un participante de rol `karaoke` sin socket, ya en estado `queued`. | `test:room` |
| 34 | Dado un broadcast de estado, cuando hay participantes sin socket (rol `karaoke`) o sockets cerrados, entonces se los saltea sin romper el envío al resto. | `test:room` |
| 35 | Dado un participante de rol `karaoke`, cuando la Sala manda `endTurn` para él, entonces se lo elimina de la sala (no puntúa ni queda en la lista). | manual (Mac) |
| 36 | Dado el modo Karaoke, cuando la Sala emite `karaokeProgress`, entonces todos los celulares conectados reciben `songId` y `positionMs` para sincronizar la letra. | manual (Mac) |
| 37 | Dada una canción de dueto, cuando el celular elige `duo` o `solo` (al elegir canción o después con `setDuetMode`), entonces esa elección viaja en `nowPlaying` y la Sala reproduce en consecuencia. | manual (Mac) |

## 6.5 Micrófono desde el celular (modo Karaoke)

| # | Criterio | Verificación |
|---|---|---|
| 72 | Dado un `phoneMic` nulo o incompleto, cuando se normaliza, entonces queda apagado con la música al 70% (`enabled: false`, `musicVolume: 70`). | `test:settings` |
| 73 | Dado un `phoneMic.musicVolume` fuera de rango o no numérico, cuando se normaliza, entonces se recorta a 0-100 (o cae a 70). | `test:settings` |
| 74 | Dado el interruptor global, cuando se guarda desde Configuración, entonces `Room.phoneMicEnabled` se actualiza y viaja en el siguiente `roomState` **sin reiniciar** el servidor. | `test:room` (broadcast) + manual (curl) |
| 75 | Dado que nadie está en su turno, cuando un celular manda audio por `/ws/mic/:userId`, entonces el servidor lo descarta (no llega nada a `/ws/micmix`). | manual (curl) |
| 76 | Dado el celular del turno actual, cuando manda audio, entonces sus frames llegan a la Sala tal cual. | manual (curl) |
| 77 | Dado un celular que **no** tiene el turno, cuando manda audio, entonces se descarta aunque su socket siga abierto. | manual (curl) |
| 78 | Dado el interruptor global apagado, cuando el celular del turno manda audio, entonces también se descarta. | manual (curl) |
| 79 | Dado un turno que termina, cuando el cantante deja de tener el turno, entonces su audio deja de sonar (la regla se evalúa por frame, no al conectar). | `test:room` |
| 80 | Dado el modo Karaoke con la función habilitada, cuando el cantante entra al flujo de turno, entonces ve el botón de micrófono **apagado por defecto**. | manual (navegador) |
| 81 | Dado el interruptor global apagado, cuando un celular entra a su turno, entonces el botón no aparece; en modo UltraStar tampoco aparece nunca. | manual (navegador) |
| 82 | Dado un cantante que arma el botón mientras espera, cuando llega su turno, entonces la captura arranca sola (el permiso de micrófono se pidió en el toque, no al arrancar el turno). | manual (Mac) |
| 83 | Dado audio llegando del celular, cuando suena por los parlantes, entonces la música baja a `phoneMic.musicVolume` y se restaura al dejar de llegar. | manual (Mac) |

## 6.6 Mensajes desde el celular

| # | Criterio | Verificación |
|---|---|---|
| 38 | Dado un mensaje sin `type`, o con un `type` desconocido, cuando se valida, entonces se rechaza con `400`. | `test:messages` |
| 39 | Dado un mensaje `bug` o `general`, cuando el `text` viene vacío o solo con espacios, entonces se rechaza; si es válido, se guarda recortado. | `test:messages` |
| 40 | Dado un mensaje `sync`, cuando falta el `songId` o no es numérico, entonces se rechaza; el `text` es opcional. | `test:messages` |
| 41 | Dado un mensaje `sync` con un `songId` que no está en el catálogo, cuando se procesa, entonces se rechaza con `400`. | manual |
| 42 | Dado un mensaje `sync` válido, cuando se guarda, entonces se persiste también el `song_title` del momento, para que siga siendo legible aunque la canción desaparezca del catálogo. | manual |
| 43 | Dado un `song_request`, cuando falta `requestedTitle`, entonces se rechaza; `requestedArtist` y `text` son opcionales. | `test:messages` |
| 44 | Dado cualquier mensaje con apodo, cuando se guarda, entonces el apodo se recorta y se limita a 40 caracteres. | `test:messages` |
| 45 | Dado un mensaje existente, cuando se hace `PATCH` con `resolved`, entonces cambia su estado; con un id inexistente responde `404`. | manual |
| 46 | Dado un `DELETE` de un mensaje, cuando se ejecuta, entonces responde `204` — incluso si ese id ya no existía. | manual |
| 58 | Dados mensajes pendientes y resueltos, cuando se abre la bandeja, entonces se ven solo los pendientes y un control que indica cuántos resueltos hay. | manual (navegador) |
| 59 | Dado que no hay ningún mensaje resuelto, cuando se abre la bandeja, entonces ni el control de ver resueltos ni el de borrado masivo están visibles. | manual (navegador) |
| 60 | Dado el control de resueltos, cuando se activa, entonces se muestran también los resueltos (pendientes primero) sin recargar; al desactivarlo, se vuelven a ocultar. | manual (navegador) |
| 61 | Dado que todos los mensajes están resueltos y ocultos, cuando se mira la lista, entonces dice cuántos hay ocultos en vez de "no hay mensajes" (que sería engañoso). | manual (navegador) |
| 62 | Dado que la bandeja se refresca sola cada 15 s, cuando ocurre ese refresco con los resueltos visibles, entonces siguen visibles (el refresco no pisa la preferencia). | manual (navegador) |
| 63 | Dado `DELETE /api/messages/resolved`, cuando se ejecuta, entonces borra todos los resueltos, **ningún** pendiente, y devuelve cuántos borró. | manual (curl) |
| 64 | Dado que no hay resueltos, cuando se llama a ese endpoint igual, entonces responde `{ deleted: 0 }` con `200` en vez de error. | manual (curl) |
| 65 | Dada la acción de borrado masivo en la bandeja, cuando se cancela la confirmación, entonces no se borra nada; cuando se confirma, la lista se actualiza sola y avisa cuántos borró. | manual (navegador) |

## 6.7 Configuración

| # | Criterio | Verificación |
|---|---|---|
| 47 | Dado un `micMonitor` nulo o incompleto, cuando se normaliza, entonces quedan valores sanos por defecto (`enabled: false`, `deviceId: null`, `musicVolume: 70`). | `test:settings` |
| 48 | Dado un `musicVolume` fuera de rango o no numérico, cuando se normaliza, entonces se recorta a 0-100 (o cae a 70 si no es un número). | `test:settings` |
| 49 | Dados `localMics` con entradas sin `deviceId`, cuando se guardan, entonces esas entradas se descartan. | manual |
| 50 | Dado un cambio de `libraryPaths`, cuando se guarda, entonces se dispara un reindexado en la misma request. | manual |
| 51 | Dado un cambio de IP LAN o de certificado, cuando se guarda, entonces la respuesta avisa que **requiere reiniciar** el proceso para tomar efecto. | manual |

## 6.8 Experiencia en vivo (solo verificable en el MacBook)

Nada de esto tiene test automatizado y probablemente nunca lo tenga: necesita micrófono real, HTTPS y celulares de verdad.

| # | Criterio | Verificación |
|---|---|---|
| 52 | Dado un celular en la misma red, cuando escanea el QR de la Sala, entonces abre la pantalla de unirse sin advertencia de certificado (con cert de Let's Encrypt) o aceptando la advertencia (autofirmado). | manual (Mac) |
| 53 | Dado el turno de un cantante, cuando llega su momento, entonces su celular arranca el micrófono solo, alineado con la cuenta atrás de la Sala. | manual (Mac) |
| 54 | Dado un cantante cantando, cuando mira su celular, entonces ve el ecualizador de afinación en vivo y el porcentaje de acierto derivado de los mensajes `frame`. | manual (Mac) |
| 55 | Dado un celular que se bloquea a mitad de canción y vuelve, cuando reconecta dentro de 90 s, entonces recupera su sesión sin volver a unirse. | manual (Mac) |
| 56 | Dada una latencia reportada ≥150 ms (o ≥300 ms), cuando la Sala la muestra, entonces avisa "algo de latencia" (o "latencia alta") en vez de fallar en silencio. | manual (Mac) |
| 57 | Dado el monitor de micrófono activado, cuando corre una canción, entonces el micrófono de la máquina de la Sala suena por los parlantes y la música baja a `musicVolume`. | manual (Mac) |
