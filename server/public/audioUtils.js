export const TARGET_SAMPLE_RATE = 16000;

export function downsampleTo16k(float32Input, inputSampleRate) {
  if (inputSampleRate === TARGET_SAMPLE_RATE) return float32Input;
  const ratio = inputSampleRate / TARGET_SAMPLE_RATE;
  const outLength = Math.floor(float32Input.length / ratio);
  const output = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    output[i] = float32Input[Math.floor(i * ratio)];
  }
  return output;
}

export function floatTo16BitPCM(float32) {
  const out = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

export function midiToNoteName(midi) {
  if (midi == null) return '-';
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const rounded = Math.round(midi);
  const name = names[((rounded % 12) + 12) % 12];
  const octave = Math.floor(rounded / 12) - 1;
  return `${name}${octave}`;
}

export function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
