# PitchParty 🎤

Sistema de karaoke casero (estilo UltraStar Deluxe) para la red local de tu casa: el celular es el micrófono, la TV/PC es la pantalla principal, y todo corre en contenedores Docker sin instalar nada más en el equipo servidor.

Reutiliza el catálogo y formato de canciones de **UltraStar Deluxe** (`.txt` + audio + video), con un motor de puntuación propio en Python.

## Qué incluye

- **Sala** (pantalla principal): catálogo de canciones con buscador, código QR para que los celulares se conecten, lista de usuarios conectados en tiempo real (en cola / cantando / puntaje), cola de turnos con rotación manual, ranking de la sesión, indicador de latencia de red y modo de baja latencia.
- **Motor de puntuación** (Python): detecta el tono de la voz por autocorrelación y lo compara contra las notas `.txt` de UltraStar (tolerante a errores de octava). Corre en su propio contenedor, hasta 4 cantantes simultáneos.
- **Celular como micrófono** (PWA vía navegador): se une por QR, elige rol (cantante/invitado), canción, y canta cuando la Sala lo llama — con vibración/beep de aviso.
- **Fondos**: video propio de la canción si existe (servido por HTTP), o barras de audio reactivas en tiempo real (Web Audio `AnalyserNode` + canvas) cuando no hay video.
- **Biblioteca configurable**: una o más carpetas (local y/o NAS montado como carpeta de red), indexadas automáticamente al arrancar.
- **HTTPS con certificado autofirmado**: necesario porque el micrófono del navegador (`getUserMedia`) solo funciona en un "contexto seguro" — no hay forma de evitarlo para usar el mic desde un celular en la LAN.

## Arquitectura

```
Celular (PWA, mic)  ──WebSocket (audio + control)──┐
                                                     ▼
Pantalla principal  ──WebSocket (estado, letras)──► Servidor Node (Fastify)
(navegador/TV)      ◄──HTTP (audio/video/cover)────┤  - Catálogo + SQLite
                                                     │  - Sala/sesión + cola
                                                     │  - Relay de audio
                                                     └──WebSocket local──┐
                                                                          ▼
                                                          Motor de puntuación (Python)
                                                          - Detección de pitch
                                                          - Scoring vs notas USDX
```

Ver [plan_karaoke_v0.03.md](plan_karaoke_v0.03.md) para el diseño completo y las decisiones de producto.

## Cómo correrlo

Requiere [Docker](https://www.docker.com/) — no hace falta instalar Node ni Python en el equipo.

1. Copiá `.env.example` a `.env` y poné la IP de tu equipo en la red local:
   ```bash
   cp .env.example .env
   # editar SERVER_LAN_IP=192.168.x.x
   ```
2. Poné tus canciones UltraStar (carpeta por canción, con `.txt` + `.mp3` + opcionalmente `.jpg`/`.avi`) en `songs/`.
3. Levantalo:
   ```bash
   docker compose up -d
   ```
4. Abrí `https://<SERVER_LAN_IP>:3000` en el equipo y en cada celular — vas a ver la advertencia de certificado no confiable (es autofirmado, sin eso el navegador rechaza el micrófono). Aceptala una vez por dispositivo.

Para agregar más fuentes de canciones (por ejemplo un NAS montado como carpeta de red), sumá la ruta a `config.json` → `libraryPaths`.

## Estructura del repo

```
server/     Servidor Node (Fastify) + cliente web (Sala, join, sing)
engine/     Motor de puntuación en Python (WebSocket + numpy)
songs/      Biblioteca de canciones UltraStar (no versionada)
config.json Rutas de la biblioteca de canciones
```

## Estado

Fases 0 a 4 del plan completas: indexador + parser USDX, motor de puntuación con prueba de carga, celular como micrófono, multijugador de fiesta (cola de turnos, ranking), y modo de baja latencia. Acceso remoto fuera de la LAN (Tailscale/Cloudflare Tunnel) queda pendiente como fase opcional.
