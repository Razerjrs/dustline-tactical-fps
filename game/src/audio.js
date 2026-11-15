// Synthesized sound only: every effect is built from oscillators and filtered noise
// in a WebAudio graph. No audio files, no network. The context starts on the first
// user gesture; in headless captures it simply stays silent.
export function createAudio() {
  let ctx = null;
  let master = null;
  let noiseBuffer = null;

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return true;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
      noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 1, ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
      return true;
    } catch {
      return false;
    }
  }

  function noise(when, duration, filterType, frequency, gainValue, quality = 1) {
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer;
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = frequency;
    filter.Q.value = quality;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainValue, when);
    gain.gain.exponentialRampToValueAtTime(0.001, when + duration);
    source.connect(filter).connect(gain).connect(master);
    source.start(when);
    source.stop(when + duration + 0.02);
  }

  function tone(when, duration, type, fromFreq, toFreq, gainValue) {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(fromFreq, when);
    if (toFreq !== fromFreq) osc.frequency.exponentialRampToValueAtTime(Math.max(1, toFreq), when + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainValue, when);
    gain.gain.exponentialRampToValueAtTime(0.001, when + duration);
    osc.connect(gain).connect(master);
    osc.start(when);
    osc.stop(when + duration + 0.02);
  }

  function play(fn) {
    if (!ensure()) return;
    try {
      fn(ctx.currentTime);
    } catch {
      // Audio is decoration; a failure must never break the game.
    }
  }

  const SHOTS = {
    pistol: { noise: [0.09, 'lowpass', 2600, 0.5], tone: [0.07, 'square', 190, 60, 0.22] },
    smg: { noise: [0.07, 'bandpass', 3200, 0.42], tone: [0.05, 'square', 240, 90, 0.18] },
    rifle: { noise: [0.13, 'lowpass', 1800, 0.6], tone: [0.1, 'sawtooth', 150, 45, 0.3] },
    sniper: { noise: [0.28, 'lowpass', 1200, 0.85], tone: [0.2, 'sawtooth', 110, 30, 0.4] },
    enemy: { noise: [0.1, 'lowpass', 1400, 0.22], tone: [0.08, 'square', 130, 50, 0.1] },
  };

  return {
    unlock() { ensure(); },
    shot(kind) {
      const def = SHOTS[kind] || SHOTS.rifle;
      play((t) => {
        noise(t, def.noise[0], def.noise[1], def.noise[2], def.noise[3]);
        tone(t, def.tone[0], def.tone[1], def.tone[2], def.tone[3], def.tone[4]);
      });
    },
    dryFire() {
      play((t) => tone(t, 0.03, 'square', 900, 700, 0.12));
    },
    reload() {
      play((t) => {
        tone(t, 0.04, 'square', 500, 400, 0.12);
        tone(t + 0.22, 0.04, 'square', 700, 600, 0.12);
        tone(t + 0.55, 0.05, 'square', 420, 520, 0.16);
      });
    },
    hit() {
      play((t) => tone(t, 0.05, 'sine', 1400, 1400, 0.2));
    },
    kill() {
      play((t) => {
        tone(t, 0.07, 'sine', 1250, 1250, 0.22);
        tone(t + 0.08, 0.1, 'sine', 1660, 1660, 0.22);
      });
    },
    hurt() {
      play((t) => {
        noise(t, 0.12, 'lowpass', 500, 0.35);
        tone(t, 0.12, 'sine', 140, 70, 0.25);
      });
    },
    footstep() {
      play((t) => noise(t, 0.05, 'lowpass', 420, 0.08));
    },
    buy() {
      play((t) => {
        tone(t, 0.08, 'sine', 880, 880, 0.2);
        tone(t + 0.09, 0.12, 'sine', 1318, 1318, 0.2);
      });
    },
    denied() {
      play((t) => tone(t, 0.12, 'square', 220, 160, 0.14));
    },
    beep(final = false) {
      play((t) => tone(t, final ? 0.3 : 0.09, 'sine', final ? 1900 : 1500, final ? 1900 : 1500, 0.25));
    },
    plant() {
      play((t) => {
        tone(t, 0.12, 'square', 620, 620, 0.16);
        tone(t + 0.16, 0.12, 'square', 620, 620, 0.16);
        tone(t + 0.32, 0.2, 'square', 930, 930, 0.18);
      });
    },
    defuse() {
      play((t) => {
        tone(t, 0.1, 'sine', 1046, 1046, 0.2);
        tone(t + 0.12, 0.1, 'sine', 1318, 1318, 0.2);
        tone(t + 0.24, 0.18, 'sine', 1568, 1568, 0.2);
      });
    },
    explosion() {
      play((t) => {
        noise(t, 0.9, 'lowpass', 900, 0.9);
        tone(t, 0.7, 'sine', 90, 28, 0.7);
        noise(t + 0.05, 0.4, 'bandpass', 300, 0.5);
      });
    },
    roundWin() {
      play((t) => {
        tone(t, 0.14, 'sine', 523, 523, 0.2);
        tone(t + 0.14, 0.14, 'sine', 659, 659, 0.2);
        tone(t + 0.28, 0.26, 'sine', 784, 784, 0.22);
      });
    },
    roundLose() {
      play((t) => {
        tone(t, 0.18, 'sine', 392, 392, 0.2);
        tone(t + 0.18, 0.18, 'sine', 330, 330, 0.2);
        tone(t + 0.36, 0.3, 'sine', 262, 262, 0.22);
      });
    },
  };
}
