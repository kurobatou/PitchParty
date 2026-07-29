"""Fundamental frequency (pitch) estimation for short audio frames.

Uses autocorrelation, which is simple and dependency-free (pure numpy) and
accurate enough for singing voice range (~80-1000 Hz). Not as robust as YIN
or aubio's pyin, but avoids extra native dependencies for V1.
"""
import numpy as np

MIN_FREQ_HZ = 70.0
MAX_FREQ_HZ = 1000.0
MIN_RMS = 0.01  # frames quieter than this are treated as silence


def detect_pitch(samples: np.ndarray, sample_rate: int) -> float | None:
    """Returns the estimated fundamental frequency in Hz, or None if the
    frame is silent/unvoiced."""
    if samples.size == 0:
        return None

    windowed = samples.astype(np.float64) * np.hanning(samples.size)

    rms = np.sqrt(np.mean(windowed ** 2))
    if rms < MIN_RMS:
        return None

    autocorr = np.correlate(windowed, windowed, mode='full')
    autocorr = autocorr[autocorr.size // 2:]

    min_lag = int(sample_rate / MAX_FREQ_HZ)
    max_lag = int(sample_rate / MIN_FREQ_HZ)
    max_lag = min(max_lag, autocorr.size - 1)
    if max_lag <= min_lag:
        return None

    search = autocorr[min_lag:max_lag]
    if search.size == 0:
        return None

    peak_idx = int(np.argmax(search)) + min_lag
    peak_value = autocorr[peak_idx]
    if peak_value <= 0:
        return None

    freq = sample_rate / peak_idx
    return freq
