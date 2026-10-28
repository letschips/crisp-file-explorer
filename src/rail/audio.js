import { normalizePlaybackSoundStyle } from "../orb/styles.js";

export class CrispAudio {
  constructor() {
    this.contexts = new WeakMap();
    this.contextList = new Set();
    this.lastTickAt = 0;
    this.currentOwnerWindow = null;
  }

  ensureContext(ownerWindow) {
    const win = ownerWindow || (typeof window !== "undefined" ? window : null);
    if (!win) return null;
    const AudioContext = win.AudioContext || win.webkitAudioContext;
    if (!AudioContext) return null;
    let context = this.contexts.get(win);
    if (!context) {
      context = new AudioContext();
      this.contexts.set(win, context);
      this.contextList.add(context);
    }
    if (context.state === "suspended") {
      context.resume().catch(() => {});
    }
    return context;
  }

  async destroy() {
    const contexts = Array.from(this.contextList);
    this.contextList.clear();
    this.contexts = new WeakMap();
    await Promise.all(contexts.map(async (context) => {
      if (context && context.state !== "closed" && typeof context.close === "function") {
        await context.close();
      }
    }));
  }

  playTone(options) {
    const context = this.ensureContext(this.currentOwnerWindow);
    if (!context) return;

    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const duration = options.duration || 0.04;
    const attack = options.attack || 0.004;
    const release = options.release || 0.035;
    const volume = options.volume || 0.025;

    oscillator.type = options.type || "triangle";
    oscillator.frequency.setValueAtTime(options.frequency, now);
    if (options.frequencyEnd) {
      oscillator.frequency.exponentialRampToValueAtTime(options.frequencyEnd, now + duration);
    }

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration + release);

    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + duration + release + 0.01);
  }

  tick(style = "soft", progress = 0.5, pitchScale = false, ownerWindow) {
    this.currentOwnerWindow = ownerWindow;
    try {
      const now = performance.now();
      if (now - this.lastTickAt < 35) return;
      this.lastTickAt = now;

      let resolvedStyle = normalizePlaybackSoundStyle(style);
      if (resolvedStyle === "wood") resolvedStyle = "wooden";
      if (resolvedStyle === "digital") resolvedStyle = "mechanical";

      const clampedProgress = Math.max(0, Math.min(1, progress || 0));
      const pitchMultiplier = pitchScale ? Math.pow(2, clampedProgress - 0.5) : 1;
      const pitch = (frequency) => frequency * pitchMultiplier;

      if (resolvedStyle === "scale") {
        const pentatonicScale = [523.25, 587.33, 659.25, 783.99, 880.00, 1046.50, 1174.66, 1318.51, 1567.98, 1760.00];
        const index = Math.floor(clampedProgress * (pentatonicScale.length - 0.01));
        const freq = pentatonicScale[index];
        this.playTone({ type: "sine", frequency: freq, duration: 0.038, release: 0.032, volume: 0.024 });
      } else if (resolvedStyle === "wooden") {
        this.playTone({ type: "sine", frequency: pitch(720), frequencyEnd: pitch(360), duration: 0.022, release: 0.02, volume: 0.03 });
      } else if (resolvedStyle === "mechanical") {
        this.playTone({ type: "square", frequency: pitch(2600), frequencyEnd: pitch(1800), duration: 0.01, release: 0.012, volume: 0.016 });
      } else if (resolvedStyle === "raindrop") {
        this.playTone({ type: "sine", frequency: pitch(1850), frequencyEnd: pitch(620), duration: 0.035, release: 0.028, volume: 0.026 });
      } else if (resolvedStyle === "retro8bit") {
        this.playTone({ type: "square", frequency: pitch(987), frequencyEnd: pitch(1318), duration: 0.02, release: 0.018, volume: 0.018 });
      } else if (resolvedStyle === "watchgear") {
        this.playTone({ type: "triangle", frequency: pitch(3200), frequencyEnd: pitch(2400), duration: 0.008, release: 0.008, volume: 0.022 });
      } else if (resolvedStyle === "bubble") {
        this.playTone({ type: "sine", frequency: pitch(350), frequencyEnd: pitch(920), duration: 0.045, release: 0.035, volume: 0.024 });
      } else if (resolvedStyle === "bounce") {
        this.playTone({ type: "sine", frequency: pitch(460), frequencyEnd: pitch(280), duration: 0.028, release: 0.024, volume: 0.028 });
      } else if (resolvedStyle === "thump") {
        this.playTone({ type: "sine", frequency: pitch(210), frequencyEnd: pitch(120), duration: 0.03, release: 0.03, volume: 0.036 });
      } else if (resolvedStyle === "pop") {
        this.playTone({ type: "sine", frequency: pitch(620), frequencyEnd: pitch(1180), duration: 0.018, release: 0.016, volume: 0.024 });
      } else if (resolvedStyle === "chime") {
        this.playTone({ type: "sine", frequency: pitch(1568), duration: 0.03, release: 0.06, volume: 0.016 });
      } else if (resolvedStyle === "spark") {
        this.playTone({ type: "triangle", frequency: pitch(2400), frequencyEnd: pitch(3400), duration: 0.012, release: 0.014, volume: 0.016 });
      } else if (resolvedStyle === "bell") {
        this.playTone({ type: "sine", frequency: pitch(1318.51), duration: 0.035, release: 0.08, volume: 0.016 });
      } else {
        this.playTone({ type: "triangle", frequency: pitch(680), duration: 0.012, release: 0.012, volume: 0.02 });
      }
    } catch (error) {
      console.debug("Crisp File Explorer tick sound failed", error);
    } finally {
      this.currentOwnerWindow = null;
    }
  }

  release(style = "soft", ownerWindow) {
    this.currentOwnerWindow = ownerWindow;
    try {
      let resolvedStyle = normalizePlaybackSoundStyle(style);
      if (resolvedStyle === "wood") resolvedStyle = "wooden";
      if (resolvedStyle === "digital") resolvedStyle = "mechanical";

      if (resolvedStyle === "scale") {
        this.playTone({ type: "sine", frequency: 659.25, frequencyEnd: 1046.50, duration: 0.08, release: 0.06, volume: 0.025 });
      } else if (resolvedStyle === "wooden") {
        this.playTone({ type: "sine", frequency: 540, frequencyEnd: 260, duration: 0.05, release: 0.04, volume: 0.032 });
      } else if (resolvedStyle === "mechanical") {
        this.playTone({ type: "square", frequency: 2200, frequencyEnd: 950, duration: 0.035, release: 0.025, volume: 0.018 });
      } else if (resolvedStyle === "raindrop") {
        this.playTone({ type: "sine", frequency: 850, frequencyEnd: 1450, duration: 0.065, release: 0.05, volume: 0.028 });
      } else if (resolvedStyle === "retro8bit") {
        this.playTone({ type: "square", frequency: 1318, frequencyEnd: 1760, duration: 0.06, release: 0.04, volume: 0.02 });
      } else if (resolvedStyle === "watchgear") {
        this.playTone({ type: "triangle", frequency: 2400, frequencyEnd: 1200, duration: 0.03, release: 0.02, volume: 0.024 });
      } else if (resolvedStyle === "bubble") {
        this.playTone({ type: "sine", frequency: 280, frequencyEnd: 720, duration: 0.08, release: 0.05, volume: 0.028 });
      } else if (resolvedStyle === "bounce") {
        this.playTone({ type: "sine", frequency: 380, frequencyEnd: 200, duration: 0.07, release: 0.05, volume: 0.03 });
      } else if (resolvedStyle === "thump") {
        this.playTone({ type: "sine", frequency: 160, frequencyEnd: 80, duration: 0.08, release: 0.06, volume: 0.04 });
      } else if (resolvedStyle === "pop") {
        this.playTone({ type: "sine", frequency: 520, frequencyEnd: 1320, duration: 0.05, release: 0.04, volume: 0.026 });
      } else if (resolvedStyle === "chime") {
        this.playTone({ type: "sine", frequency: 1046.5, frequencyEnd: 1568, duration: 0.07, release: 0.12, volume: 0.02 });
      } else if (resolvedStyle === "spark") {
        this.playTone({ type: "triangle", frequency: 1800, frequencyEnd: 3200, duration: 0.05, release: 0.04, volume: 0.018 });
      } else if (resolvedStyle === "bell") {
        this.playTone({ type: "sine", frequency: 987.77, frequencyEnd: 1318.51, duration: 0.08, release: 0.16, volume: 0.02 });
      } else {
        this.playTone({ type: "sine", frequency: 320, frequencyEnd: 180, duration: 0.06, release: 0.05, volume: 0.026 });
      }
    } catch (error) {
      console.debug("Crisp File Explorer release sound failed", error);
    } finally {
      this.currentOwnerWindow = null;
    }
  }
}
