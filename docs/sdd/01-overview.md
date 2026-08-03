# 1. Visión general y decisiones de producto

## Qué es

PitchParty es un sistema de karaoke casero, estilo UltraStar Deluxe, para la red local de una casa: el celular de cada invitado es el micrófono, y una pantalla principal (TV o un equipo conectado a ella) muestra el catálogo, la letra, el video/fondo y el estado de la sala. Reutiliza el catálogo y formato de canciones de **UltraStar Deluxe** (carpeta por canción con `.txt` + audio + video/portada opcionales) y calcula el puntaje con un motor de afinación propio.

Corre como **un único proceso Node.js**, sin Docker y sin ningún componente en Python — ver [02-architecture.md](02-architecture.md) para el detalle de por qué esto es distinto a lo que planteaba el documento de diseño original.

## Decisiones de producto vigentes

| Tema | Decisión actual |
|---|---|
| Dónde corre el servidor | Un único proceso Node.js en cualquier computador de la casa; se prende/apaga manualmente, no es un servicio siempre activo. |
| Rol de la pantalla principal ("Sala") | Cliente de navegador — el navegador propio de la TV, o un equipo externo conectado por HDMI. Sin micrófono. |
| Micrófonos | El celular de cada participante, vía navegador (PWA, `getUserMedia`). No hay soporte de micrófono USB/Bluetooth conectado al servidor (estaba en el plan original, no se implementó — ver [05-status-roadmap.md](05-status-roadmap.md)). |
| Cantantes simultáneos | Hasta **4** turnos activos (`llamado`/`cantando`) a la vez — límite real, aplicado en `Room.advanceQueue()` (`MAX_ACTIVE_SINGERS`, ver [04-data-model.md](04-data-model.md)). |
| Invitados/conexiones totales | Sin límite técnico aplicado hoy. El plan original mencionaba "hasta 20 conexiones totales" como objetivo de capacidad de referencia, pero el código actual no lo hace cumplir (ninguna conexión es rechazada por cupo). |
| Usuarios / ranking | Solo de la sesión activa, en memoria (`Room`, se pierde al reiniciar el servidor). No hay cuentas persistentes ni ranking entre sesiones. |
| Biblioteca de canciones | Una o más carpetas configurables desde la UI (`⚙️ Configuración`): carpeta local y/o una ruta de red ya montada por el sistema operativo (NAS como unidad de red/punto de montaje). El indexador las escanea todas y arma un catálogo único en SQLite. |
| Fondos sin video propio | Ondas de audio reales dibujadas en `<canvas>` a partir del propio `.mp3` de la canción (barras, barras espejadas, anillos radiales, osciloscopio — se elige un efecto por canción), con un degradado CSS como último fallback. No son shaders ni gradientes puramente decorativos como planteaba el diseño original. |
| Latencia | Medida por ping/pong sobre `/ws/room` y mostrada en la Sala; existe un modo de baja latencia activable desde la Sala que corta el video/ondas de fondo para priorizar audio/puntuación. |
| Tema visual | Claro/oscuro, con acento configurable vía variables CSS (hoy rosa `#ec4899`), toggle persistido en `localStorage`. Rediseño hecho a partir de un mockup (ver [05-status-roadmap.md](05-status-roadmap.md)). |
| HTTPS | Autofirmado por defecto (necesario porque el micrófono del navegador exige un "contexto seguro"), con opción de certificado real de Let's Encrypt vía DNS-01 en Cloudflare configurable desde la UI (no requiere exponer el servidor a internet). |
| Licencia | Apache 2.0, código público (visibilidad del repo en GitHub es una decisión del dueño del repo, no del código en sí). |

## Objetivos

1. Reproducir canciones UltraStar Deluxe (letras, notas, video de fondo si existe) en la pantalla principal.
2. Capturar la voz del cantante desde su celular y calcular un puntaje propio de afinación.
3. Soportar hasta 4 cantantes con turno activo simultáneamente.
4. Dar visibilidad clara del estado de la sala (canciones, cola, usuarios conectados, puntajes) desde la pantalla principal y desde cada celular.
5. Ser tolerante a problemas de red: medir y avisar latencia alta, y permitir degradar la experiencia (menos video, más estabilidad) en vez de fallar en silencio. Reconectar solo y recuperar el lugar en la cola si un celular se cae brevemente (bloqueo de pantalla, Wi-Fi inestable).
6. Indexar la biblioteca desde donde el usuario la tenga (una o varias carpetas configurables), sin asumir una ruta fija.

## Roles y capacidad

- **Pantalla ("screen")**: la Sala. No tiene límite de cantidad (aunque en la práctica hay una sola TV), no ocupa lugar en la cola, no se le aplica el período de gracia de reconexión (ver [03-protocol.md](03-protocol.md)).
- **Cantante ("singer")**: elige canción, entra a la cola, cuando le toca el turno su celular arranca el micrófono solo y transmite audio por `/ws/sing/:songId`.
- **Invitado ("guest")**: conectado pero no canta; ve el estado de la sala y puede avanzar la cola desde su propio celular igual que un cantante.

No hay un rol de administrador distinto — cualquier conectado que abre `⚙️ Configuración` desde la Sala puede cambiar carpetas de biblioteca, IP y certificado; no hay autenticación (asume red doméstica confiable).

## Fuera de alcance actual (no confundir con "no planeado")

- Acceso remoto fuera de la LAN para invitados externos (Tailscale/Cloudflare Tunnel): identificado como fase opcional, no implementado.
- Cuentas persistentes, ranking histórico entre sesiones, "modo servicio en la nube": explícitamente V2, fuera de alcance de este repo.
- Multi-sala / múltiples sesiones concurrentes en el mismo servidor: hay una sola `Room` global por proceso.
- Micrófono USB/Bluetooth conectado directo al servidor: mencionado en el plan original como alternativa secundaria, nunca implementado (todo el audio entra por WebSocket desde el navegador del celular).
- Tests automatizados: no hay suite de tests en el repo hoy; la verificación es manual (ver [05-status-roadmap.md](05-status-roadmap.md)).
