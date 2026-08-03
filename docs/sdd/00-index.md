# SDD de PitchParty — índice

Esta carpeta es la especificación técnica **viva** del proyecto: describe lo que el código hace *hoy*, no lo que se planeó en su momento. Está pensada para que cualquiera (humano o agente de IA) que nunca vio este repo pueda orientarse rápido sin tener que leer archivo por archivo.

Orden de lectura sugerido:

1. [01-overview.md](01-overview.md) — Qué es PitchParty, decisiones de producto, capacidad/roles, qué queda fuera de alcance.
2. [02-architecture.md](02-architecture.md) — Arquitectura del proceso único Node.js, mapa de archivos del server y del cliente, stack técnico.
3. [03-protocol.md](03-protocol.md) — Contrato real de la API HTTP y de los dos WebSockets (`/ws/room`, `/ws/sing/:songId`): forma exacta de cada mensaje.
4. [04-data-model.md](04-data-model.md) — Esquema SQLite, `config.json`/`settings.json`, y el modelo en memoria de la sala (`Room`).
5. [05-status-roadmap.md](05-status-roadmap.md) — Qué fases están completas, qué cambió respecto al plan original, y qué queda pendiente/fuera de alcance.

## Relación con otros documentos del repo

- [`README.md`](../../README.md) — cara pública del proyecto (cómo instalarlo y correrlo). Sigue siendo la fuente de verdad para instrucciones de usuario final.
- [`plan_karaoke_v0.03.md`](../../plan_karaoke_v0.03.md) — **documento histórico**, el plan de producto original (previo a la implementación). Describe una arquitectura con un motor de puntuación en **Python** corriendo en un contenedor separado (Docker) que hablaba con el servidor Node por WebSocket/IPC. Esa arquitectura **ya no existe**: el motor de puntuación se reimplementó en JavaScript puro y corre en el mismo proceso Node que el resto del servidor (ver [02-architecture.md](02-architecture.md)). Se conserva el archivo por su valor histórico de decisiones de producto, pero para arquitectura/protocolo actual usar siempre esta carpeta, no ese archivo.
- [`LICENSE`](../../LICENSE) — Apache 2.0. Cubre el código; no las canciones (`songs/`, no versionado).

## Qué NO es esta carpeta

No es un tracker de tareas ni un backlog día a día — para eso está el historial de commits y las conversaciones con el mantenedor. Esta carpeta se actualiza cuando cambia algo estructural (protocolo, esquema de datos, arquitectura), no en cada commit.
