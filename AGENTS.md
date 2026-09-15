# AGENTS.md

## Resumen del proyecto

**PitchParty**: sistema de karaoke casero estilo UltraStar Deluxe para la red local de una casa. El celular de cada invitado es el micrófono, una pantalla principal ("la Sala") muestra catálogo, letra y estado. Corre como **un único proceso Node.js** — sin Docker, sin Python, sin build step en el cliente.

**La fuente de verdad del comportamiento es [`docs/sdd/`](docs/sdd/), no este archivo ni el README.** Antes de tocar algo, leé lo que corresponda:

| Querés entender… | Leé |
|---|---|
| Qué es el producto, roles, decisiones, fuera de alcance | [`docs/sdd/01-overview.md`](docs/sdd/01-overview.md) |
| Cómo está armado, qué hace cada archivo | [`docs/sdd/02-architecture.md`](docs/sdd/02-architecture.md) |
| Endpoints HTTP y mensajes de los dos WebSockets | [`docs/sdd/03-protocol.md`](docs/sdd/03-protocol.md) |
| Tablas SQLite, settings, estado de `Room` | [`docs/sdd/04-data-model.md`](docs/sdd/04-data-model.md) |
| Qué está hecho y qué brechas hay | [`docs/sdd/05-status-roadmap.md`](docs/sdd/05-status-roadmap.md) |
| Criterios de aceptación numerados (y qué test cubre cada uno) | [`docs/sdd/06-acceptance.md`](docs/sdd/06-acceptance.md) |
| Lo que **todavía no existe** (features en especificación) | [`docs/sdd/07-next.md`](docs/sdd/07-next.md) |

## ⚠️ La regla de oro: los docs se actualizan en el mismo commit

**Si cambiás protocolo, esquema de datos, arquitectura o comportamiento observable, actualizás `docs/sdd/` en el mismo commit que el código.** No en un commit aparte, no "después".

**Por qué:** entre el 15 y el 29 de agosto de 2026 entraron cuatro features (modos Karaoke/UltraStar, duetos, invitado→cantante, mensajes desde el celular) sin tocar los docs. El resultado fueron ocho afirmaciones falsas en la especificación — incluida una donde dos documentos se contradecían entre sí sobre si había tests — y recuperarlo costó una auditoría completa comparando código contra documentación, línea por línea. `docs/sdd/00-index.md` se autodefine como especificación **viva**; si deja de serlo, es peor que no tenerla, porque un agente confía en ella.

**Mapa de qué tocar según qué cambiaste:**

| Si cambiaste… | Actualizá |
|---|---|
| Una ruta HTTP, o un tipo de mensaje de `/ws/room` o `/ws/sing` | `03-protocol.md` |
| Una tabla de SQLite, `settings.json`, o un campo de `Room`/`User` | `04-data-model.md` |
| Agregaste o borraste un archivo en `server/src/` o `server/public/` | `02-architecture.md` |
| Una decisión de producto, un rol, o algo que entra/sale del alcance | `01-overview.md` |
| Cualquier comportamiento verificable | `06-acceptance.md` (criterio nuevo, o corregir el que dejó de ser cierto) |
| Terminaste una feature que estaba especificada en `07-next.md` | Mové sus criterios a `06-acceptance.md` y **borrá** su entrada de `07-next.md` |

**Para algo nuevo que todavía no existe**: primero una mini-spec en `07-next.md` (hay plantilla ahí), después el código. No al revés.

## Estado actual

- Servidor Node funcionando, con las 5 fases del plan original completas (ver `05-status-roadmap.md`).
- **51 tests** de la lógica pura (`node --test`), ESLint y un chequeo de sintaxis de todo el JS (incluido el del navegador).
- CI en GitHub Actions: corre `check` + `lint` + `test` en Node 18 y 20, en cada push a `main` y en cada PR.
- Lo que **no** está cubierto por tests: endpoints HTTP/WS, indexado con SQLite, y todo el comportamiento en navegador.

## Entorno y comandos

Todo se corre desde `server/`:

    npm ci              # instalar (la primera vez, o si cambió package-lock.json)
    npm run ci          # check de sintaxis + lint + tests — lo mismo que corre GitHub Actions
    npm test            # solo los tests (node --test)
    npm run lint        # solo ESLint
    npm start           # levanta el servidor (HTTPS, puerto 3000 por defecto)
    npm run dev         # igual pero con --watch

- El código apunta a **Node 18+** (es lo que valida el CI). Local puede ser más nuevo.
- `better-sqlite3` es la única dependencia con binario nativo: resuelve un prebuilt en Linux y macOS. En Windows puede pedir toolchain de compilación — ver el callout del README.
- Cliente sin build step: los archivos de `server/public/` se sirven tal cual. **No** agregues bundler, transpilador ni framework de frontend.

## Dónde se verifica cada cosa (Windows ↔ MacBook)

Este proyecto se desarrolla en dos máquinas y **no todo se puede probar en las dos**. Saber dónde frenar es parte del trabajo.

**En Windows (máquina de desarrollo) se puede y se debe verificar:**
- `npm run ci` completo — los 51 tests, lint y syntax-check pasan acá sin problema (~90 s).
- Toda la lógica pura: parser USDX, scoring, detección de tono, `Room`/cola/ranking, validación de mensajes, normalización de settings.
- La API completa, contra el servidor corriendo (`curl`).
- **La UI que no necesita micrófono** — la bandeja de mensajes, Configuración, el catálogo de la Sala: se abren en un navegador real y se verifican ahí.

> **Certificado de desarrollo.** El micrófono exige HTTPS, así que el servidor siempre levanta con TLS; con el certificado autofirmado, las herramientas de automatización de navegador no pueden cargar la página (rechazan el certificado sin ofrecer un "avanzar igual"). La solución es usar la propia feature del proyecto: en la máquina de desarrollo hay configurado un dominio con certificado real de Let's Encrypt vía DNS-01 (`dev.pp.batou.rocks` → la IP LAN de esa máquina, registro A en Cloudflare, **DNS only, sin proxy**). Con eso el navegador entra sin advertencias. Si hay que rehacerlo en otra máquina: agregar el registro A, y cargar dominio + token de Cloudflare + email desde **⚙️ Configuración → Certificado HTTPS**; el certificado se toma recién al reiniciar el proceso.

**En el MacBook (donde se usa de verdad, con amigos) hay que verificar:**
- Todo lo marcado `manual (Mac)` en [`docs/sdd/06-acceptance.md`](docs/sdd/06-acceptance.md).
- Cualquier cosa que toque: micrófono real, celulares conectándose por QR, duetos en vivo, monitor de micrófono, latencia real de red.

**Regla práctica:** si un cambio toca captura de audio o el navegador del celular, **no lo declares terminado desde Windows**. Dejalo commiteado y push-eado, y decí explícitamente qué falta probar en el MacBook. Lo que es solo UI de escritorio sí se cierra acá — no lo dejes pendiente "por las dudas".

## Flujo entre las dos máquinas

Nada específico de una máquina viaja por git: `server/data/` (base, certificados, `settings.json`), `/songs/` y `.env` están todos en `.gitignore`. Cada máquina tiene su biblioteca, su base y sus certificados.

**En Windows (desarrollo):**

    git pull                     # arrancar siempre al día
    # …cambios + docs…
    cd server && npm run ci      # tiene que estar en verde antes de commitear
    git add -A && git commit
    git push

**En el MacBook (uso real):**

    git pull
    cd server && npm ci          # solo si cambió package-lock.json
    npm start

## Convenciones

- **ES modules** (`import`/`export`) en todo el proyecto, servidor y cliente.
- **Sin dependencias nuevas salvo que haga falta de verdad**, y nunca una con binario nativo: `better-sqlite3` ya es la excepción y es la que más fricción da entre máquinas. El proyecto salió de Docker + Python justamente para no volver a tener ese problema (ver `02-architecture.md`).
- Comentarios en el código: explican **por qué**, no qué. El código existente sigue esa línea — respetala.
- Los strings de la UI van en español; los identificadores y nombres de archivo, en inglés.
- No toques `sing.html`/`sing.js` pensando que son parte del flujo de usuario: son una página de debug del motor de puntuación.

## Seguridad

- `server/data/settings.json` guarda el **token de Cloudflare en texto plano**. No lo loguees, no lo copies a otro archivo, y nunca versiones `server/data/`.
- `songs/` no se versiona: es biblioteca del usuario, con material de terceros. No agregues canciones al repo ni en ejemplos.
- No hay autenticación: cualquiera en la LAN puede abrir `/settings.html` y cambiar la configuración. Es una decisión consciente (red doméstica), pero no agregues nada que empeore eso asumiendo que "igual no hay auth".
- `.env` está en `.gitignore` — no lo commitees ni pegues su contenido en un mensaje.

## Antes de dar una tarea por terminada

1. `cd server && npm run ci` en verde (los tres pasos).
2. **`docs/sdd/` actualizado** si tocaste protocolo, datos, arquitectura o comportamiento — ver la regla de oro arriba.
3. Si era una feature de `07-next.md`: criterios movidos a `06-acceptance.md` y la entrada borrada de `07-next.md`.
4. Si algo quedó sin poder verificarse desde Windows, decilo explícitamente en vez de darlo por hecho.
