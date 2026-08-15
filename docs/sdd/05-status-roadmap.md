# 5. Estado y roadmap

## Fases completas

El plan original (`plan_karaoke_v0.03.md`, §13) definía 7 fases. Estado real hoy:

| Fase | Contenido planeado | Estado |
|---|---|---|
| 0 | Parser USDX + indexador multi-fuente + servidor Node básico + layout base de la Sala | ✅ Completa |
| 1 | Micrófono local + motor de puntuación + prueba de carga con 4 streams | ✅ Completa — pero el motor terminó siendo JS puro en el mismo proceso, no Python en contenedor separado como planeaba el documento original (ver [02-architecture.md](02-architecture.md)). `sing.html`/`sing.js` es el resabio de la página de prueba de carga de esta fase; sigue en el repo como herramienta de debug. |
| 2 | Celular como micrófono (PWA) + Sala interactiva (QR, usuarios conectados, indicador de latencia) | ✅ Completa |
| 3 | Multijugador de fiesta: hasta 4 cantantes, cola de turnos, ranking de sesión | ✅ Completa |
| 4 | Videos de fondo + modo de baja latencia | ✅ Completa — con un plus no planeado: para canciones sin video propio, el fallback terminó siendo ondas de audio reales dibujadas en `<canvas>` a partir del `.mp3` (varios efectos, uno por canción), no gradientes/shaders CSS genéricos como decía el plan original. |
| 5 | Acceso remoto fuera de la LAN (Tailscale/Cloudflare Tunnel) | ⬜ No iniciada. Sigue marcada como opcional. |
| 6 | V2: cuentas persistentes, ranking histórico, "modo servicio en la nube" | ⬜ Explícitamente fuera de alcance de este repo. |

## Trabajo hecho más allá del plan original

- **Migración de Docker + Python a un único proceso Node.js.** El motor de pitch detection y de scoring se reescribió en JavaScript puro (`server/src/pitch.js`, `server/src/scoring.js`), eliminando el contenedor separado, la dependencia de Python/`aubio`/`numpy`, y el IPC entre procesos que proponía el diseño original. La versión anterior (Docker + Python) quedó preservada en la rama `alpha` del repo, no se sigue manteniendo.
- **Configuración desde la UI.** El plan original mencionaba "un archivo de configuración simple (o una pantalla de ajustes básica)" como algo abierto; se implementó como pantalla completa (`settings.html`) con selector nativo de carpetas, override de IP LAN, y gestión de certificado HTTPS — no estaba detallado en el plan v0.03.
- **HTTPS con opción de certificado real.** El plan no entraba en detalle sobre HTTPS. Se implementó autofirmado por defecto más una opción de Let's Encrypt vía DNS-01 en Cloudflare (sin exponer el servidor a internet), configurable desde la misma pantalla de ajustes.
- **Reconexión con recuperación de cola.** No estaba en el plan original: un celular que pierde la conexión (bloqueo de pantalla, Wi-Fi inestable) reconecta solo y recupera su lugar en la cola/estado durante 90 segundos (`Room.reconnect`, `DISCONNECT_GRACE_MS`), en vez de tener que unirse de nuevo desde cero.
- **Rediseño visual (tema claro/oscuro + ecualizador de afinación en vivo).** Hecho a partir de un mockup externo (proyecto de Claude Design). Agregó: sistema de tokens de tema vía variables CSS (OKLCH) con toggle claro/oscuro persistido, un layout de tarjeta centrada para la Sala, y un ecualizador de 12 barras + porcentaje de acierto en la pantalla del celular mientras canta — derivado 100% en el cliente de los mismos mensajes `frame` que ya viajaban por `/ws/sing` (sin cambios de protocolo, ver [03-protocol.md](03-protocol.md)). `sing.html`/`settings.html` quedaron fuera de este rediseño a propósito: heredan la paleta pasivamente pero no tienen layout nuevo.
- **Micrófonos físicos (sin celular).** En Configuración se **habilitan** los micrófonos disponibles (`localMics`, solo `{deviceId, label}`). Desde la Sala se agrega un cantante sin celular (nombre + canción) que entra a la cola vía `localmics.js` (su propio `/ws/room` como `singer`); justo antes de su turno, `app.js` muestra una pantalla de preparación para elegir y probar el mic (medidor de nivel), y al "Empezar" se captura desde el `deviceId` a `/ws/sing` alineado con la cuenta atrás. No requiere librerías de audio nativas (el mic es solo otro dispositivo de entrada del navegador), así que no reintroduce el problema de compilación/empaquetado que motivó salir de Docker. Era una opción secundaria del plan original que quedaba pendiente.
- **Licencia Apache 2.0.** Agregada como paso explícito, con la intención declarada del dueño del repo de hacerlo público más adelante.

## Brechas conocidas / no implementado

Cosas que un agente que retome este proyecto debería saber que **no** están hechas, para no asumir que sí:

- **El tope de "20 conexiones totales"** que mencionaba el plan original como objetivo de capacidad **no está aplicado en el código**: no hay ningún rechazo de conexión por cupo en `room.js` ni en `index.js`. Solo `MAX_ACTIVE_SINGERS = 4` (cantantes con turno activo simultáneo) es un límite real.
- **Sin acceso remoto fuera de la LAN.** El acceso público hoy solo se usa para la validación DNS-01 del certificado Let's Encrypt (un registro TXT temporal), no para exponer la app en sí — seguís necesitando estar en la misma red que el servidor para usarla.
- **Cobertura de tests parcial (por diseño).** Hay tests unitarios (`node --test`, en `server/test/`) de la lógica pura — parser USDX, scoring, detección de tono, y la sala/cola/ranking (`Room`) — más un chequeo de sintaxis de todo el JS (incluido el frontend), lint (ESLint), y CI en GitHub Actions que corre los tres en cada PR y push a `main` (`.github/workflows/ci.yml`, `npm run ci`). Lo que **todavía no** está cubierto: los endpoints HTTP/WebSocket de `index.js`, el indexado real con SQLite (`db.js`/`indexer.js`, que necesitarían una DB temporal y fixtures), y el comportamiento en navegador de la Sala/celular (que hoy solo se valida a mano). Son capas que pueden sumarse después; la actual apunta al mayor valor por menor costo y sin dependencias nativas.
- **Sin multi-sala.** `Room` es una única instancia global por proceso — dos sesiones de karaoke simultáneas necesitarían dos procesos/puertos distintos, no está pensado para convivir en el mismo proceso.
- **Sin autenticación/autorización.** Cualquiera en la red local que abra `/settings.html` puede cambiar la configuración del servidor (carpetas, IP, certificado). Asume red doméstica confiable, no es apto para desplegar en una red compartida con desconocidos.
- **`cloudflareApiToken` en texto plano** en `server/data/settings.json` (no versionado, pero sin cifrar en disco).
