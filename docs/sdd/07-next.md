# 7. Próximo trabajo (el carril de lo que todavía no existe)

Los documentos 01 a 06 describen **lo que el código hace hoy**. Este describe **lo que todavía no existe**. Es la diferencia entre documentación y especificación: sin este archivo, una feature nueva no tiene dónde discutirse antes de escribirse, y termina entrando directo al código (que fue exactamente lo que pasó entre agosto y septiembre de 2026 con los modos, los duetos y los mensajes).

## Cómo se usa

1. **Antes** de escribir código para algo nuevo, se agrega acá una mini-spec con la plantilla de abajo.
2. Se discute y se aprueba la mini-spec (qué, por qué, criterios, qué queda afuera). Recién ahí se programa.
3. Cuando la feature está terminada y funcionando:
   - sus criterios se mueven a [06-acceptance.md](06-acceptance.md) (numerados, con su verificación),
   - lo que cambió de protocolo/datos/arquitectura se refleja en [03](03-protocol.md)/[04](04-data-model.md)/[02](02-architecture.md),
   - la decisión de producto, si la hubo, entra en [01-overview.md](01-overview.md),
   - y la entrada se **borra de este archivo** (no se deja "hecho ✅" acumulándose: para eso está el historial de git).

Este archivo debería estar casi siempre corto. Si crece mucho, es backlog, no spec.

## Plantilla para una feature nueva

```markdown
### <nombre corto de la feature>

**Qué**: una o dos frases, en lenguaje de producto (qué ve o puede hacer una persona).
**Por qué**: el problema real que resuelve. Si no hay uno concreto, no se construye.

**Criterios de aceptación** (numerados provisionalmente; al terminar se renumeran dentro de 06):
1. Dado …, cuando …, entonces …
2. …

**Impacto en los docs** (marcar lo que se va a tener que tocar):
- [ ] 01-overview (decisión de producto / roles / fuera de alcance)
- [ ] 02-architecture (archivos nuevos)
- [ ] 03-protocol (endpoints o mensajes WS nuevos)
- [ ] 04-data-model (tablas, settings, campos de Room)
- [ ] 06-acceptance (criterios definitivos)

**Fuera de alcance**: qué NO incluye esta feature, explícito, para acotar la exploración.
**Verificación**: qué se puede probar con tests acá, y qué necesita sí o sí el MacBook.
```

## Pendientes conocidos (sin spec todavía)

Cosas ya identificadas como deuda o mejora, que **todavía no tienen mini-spec**. Están acá para no perderlas, no como compromiso de hacerlas.

| Tema | De dónde sale | Nota |
|---|---|---|
| Tope de conexiones totales | El plan original hablaba de "hasta 20 conexiones"; hoy no hay ningún rechazo por cupo (ver [05-status-roadmap.md](05-status-roadmap.md)) | Decidir si se implementa o si se declara explícitamente fuera de alcance y se borra la mención |
| Acceso remoto fuera de la LAN | Fase 5 del plan original (Tailscale / Cloudflare Tunnel) | Sigue marcada como opcional, nunca iniciada |
| Tests de las capas con I/O | Brecha declarada en [05-status-roadmap.md](05-status-roadmap.md) | Endpoints HTTP/WS, indexado con SQLite (necesita DB temporal + fixtures) |
| `cloudflareApiToken` en texto plano | Brecha declarada en [05-status-roadmap.md](05-status-roadmap.md) | Vive sin cifrar en `server/data/settings.json` |
| Sin autenticación en Configuración | Brecha declarada en [05-status-roadmap.md](05-status-roadmap.md) | Cualquiera en la LAN puede cambiar carpetas, IP y certificado |
| Limpieza de mensajes viejos | Tabla `messages` (ver [04-data-model.md](04-data-model.md)) | Nada la purga: crece indefinidamente hasta que alguien borra a mano |

## Features en especificación

*(vacío — cuando arranque una feature nueva, su mini-spec va acá)*
