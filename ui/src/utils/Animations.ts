import { Ticker, Container } from 'pixi.js';

interface TweenOptions {
  target: Container;
  duration: number; // ms
  props: Partial<{ x: number; y: number; alpha: number; scaleX: number; scaleY: number; rotation: number }>;
  easing?: (t: number) => number;
}

// Easing functions
export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

export function easeOutElastic(t: number): number {
  if (t === 0 || t === 1) return t;
  return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI) / 3) + 1;
}

export function easeOutQuint(t: number): number {
  return 1 - Math.pow(1 - t, 5);
}

export function easeInQuad(t: number): number {
  return t * t;
}

export function tween(ticker: Ticker, options: TweenOptions): Promise<void> {
  return new Promise((resolve) => {
    const { target, duration, props, easing = easeOutCubic } = options;
    const startValues: Record<string, number> = {};

    for (const key of Object.keys(props) as (keyof typeof props)[]) {
      if (key === 'scaleX') {
        startValues[key] = target.scale.x;
      } else if (key === 'scaleY') {
        startValues[key] = target.scale.y;
      } else {
        startValues[key] = (target as unknown as Record<string, number>)[key];
      }
    }

    let elapsed = 0;

    const update = (tick: Ticker) => {
      elapsed += tick.deltaMS;
      const progress = Math.min(elapsed / duration, 1);
      const eased = easing(progress);

      for (const key of Object.keys(props) as (keyof typeof props)[]) {
        const start = startValues[key];
        const end = props[key]!;
        const value = start + (end - start) * eased;

        if (key === 'scaleX') {
          target.scale.x = value;
        } else if (key === 'scaleY') {
          target.scale.y = value;
        } else {
          (target as unknown as Record<string, number>)[key] = value;
        }
      }

      if (progress >= 1) {
        ticker.remove(update);
        resolve();
      }
    };

    ticker.add(update);
  });
}

/** Pulse alpha between two values continuously. Returns a stop function. */
export function pulseAlpha(
  ticker: Ticker,
  target: Container,
  min: number,
  max: number,
  period: number, // ms for full cycle
): () => void {
  let elapsed = 0;
  const update = (tick: Ticker) => {
    elapsed += tick.deltaMS;
    const t = (Math.sin((elapsed / period) * Math.PI * 2) + 1) / 2;
    target.alpha = min + t * (max - min);
  };
  ticker.add(update);
  return () => ticker.remove(update);
}

/** Pulse scale between two values continuously. Returns a stop function. */
export function pulseScale(
  ticker: Ticker,
  target: Container,
  min: number,
  max: number,
  period: number,
): () => void {
  let elapsed = 0;
  const update = (tick: Ticker) => {
    elapsed += tick.deltaMS;
    const t = (Math.sin((elapsed / period) * Math.PI * 2) + 1) / 2;
    const s = min + t * (max - min);
    target.scale.set(s);
  };
  ticker.add(update);
  return () => ticker.remove(update);
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}