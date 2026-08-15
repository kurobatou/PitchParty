# PitchParty 🎤

![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)

Sistema de karaoke casero (estilo UltraStar Deluxe) para la red local de tu casa: el celular es el micrófono, la TV/PC es la pantalla principal. Corre como un único proceso Node.js — sin Docker, sin Python, sin nada más que instalar además de Node.

Reutiliza el catálogo y formato de canciones de **UltraStar Deluxe** (`.txt` + audio + video), con un motor de puntuación propio en JavaScript.

## Qué incluye

- **Sala** (pantalla principal): catálogo de canciones con buscador y selector de letras A-Z (útil con bibliotecas grandes, ej. un NAS con 200+ canciones), botón de pantalla completa, código QR para que los celulares se conecten, lista de usuarios conectados en tiempo real (en cola / cantando / puntaje), cola de turnos con quién-canta-qué visible y rotación manual (desde la Sala o desde cualquier celular), ranking de la sesión, indicador de latencia de red y modo de baja latencia. Todo dentro de una tarjeta centrada con **tema claro/oscuro** (botón 🌙/☀️, se recuerda entre visitas).
- **Motor de puntuación** (JavaScript, corre en el mismo proceso que el servidor): detecta el tono de la voz por autocorrelación y lo compara contra las notas `.txt` de UltraStar (tolerante a errores de octava). Hasta 4 cantantes simultáneos.
- **Micrófonos físicos** (sin celular): en **⚙️ Configuración** elegís qué micrófonos conectados a la máquina de la Sala (por ejemplo uno Bluetooth emparejado) van a estar disponibles. Después, desde la Sala, agregás un cantante sin celular (nombre + canción) con "➕ Cantante con micrófono" — entra en la cola como todos. Justo antes de su turno aparece una pantalla de preparación para elegir y **probar** el micrófono (con barra de nivel en vivo) y recién ahí arranca la cuenta atrás y la canción. Recibe puntaje/ranking igual que quien usa celular. La captura ocurre en el navegador de la Sala (el micrófono es solo otro dispositivo de entrada), así que no hace falta ninguna librería de audio nativa.
- **Celular como micrófono** (PWA vía navegador): se une por QR, elige rol (cantante/invitado) y busca su canción con autocompletado. El permiso de micrófono se pide apenas elige la canción (mientras espera en la cola), así que cuando la Sala lo llama el micrófono arranca solo, sin pasos extra (con vibración/beep de aviso). Mientras canta ve el título/artista, la letra (línea previa/actual/siguiente) y un **ecualizador de afinación en vivo** (12 barras + % de acierto, calculado en el navegador a partir del puntaje en tiempo real) en su propia pantalla, sin reproducir audio. Al terminar la canción (o si la Sala corta antes) el micrófono se apaga solo, muestra el puntaje final, y deja elegir otra canción. Cualquier conectado (cantante o invitado) puede además avanzar la cola/arrancar el próximo turno desde su propio celular. La pantalla intenta no bloquearse sola mientras espera en cola, y si igual se corta la conexión (bloqueo de pantalla, Wi-Fi), reconecta sola y recupera su lugar en la cola durante los siguientes 90 segundos.
- **Fondos**: video propio de la canción si existe (servido por HTTP), o uno de varios efectos con las ondas reales del audio (barras, barras espejadas, anillos radiales, osciloscopio) cuando no hay video — se elige un efecto distinto por canción para que la biblioteca no se vea siempre igual.
- **Configuración desde la UI** (`⚙️ Configuración` desde la Sala): carpetas de biblioteca (con selector de carpeta nativo del sistema operativo, útil para elegir un NAS ya montado), IP del servidor si hace falta forzarla, certificado HTTPS, y asignación de micrófonos físicos a cantantes.
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

Ver [docs/sdd/](docs/sdd/00-index.md) para la especificación técnica completa (arquitectura, protocolo WebSocket/HTTP, modelo de datos, estado de cada fase) — pensada para orientar rápido a quien nunca vio este repo, humano o agente de IA. [plan_karaoke_v0.03.md](plan_karaoke_v0.03.md) es el plan de producto original, previo a la implementación; se conserva como referencia histórica, pero describe una arquitectura con un motor de puntuación en Python que ya no existe.

## Cómo correrlo

Requiere [Node.js](https://nodejs.org/) (18 o más nuevo) instalado en el equipo que va a ser el servidor:

- **macOS**: `brew install node`
- **Windows**: instalador desde [nodejs.org](https://nodejs.org/) o `winget install OpenJS.NodeJS.LTS`
- **Linux**: paquete `nodejs` de tu distro, o [nodesource](https://github.com/nodesource/distributions)

> **Windows sin Python/Visual Studio instalado:** `better-sqlite3` no siempre trae un binario precompilado listo para tu versión de Node, y en ese caso `npm install` intenta compilarlo — lo cual pide Python 3 y el compilador de C++ de Visual Studio Build Tools (workload "Desktop development with C++", instalable con `winget install Microsoft.VisualStudio.2022.BuildTools --override "--add Microsoft.VisualStudio.Workload.VCTools"`). Si `npm install` avisa `"1 package has install scripts not yet covered by allowScripts"`, corré `npm approve-scripts better-sqlite3` y volvé a instalar.

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
server/test/          Tests unitarios de la lógica pura (node --test)
docs/sdd/             Especificación técnica del proyecto
songs/                Biblioteca de canciones UltraStar (no versionada)
config.json           Carpeta(s) de biblioteca por defecto (editable después desde la UI)
.github/workflows/    CI (GitHub Actions): check + lint + tests en cada PR
```

## Desarrollo / Tests

Hay una red de seguridad liviana, sin dependencias nuevas de runtime ni build step. Desde `server/`:

```bash
cd server
npm ci
npm run ci     # corre los tres de abajo en orden
```

- `npm test` — tests unitarios de la lógica pura (parser USDX, scoring, detección de tono, sala/cola/ranking) con el runner nativo de Node (`node --test`).
- `npm run check` — chequeo de sintaxis (`node --check`) de **todo** el JS, incluido el del navegador (`app.js`, `join.js`, ...) que no se puede unit-testear sin un navegador real.
- `npm run lint` — ESLint (config flat) sobre server + frontend.

El mismo `check` + `lint` + `test` corre solo en cada Pull Request y en cada push a `main` vía GitHub Actions (ver `.github/workflows/ci.yml`).

## Estado

Fases 0 a 4 del plan completas: indexador + parser USDX, motor de puntuación con prueba de carga, celular como micrófono, multijugador de fiesta (cola de turnos, ranking), y modo de baja latencia.

Migrado de Docker/Python a un único proceso Node.js, con configuración desde la UI (carpetas de biblioteca vía selector nativo o ruta a mano, IP del servidor, certificado HTTPS). El flujo de "cantante" en el celular quedó de punta a punta: búsqueda con autocompletado, permiso de mic pedido con anticipación, arranque automático al ser llamado, letra en pantalla mientras canta, corte automático y puntaje al terminar (por la Sala o por el propio celular), reconexión con recuperación de la cola si se corta la conexión, y vuelta a elegir canción sin recargar la página. La Sala soporta bibliotecas grandes (selector alfabético), pantalla completa, y varía el efecto visual de fondo por canción cuando no hay video (con fallback automático si el video no es reproducible en el navegador).

El estado previo a esta migración (versión con Docker + motor de puntuación en Python) quedó preservado en la rama `alpha`.

## Licencia

Código bajo licencia [Apache 2.0](LICENSE). Esto cubre el código de este repositorio — no las canciones: la carpeta `songs/` es tuya, no se versiona, y el formato compatible con UltraStar Deluxe no implica que el repo incluya (ni deba incluir) audio/video con derechos de autor de terceros.

Rediseño visual (a partir de un mockup hecho en Claude Design): sistema de tema claro/oscuro con paleta OKLCH y acento configurable vía CSS (`server/public/theme.js` + variables en `style.css`), la Sala pasó a una tarjeta centrada, y el celular ganó un ecualizador de afinación en vivo (12 barras + %, derivado 100% en el cliente del mismo puntaje por frame que ya se mostraba, sin cambios de backend) y una línea de letra "previa" además de actual/siguiente.

Acceso remoto fuera de la LAN para invitados externos (Tailscale/Cloudflare Tunnel) queda pendiente como fase opcional — hoy el acceso público solo se usa para la validación DNS del certificado, no para exponer la app.

Detalle fase por fase, y qué queda pendiente, en [docs/sdd/05-status-roadmap.md](docs/sdd/05-status-roadmap.md).
