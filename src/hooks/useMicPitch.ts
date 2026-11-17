import { useState, useRef, useCallback, useEffect } from 'react';
import { detectPitch, PitchStabilizer, VoiceSmoother } from '../utils/pitch';
import type { PitchResult } from '../utils/pitch';
import { frameGate } from '../utils/frames';
import { micAnswered } from '../utils/telemetry';

// Shared microphone + pitch detection pipeline (getUserMedia -> AnalyserNode
// -> YIN detector -> stabilizer), polled once per animation frame.
// Used by the Tuner lab and the Play Challenges lab.
export interface MicPitch {
  pitch: PitchResult | null;
  isActive: boolean;
  error: string | null;
  start: () => Promise<void>;
  stop: () => void;
  /** performance.now() of the last pluck heard: a jump in loudness. Lets a
   *  caller tell a fresh pluck of the same note from one still ringing. */
  lastPluck: () => number;
}

/**
 * 'instrument' snaps to a note and holds it, for a needle reading a string.
 * 'voice' keeps the pitch continuous, for a trace of somebody singing.
 */
export type PitchMode = 'instrument' | 'voice';

export function useMicPitch(mode: PitchMode = 'instrument'): MicPitch {
  const [pitch, setPitch] = useState<PitchResult | null>(null);
  const [isActive, setIsActive] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameId = useRef<number | null>(null);
  const bufferRef = useRef<Float32Array | null>(null);
  const pluckAt = useRef(0);
  const envRef = useRef(0);
  const candRef = useRef<{ at: number; rms: number } | null>(null);
  const lastPluck = useCallback(() => pluckAt.current, []);
  const stabilizerRef = useRef<PitchStabilizer | VoiceSmoother>(
    mode === 'voice' ? new VoiceSmoother() : new PitchStabilizer()
  );

  // Each start or stop bumps this, so a start still waiting on the mic
  // permission knows it was cancelled and gives the mic straight back.
  const gen = useRef(0);

  const stop = useCallback(() => {
    gen.current++;
    setIsActive(false);

    if (animationFrameId.current !== null) {
      cancelAnimationFrame(animationFrameId.current);
      animationFrameId.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    sourceRef.current = null;
    analyserRef.current = null;
    stabilizerRef.current.reset();
    setPitch(null);
  }, []);

  const start = useCallback(async () => {
    const mine = ++gen.current;
    try {
      setError(null);
      // Raw signal: processing like echo cancellation distorts pitched input
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      });
      micAnswered();
      if (mine !== gen.current) { stream.getTracks().forEach(t => t.stop()); return; }
      streamRef.current = stream;

      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioContextClass();
      audioContextRef.current = ctx;

      const source = ctx.createMediaStreamSource(stream);
      sourceRef.current = source;

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048; // high FFT size for low-frequency resolution
      analyserRef.current = analyser;
      source.connect(analyser);

      const buffer = new Float32Array(analyser.fftSize);
      bufferRef.current = buffer;
      stabilizerRef.current.reset();

      const sampleRate = ctx.sampleRate;
      const due = frameGate();
      const updatePitch = () => {
        if (!due()) { animationFrameId.current = requestAnimationFrame(updatePitch); return; }
        analyser.getFloatTimeDomainData(buffer as any);
        let sum = 0;
        for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
        const rms = Math.sqrt(sum / buffer.length);
        const now = performance.now();
        // A pluck keeps sounding; a click (the metronome, a tap on the phone)
        // is gone a moment later. A jump in loudness only counts as a pluck
        // if most of it is still there about 70 ms on.
        const cand = candRef.current;
        if (cand && now - cand.at >= 70) {
          if (rms >= cand.rms * 0.5) pluckAt.current = cand.at;
          candRef.current = null;
        }
        if (!candRef.current && rms > 0.01 && rms > envRef.current * 1.25 && now - pluckAt.current > 90) candRef.current = { at: now, rms };
        envRef.current = envRef.current * 0.85 + rms * 0.15;
        const raw = detectPitch(buffer, sampleRate);
        // Stabilize: hysteresis on note changes + smoothing, so the reading
        // doesn't flicker on every animation frame
        setPitch(stabilizerRef.current.update(raw));
        animationFrameId.current = requestAnimationFrame(updatePitch);
      };
      animationFrameId.current = requestAnimationFrame(updatePitch);

      setIsActive(true);
    } catch (err) {
      micAnswered(err);
      console.error('Microphone initialization failed:', err);
      setError('Microphone blocked. Allow it in settings.');
      stop();
    }
  }, [stop]);

  // Release the mic and audio context when the owning component unmounts
  useEffect(() => stop, [stop]);

  return { pitch, isActive, error, start, stop, lastPluck };
}
