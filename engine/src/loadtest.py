"""Fase 1 load test: opens N concurrent sessions against the scoring engine,
each streaming a synthetic sine-wave "singer" holding a known pitch, and
checks that every stream gets scored correctly and promptly.

Run inside the docker network (no Python on the host):
  docker compose run --rm engine python src/loadtest.py
"""
import asyncio
import json
import math
import time

import numpy as np
import websockets

ENGINE_URL = 'ws://engine:8765'
SAMPLE_RATE = 16000
CHUNK_SAMPLES = 4096
CHUNK_SECONDS = CHUNK_SAMPLES / SAMPLE_RATE
DURATION_SECONDS = 6
TARGET_FREQ_HZ = 440.0  # A4, MIDI 69
TARGET_PITCH = 9  # usdx_pitch_to_midi(9) == 69


def make_sine_chunk(phase: float, freq: float) -> tuple[bytes, float]:
    t = (np.arange(CHUNK_SAMPLES) / SAMPLE_RATE)
    signal = 0.6 * np.sin(2 * math.pi * freq * t + phase)
    new_phase = phase + 2 * math.pi * freq * CHUNK_SECONDS
    pcm16 = (signal * 32767).astype('<i2')
    return pcm16.tobytes(), new_phase


async def run_singer(index: int) -> dict:
    notes = [{'type': 'normal', 'startMs': 0, 'endMs': DURATION_SECONDS * 1000, 'pitch': TARGET_PITCH}]
    latencies = []
    hits = 0
    frames = 0
    summary = None

    async with websockets.connect(ENGINE_URL, max_size=2 ** 20) as ws:
        await ws.send(json.dumps({'type': 'start', 'sampleRate': SAMPLE_RATE, 'notes': notes}))

        phase = 0.0
        chunks_to_send = int(DURATION_SECONDS / CHUNK_SECONDS)
        send_times = []

        async def sender():
            nonlocal phase
            for _ in range(chunks_to_send):
                chunk, phase = make_sine_chunk(phase, TARGET_FREQ_HZ)
                send_times.append(time.perf_counter())
                await ws.send(chunk)
                await asyncio.sleep(CHUNK_SECONDS)
            await ws.send(json.dumps({'type': 'stop'}))

        sender_task = asyncio.create_task(sender())

        async for message in ws:
            data = json.loads(message)
            if data['type'] == 'frame':
                frames += 1
                if data['hit']:
                    hits += 1
                if send_times:
                    reference_send = send_times[min(frames - 1, len(send_times) - 1)]
                    latencies.append(time.perf_counter() - reference_send)
            elif data['type'] == 'summary':
                summary = data
                break

        await sender_task

    return {
        'index': index,
        'frames': frames,
        'hits': hits,
        'hitRate': hits / frames if frames else 0.0,
        'avgLatencyMs': (sum(latencies) / len(latencies) * 1000) if latencies else None,
        'maxLatencyMs': (max(latencies) * 1000) if latencies else None,
        'summary': summary,
    }


async def main(concurrency: int = 4):
    start = time.perf_counter()
    results = await asyncio.gather(*(run_singer(i) for i in range(concurrency)))
    elapsed = time.perf_counter() - start

    print(f'\n=== Load test: {concurrency} concurrent singers, {DURATION_SECONDS}s each ===')
    print(f'Wall time: {elapsed:.2f}s\n')
    for r in results:
        print(f"singer {r['index']}: frames={r['frames']} hitRate={r['hitRate']:.0%} "
              f"avgLatency={r['avgLatencyMs']:.1f}ms maxLatency={r['maxLatencyMs']:.1f}ms "
              f"summary={r['summary']}")

    all_ok = all(r['hitRate'] > 0.8 for r in results)
    print('\nRESULT:', 'PASS' if all_ok else 'FAIL — hit rate too low, check pitch detection/scoring')


if __name__ == '__main__':
    asyncio.run(main())
