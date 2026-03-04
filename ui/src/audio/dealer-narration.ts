/**
 * TTS dealer narration using the browser's Web Speech API.
 * Opt-in via GameSettings.dealerNarration toggle.
 */

import { GameSettings } from '../settings/GameSettings';

const RANK_WORDS: Record<string, string> = {
  '2': 'Two', '3': 'Three', '4': 'Four', '5': 'Five',
  '6': 'Six', '7': 'Seven', '8': 'Eight', '9': 'Nine',
  'T': 'Ten', '10': 'Ten',
  'J': 'Jack', 'Q': 'Queen', 'K': 'King', 'A': 'Ace',
};

const SUIT_WORDS: Record<string, string> = {
  'h': 'of hearts', 'd': 'of diamonds', 'c': 'of clubs', 's': 'of spades',
};

/** Convert a card code like "Ah" or "10s" to spoken words. */
export function cardToWords(code: string): string {
  // Card codes: rank + suit char. Rank can be 2 chars for "10".
  const suit = code.slice(-1);
  const rank = code.slice(0, -1);
  const rankWord = RANK_WORDS[rank] ?? rank;
  const suitWord = SUIT_WORDS[suit] ?? suit;
  return `${rankWord} ${suitWord}`;
}

/** Speak text using Web Speech API. Non-blocking, fire-and-forget. */
export function speak(text: string): void {
  if (!GameSettings.dealerNarration) return;
  if (typeof window === 'undefined' || !window.speechSynthesis) return;

  // If the queue is building up, cancel the backlog and skip ahead
  if (window.speechSynthesis.pending) {
    window.speechSynthesis.cancel();
  }

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 0.95;
  utterance.pitch = 0.85;
  utterance.volume = 0.9;
  window.speechSynthesis.speak(utterance);
}

/** Cancel any pending speech (e.g. on new hand to avoid pile-up). */
export function cancelSpeech(): void {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
}
