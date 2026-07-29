# Plan de Proyecto: Sistema de Karaoke (estilo UltraStar Deluxe) — V0.03

> Estado: Borrador V0.03 — detalla la pantalla principal ("Sala"), latencia, biblioteca y fondos que quedaban abiertos en V0.02 §10.

## 1. Cambios respecto a V0.02

- **Pantalla principal flexible:** no tiene que ser el navegador propio de la TV. Puede ser la TV directamente (si su navegador soporta el frontend) o un equipo externo conectado a la TV por HDMI que abre el navegador. En ambos casos es un cliente más del servidor, solo cambia el dispositivo físico.
- **Flujo de "Sala" detallado** (ver §6): catálogo de canciones, código QR, lista de usuarios conectados con su estado, botón de inicio/rotación.
- **Servidor con encendido/apagado manual, no permanente:** se confirma que no es un servicio que corre siempre; se prende para jugar y se apaga después. Mientras está corriendo, se debe evitar que el equipo se suspenda.
- **Latencia:** se agrega monitoreo + señal visible al usuario, y un modo de baja latencia opcional (recorta video, prioriza audio/puntuación).
- **Biblioteca de canciones:** se confirma que vive en un NAS de la red interna; se diseña para leer de una carpeta local **y/o** una ruta de red configurable, no una ubicación fija.
- **Fondos por defecto:** se confirma el enfoque CSS/shader simple (sin videos/loops).

## 2. Resumen del proyecto

Sistema de karaoke que reutiliza el catálogo y formato de UltraStar Deluxe (`.txt` + audio + video), con motor de puntuación propio. El servidor (Node.js + motor Python) corre en un computador de la casa y se enciende/apaga según se vaya a jugar. La pantalla principal (TV o un equipo conectado a ella) y los celulares de los invitados son clientes que se conectan a ese servidor por red local.

## 3. Decisiones de producto

| Tema | Decisión |
|---|---|
| Dónde corre el servidor | Cualquier computador de la casa; se enciende/apaga manualmente, no es un servicio siempre activo. |
| Rol de la pantalla principal | Cliente de navegador — puede ser el navegador propio de la TV, o un equipo externo conectado por HDMI. Sin micrófono. |
| Micrófonos | Principalmente celulares. USB/Bluetooth como opción secundaria, conectados al equipo servidor. |
| Cantantes / invitados simultáneos | Hasta 4 cantantes activos; hasta 20 conexiones totales. |
| Usuarios / ranking | Solo de la sesión activa en V1; modelo de datos preparado para V2 con cuentas persistentes. |
| Biblioteca de canciones | Configurable: carpeta local del servidor **y** ruta de red (NAS), no hardcodeada a una sola ubicación. |
| Fondos sin video propio | CSS/shader simple (gradientes/patrones animados), sin loops de video. |
| Latencia | Se mide y se muestra al usuario; existe un modo de baja latencia opcional que prioriza audio sobre video. |

## 4. Objetivos

1. Reproducir canciones UltraStar Deluxe (letras, notas, video de fondo si existe) en la pantalla principal.
2. Capturar la voz del cantante (celular) y calcular un puntaje propio de afinación/ritmo.
3. Soportar hasta 4 cantantes activos y hasta 20 conexiones totales por sesión.
4. Dar visibilidad clara del estado de la sala (canciones, cola, usuarios, puntajes) desde la pantalla principal.
5. Ser tolerante a problemas de red: avisar cuando hay latencia y permitir degradar la experiencia (menos video, más estabilidad) en vez de fallar en silencio.
6. Indexar la biblioteca desde donde el usuario la tenga (carpeta local o NAS), sin asumir una ruta fija.

## 5. Capacidad y roles de usuarios

Sin cambios de fondo respecto a V0.02: **cantante activo** (hasta 4, audio en vivo procesado por el motor Python) vs. **invitado/espectador** (hasta 20 en total, solo tráfico liviano de estado/cola/ranking).

## 6. Pantalla principal / "Sala" — flujo y responsabilidades

Al abrir el navegador (en la TV o en el equipo conectado a ella) y apuntar al servidor, se crea/abre una sala. Esa pantalla debe mostrar y permitir:

- **Catálogo de canciones disponibles**, indexado por el servidor desde sus fuentes configuradas (carpeta local + NAS, ver §7). Idealmente con buscador simple.
- **Código QR** con la URL de la sala, para que los celulares se conecten directo (como cantante o como invitado) sin tener que tipear una dirección.
- **Lista de usuarios conectados en tiempo real**, con su estado: en cola con una canción elegida, cantando en este momento, o con puntaje de una ronda anterior.
- **Botón para iniciar la partida / avanzar la rotación de la cola** de canciones (quién canta a continuación).
- **Indicador de estado de red/latencia** y control para activar el modo de baja latencia (ver §9).

Esta pantalla se construye de forma incremental: el catálogo y el layout base se arman en Fase 0; QR y lista de usuarios conectados llegan con el soporte de celulares (Fase 2); cola de turnos y botón de rotación con el modo multijugador (Fase 3); indicador de latencia y su toggle se agregan en Fase 2/4 (ver §13).

## 7. Biblioteca de canciones — fuentes configurables

La biblioteca ya existe hoy en un NAS de la red interna, pero el sistema no debe asumir esa ubicación como fija (para que el propio usuario pueda empezar solo con canciones locales, y para que sea portable a otros usuarios/instalaciones).

Diseño propuesto:
- El servidor lee su lista de "carpetas de biblioteca" desde un archivo de configuración simple (o una pantalla de ajustes básica).
- Se admite **una o más rutas** simultáneamente: una carpeta local en el mismo equipo del servidor, y una o más rutas de red (por ejemplo, el NAS montado como unidad/carpeta de red a nivel de sistema operativo — SMB o NFS).
- **Recomendación:** resolver el acceso al NAS montando su recurso compartido como una carpeta más del sistema operativo (unidad de red en Windows, punto de montaje en Linux/Mac), y que el indexador simplemente escanee esa ruta como si fuera local. Esto evita tener que implementar un cliente SMB/NFS propio dentro de la aplicación.
- El indexador re-escanea las carpetas configuradas (al iniciar el servidor, y opcionalmente bajo demanda desde la pantalla de administración) y arma el catálogo único que se le muestra a la Sala, sin importar de qué carpeta vino cada canción.
- Para arrancar, basta con apuntar a una carpeta local con un par de canciones copiadas; agregar el NAS después es solo sumar una ruta más a la configuración.

## 8. Videos de fondo

Se confirma el enfoque **CSS/shader simple** para las canciones sin video propio: gradientes animados o patrones generados por CSS (o un shader liviano vía WebGL/Canvas si se quiere algo más vistoso), en vez de loops de video. Ventajas: peso de red mínimo (no hay que transferir ni normalizar archivos de video para el fallback), y se genera en el momento por la pantalla principal sin depender de assets adicionales.

Para canciones que sí tienen video propio (definido en el `.txt` de USDX), se mantiene lo definido en V0.02 §5: el servidor sirve el archivo por HTTP y la pantalla principal lo decodifica/reproduce localmente con un `<video>` de fondo. Esto es independiente del enfoque de fondos por defecto.

## 9. Latencia — monitoreo y modo de baja latencia

**Monitoreo:** el servidor mide la latencia de cada conexión de audio (celular cantando) con timestamps ida/vuelta sobre el WebSocket — no requiere librerías especiales, es lógica simple de la aplicación. Cuando la latencia de un cantante supera un umbral razonable, se muestra una señal visible (ícono/color en la pantalla principal junto al nombre del jugador, y opcionalmente también en su propio celular) para que el grupo entienda que el problema es de red y no del puntaje.

**Modo de baja latencia (factible incluir desde V1, no es mucho trabajo adicional):** activable desde la pantalla principal (afecta a toda la sala, ya que suele deberse a congestión de la red doméstica, por ejemplo con las 20 conexiones de una fiesta). Al activarlo:
- Se corta o reduce drásticamente el streaming de video de fondo hacia la pantalla principal (que es lo que más ancho de banda consume).
- Se prioriza el tráfico de audio de los celulares que están cantando y la sincronización de puntuación/letras.
- El usuario elige el modo (normal vs. baja latencia); el sistema no lo fuerza automáticamente en V1, aunque el indicador de latencia ayuda a decidir cuándo conviene activarlo. Automatizar ese cambio (detectar y sugerir/activar solo) puede quedar para una iteración posterior.

## 10. Arquitectura propuesta

```
┌───────────────────────────┐        WebSocket (audio + control,
│  Celular — Cantante activo │        con medición de latencia)
│  (PWA, hasta 4 a la vez)   │ ──────────────────────────────┐
└───────────────────────────┘                                 ▼
┌───────────────────────────┐   WebSocket (estado, cola,      ┌─────────────────────────┐
│  Celular — Invitado/cola   │   letras, ranking sesión)       │   Servidor principal     │
│  (PWA, hasta 20 en total)  │◄────────────────────────────────►   (Node.js — se prende/ │
└───────────────────────────┘                                 │   apaga manualmente)    │
                                                                │   - Sala/sesión + cola  │
┌────────────────────────────┐  WebSocket (estado, letras,     │   - Enrutamiento audio  │
│  Pantalla principal         │  QR, usuarios, latencia)        │   - Medición de latencia│
│  (TV con navegador propio,  │◄──────────────────────────────►│   - API REST + archivos │
│   o equipo externo por HDMI)│  HTTP (audio/video estáticos,    │     de canciones        │
└────────────────────────────┘  o fondo CSS/shader local)      └───────────┬─────────────┘
                                                                            │ IPC/socket local
                                                                            ▼
                                                                ┌─────────────────────────┐
                                                                │  Motor de puntuación     │
                                                                │  (Python, hasta 4        │
                                                                │   streams concurrentes)  │
                                                                └───────────┬─────────────┘
                                                                            ▼
                                                                ┌─────────────────────────┐
                                                                │  Biblioteca de canciones │
                                                                │  - Carpeta local         │
                                                                │  - NAS (montado como     │
                                                                │    carpeta de red)       │
                                                                │  - Índice SQLite         │
                                                                └─────────────────────────┘

Micrófono USB/Bluetooth (opcional) ──► se conecta directo al equipo servidor.
(Fase futura, opcional) ──► Túnel/reverse proxy (Tailscale / Cloudflare Tunnel) para acceso remoto.
```

## 11. Recomendación de tecnologías

| Componente | Recomendación | Notas |
|---|---|---|
| Servidor principal | **Node.js** (Fastify/Express + `socket.io`) | Se ejecuta bajo demanda, no como daemon permanente. |
| Motor de puntuación / audio | **Python** (`aubio`, `numpy`) | Eficiente por stream; hasta 4 streams concurrentes. |
| Pantalla principal | **Web (navegador)**, dispositivo flexible (TV o equipo por HDMI) | Renderiza fondos CSS/shader y videos servidos por HTTP. |
| App companion (celular) | **PWA** | Mismo cliente para cantante activo e invitado. |
| Acceso a biblioteca en NAS | Montar el recurso compartido como carpeta/unidad de red del sistema operativo | Evita implementar cliente SMB/NFS propio; el indexador solo necesita rutas de filesystem. |
| Medición de latencia | Timestamps en mensajes WebSocket (ida/vuelta) | Lógica simple de aplicación, sin dependencias extra. |
| Base de datos de biblioteca y sesión | **SQLite** | Vive en el equipo servidor. |

## 12. Modelo de datos — sesión y usuarios

Sin cambios: sesión efímera, jugadores identificados por apodo dentro de la sesión activa, campo `external_user_id` reservado (nulo en V1) para una futura V2 con cuentas persistentes y ranking en la nube.

## 13. Fases sugeridas (actualizadas)

1. **Fase 0 – Prueba de concepto:** parser USDX + indexador con soporte multi-fuente (carpeta local desde el día uno; ruta de red se agrega apenas se pruebe con el NAS) + servidor Node sirviendo una canción a un cliente web + layout base de la pantalla "Sala" (catálogo de canciones). Fondos CSS/shader básicos.
2. **Fase 1 – Micrófono local + motor de puntuación + prueba de carga:** captura de audio local (USB/Bluetooth), motor de puntuación en Python, prueba con 4 streams simultáneos en el equipo real que se usará como servidor.
3. **Fase 2 – Móvil como micrófono + Sala interactiva:** PWA + WebSocket de audio, generación de código QR, lista de usuarios conectados en tiempo real, y primera versión del monitoreo/indicador de latencia.
4. **Fase 3 – Multijugador de fiesta:** hasta 4 cantantes simultáneos con puntuación en vivo, cola de turnos + botón de rotación en la Sala, ranking de sesión.
5. **Fase 4 – Videos de fondo y modo de baja latencia:** videos de fondo para canciones que los tienen (servidos por HTTP), y el toggle de modo baja latencia (corta/reduce ese video para priorizar audio).
6. **Fase 5 – Acceso remoto (opcional):** túnel seguro (Tailscale/Cloudflare Tunnel) para invitados fuera de la red local.
7. **Fase 6 – V2 (fuera de alcance):** cuentas persistentes, ranking histórico/global, "modo servicio en la nube".

## 14. Riesgos y preguntas abiertas

- **Umbral de latencia:** falta definir qué valor concreto (ej. X ms) dispara la señal de "latencia alta" en la UI — se puede calibrar empíricamente en Fase 2 con pruebas reales en la red del usuario.
- **Alcance del modo de baja latencia:** confirmar si además de cortar video conviene bajar la tasa de muestreo/calidad del audio en casos extremos, o si con priorizar tráfico alcanza.
- **Detección de la ruta del NAS:** definir si la ruta de red se configura a mano (más simple, alcanza para V1) o si se agrega un asistente de configuración más adelante.
- **Suspensión del equipo servidor:** falta confirmar en qué sistema operativo corre principalmente (Windows/Mac/Linux) para documentar el ajuste de energía correcto en cada caso.
