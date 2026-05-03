type SoundName = "correct" | "wrong" | "skip" | "start" | "gameOver" | "tick";

let audioContext: AudioContext | null = null;

function getContext() {
  audioContext ??= new AudioContext();
  return audioContext;
}

export function playSound(name: SoundName, enabled: boolean) {
  if (!enabled) return;

  try {
    const context = getContext();
    const now = context.currentTime;

    if (context.state === "suspended") {
      void context.resume();
    }

    if (name === "correct") {
      tone(context, 523.25, now, 0.09, "sine", 0.055);
      tone(context, 659.25, now + 0.08, 0.11, "sine", 0.05);
      tone(context, 783.99, now + 0.17, 0.14, "sine", 0.045);
      return;
    }

    if (name === "wrong") {
      tone(context, 190, now, 0.16, "sawtooth", 0.045);
      tone(context, 150, now + 0.1, 0.18, "sawtooth", 0.035);
      return;
    }

    if (name === "skip") {
      tone(context, 330, now, 0.08, "square", 0.04);
      tone(context, 247, now + 0.08, 0.11, "square", 0.032);
      return;
    }

    if (name === "gameOver") {
      tone(context, 392, now, 0.16, "triangle", 0.05);
      tone(context, 311, now + 0.16, 0.16, "triangle", 0.045);
      tone(context, 262, now + 0.32, 0.28, "triangle", 0.04);
      return;
    }

    if (name === "tick") {
      tone(context, 840, now, 0.035, "square", 0.018);
      return;
    }

    tone(context, 440, now, 0.07, "sine", 0.035);
  } catch {
    // Browser audio can fail before a user gesture; the game should stay silent and playable.
  }
}

function tone(
  context: AudioContext,
  frequency: number,
  start: number,
  duration: number,
  type: OscillatorType,
  volume: number
) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.03);
}
