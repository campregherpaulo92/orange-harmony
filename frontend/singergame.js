// ══════════════════════════════════════════════════════════════
// singergame.js — Singergame: sua voz guia uma bolinha de luz por um túnel.
// Cada anel é uma nota; cante a altura certa enquanto ele atravessa a "zona de julgamento".
// v2: afinômetro em tempo real (você vê o quanto está agudo/grave, em cents), tolerância
// precisa por dificuldade, anéis espaçados no tempo, e julgamento por TEMPO na nota (não por
// um instante só). Reaproveita detectarPitchAutocorr (afinador.js), o perfil vocal da
// Avaliação e as fórmulas de escala (ESCALAS_TREINO / escalaAtual, de app.js).
// ══════════════════════════════════════════════════════════════

let SG_TOTAL_ANEIS = 20;
const SG_JANELA_INICIO = 0.70;           // o anel entra na "zona de julgamento" em z = 0.70 e sai em z = 1.0

// tolCents: quão perto da nota você precisa estar (100 cents = 1 semitom).
// minimo: fração do tempo dentro da zona em que você precisa estar na tolerância.
// velocidade: z por segundo (o anel nasce em z=0 e chega em z=1). espaco: z entre um anel e o seguinte.
const SG_DIFICULDADE = {
  facil:   { tolCents: 75, velocidade: 0.20, espaco: 0.55, minimo: 0.40 },
  medio:   { tolCents: 50, velocidade: 0.26, espaco: 0.50, minimo: 0.45 },
  dificil: { tolCents: 25, velocidade: 0.34, espaco: 0.46, minimo: 0.50 },
};

const SG = {
  ativo: false, ctx: null, analyser: null, stream: null, raf: null,
  modo: "livre", dificuldade: "facil", qualquerOitava: true,
  perfilMin: 48, perfilMax: 72,
  escalaBase: null, escalaIntervalos: null, escalaNome: "",
  aneis: [], proximoIndice: 0, passados: 0,
  pontos: 0, combo: 0, comboMaximo: 0, acertos: 0, errosAbs: [],
  freqSuavMidi: null, historicoFreq: [], ultimoFrame: 0, semSomFrames: 0,
  leitura: { dev: null, nome: null },     // o que o jogador está cantando AGORA em relação ao anel da frente
  feedbackTimer: null,
};

const SG_NOMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
function sgNome(midi) { const m = Math.round(midi); return SG_NOMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1); }
function sgEl(id) { return document.getElementById(id); }

// ── Sons (sintetizados no navegador) ──
function sgTocarBlip(acertou) {
  const ctx = SG.ctx; if (!ctx) return;
  const t0 = ctx.currentTime, osc = ctx.createOscillator(), g = ctx.createGain();
  osc.type = acertou ? "sine" : "triangle";
  osc.frequency.setValueAtTime(acertou ? 880 : 220, t0);
  osc.frequency.exponentialRampToValueAtTime(acertou ? 1760 : 160, t0 + (acertou ? 0.12 : 0.18));
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(acertou ? 0.22 : 0.16, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + (acertou ? 0.22 : 0.26));
  osc.connect(g).connect(ctx.destination); osc.start(t0); osc.stop(t0 + 0.3);
}
function sgTocarCombo(nivel) {
  const ctx = SG.ctx; if (!ctx || nivel < 3 || nivel % 3 !== 0) return;
  [0, 0.08, 0.16].forEach((atraso, i) => {
    const t0 = ctx.currentTime + atraso, osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = "sine"; osc.frequency.value = 660 * Math.pow(2, i / 12);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.14, t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);
    osc.connect(g).connect(ctx.destination); osc.start(t0); osc.stop(t0 + 0.2);
  });
}

// ── Notas dos anéis ──
function sgNotaDoAnel(indice) {
  if (SG.modo === "escala") {
    const iv = SG.escalaIntervalos, n = iv.length;
    const volta = Math.floor(indice / n) % 2 === 1;
    const passo = iv[indice % n];
    return SG.escalaBase + (volta ? iv[n - 1] - passo : passo);
  }
  return SG.perfilMin + Math.floor(Math.random() * (SG.perfilMax - SG.perfilMin + 1));
}
function sgNovoAnel(indice) { return { midi: sgNotaDoAnel(indice), z: 0, julgado: false, acertou: false, frames: 0, dentro: 0, desvios: [] }; }

// quanto a voz está acima (+) ou abaixo (−) do alvo, em semitons; com "qualquer oitava" dobra para a oitava mais próxima
function sgDesvio(vozMidi, alvoMidi) {
  const d = vozMidi - alvoMidi;
  return SG.qualquerOitava ? ((d % 12) + 18) % 12 - 6 : d;
}

// ── Captura de voz ──
function sgCapturarPitch() {
  if (!SG.analyser) return;
  const buffer = new Float32Array(SG.analyser.fftSize);
  SG.analyser.getFloatTimeDomainData(buffer);
  const freq = detectarPitchAutocorr(buffer, SG.ctx.sampleRate);
  if (freq === null || freq === undefined) {
    SG.semSomFrames++;
    if (SG.semSomFrames > 8) { SG.freqSuavMidi = null; SG.historicoFreq = []; }      // silêncio de uns 8 quadros: some a leitura
    return;
  }
  SG.semSomFrames = 0;
  SG.historicoFreq.push(69 + 12 * Math.log2(freq / 440));
  if (SG.historicoFreq.length > 5) SG.historicoFreq.shift();
  const ord = [...SG.historicoFreq].sort((a, b) => a - b);
  SG.freqSuavMidi = ord[Math.floor(ord.length / 2)];
}

// ── Regras do jogo ──
function sgAtualizar(dt) {
  const cfg = SG_DIFICULDADE[SG.dificuldade];
  const ultimo = SG.aneis[SG.aneis.length - 1];
  if (SG.proximoIndice < SG_TOTAL_ANEIS && (!ultimo || ultimo.z >= cfg.espaco)) SG.aneis.push(sgNovoAnel(SG.proximoIndice++));
  SG.aneis.forEach((a) => { a.z += cfg.velocidade * dt; });

  const alvo = SG.aneis[0];
  if (!alvo) return;

  // leitura em tempo real (alimenta o afinômetro)
  if (SG.freqSuavMidi !== null) SG.leitura = { dev: sgDesvio(SG.freqSuavMidi, alvo.midi) * 100, nome: sgNome(SG.freqSuavMidi) };
  else SG.leitura = { dev: null, nome: null };

  // dentro da zona de julgamento: conta quanto tempo você ficou na tolerância
  if (alvo.z >= SG_JANELA_INICIO && alvo.z < 1.0) {
    alvo.frames++;
    if (SG.leitura.dev !== null) {
      alvo.desvios.push(SG.leitura.dev);
      if (Math.abs(SG.leitura.dev) <= cfg.tolCents) alvo.dentro++;
    }
  }
  if (alvo.z >= 1.0 && !alvo.julgado) sgJulgar(alvo, cfg);

  if (alvo.z >= 1.12) {
    SG.aneis.shift();
    SG.passados++;
    sgEl("sgTotal").textContent = SG.passados;
    if (SG.passados >= SG_TOTAL_ANEIS) sgFinalizar();
  }
}

function sgMediana(v) { const o = [...v].sort((a, b) => a - b); return o.length ? o[Math.floor(o.length / 2)] : null; }

function sgJulgar(alvo, cfg) {
  alvo.julgado = true;
  const fracao = alvo.frames ? alvo.dentro / alvo.frames : 0;
  const med = sgMediana(alvo.desvios);                    // erro "típico" nessa nota, em cents (+ agudo / − grave)
  alvo.acertou = fracao >= cfg.minimo;
  if (med !== null) SG.errosAbs.push(Math.abs(med));

  let texto, cor;
  if (med === null) { texto = "Sem som — cante!"; cor = "#9ca3af"; }
  else if (alvo.acertou) {
    const perfeito = Math.abs(med) <= cfg.tolCents / 2;
    texto = perfeito ? "Perfeito! 🎯" : "Boa!"; cor = perfeito ? "#22d3ee" : "#4ade80";
  } else {
    const c = Math.round(Math.abs(med)), sinal = med > 0 ? "+" : "−";
    texto = fracao > 0 ? `Quase — segure mais tempo na nota (${sinal}${c}¢)` : (med > 0 ? `Agudo demais (+${c}¢)` : `Grave demais (−${c}¢)`);
    cor = "#f87171";
  }
  sgMostrarFeedback(texto, cor);
  sgTocarBlip(alvo.acertou);
  if (alvo.acertou) {
    SG.acertos++; SG.combo++; SG.comboMaximo = Math.max(SG.comboMaximo, SG.combo);
    SG.pontos += 100 + SG.combo * 10 + Math.round(fracao * 50);
    sgTocarCombo(SG.combo);
  } else {
    SG.combo = 0;
  }
  sgEl("sgPontos").textContent = SG.pontos.toLocaleString("pt-BR");
  sgEl("sgCombo").textContent = `combo x${SG.combo}`;
  sgEl("sgCombo").classList.toggle("sg-combo-ativo", SG.combo >= 3);
}

function sgMostrarFeedback(texto, cor) {
  const el = sgEl("sgFeedback"); if (!el) return;
  el.textContent = texto; el.style.color = cor; el.classList.add("sg-feedback-ativo");
  clearTimeout(SG.feedbackTimer);
  SG.feedbackTimer = setTimeout(() => el.classList.remove("sg-feedback-ativo"), 1300);
}

// ── Desenho ──
function sgArredondado(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

function sgDesenharAfinometro(ctx, alvo, cfg) {
  const x = 84, topo = 118, base = 518, centro = (topo + base) / 2, pxPorCent = ((base - topo) / 2) / 300;
  ctx.save();
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(255,255,255,0.6)"; ctx.font = "800 13px Nunito, sans-serif"; ctx.fillText("AFINÔMETRO", x, topo - 44);
  ctx.fillStyle = "rgba(255,255,255,0.38)"; ctx.font = "700 11px Nunito, sans-serif"; ctx.fillText("▲ agudo", x, topo - 24); ctx.fillText("▼ grave", x, base + 26);

  ctx.fillStyle = "rgba(255,255,255,0.07)"; sgArredondado(ctx, x - 8, topo, 16, base - topo, 8); ctx.fill();
  // faixa de acerto = a tolerância da dificuldade
  const meia = cfg.tolCents * pxPorCent;
  ctx.fillStyle = "rgba(74,222,128,0.30)"; ctx.fillRect(x - 13, centro - meia, 26, meia * 2);
  ctx.fillStyle = "rgba(74,222,128,0.85)"; ctx.font = "700 10px Nunito, sans-serif"; ctx.textAlign = "left";
  ctx.fillText(`±${cfg.tolCents}¢`, x + 18, centro - meia - 3);

  // marcas de semitom (100¢) com o nome das notas vizinhas
  ctx.font = "600 11px Nunito, sans-serif";
  for (let k = -3; k <= 3; k++) {
    if (k === 0) continue;
    const y = centro - k * 100 * pxPorCent;
    ctx.strokeStyle = "rgba(255,255,255,0.18)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x - 12, y); ctx.lineTo(x + 12, y); ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.4)"; ctx.fillText(sgNome(alvo.midi + k), x + 18, y + 4);
  }
  // alvo
  ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x - 18, centro); ctx.lineTo(x + 18, centro); ctx.stroke();
  ctx.fillStyle = "#f97316"; ctx.font = "800 13px Nunito, sans-serif"; ctx.fillText(sgNome(alvo.midi), x + 22, centro + 5);

  // sua voz
  const dev = SG.leitura.dev;
  if (dev !== null) {
    const limitado = Math.max(-300, Math.min(300, dev));
    const y = centro - limitado * pxPorCent;
    const abs = Math.abs(dev);
    const cor = abs <= cfg.tolCents ? "#4ade80" : abs <= cfg.tolCents * 2 ? "#fbbf24" : "#ef4444";
    ctx.shadowColor = cor; ctx.shadowBlur = 18; ctx.fillStyle = cor;
    ctx.beginPath(); ctx.arc(x, y, 11, 0, 7); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#fff"; ctx.textAlign = "right"; ctx.font = "800 12px Nunito, sans-serif";
    ctx.fillText(`${dev > 0 ? "+" : dev < 0 ? "−" : ""}${Math.round(abs)}¢`, x - 18, y + 4);
    ctx.textAlign = "center"; ctx.fillStyle = "rgba(255,255,255,0.85)"; ctx.font = "700 13px Nunito, sans-serif";
    const dica = abs <= cfg.tolCents ? "na nota ✓" : dev > 0 ? "desça um pouco ▼" : "suba um pouco ▲";
    ctx.fillText(`Você: ${SG.leitura.nome} · ${dica}`, x + 20, base + 52);
  } else {
    ctx.textAlign = "center"; ctx.fillStyle = "rgba(255,255,255,0.35)"; ctx.font = "700 12px Nunito, sans-serif";
    ctx.fillText("cante para aparecer aqui", x + 24, base + 52);
  }
  ctx.restore();
}

function sgDesenhar() {
  const canvas = sgEl("sgCanvas"); if (!canvas) return;
  const ctx = canvas.getContext("2d"), W = canvas.width, H = canvas.height, CX = W * 0.58;
  const HORIZONTE_Y = H * 0.30, CAMERA_Y = H * 0.88;
  const cfg = SG_DIFICULDADE[SG.dificuldade];
  const projetar = (z) => { const zz = Math.min(1.1, z); return { y: HORIZONTE_Y + (CAMERA_Y - HORIZONTE_Y) * zz, escala: 0.015 + Math.pow(zz, 1.6) }; };

  ctx.clearRect(0, 0, W, H);
  const fundo = ctx.createRadialGradient(CX, HORIZONTE_Y, 30, CX, HORIZONTE_Y, W);
  fundo.addColorStop(0, "#241a12"); fundo.addColorStop(0.45, "#120c08"); fundo.addColorStop(1, "#030202");
  ctx.fillStyle = fundo; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "rgba(249,150,80,0.14)"; ctx.lineWidth = 1.2;
  for (let i = -6; i <= 6; i++) { if (i === 0) continue; ctx.beginPath(); ctx.moveTo(CX + i * 4, HORIZONTE_Y); ctx.lineTo(CX + i * W * 0.23, CAMERA_Y + 40); ctx.stroke(); }

  const faixaMin = SG.modo === "escala" ? SG.escalaBase - 2 : SG.perfilMin;
  const faixaMax = SG.modo === "escala" ? SG.escalaBase + 14 : SG.perfilMax;
  const posY = (midi) => 1 - (midi - faixaMin) / Math.max(1, faixaMax - faixaMin);

  SG.aneis.slice().reverse().forEach((a) => {
    const { y, escala } = projetar(a.z);
    const raioX = W * 0.20 * escala, raioY = H * 0.085 * escala, centroAb = (posY(a.midi) - 0.5) * raioY * 1.7;
    const ativo = a === SG.aneis[0], naZona = ativo && a.z >= SG_JANELA_INICIO && !a.julgado;
    const prog = a.frames ? a.dentro / a.frames : 0;
    const cor = a.julgado ? (a.acertou ? "34,211,238" : "239,68,68") : (naZona && prog >= cfg.minimo ? "74,222,128" : "249,115,22");
    ctx.save(); ctx.translate(CX, y);
    ctx.strokeStyle = `rgba(120,90,60,${0.25 * escala + 0.08})`; ctx.lineWidth = Math.max(1, 8 * escala);
    ctx.beginPath(); ctx.ellipse(0, 0, raioX, raioY, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.shadowColor = `rgba(${cor},${ativo ? 0.95 : 0.4})`; ctx.shadowBlur = (ativo ? 40 : 16) * escala;
    ctx.strokeStyle = `rgba(${cor},${ativo ? 0.92 : 0.35})`; ctx.lineWidth = Math.max(2, 14 * escala);
    const meiaAlt = Math.max(3, raioY * 0.42);
    ctx.beginPath(); ctx.ellipse(0, centroAb, raioX * 0.78, meiaAlt, 0, Math.PI * 0.08, Math.PI * 0.92); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(0, centroAb, raioX * 0.78, meiaAlt, 0, Math.PI * 1.08, Math.PI * 1.92); ctx.stroke();
    ctx.restore();
  });

  // bolinha: altura = sua voz em relação ao anel da frente (mesma escala da abertura desse anel)
  const alvo = SG.aneis[0];
  if (alvo) sgEl("sgNotaAlvo").textContent = sgNome(alvo.midi);
  let midiBola = (faixaMin + faixaMax) / 2;
  if (SG.freqSuavMidi !== null) midiBola = alvo ? alvo.midi + sgDesvio(SG.freqSuavMidi, alvo.midi) : SG.freqSuavMidi;
  const raioYz1 = H * 0.085 * projetar(1).escala;
  const yBola = CAMERA_Y + (posY(midiBola) - 0.5) * raioYz1 * 1.7;
  const r = 20;
  ctx.save(); ctx.shadowColor = "rgba(249,115,22,0.95)"; ctx.shadowBlur = 48;
  const g = ctx.createRadialGradient(CX - r * 0.3, yBola - r * 0.35, r * 0.1, CX, yBola, r);
  g.addColorStop(0, "#fff7ed"); g.addColorStop(0.35, "#fdba74"); g.addColorStop(0.7, "#f97316"); g.addColorStop(1, "#9a3412");
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(CX, yBola, r, 0, 7); ctx.fill(); ctx.restore();

  const vinheta = ctx.createRadialGradient(CX, H * 0.5, H * 0.25, CX, H * 0.5, H * 0.85);
  vinheta.addColorStop(0, "rgba(0,0,0,0)"); vinheta.addColorStop(1, "rgba(0,0,0,0.5)");
  ctx.fillStyle = vinheta; ctx.fillRect(0, 0, W, H);

  if (alvo) sgDesenharAfinometro(ctx, alvo, cfg);
}

function sgLoop(agora) {
  if (!SG.ativo) return;
  SG.raf = requestAnimationFrame(sgLoop);
  const dt = Math.min(0.05, (agora - (SG.ultimoFrame || agora)) / 1000);
  SG.ultimoFrame = agora;
  sgCapturarPitch();
  sgAtualizar(dt);
  if (SG.ativo) sgDesenhar();
}

// ── Ciclo de vida ──
async function sgIniciar(modo, dificuldade) {
  const erro = sgEl("sgErro"); erro.textContent = "";
  try { SG.stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch (e) { erro.textContent = "Sem permissão de microfone."; return; }
  SG.ctx = new (window.AudioContext || window.webkitAudioContext)();
  const fonte = SG.ctx.createMediaStreamSource(SG.stream);
  SG.analyser = SG.ctx.createAnalyser(); SG.analyser.fftSize = 4096; fonte.connect(SG.analyser);

  SG.modo = modo; SG.dificuldade = dificuldade; SG.qualquerOitava = sgEl("sgQualquerOitava").checked;
  SG.aneis = []; SG.proximoIndice = 0; SG.passados = 0;
  SG.pontos = 0; SG.combo = 0; SG.comboMaximo = 0; SG.acertos = 0; SG.errosAbs = [];
  SG.historicoFreq = []; SG.freqSuavMidi = null; SG.leitura = { dev: null, nome: null }; SG.semSomFrames = 0;

  if (modo === "escala" && typeof escalaAtual === "function") {
    const esc = escalaAtual();
    SG.escalaBase = 12 * (esc.oitava + 1) + NOMES_NOTAS.indexOf(esc.tonica);
    SG.escalaIntervalos = [...esc.intervalos, 12];
    SG.escalaNome = `${esc.nota} ${esc.nome}`;
  } else if (modo === "escala") {
    SG.escalaBase = 60; SG.escalaIntervalos = [0, 2, 4, 5, 7, 9, 11, 12]; SG.escalaNome = "C4 maior";
  } else {
    SG.escalaNome = "";
  }

  sgEl("sgConfig").hidden = true; sgEl("sgJogo").hidden = false; sgEl("sgFim").hidden = true;
  sgEl("sgPontos").textContent = "0"; sgEl("sgCombo").textContent = "combo x0"; sgEl("sgTotal").textContent = "0";
  sgEl("sgMeta").textContent = SG_TOTAL_ANEIS; sgEl("sgFeedback").classList.remove("sg-feedback-ativo");
  SG.ativo = true; SG.ultimoFrame = 0;
  SG.raf = requestAnimationFrame(sgLoop);
}

function sgPararMicrofone() {
  if (SG.stream) SG.stream.getTracks().forEach((t) => t.stop());
  if (SG.ctx) SG.ctx.close().catch(() => {});
  SG.stream = null; SG.ctx = null; SG.analyser = null;
}

async function sgFinalizar() {
  SG.ativo = false; cancelAnimationFrame(SG.raf); sgPararMicrofone();
  sgEl("sgJogo").hidden = true; sgEl("sgFim").hidden = false;
  const cfg = SG_DIFICULDADE[SG.dificuldade];
  const medio = SG.errosAbs.length ? Math.round(SG.errosAbs.reduce((a, b) => a + b, 0) / SG.errosAbs.length) : null;
  sgEl("sgFimPontos").textContent = SG.pontos.toLocaleString("pt-BR");
  sgEl("sgFimDetalhe").textContent = `${SG.acertos} de ${SG.passados} notas certas · combo máximo x${SG.comboMaximo}` +
    (medio !== null ? ` · erro médio ${medio}¢ (tolerância ±${cfg.tolCents}¢)` : "");

  const form = new FormData();
  form.append("modo", SG.modo); form.append("dificuldade", `${SG.dificuldade}_v2`);       // v2 = regras novas (os recordes antigos eram de outro jogo)
  form.append("pontos", String(SG.pontos)); form.append("acertos", String(SG.acertos));
  form.append("total", String(SG.passados)); form.append("combo_maximo", String(SG.comboMaximo));
  if (SG.escalaNome) form.append("escala_nome", SG.escalaNome);
  try {
    const dados = await (await fetch(`${API_BASE}/api/singergame/pontuacao`, { method: "POST", body: form })).json();
    sgEl("sgFimRecorde").textContent = dados.bateu_recorde ? "🏆 Novo recorde nesse modo!" : `Recorde atual: ${Number(dados.recorde).toLocaleString("pt-BR")} pontos`;
  } catch (err) { sgEl("sgFimRecorde").textContent = ""; }
}

function sgCancelar() {
  if (!SG.ativo) return;
  SG.ativo = false; cancelAnimationFrame(SG.raf); sgPararMicrofone();
  sgEl("sgJogo").hidden = true; sgEl("sgConfig").hidden = false;
}
function sgVoltarConfig() { sgEl("sgFim").hidden = true; sgEl("sgConfig").hidden = false; sgCarregarRecordes(); }

async function sgCarregarRecordes() {
  try {
    const dados = await (await fetch(`${API_BASE}/api/singergame/recordes`)).json();
    const lista = sgEl("sgRecordes"); lista.replaceChildren();
    const nomes = { livre: "Livre", escala: "Escala" }, dif = { facil: "Fácil", medio: "Médio", dificil: "Difícil" };
    const chaves = Object.keys(dados.recordes || {}).filter((k) => k.endsWith("_v2"));
    if (!chaves.length) { const p = document.createElement("p"); p.className = "oh-hint"; p.textContent = "Ainda sem recordes — jogue uma partida!"; lista.appendChild(p); return; }
    chaves.forEach((k) => {
      const [modo, d] = k.replace("_v2", "").split("_");
      const li = document.createElement("div"); li.className = "sg-recorde-item";
      li.textContent = `${nomes[modo] || modo} · ${dif[d] || d}: ${Number(dados.recordes[k].pontos).toLocaleString("pt-BR")} pontos`;
      lista.appendChild(li);
    });
  } catch (err) { /* sem recordes: a tela segue sem essa lista */ }
}

function sgInicializar() {
  const botao = document.querySelector('.oh-nav-item[data-page="singergame"]');
  if (!botao || !sgEl("sgCanvas")) return;
  fetch(`${API_BASE}/api/avaliacao/perfil`).then((r) => r.json()).then((p) => {
    if (p && p.nota_grave && p.nota_aguda) {
      const paraMidi = (n) => { const m = n.match(/^([A-G]#?)(\d)$/); return m ? 12 * (parseInt(m[2], 10) + 1) + SG_NOMES.indexOf(m[1]) : null; };
      const min = paraMidi(p.nota_grave), max = paraMidi(p.nota_aguda);
      if (min !== null && max !== null && max > min) { SG.perfilMin = min; SG.perfilMax = max; }
    }
  }).catch(() => {});
  botao.addEventListener("click", sgCarregarRecordes);
  document.querySelectorAll(".sg-modo-btn").forEach((b) => b.addEventListener("click", () => sgIniciar(b.dataset.modo, sgEl("sgDificuldade").value)));
  sgEl("btnSgCancelar").addEventListener("click", sgCancelar);
  sgEl("btnSgJogarDeNovo").addEventListener("click", sgVoltarConfig);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", sgInicializar);
else sgInicializar();
