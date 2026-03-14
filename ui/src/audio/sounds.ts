/**
 * Audio system — sample-based card/chip sounds (Kenney Casino CC0)
 * plus synthesized UI tones for blinds and victory.
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

// ─── Sample loading & playback ───────────────────────────────────────────────

const bufferCache = new Map<string, AudioBuffer>();
const loadingPromises = new Map<string, Promise<AudioBuffer>>();

async function loadSound(ctx: AudioContext, path: string): Promise<AudioBuffer> {
  const cached = bufferCache.get(path);
  if (cached) return cached;

  // Deduplicate concurrent fetches for the same path
  const existing = loadingPromises.get(path);
  if (existing) return existing;

  const promise = (async () => {
    const response = await fetch(path);
    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    bufferCache.set(path, audioBuffer);
    loadingPromises.delete(path);
    return audioBuffer;
  })();

  loadingPromises.set(path, promise);
  return promise;
}

function playSample(path: string, volume = 0.5, playbackRate = 1.0): void {
  const ctx = getAudioContext();
  if (!ctx) return;
  loadSound(ctx, path).then(buffer => {
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = playbackRate;
    const gain = ctx.createGain();
    gain.gain.value = volume;
    source.connect(gain);
    gain.connect(ctx.destination);
    source.start(0);
  });
}

// Sound file paths (served from public/assets/sfx/)
const SFX = {
  cardShuffle: 'assets/sfx/card-shuffle.ogg',
  cardSlide: 'assets/sfx/card-slide-1.ogg',
  cardPlace: 'assets/sfx/card-place-1.ogg',
  cardShove: 'assets/sfx/card-shove-1.ogg',
  chipLay1: 'assets/sfx/chip-lay-1.ogg',
  chipLay2: 'assets/sfx/chip-lay-2.ogg',
  chipsCollide: 'assets/sfx/chips-collide-1.ogg',
  chipsStack: 'assets/sfx/chips-stack-1.ogg',
  chipsHandle: 'assets/sfx/chips-handle-1.ogg',
  chipsHandleBig: 'assets/sfx/chips-handle-5.ogg',
} as const;

// ─── Card Sounds ─────────────────────────────────────────────────────────────

export function playCardShuffle(): void {
  playSample(SFX.cardShuffle, 0.4);
}

export function playCardDeal(): void {
  playSample(SFX.cardSlide, 0.5);
}

export function playCardFlip(): void {
  playSample(SFX.cardPlace, 0.5);
}

// ─── Action Sounds ───────────────────────────────────────────────────────────

export function playCheckSound(): void {
  playSample(SFX.cardShove, 0.35);
}

export function playBetSound(): void {
  playSample(SFX.chipLay1, 0.6);
}

export function playCallSound(): void {
  playSample(SFX.chipLay2, 0.6);
}

export function playRaiseSound(): void {
  playSample(SFX.chipsStack, 0.6);
}

export function playAllInSound(): void {
  playSample(SFX.chipsHandleBig, 0.7);
}

export function playFoldSound(): void {
  playSample(SFX.cardShove, 0.25, 0.8);
}

// ─── Blind / Tournament Sounds (synthesized) ────────────────────────────────

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

// ─── Notification Sounds ──────────────────────────────────────────────────────

/** Attention-grabbing bell tone when it's the player's turn. */
export function playTurnDing(): void {
  if (!GameSettings.turnSound) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;

  // Two-oscillator bell: 660Hz + 880Hz for a rich ding
  for (const freq of [660, 880]) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now);
    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    osc.start(now);
    osc.stop(now + 0.3);
  }
}

/** Subtle short blip for incoming chat messages. */
export function playChatDing(): void {
  if (!GameSettings.chatSound) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.type = 'sine';
  osc.frequency.setValueAtTime(520, ctx.currentTime);
  gain.gain.setValueAtTime(0.12, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + 0.08);
}

// ─── Victory ─────────────────────────────────────────────────────────────────

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
