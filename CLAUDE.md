@AGENTS.md

## Claude Code

- Este repo se desarrolla en Windows y se **usa** en un MacBook. Antes de decir que algo funciona, fijate en qué máquina estás: lo que toca micrófono, HTTPS o celulares no se puede verificar desde Windows (ver "Dónde se verifica cada cosa" en AGENTS.md). Decí qué quedó pendiente de probar en el MacBook en vez de darlo por cerrado.
- Usa modo plan antes de tocar `server/src/index.js`: es el único archivo que conoce el protocolo completo, y un cambio ahí casi siempre implica actualizar `docs/sdd/03-protocol.md` en el mismo commit.
- Antes de implementar una feature nueva, invoca el subagente `Plan` para armar la mini-spec de `docs/sdd/07-next.md` (hay plantilla en ese archivo) — el código va después de la spec, no antes.
- `.claude/launch.json` levanta el servidor (`karaoke-server`, `https://localhost:3000`) para el panel de navegador. No sirve para probar micrófono ni celulares.
- No guardes en auto memory nada que ya esté en `docs/sdd/` o en `AGENTS.md` — esos archivos son la fuente de verdad persistente del proyecto.
