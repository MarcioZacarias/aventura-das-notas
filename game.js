'use strict';

// ===== CONFIG =====
// step = position on the staff in half-line units. 0 = top staff line, 8 = bottom line,
// 9 = first space below bottom, 10 = first ledger line below.
const CLEFS = {
  sol: {
    label: 'Sol',
    symbol: '𝄞',
    glyphScale: 1.6,
    glyphOffsetY: 0.05,
    centerStep: 6,
    notes: [
      { id: 'C4', button: 'do',  label: 'Dó',  freq: 261.63, step: 10 },
      { id: 'D4', button: 're',  label: 'Ré',  freq: 293.66, step: 9 },
      { id: 'E4', button: 'mi',  label: 'Mi',  freq: 329.63, step: 8 },
      { id: 'F4', button: 'fa',  label: 'Fá',  freq: 349.23, step: 7 },
      { id: 'G4', button: 'sol', label: 'Sol', freq: 392.00, step: 6 },
      { id: 'A4', button: 'la',  label: 'Lá',  freq: 440.00, step: 5 },
      { id: 'B4', button: 'si',  label: 'Si',  freq: 493.88, step: 4 },
      { id: 'C5', button: 'do',  label: 'Dó',  freq: 523.25, step: 3 },
      { id: 'D5', button: 're',  label: 'Ré',  freq: 587.33, step: 2 },
      { id: 'E5', button: 'mi',  label: 'Mi',  freq: 659.25, step: 1 },
      { id: 'F5', button: 'fa',  label: 'Fá',  freq: 698.46, step: 0 }
    ]
  },
  fa: {
    label: 'Fá',
    symbol: '𝄢',
    glyphScale: 1.25,
    glyphOffsetY: -0.08,
    centerStep: 2,
    notes: [
      { id: 'E2', button: 'mi',  label: 'Mi',  freq: 82.41,  step: 10 },
      { id: 'F2', button: 'fa',  label: 'Fá',  freq: 87.31,  step: 9 },
      { id: 'G2', button: 'sol', label: 'Sol', freq: 98.00,  step: 8 },
      { id: 'A2', button: 'la',  label: 'Lá',  freq: 110.00, step: 7 },
      { id: 'B2', button: 'si',  label: 'Si',  freq: 123.47, step: 6 },
      { id: 'C3', button: 'do',  label: 'Dó',  freq: 130.81, step: 5 },
      { id: 'D3', button: 're',  label: 'Ré',  freq: 146.83, step: 4 },
      { id: 'E3', button: 'mi',  label: 'Mi',  freq: 164.81, step: 3 },
      { id: 'F3', button: 'fa',  label: 'Fá',  freq: 174.61, step: 2 },
      { id: 'G3', button: 'sol', label: 'Sol', freq: 196.00, step: 1 },
      { id: 'A3', button: 'la',  label: 'Lá',  freq: 220.00, step: 0 }
    ]
  },
  do: {
    label: 'Dó (3ª linha)',
    symbol: '𝄡',
    glyphScale: 1.45,
    glyphOffsetY: 0,
    centerStep: 4,
    notes: [
      { id: 'D3', button: 're',  label: 'Ré',  freq: 146.83, step: 10 },
      { id: 'E3', button: 'mi',  label: 'Mi',  freq: 164.81, step: 9 },
      { id: 'F3', button: 'fa',  label: 'Fá',  freq: 174.61, step: 8 },
      { id: 'G3', button: 'sol', label: 'Sol', freq: 196.00, step: 7 },
      { id: 'A3', button: 'la',  label: 'Lá',  freq: 220.00, step: 6 },
      { id: 'B3', button: 'si',  label: 'Si',  freq: 246.94, step: 5 },
      { id: 'C4', button: 'do',  label: 'Dó',  freq: 261.63, step: 4 },
      { id: 'D4', button: 're',  label: 'Ré',  freq: 293.66, step: 3 },
      { id: 'E4', button: 'mi',  label: 'Mi',  freq: 329.63, step: 2 },
      { id: 'F4', button: 'fa',  label: 'Fá',  freq: 349.23, step: 1 },
      { id: 'G4', button: 'sol', label: 'Sol', freq: 392.00, step: 0 }
    ]
  }
};

// ===== AUDIO =====
let audioCtx = null;
let muted = false;

function getAudioCtx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function playNote(freq, duration) {
  if (muted) return;
  duration = duration || 0.6;
  try {
    const c = getAudioCtx();
    const now = c.currentTime;
    const osc1 = c.createOscillator();
    const osc2 = c.createOscillator();
    const gain = c.createGain();
    const filter = c.createBiquadFilter();
    const vibrato = c.createOscillator();
    const vibratoGain = c.createGain();
    osc1.type = 'sawtooth';
    osc2.type = 'triangle';
    osc1.frequency.value = freq;
    osc2.frequency.value = freq;
    vibrato.frequency.value = 5;
    vibratoGain.gain.value = freq * 0.005;
    vibrato.connect(vibratoGain);
    vibratoGain.connect(osc1.frequency);
    vibratoGain.connect(osc2.frequency);
    filter.type = 'lowpass';
    filter.frequency.value = freq * 4;
    filter.Q.value = 1;
    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(gain);
    gain.connect(c.destination);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.18, now + 0.06);
    gain.gain.linearRampToValueAtTime(0.14, now + 0.15);
    gain.gain.linearRampToValueAtTime(0, now + duration);
    osc1.start(now); osc2.start(now); vibrato.start(now);
    osc1.stop(now + duration); osc2.stop(now + duration); vibrato.stop(now + duration);
  } catch (e) { console.warn(e); }
}

function playFx(type) {
  if (muted) return;
  try {
    const c = getAudioCtx();
    const now = c.currentTime;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.connect(gain);
    gain.connect(c.destination);
    if (type === 'correct') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(523.25, now);
      osc.frequency.setValueAtTime(659.25, now + 0.08);
      osc.frequency.setValueAtTime(783.99, now + 0.16);
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.2, now + 0.02);
      gain.gain.linearRampToValueAtTime(0, now + 0.3);
      osc.start(now); osc.stop(now + 0.3);
    } else {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(330, now);
      osc.frequency.exponentialRampToValueAtTime(180, now + 0.3);
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.18, now + 0.02);
      gain.gain.linearRampToValueAtTime(0, now + 0.35);
      osc.start(now); osc.stop(now + 0.35);
    }
  } catch (e) { console.warn(e); }
}

// ===== CANVAS =====
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
let W = 0, H = 0, dpr = 1;

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  dpr = window.devicePixelRatio || 1;
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  W = rect.width;
  H = rect.height;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function getLayout() {
  const lineSpacing = Math.min(22, H / 12);
  const staffHeight = lineSpacing * 4;
  const staffTop = (H - staffHeight) / 2 - lineSpacing * 0.5;
  return {
    lineSpacing: lineSpacing,
    staffTop: staffTop,
    staffBottom: staffTop + staffHeight,
    clefX: 14,
    clefWidth: 50,
    hitX: 90,
    spawnX: W + 30,
    despawnX: -40
  };
}

function noteY(step, layout) {
  return layout.staffTop + (step * layout.lineSpacing / 2);
}

function drawClef(clefDef, x, yCenter, h) {
  ctx.save();
  ctx.fillStyle = '#3e2723';
  ctx.font = (h * clefDef.glyphScale) + 'px "Bravura Text", "Noto Music", "Apple Symbols", serif';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(clefDef.symbol, x, yCenter + h * clefDef.glyphOffsetY);
  ctx.restore();
}

function drawStaff(layout) {
  ctx.save();
  ctx.strokeStyle = '#5d4037';
  ctx.lineWidth = 1.5;
  ctx.lineCap = 'round';
  for (let i = 0; i < 5; i++) {
    const y = layout.staffTop + i * layout.lineSpacing;
    ctx.beginPath();
    ctx.moveTo(8, y);
    ctx.lineTo(W - 8, y);
    ctx.stroke();
  }
  const clefDef = CLEFS[state.currentClef];
  const clefCenterY = noteY(clefDef.centerStep, layout);
  drawClef(clefDef, layout.clefX, clefCenterY, layout.lineSpacing * 4);

  const grad = ctx.createLinearGradient(layout.hitX - 22, 0, layout.hitX + 22, 0);
  grad.addColorStop(0, 'rgba(255, 193, 7, 0)');
  grad.addColorStop(0.5, 'rgba(255, 193, 7, 0.35)');
  grad.addColorStop(1, 'rgba(255, 193, 7, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(layout.hitX - 22, layout.staffTop - 30, 44, layout.lineSpacing * 4 + 60);

  ctx.strokeStyle = 'rgba(255, 152, 0, 0.6)';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(layout.hitX, layout.staffTop - 35);
  ctx.lineTo(layout.hitX, layout.staffTop + layout.lineSpacing * 4 + 35);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

function drawNote(note, layout) {
  const y = noteY(note.step, layout);
  const x = note.x;
  const ls = layout.lineSpacing;
  const headW = ls * 0.9;
  const headH = ls * 0.7;
  ctx.save();
  if (note.step >= 10) {
    ctx.strokeStyle = '#5d4037';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(x - headW * 0.8, y);
    ctx.lineTo(x + headW * 0.8, y);
    ctx.stroke();
  }
  const stemDown = note.step <= 4;
  ctx.strokeStyle = '#3e2723';
  ctx.lineWidth = 2;
  ctx.beginPath();
  if (stemDown) {
    ctx.moveTo(x - headW * 0.42, y);
    ctx.lineTo(x - headW * 0.42, y + ls * 3.2);
  } else {
    ctx.moveTo(x + headW * 0.42, y);
    ctx.lineTo(x + headW * 0.42, y - ls * 3.2);
  }
  ctx.stroke();
  ctx.fillStyle = note.flash ? '#ff5722' : '#3e2723';
  ctx.beginPath();
  ctx.ellipse(x, y, headW / 2, headH / 2, -0.35, 0, Math.PI * 2);
  ctx.fill();
  if (note.inHitZone) {
    ctx.strokeStyle = 'rgba(255, 193, 7, 0.9)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(x, y, headW / 2 + 4, headH / 2 + 4, -0.35, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

// ===== STATE =====
const state = {
  running: false,
  score: 0,
  lives: 3,
  level: 1,
  notes: [],
  speed: 90,
  spawnInterval: 2400,
  lastSpawnTime: 0,
  lastTime: 0,
  consecutiveCorrect: 0,
  notesPlayed: 0,
  currentClef: 'sol'
};

function pickNextNote() {
  const clef = CLEFS[state.currentClef];
  const staffOnly = state.level <= 2;
  const pool = staffOnly ? clef.notes.filter(n => n.step >= 0 && n.step <= 8) : clef.notes;
  const last = state.notes.length > 0 ? state.notes[state.notes.length - 1] : null;
  let pick, attempts = 0;
  do {
    pick = pool[Math.floor(Math.random() * pool.length)];
    attempts++;
  } while (last && pick.id === last.id && attempts < 4);
  return pick;
}

function spawnNote() {
  const layout = getLayout();
  const def = pickNextNote();
  state.notes.push({
    id: def.id, button: def.button, label: def.label, freq: def.freq, step: def.step,
    x: layout.spawnX, flash: false, inHitZone: false, answered: false, soundPlayed: false
  });
  state.notesPlayed++;
}

function updateGame(dt) {
  const layout = getLayout();
  const speed = state.speed * (1 + (state.level - 1) * 0.15);
  state.lastSpawnTime += dt;
  if (state.lastSpawnTime >= state.spawnInterval) {
    spawnNote();
    state.lastSpawnTime = 0;
  }
  for (let i = state.notes.length - 1; i >= 0; i--) {
    const n = state.notes[i];
    n.x -= speed * dt / 1000;
    if (!n.soundPlayed && n.x < W * 0.85) {
      playNote(n.freq, 0.5);
      n.soundPlayed = true;
    }
    n.inHitZone = Math.abs(n.x - layout.hitX) < 30;
    if (!n.answered && n.x < layout.hitX - 35) {
      handleMiss(n);
      n.answered = true;
    }
    if (n.x < layout.despawnX) {
      state.notes.splice(i, 1);
    }
  }
  const targetLevel = 1 + Math.floor(state.score / 8);
  if (targetLevel > state.level) {
    state.level = targetLevel;
    document.getElementById('level').textContent = state.level;
    state.spawnInterval = Math.max(900, 2400 - (state.level - 1) * 150);
  }
}

function render() {
  ctx.clearRect(0, 0, W, H);
  const layout = getLayout();
  drawStaff(layout);
  for (const n of state.notes) drawNote(n, layout);
}

let rafId = null;
function gameLoop(t) {
  if (!state.running) return;
  if (!state.lastTime) state.lastTime = t;
  const dt = Math.min(50, t - state.lastTime);
  state.lastTime = t;
  updateGame(dt);
  render();
  rafId = requestAnimationFrame(gameLoop);
}

// ===== INPUT =====
function handleAnswer(buttonId) {
  if (!state.running) return;
  const layout = getLayout();
  let target = null, bestDist = Infinity;
  for (const n of state.notes) {
    if (n.answered) continue;
    const d = Math.abs(n.x - layout.hitX);
    if (n.x > layout.hitX - 35 && d < bestDist) {
      bestDist = d; target = n;
    }
  }
  if (!target) {
    flashFeedback('wrong', 'Espera!');
    return;
  }
  const correct = target.button === buttonId;
  target.answered = true;
  if (correct) {
    state.score++;
    state.consecutiveCorrect++;
    document.getElementById('score').textContent = state.score;
    flashFeedback('correct', randomCheer());
    target.flash = true;
    playFx('correct');
    setTimeout(() => {
      const idx = state.notes.indexOf(target);
      if (idx >= 0) state.notes.splice(idx, 1);
    }, 120);
  } else {
    state.consecutiveCorrect = 0;
    loseLife();
    flashFeedback('wrong', 'Era ' + target.label + '!');
    playFx('wrong');
    setTimeout(() => {
      const idx = state.notes.indexOf(target);
      if (idx >= 0) state.notes.splice(idx, 1);
    }, 200);
  }
}

function handleMiss(note) {
  state.consecutiveCorrect = 0;
  loseLife();
  flashFeedback('wrong', 'Era ' + note.label + '!');
  playFx('wrong');
}

function loseLife() {
  state.lives--;
  updateHearts();
  if (state.lives <= 0) endGame();
}

function updateHearts() {
  let html = '';
  for (let i = 0; i < 3; i++) {
    if (i < state.lives) html += '❤';
    else html += '<span class="heart-empty">❤</span>';
  }
  document.getElementById('hearts').innerHTML = html;
}

const cheers = ['Perfeito!', 'Mandou bem!', 'Show!', 'Isso!', 'Boa!', 'Acertou!', 'Lindo!'];
function randomCheer() {
  return cheers[Math.floor(Math.random() * cheers.length)];
}

const flashEl = document.getElementById('flash');
const feedbackTextEl = document.getElementById('feedbackText');
let flashTimeout = null;
function flashFeedback(type, text) {
  flashEl.className = 'feedback-flash ' + type;
  feedbackTextEl.className = 'feedback-text ' + type + ' show';
  feedbackTextEl.textContent = text;
  clearTimeout(flashTimeout);
  flashTimeout = setTimeout(() => {
    flashEl.className = 'feedback-flash';
    feedbackTextEl.className = 'feedback-text ' + type;
  }, 500);
}

// ===== LIFECYCLE =====
function startGame(clefKey) {
  if (clefKey && CLEFS[clefKey]) state.currentClef = clefKey;
  document.getElementById('startScreen').classList.add('hidden');
  document.getElementById('endScreen').classList.add('hidden');
  document.getElementById('header').style.display = 'flex';
  document.getElementById('staffArea').style.display = 'flex';
  document.getElementById('buttons').style.display = 'grid';
  state.running = true;
  state.score = 0;
  state.lives = 3;
  state.level = 1;
  state.notes = [];
  state.lastSpawnTime = 1500;
  state.lastTime = 0;
  state.consecutiveCorrect = 0;
  state.notesPlayed = 0;
  state.spawnInterval = 2400;
  document.getElementById('score').textContent = '0';
  document.getElementById('level').textContent = '1';
  updateHearts();
  getAudioCtx();
  setTimeout(resizeCanvas, 50);
  rafId = requestAnimationFrame(gameLoop);
}

function endGame() {
  state.running = false;
  if (rafId) cancelAnimationFrame(rafId);
  state.notes = [];
  document.getElementById('finalScore').textContent = state.score;
  document.getElementById('finalLevel').textContent = state.level;
  document.getElementById('finalClef').textContent = CLEFS[state.currentClef].label;
  let title, msg, mascot;
  if (state.score >= 30) { title = 'Incrível!'; msg = 'Você é um(a) grande músico(a)!'; mascot = '🏆'; }
  else if (state.score >= 15) { title = 'Muito bom!'; msg = 'Você está aprendendo rápido!'; mascot = '🎉'; }
  else if (state.score >= 5) { title = 'Boa tentativa!'; msg = 'Pratique mais um pouco!'; mascot = '🎻'; }
  else { title = 'Tente de novo!'; msg = 'A prática leva à perfeição. Você consegue!'; mascot = '💪'; }
  document.getElementById('endTitle').textContent = title;
  document.getElementById('endMessage').textContent = msg;
  document.getElementById('endMascot').textContent = mascot;
  setTimeout(() => {
    document.getElementById('endScreen').classList.remove('hidden');
  }, 600);
}

// ===== EVENTS =====
document.querySelectorAll('.clef-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    getAudioCtx();
    startGame(btn.dataset.clef);
  });
});
document.getElementById('restartBtn').addEventListener('click', () => startGame());
document.getElementById('changeClefBtn').addEventListener('click', () => {
  document.getElementById('endScreen').classList.add('hidden');
  document.getElementById('header').style.display = 'none';
  document.getElementById('staffArea').style.display = 'none';
  document.getElementById('buttons').style.display = 'none';
  document.getElementById('startScreen').classList.remove('hidden');
});
document.querySelectorAll('.note-btn').forEach(btn => {
  const handler = (e) => {
    e.preventDefault();
    handleAnswer(btn.dataset.note);
  };
  btn.addEventListener('touchstart', handler, { passive: false });
  btn.addEventListener('mousedown', handler);
});
document.getElementById('muteBtn').addEventListener('click', () => {
  muted = !muted;
  document.getElementById('muteBtn').textContent = muted ? '🔇' : '🔊';
});

function setRealVH() {
  const vh = window.innerHeight * 0.01;
  document.documentElement.style.setProperty('--vh', vh + 'px');
  resizeCanvas();
}
window.addEventListener('resize', setRealVH);
window.addEventListener('orientationchange', () => setTimeout(setRealVH, 150));
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', setRealVH);
}
setRealVH();

document.addEventListener('gesturestart', e => e.preventDefault());
let lastTouchEnd = 0;
document.addEventListener('touchend', e => {
  const now = Date.now();
  if (now - lastTouchEnd <= 300) e.preventDefault();
  lastTouchEnd = now;
}, false);

setTimeout(resizeCanvas, 50);
