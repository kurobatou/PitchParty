// Fundamental frequency (pitch) estimation for short audio frames.
//
// Uses autocorrelation, which is simple and dependency-free and accurate
// enough for singing voice range (~80-1000 Hz). Not as robust as YIN or
// aubio's pyin, but avoids extra native dependencies. Ported from the
// original Python engine (engine/src/pitch.py).

const MIN_FREQ_HZ = 70.0;
const MAX_FREQ_HZ = 1000.0;
const MIN_RMS = 0.006; // frames quieter than this are treated as silence

function hanningWindow(size) {
  const window = new Float64Array(size);
  for (let i = 0; i < size; i++) {
    window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
  }
  return window;
}

const windowCache = new Map();
function getHanningWindow(size) {
  let window = windowCache.get(size);
  if (!window) {
    window = hanningWindow(size);
    windowCache.set(size, window);
  }
  return window;
}

/**
 * Returns the estimated fundamental frequency in Hz, or null if the frame
 * is silent/unvoiced. `samples` is a Float64Array/Float32Array of
 * normalized (-1..1) mono samples.
 */
export function detectPitch(samples, sampleRate) {
  const size = samples.length;
  if (size === 0) return null;

  const window = getHanningWindow(size);
  const windowed = new Float64Array(size);
  let sumSquares = 0;
  for (let i = 0; i < size; i++) {
    const v = samples[i] * window[i];
    windowed[i] = v;
    sumSquares += v * v;
  }

  const rms = Math.sqrt(sumSquares / size);
  if (rms < MIN_RMS) return null;

  const minLag = Math.floor(sampleRate / MAX_FREQ_HZ);
  let maxLag = Math.floor(sampleRate / MIN_FREQ_HZ);
  maxLag = Math.min(maxLag, size - 1);
  if (maxLag <= minLag) return null;

  // Autocorrelation at each lag in [minLag, maxLag): sum(windowed[i] * windowed[i+lag]).
  let peakLag = -1;
  let peakValue = -Infinity;
  for (let lag = minLag; lag < maxLag; lag++) {
    let sum = 0;
    for (let i = 0; i < size - lag; i++) {
      sum += windowed[i] * windowed[i + lag];
    }
    if (sum > peakValue) {
      peakValue = sum;
      peakLag = lag;
    }
  }

  if (peakLag <= 0 || peakValue <= 0) return null;

  return sampleRate / peakLag;
}
