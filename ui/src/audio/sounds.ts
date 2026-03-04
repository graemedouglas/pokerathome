/**
 * Audio system using Web Audio API.
 * Generates short synthesized tones — no external audio files needed.
 */

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (!audioCtx) {
    try {
      audioCtx = new AudioContext();
    } catch {
      return null;
    }
  }
  return audioCtx;
}

/** Subtle tick sound for blind warnings (30s, 10s before change). */
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
