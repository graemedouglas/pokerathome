/**
 * Audio system using Web Audio API.
 * Generates short synthesized tones — no external audio files needed.
 */

import { GameSettings } from '../settings/GameSettings';

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (!GameSettings.soundEffects) return null;
  if (!audioCtx) {
    try {
      audioCtx = new AudioContext();
    } catch {
      return null;
    }
  }
  return audioCtx;
}

/** Helper: create a white noise buffer of given duration. */
function createNoiseBuffer(ctx: AudioContext, duration: number): AudioBuffer {
  const sampleRate = ctx.sampleRate;
  const length = Math.floor(sampleRate * duration);
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

// ─── Card Sounds ──────────────────────────────────────────────────────────────

/** Card shuffle — white noise burst through bandpass filter, ~0.6s. */
export function playCardShuffle(): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  const noise = ctx.createBufferSource();
  noise.buffer = createNoiseBuffer(ctx, 0.6);

  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(3000, ctx.currentTime);
  filter.Q.setValueAtTime(0.8, ctx.currentTime);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.12, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(0.15, ctx.currentTime + 0.1);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);

  noise.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);

  noise.start(ctx.currentTime);
  noise.stop(ctx.currentTime + 0.6);
}

/** Card deal — very short noise click, ~50ms snap. */
export function playCardDeal(): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  const noise = ctx.createBufferSource();
  noise.buffer = createNoiseBuffer(ctx, 0.05);

  const filter = ctx.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.setValueAtTime(4000, ctx.currentTime);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.15, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);

  noise.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);

  noise.start(ctx.currentTime);
  noise.stop(ctx.currentTime + 0.05);
}

/** Card flip on community reveal — mid-freq noise burst, ~80ms. */
export function playCardFlip(): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  const noise = ctx.createBufferSource();
  noise.buffer = createNoiseBuffer(ctx, 0.08);

  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(2500, ctx.currentTime);
  filter.Q.setValueAtTime(1.5, ctx.currentTime);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.18, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);

  noise.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);

  noise.start(ctx.currentTime);
  noise.stop(ctx.currentTime + 0.08);
}

// ─── Action Sounds ────────────────────────────────────────────────────────────

/** Check — low-pitched knock/thud, 120Hz sine with fast decay. */
export function playCheckSound(): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.type = 'sine';
  osc.frequency.setValueAtTime(120, ctx.currentTime);
  gain.gain.setValueAtTime(0.2, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);

  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + 0.1);
}

/** Single chip clink — triangle wave ~2kHz, short ring. */
function playChipClink(ctx: AudioContext, startTime: number, freq = 2000, vol = 0.12): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.type = 'triangle';
  osc.frequency.setValueAtTime(freq, startTime);
  gain.gain.setValueAtTime(0, ctx.currentTime);
  gain.gain.setValueAtTime(vol, startTime);
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.08);

  osc.start(startTime);
  osc.stop(startTime + 0.08);
}

/** Bet — single chip placement clink. */
export function playBetSound(): void {
  const ctx = getAudioContext();
  if (!ctx) return;
  playChipClink(ctx, ctx.currentTime, 2000, 0.14);
}

/** Call — similar to bet but slightly lower pitch. */
export function playCallSound(): void {
  const ctx = getAudioContext();
  if (!ctx) return;
  playChipClink(ctx, ctx.currentTime, 1600, 0.14);
}

/** Raise — chip splash: 3-4 staggered clinks with pitch variation. */
export function playRaiseSound(): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const count = 3 + Math.floor(Math.random() * 2); // 3 or 4
  for (let i = 0; i < count; i++) {
    const freq = 1800 + Math.random() * 600;
    playChipClink(ctx, now + i * 0.04, freq, 0.1);
  }
}

/** All-in — chip cascade: 8-10 rapid staggered clinks descending in pitch. */
export function playAllInSound(): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const count = 8 + Math.floor(Math.random() * 3); // 8-10
  for (let i = 0; i < count; i++) {
    const freq = 2400 - i * 120 + Math.random() * 100;
    playChipClink(ctx, now + i * 0.03, freq, 0.08);
  }
}

/** Fold — soft whoosh: filtered noise, low volume, ~150ms. */
export function playFoldSound(): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  const noise = ctx.createBufferSource();
  noise.buffer = createNoiseBuffer(ctx, 0.15);

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(1500, ctx.currentTime);
  filter.frequency.exponentialRampToValueAtTime(400, ctx.currentTime + 0.15);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.08, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);

  noise.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);

  noise.start(ctx.currentTime);
  noise.stop(ctx.currentTime + 0.15);
}

// ─── Blind / Tournament Sounds ────────────────────────────────────────────────

/** Subtle tick sound for blind warnings (60s, 30s before change). */
export function playBlindWarningTick(): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.type = 'sine';
  osc.frequency.setValueAtTime(880, ctx.currentTime);
  gain.gain.setValueAtTime(0.15, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);

  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + 0.15);
}

/** Urgent countdown tick for last 5 seconds — higher pitch, shorter. */
export function playCountdownTick(): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.type = 'sine';
  osc.frequency.setValueAtTime(1200, ctx.currentTime);
  gain.gain.setValueAtTime(0.18, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);

  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + 0.08);
}

/** Ding-dong doorbell for blind level up — C5 then E5, each ~200ms. */
export function playBlindDingDong(): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;

  // Low tone (C5 = 523Hz)
  const osc1 = ctx.createOscillator();
  const gain1 = ctx.createGain();
  osc1.connect(gain1);
  gain1.connect(ctx.destination);
  osc1.type = 'sine';
  osc1.frequency.setValueAtTime(523, now);
  gain1.gain.setValueAtTime(0.2, now);
  gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
  osc1.start(now);
  osc1.stop(now + 0.25);

  // High tone (E5 = 659Hz) — slight overlap
  const osc2 = ctx.createOscillator();
  const gain2 = ctx.createGain();
  osc2.connect(gain2);
  gain2.connect(ctx.destination);
  osc2.type = 'sine';
  osc2.frequency.setValueAtTime(659, now + 0.18);
  gain2.gain.setValueAtTime(0, now);
  gain2.gain.setValueAtTime(0.2, now + 0.18);
  gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
  osc2.start(now + 0.18);
  osc2.stop(now + 0.45);
}

/** Distinct chime when blinds increase. Two ascending tones. */
export function playBlindLevelUp(): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  // First tone
  const osc1 = ctx.createOscillator();
  const gain1 = ctx.createGain();
  osc1.connect(gain1);
  gain1.connect(ctx.destination);
  osc1.type = 'sine';
  osc1.frequency.setValueAtTime(660, ctx.currentTime);
  gain1.gain.setValueAtTime(0.2, ctx.currentTime);
  gain1.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
  osc1.start(ctx.currentTime);
  osc1.stop(ctx.currentTime + 0.2);

  // Second tone (higher)
  const osc2 = ctx.createOscillator();
  const gain2 = ctx.createGain();
  osc2.connect(gain2);
  gain2.connect(ctx.destination);
  osc2.type = 'sine';
  osc2.frequency.setValueAtTime(880, ctx.currentTime + 0.15);
  gain2.gain.setValueAtTime(0, ctx.currentTime);
  gain2.gain.setValueAtTime(0.2, ctx.currentTime + 0.15);
  gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
  osc2.start(ctx.currentTime + 0.15);
  osc2.stop(ctx.currentTime + 0.4);
}

// ─── Victory ──────────────────────────────────────────────────────────────────

/** Victory fanfare — ascending major arpeggio (C5-E5-G5-C6) with sustain. */
export function playVictoryFanfare(): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  const notes = [523, 659, 784, 1047]; // C5, E5, G5, C6
  const stagger = 0.12;
  const now = ctx.currentTime;

  for (let i = 0; i < notes.length; i++) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.type = 'sine';
    const start = now + i * stagger;
    const isLast = i === notes.length - 1;
    const duration = isLast ? 0.6 : 0.25;

    osc.frequency.setValueAtTime(notes[i], start);
    gain.gain.setValueAtTime(0, now);
    gain.gain.setValueAtTime(0.2, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);

    osc.start(start);
    osc.stop(start + duration);
  }
}
