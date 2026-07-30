# PitchParty 🎤

Sistema de karaoke casero (estilo UltraStar Deluxe) para la red local de tu casa: el celular es el micrófono, la TV/PC es la pantalla principal. Corre como un único proceso Node.js — sin Docker, sin Python, sin nada más que instalar además de Node.

Reutiliza el catálogo y formato de canciones de **UltraStar Deluxe** (`.txt` + audio + video), con un motor de puntuación propio en JavaScript.

## Qué incluye

- **Sala** (pantalla principal): catálogo de canciones con buscador y selector de letras A-Z (útil con bibliotecas grandes, ej. un NAS con 200+ canciones), código QR para que los celulares se conecten, lista de usuarios conectados en tiempo real (en cola / cantando / puntaje), cola de turnos con rotación manual, ranking de la sesión, indicador de latencia de red y modo de baja latencia.
- **Motor de puntuación** (JavaScript, corre en el mismo proceso que el servidor): detecta el tono de la voz por autocorrelación y lo compara contra las notas `.txt` de UltraStar (tolerante a errores de octava). Hasta 4 cantantes simultáneos.
- **Celular como micrófono** (PWA vía navegador): se une por QR, elige rol (cantante/invitado) y canción. El permiso de micrófono se pide apenas elige la canción (mientras espera en la cola), así que cuando la Sala lo llama el micrófono arranca solo, sin pasos extra. Al terminar la canción (o si la Sala corta antes) el micrófono se apaga solo, muestra el puntaje final, y deja elegir otra canción para seguir cantando.
- **Fondos**: video propio de la canción si existe (servido por HTTP), o uno de varios efectos con las ondas reales del audio (barras, barras espejadas, anillos radiales, osciloscopio) cuando no hay video — se elige un efecto distinto por canción para que la biblioteca no se vea siempre igual.
- **Configuración desde la UI** (`⚙️ Configuración` desde la Sala): carpetas de biblioteca (con selector de carpeta nativo del sistema operativo, útil para elegir un NAS ya montado), IP del servidor si hace falta forzarla, y certificado HTTPS.
- **HTTPS**: por defecto autofirmado (necesario porque el micrófono del navegador exige un "contexto seguro"), con la IP de este equipo detectada sola al arrancar. Opcionalmente, con un dominio propio en Cloudflare, se puede generar un certificado real de Let's Encrypt desde la misma pantalla de Configuración — sin la advertencia de "sitio no seguro" y sin exponer el servidor a internet (ver más abajo).

## Arquitectura

```
Celular (PWA, mic)  ──WebSocket (audio + control)──┐
                                                     ▼
Pantalla principal  ──WebSocket (estado, letras)──► Servidor Node (Fastify)
(navegador/TV)      ◄──HTTP (audio/video/cover)────┤  - Catálogo + SQLite
                                                     │  - Sala/sesión + cola
                                                     │  - Motor de puntuación
                                                     │    (pitch + scoring, en el
                                                     │    mismo proceso)
                                                     └─────────────────────────
```

Ver [plan_karaoke_v0.03.md](plan_karaoke_v0.03.md) para el diseño completo y las decisiones de producto.

## Cómo correrlo

Requiere [Node.js](https://nodejs.org/) (18 o más nuevo) instalado en el equipo que va a ser el servidor:

- **macOS**: `brew install node`
- **Windows**: instalador desde [nodejs.org](https://nodejs.org/) o `winget install OpenJS.NodeJS.LTS`
- **Linux**: paquete `nodejs` de tu distro, o [nodesource](https://github.com/nodesource/distributions)

Pasos:

1. Poné tus canciones UltraStar (carpeta por canción, con `.txt` + `.mp3` + opcionalmente `.jpg`/`.avi`) en `songs/`.
2. Instalá dependencias y arrancá:
   ```bash
   cd server
   npm install
   npm start
   ```
3. La terminal va a mostrar algo como `HTTPS enabled — open https://192.168.1.x:3000` (la IP se detecta sola). Abrí esa URL en el equipo y en cada celular — vas a ver la advertencia de certificado no confiable (es autofirmado, sin eso el navegador rechaza el micrófono). Aceptala una vez por dispositivo.

Para agregar más carpetas de canciones (por ejemplo un NAS), entrá a **⚙️ Configuración** desde la Sala: podés escribir la ruta a mano o usar "Buscar carpeta..." (abre el selector nativo del sistema operativo) — funciona mejor si montás el recurso del NAS como una carpeta más del sistema operativo primero (unidad de red en Windows, punto de montaje en Linux, o simplemente conectándote por Finder en Mac, donde aparece bajo `/Volumes/...`).

Si tenés varias redes activas y el servidor detecta la IP que no es, podés forzarla desde la misma pantalla de Configuración (o ver `.env.example`).

### Certificado HTTPS sin advertencia (opcional)

Por defecto el certificado es autofirmado (hay que aceptar una advertencia una vez por dispositivo). Si tenés
un dominio propio administrado en **Cloudflare**, podés generar un certificado real de Let's Encrypt desde
**⚙️ Configuración → Certificado HTTPS** — se valida por DNS (un registro TXT temporal), así que **no hace
falta exponer este servidor a internet** para conseguirlo. Necesitás:

1. Un subdominio (ej. `karaoke.tudominio.com`) con un registro **A en Cloudflare apuntando a la IP LAN del
   servidor** (ej. `192.168.1.85`) — así cualquier celular en la misma red lo resuelve directo a tu equipo.
2. Un token de API de Cloudflare con permiso `Zone:DNS:Edit` sobre esa zona (se crea en Cloudflare → My
   Profile → API Tokens), pegado en el campo correspondiente de la pantalla de Configuración — nunca hace
   falta compartirlo fuera de ahí.

Después de guardar, el certificado se genera al toque (podés ver si funcionó en la misma pantalla) pero
recién se usa después de reiniciar el servidor. Se renueva solo la próxima vez que arranque el servidor
si está a menos de 30 días de vencer.

## Estructura del repo

```
server/               Servidor Node (Fastify): motor de puntuación, indexador, Sala/join/sing, config
server/data/          DB SQLite, certificados (autofirmado y Let's Encrypt) y ajustes — no versionado, se crea solo
server/public/        Cliente web: Sala (index), unirse desde el celular (join), configuración (settings)
songs/                Biblioteca de canciones UltraStar (no versionada)
config.json           Carpeta(s) de biblioteca por defecto (editable después desde la UI)
```

## Estado

Fases 0 a 4 del plan completas: indexador + parser USDX, motor de puntuación con prueba de carga, celular como micrófono, multijugador de fiesta (cola de turnos, ranking), y modo de baja latencia.

Migrado de Docker/Python a un único proceso Node.js, con configuración desde la UI (carpetas de biblioteca vía selector nativo o ruta a mano, IP del servidor, certificado HTTPS). El flujo de "cantante" en el celular quedó de punta a punta: permiso de mic pedido con anticipación, arranque automático al ser llamado, corte automático y puntaje al terminar (por la Sala o por el propio celular), y vuelta a elegir canción sin recargar la página. La Sala soporta bibliotecas grandes (selector alfabético) y varía el efecto visual de fondo por canción cuando no hay video.

El estado previo a esta migración (versión con Docker + motor de puntuación en Python) quedó preservado en la rama `alpha`.

Acceso remoto fuera de la LAN para invitados externos (Tailscale/Cloudflare Tunnel) queda pendiente como fase opcional — hoy el acceso público solo se usa para la validación DNS del certificado, no para exponer la app.
