"""Scoring engine WebSocket server.

Protocol (per connection = one singer's session):
  1. Client sends a text JSON "start" message:
       {"type": "start", "sampleRate": 16000, "notes": [
         {"type": "normal"|"golden"|"freestyle"|"rap", "startMs": .., "endMs": .., "pitch": ..}
       ]}
  2. Client streams binary frames: raw PCM16LE mono audio at `sampleRate`.
  3. Server replies with one JSON "frame" message per analysis window
     (~128ms) containing the running score.
  4. Client sends {"type": "stop"} (or just closes) to end the session;
     server replies with a final "summary" message.
"""
import asyncio
import json
import logging
import os

import numpy as np
import websockets

from pitch import detect_pitch
from scoring import ScoringSession, notes_from_song_payload

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
log = logging.getLogger('engine')

HOST = os.environ.get('HOST', '0.0.0.0')
PORT = int(os.environ.get('PORT', '8765'))

ANALYSIS_WINDOW_SAMPLES = 2048  # ~128ms at 16kHz


async def handle_connection(websocket):
    session: ScoringSession | None = None
    sample_rate = 16000
    buffer = bytearray()
    samples_processed = 0
    frame_bytes = ANALYSIS_WINDOW_SAMPLES * 2  # int16 = 2 bytes/sample

    peer = websocket.remote_address
    log.info('connection opened from %s', peer)

    try:
        async for message in websocket:
            if isinstance(message, str):
                data = json.loads(message)
                msg_type = data.get('type')

                if msg_type == 'start':
                    sample_rate = int(data.get('sampleRate', 16000))
                    notes = notes_from_song_payload(data.get('notes', []))
                    session = ScoringSession(notes)
                    samples_processed = 0
                    buffer.clear()
                    log.info('session started: %d scorable notes, maxScore=%d',
                              len(notes), session.max_score)

                elif msg_type == 'stop':
                    if session is not None:
                        await websocket.send(json.dumps({
                            'type': 'summary',
                            'totalScore': session.total_score,
                            'maxScore': session.max_score,
                        }))
                    break

                continue

            # Binary message: raw PCM16LE audio.
            if session is None:
                continue  # ignore audio before a start message

            buffer.extend(message)

            while len(buffer) >= frame_bytes:
                chunk = bytes(buffer[:frame_bytes])
                del buffer[:frame_bytes]

                samples = np.frombuffer(chunk, dtype='<i2').astype(np.float32) / 32768.0
                freq = detect_pitch(samples, sample_rate)

                samples_processed += ANALYSIS_WINDOW_SAMPLES
                elapsed_ms = samples_processed / sample_rate * 1000.0

                result = session.score_frame(elapsed_ms, freq)
                await websocket.send(json.dumps(result))

    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        log.info('connection closed from %s', peer)


async def main():
    async with websockets.serve(handle_connection, HOST, PORT, max_size=2 ** 20):
        log.info('scoring engine listening on ws://%s:%d', HOST, PORT)
        await asyncio.Future()


if __name__ == '__main__':
    asyncio.run(main())
