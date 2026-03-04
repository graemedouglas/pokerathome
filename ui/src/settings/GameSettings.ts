type SettingsChangeCallback = () => void;

interface SettingsData {
  fourColorSuits: boolean;
  humanAvatarId: number;
  soundEffects: boolean;
  dealerNarration: boolean;
}

const STORAGE_KEY = 'pokerathome_settings';

const DEFAULTS: SettingsData = {
  fourColorSuits: true,
  humanAvatarId: 0,
  soundEffects: true,
  dealerNarration: false,
};

class GameSettingsClass {
  private data: SettingsData;
  private listeners: SettingsChangeCallback[] = [];

  constructor() {
    this.data = { ...DEFAULTS };
    this.load();
  }

  get fourColorSuits(): boolean { return this.data.fourColorSuits; }
  set fourColorSuits(v: boolean) {
    if (this.data.fourColorSuits !== v) {
      this.data.fourColorSuits = v;
      this.save();
      this.notify();
    }
  }

  get humanAvatarId(): number { return this.data.humanAvatarId; }
  set humanAvatarId(v: number) {
    if (this.data.humanAvatarId !== v) {
      this.data.humanAvatarId = v;
      this.save();
      this.notify();
    }
  }

  get soundEffects(): boolean { return this.data.soundEffects; }
  set soundEffects(v: boolean) {
    if (this.data.soundEffects !== v) {
      this.data.soundEffects = v;
      this.save();
      this.notify();
    }
  }

  get dealerNarration(): boolean { return this.data.dealerNarration; }
  set dealerNarration(v: boolean) {
    if (this.data.dealerNarration !== v) {
      this.data.dealerNarration = v;
      this.save();
      this.notify();
    }
  }

  onChange(cb: SettingsChangeCallback): () => void {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter(l => l !== cb);
    };
  }

  private notify(): void {
    for (const cb of this.listeners) cb();
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
    } catch { /* ignore */ }
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (typeof parsed.fourColorSuits === 'boolean') this.data.fourColorSuits = parsed.fourColorSuits;
        if (typeof parsed.humanAvatarId === 'number') this.data.humanAvatarId = parsed.humanAvatarId;
        if (typeof parsed.soundEffects === 'boolean') this.data.soundEffects = parsed.soundEffects;
        if (typeof parsed.dealerNarration === 'boolean') this.data.dealerNarration = parsed.dealerNarration;
      }
    } catch { /* ignore */ }
  }
}

export const GameSettings = new GameSettingsClass();