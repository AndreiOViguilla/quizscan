export function playSound(type) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const g = ctx.createGain(); g.connect(ctx.destination);
    if (type === "correct") {
      [523, 659, 784].forEach((f, i) => {
        const o = ctx.createOscillator(); o.type = "sine"; o.frequency.value = f; o.connect(g);
        g.gain.setValueAtTime(0.18, ctx.currentTime + i * 0.1);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.1 + 0.25);
        o.start(ctx.currentTime + i * 0.1); o.stop(ctx.currentTime + i * 0.1 + 0.25);
      });
    } else if (type === "wrong") {
      const o = ctx.createOscillator(); o.type = "sawtooth"; o.frequency.value = 180; o.connect(g);
      g.gain.setValueAtTime(0.15, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
      o.start(); o.stop(ctx.currentTime + 0.4);
    } else if (type === "flip") {
      const o = ctx.createOscillator(); o.type = "sine"; o.frequency.value = 440; o.connect(g);
      g.gain.setValueAtTime(0.08, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
      o.start(); o.stop(ctx.currentTime + 0.15);
    }
  } catch {}
}
