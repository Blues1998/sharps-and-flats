import { useCallback, useEffect, useRef, useState } from 'react';
import { micAnswered } from '../utils/telemetry';

// "Prove it": strum a chord and the mic checks it, the way Simply Guitar and
// Fender Play listen for a chord before they count it.
//
// The sound is folded into its twelve pitch classes (a chroma), and a strum
// passes when every note of the chord is ringing and most of the sound is
// inside the chord, held for a moment. One note plucked alone fails (the other
// chord tones are missing), and so does the wrong chord (its odd note pulls
// the share outside the chord down). The check is lenient on balance between
// strings, because a real strum is never even.

export type CheckState = 'idle' | 'listening' | 'passed' | 'failed' | 'error';

const NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const FRAME_MS = 100;
const NEED_FRAMES = 4;         // 0.4 s of a clean chord
const TIMEOUT_MS = 8000;
const MIN_RMS = 0.008;         // quieter than this is the room, not a strum
const MIN_SHARE = 0.6;         // of the sound inside the chord's notes
const MIN_TONE = 0.15;         // each chord note, against the loudest one

export function useChordCheck() {
  const [state, setState] = useState<CheckState>('idle');
  const [missing, setMissing] = useState<string | null>(null);
  const stopRef = useRef<() => void>(() => {});

  const stop = useCallback(() => { stopRef.current(); stopRef.current = () => {}; }, []);
  useEffect(() => stop, [stop]);

  const start = useCallback(async (midis: number[]) => {
    stop();
    setMissing(null);
    const pcs = [...new Set(midis.map(m => ((m % 12) + 12) % 12))];
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
      });
      micAnswered();
    } catch (err) {
      micAnswered(err);
      setState('error');
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AC();
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 16384;
    analyser.smoothingTimeConstant = 0.4;
    src.connect(analyser);
    const freq = new Float32Array(analyser.frequencyBinCount);
    const wave = new Float32Array(analyser.fftSize);
    const binHz = ctx.sampleRate / analyser.fftSize;

    let good = 0;
    const weakest = new Array(12).fill(0);
    let heardAny = false;
    const began = performance.now();
    setState('listening');

    const id = window.setInterval(() => {
      analyser.getFloatTimeDomainData(wave);
      let sum = 0;
      for (let i = 0; i < wave.length; i++) sum += wave[i] * wave[i];
      const rms = Math.sqrt(sum / wave.length);

      if (rms >= MIN_RMS) {
        heardAny = true;
        analyser.getFloatFrequencyData(freq);
        const chroma = new Array(12).fill(0);
        let total = 0;
        for (let i = Math.ceil(70 / binHz); i < Math.min(freq.length, 1500 / binHz); i++) {
          const p = 69 + 12 * Math.log2((i * binHz) / 440);
          if (Math.abs(p - Math.round(p)) > 0.3) continue;
          const e = Math.pow(10, freq[i] / 10);
          chroma[((Math.round(p) % 12) + 12) % 12] += e;
          total += e;
        }
        const inside = pcs.reduce((n, pc) => n + chroma[pc], 0);
        const loudest = Math.max(...pcs.map(pc => chroma[pc]));
        const present = pcs.every(pc => chroma[pc] >= MIN_TONE * loudest);
        if (total > 0 && inside / total >= MIN_SHARE && present) good++;
        else {
          good = 0;
          // Remember which chord note keeps coming up short, to name it.
          const low = pcs.reduce((a, b) => (chroma[a] / (loudest || 1) <= chroma[b] / (loudest || 1) ? a : b));
          weakest[low]++;
        }
      } else {
        good = 0;
      }

      if (good >= NEED_FRAMES) {
        cleanup();
        setState('passed');
      } else if (performance.now() - began > TIMEOUT_MS) {
        cleanup();
        const worst = heardAny ? weakest.indexOf(Math.max(...weakest)) : -1;
        setMissing(worst >= 0 && weakest[worst] > 0 ? NAMES[worst] : null);
        setState('failed');
      }
    }, FRAME_MS);

    let closed = false;
    function cleanup() {
      if (closed) return;
      closed = true;
      window.clearInterval(id);
      stream.getTracks().forEach(t => t.stop());
      void ctx.close();
    }
    stopRef.current = () => { cleanup(); };
  }, [stop]);

  const reset = useCallback(() => { stop(); setState('idle'); setMissing(null); }, [stop]);

  return { state, missing, start, reset };
}
