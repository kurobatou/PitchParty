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

## Features en especificación

### Dueto con dos celulares (modo Karaoke)

**Qué**: al elegir una canción de dueto, quien la elige puede invitar a otra persona conectada a cantar la segunda voz. Si acepta, en el turno **los dos celulares** muestran la letra (cada uno con su voz destacada) y, si el micrófono de celular está activo, **las dos voces suenan** por los parlantes de la Sala.

**Por qué**: hoy `duetMode: 'duo'` significa "dos personas comparten un turno y **un** celular" — una sola entrada en la cola y un solo micrófono. En la práctica cada uno tiene su teléfono en la mano, y al pasarse un solo aparato se pierde la letra o se pierde el micrófono. Además `Room.canRelayMic()` solo deja pasar al titular del turno, así que el segundo cantante hoy es literalmente inaudible.

**Decisiones ya tomadas** (para que no se re-discutan al implementar):
- **La invitación se acepta.** Al invitado le llega un "¿Cantás X conmigo?" con aceptar/rechazar; nadie sube al escenario sin querer.
- **El servidor sigue siendo un relay tonto**: etiqueta cada frame con la voz (1 o 2) y no decodifica nada. La mezcla la hace la Sala, que ya tiene jitter buffer — usa dos y deja que Web Audio los sume. Esto además habilita volumen por voz más adelante sin tocar el servidor.
- **Solo modo Karaoke.** En UltraStar haría falta partir el scoring por voz (hoy `notesFromSongPayload` aplana las notas de las dos voces sin mirar `player`), y eso es una feature aparte con su propia spec.
- **Cada celular muestra la letra completa con su voz destacada**, no solo sus líneas: da contexto para entrar a tiempo cuando las voces se alternan.
- **El titular canta P1 y el invitado P2.** Sin opción de elegir: simplifica todo y las canciones ya vienen con esa convención.
- `duetMode: 'duo'` **sin** compañero sigue significando lo de hoy (dos personas, un celular). Esta feature agrega un camino, no reemplaza el existente.

**Criterios de aceptación** (provisionales; al terminar se renumeran dentro de [06-acceptance.md](06-acceptance.md)):

*Invitación*
1. Dada una canción de dueto elegida en modo `duo`, cuando quien la eligió confirma, entonces puede elegir compañero de una lista de los celulares conectados en ese momento.
2. Dada esa lista, cuando se arma, entonces **no** incluye a la Sala (`role: screen`), ni a participantes de rol `karaoke` (no tienen socket), ni a quien está invitando.
3. Dada una invitación enviada, cuando llega al invitado, entonces ve quién lo invita y a qué canción, y puede aceptar o rechazar.
4. Dado que el invitado acepta, cuando se confirma, entonces la cola muestra el turno con **los dos nombres** y ocupa **un solo** lugar (es una performance, no dos).
5. Dado que el invitado rechaza, cuando se procesa, entonces el turno queda en modo solo y quien invitó se entera (no queda esperando en silencio).
6. Dado un invitado que ya tiene una invitación pendiente de otra persona, cuando le llega una segunda, entonces se rechaza automáticamente la nueva (una por vez, sin colas de invitaciones).
7. Dado que quien invitó se va o cancela su canción antes del turno, cuando eso ocurre, entonces la invitación se descarta y el invitado se entera.

*El turno*
8. Dado un dueto aceptado, cuando arranca el turno, entonces los dos celulares muestran la letra de la canción con la voz propia destacada (P1 para el titular, P2 para el invitado).
9. Dado un dueto aceptado, cuando arranca el turno, entonces `Room.canRelayMic()` deja pasar audio **de los dos**, y de nadie más.
10. Dado que el invitado no aceptó antes de que arranque el turno (no contestó, rechazó, o se desconectó), cuando arranca, entonces la canción se canta en modo solo, sin bloquear la rotación.
11. Dado un dueto en curso, cuando uno de los dos pierde la conexión, entonces el otro sigue cantando y su audio se sigue relayando.
12. Dado que el turno termina, cuando se cierra, entonces ambos vuelven a estado normal y ninguno queda marcado como cantando.

*Audio*
13. Dado un frame de audio de cualquiera de los dos, cuando el servidor lo reenvía, entonces lleva la voz (1 o 2) indicada y el servidor no decodifica ni modifica el audio.
14. Dadas las dos voces llegando a la Sala, cuando se reproducen, entonces suenan mezcladas y la música baja a `phoneMic.musicVolume` igual que con una sola voz.
15. Dado que una de las dos voces deja de llegar, cuando eso ocurre, entonces la otra sigue sonando sin cortes ni chasquidos.

**Impacto en los docs**:
- [x] 01-overview — decisión de producto (el dueto con dos celulares) y qué significa ahora `duo`
- [ ] 02-architecture — sin archivos nuevos previstos
- [x] 03-protocol — mensajes de invitación, `partnerId` en `chooseSong`, `partner` en `nowPlaying`, y el **cambio de formato de los frames de `/ws/micmix`** (pasan a llevar la voz)
- [x] 04-data-model — los campos de `Room`/`User` que sostienen la invitación y el compañero
- [x] 06-acceptance — criterios definitivos

**Nota de diseño — el formato de `/ws/micmix` cambia.** Hoy los frames son PCM16 crudo sin identificador de origen, justamente porque "solo puede sonar un celular a la vez". Con dos voces hay que distinguirlas: la propuesta es anteponer un byte con el número de voz y dejar el resto igual. **Es un cambio incompatible**: la Sala tiene que actualizarse en el mismo cambio, porque un lector viejo interpretaría ese byte como audio.

**Nota de diseño — la cola y el tope de 4.** El dueto es **un** turno: entra una sola vez en la cola y consume **un** lugar de `MAX_ACTIVE_SINGERS`. El invitado acompaña ese turno (su estado refleja que está cantando) pero no ocupa un cupo propio ni una entrada de cola aparte.

**Fuera de alcance**:
- Puntuación por voz en UltraStar (es la feature aparte que habilita esto más adelante).
- Tríos o más: el parser entiende `P3`, pero acá son dos voces y punto.
- Dos celulares para la **misma** voz.
- Cambiar de compañero una vez que el turno arrancó.
- Control de volumen por voz en la Sala (el formato etiquetado lo habilita, pero no se implementa ahora).
- Invitar a alguien que no está conectado en ese momento.

**Verificación**:
- **Tests** (`test:room`): todo el ciclo de vida de la invitación (aceptar, rechazar, segunda invitación, invitante que se va), que `canRelayMic` deje pasar a los dos y a nadie más, la caída a modo solo, y que el dueto ocupe un solo lugar en la cola.
- **Navegador, desde la máquina de desarrollo**: la invitación de punta a punta con **dos ventanas** de `/join.html` — aceptar/rechazar no necesita micrófono, así que no hace falta el MacBook.
- **MacBook**: la mezcla real de las dos voces por los parlantes, con dos teléfonos de verdad (criterios 13-15). Es lo único que no se puede cerrar acá.
