// ══════════════════════════════════════════════════════════════
// singergame.js — Singergame: sua voz guia uma bolinha de luz por um túnel.
// Cada anel representa uma nota; alcance a altura certa com a voz pra atravessar.
// Reaproveita: detectarPitchAutocorr (afinador.js), o perfil vocal da Avaliação,
// e as fórmulas de escala (ESCALAS_TREINO, de app.js) pro modo "por escala".
// ══════════════════════════════════════════════════════════════

const SG = {
  ativo: false, pausado: false,
  ctx: null, analyser: null, stream: null, raf: null,
  modo: "livre", dificuldade: "facil",
  perfilMin: 48, perfilMax: 72,          // MIDI (grave/agudo) — ajustado ao perfil vocal, se existir
  escalaBase: null, escalaIntervalos: null, escalaNome: "",
  anéisPassados: 0, proximoIndice: 0,
  pontos: 0, combo: 0, comboMaximo: 0, acertos: 0,
  freqAtualMidi: null, freqSuavMidi: null,
  historicoFreq: [],
  velocidade: 0.16,                       // "z por segundo" com que os anéis se aproximam
  ultimoFrame: 0,
  anéis: [],                              // {midi, z, julgado, acertou}
  cancelado: false,
};

const SG_DIFICULDADE = {
  facil:  { largura: 2.4, velocidade: 0.14, espaco: 2.6 },
  medio:  { largura: 1.6, velocidade: 0.19, espaco: 2.2 },
  dificil:{ largura: 1.0, velocidade: 0.25, espaco: 1.9 },
};

function sgMidiParaNome(midi) {
  const nomes = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const m = Math.round(midi);
  return nomes[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
}

// ── Sons (sintetizados — mesmo AudioContext do jogo, sem arquivo de áudio) ──
function sgTocarBlip(acertou) {
  const ctx = SG.ctx;
  if (!ctx) return;
  const t0 = ctx.currentTime;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = acertou ? "sine" : "triangle";
  const f0 = acertou ? 880 : 220;
  osc.frequency.setValueAtTime(f0, t0);
  osc.frequency.exponentialRampToValueAtTime(acertou ? 1760 : 160, t0 + (acertou ? 0.12 : 0.18));
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(acertou ? 0.22 : 0.16, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + (acertou ? 0.22 : 0.26));
  osc.connect(g).connect(ctx.destination);
  osc.start(t0); osc.stop(t0 + 0.3);
}

function sgTocarCombo(nivel) {
  const ctx = SG.ctx;
  if (!ctx || nivel < 3 || nivel % 3 !== 0) return;
  [0, 0.08, 0.16].forEach((atraso, i) => {
    const t0 = ctx.currentTime + atraso;
    const osc = ctx.createOscillator(); const g = ctx.createGain();
    osc.type = "sine"; osc.frequency.value = 660 * Math.pow(2, i / 12);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.14, t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);
    osc.connect(g).connect(ctx.destination); osc.start(t0); osc.stop(t0 + 0.2);
  });
}

// ── Geração de anéis conforme o modo ──
function sgProximaNotaLivre() {
  const min = SG.perfilMin, max = SG.perfilMax;
  return min + Math.floor(Math.random() * (max - min + 1));
}

function sgProximaNotaEscala(indice) {
  const base = SG.escalaBase, iv = SG.escalaIntervalos;
  const subida = [...iv]; // sobe e desce dentro da extensão do jogador, usando a escala
  const passo = subida[indice % subida.length];
  const volta = Math.floor(indice / subida.length) % 2 === 1;
  const oitava = Math.floor(indice / (subida.length * 2));
  return base + oitava * 12 + (volta ? subida[subida.length - 1] - passo : passo);
}

function sgGerarAnel(indice) {
  const midi = SG.modo === "escala" ? sgProximaNotaEscala(indice) : sgProximaNotaLivre();
  return { midi, z: 0, julgado: false, acertou: false };
}

// ── Loop principal ──
function sgLoop(agora) {
  if (!SG.ativo) return;
  SG.raf = requestAnimationFrame(sgLoop);
  if (SG.pausado) { SG.ultimoFrame = agora; return; }
  const dt = Math.min(0.05, (agora - (SG.ultimoFrame || agora)) / 1000);
  SG.ultimoFrame = agora;

  sgCapturarPitch();
  sgAtualizarAneis(dt);
  sgDesenhar();
}

function sgCapturarPitch() {
  if (!SG.analyser) return;
  const buffer = new Float32Array(SG.analyser.fftSize);
  SG.analyser.getFloatTimeDomainData(buffer);
  const freq = detectarPitchAutocorr(buffer, SG.ctx.sampleRate);
  if (freq === null) return;
  const midi = 69 + 12 * Math.log2(freq / 440);
  SG.historicoFreq.push(midi);
  if (SG.historicoFreq.length > 6) SG.historicoFreq.shift();
  const ordenado = [...SG.historicoFreq].sort((a, b) => a - b);
  SG.freqSuavMidi = ordenado[Math.floor(ordenado.length / 2)];
  SG.freqAtualMidi = midi;
}

function sgAtualizarAneis(dt) {
  const cfg = SG_DIFICULDADE[SG.dificuldade];
  // garante anéis suficientes à frente
  while (SG.anéis.length < 5) SG.anéis.push(sgGerarAnel(SG.proximoIndice++));

  SG.anéis.forEach((a) => { a.z += cfg.velocidade * dt / 0.14 * (SG.velocidade); });

  // o anel mais perto (maior z) é o que vale julgar
  const alvo = SG.anéis[0];
  if (alvo && alvo.z >= 0.92 && !alvo.julgado && SG.freqSuavMidi !== null) {
    const dist = Math.abs(SG.freqSuavMidi - alvo.midi);
    alvo.julgado = true;
    alvo.acertou = dist <= cfg.largura;
    sgRegistrarResultado(alvo.acertou);
  }
  if (alvo && alvo.z >= 1.08) {
    if (!alvo.julgado) { alvo.julgado = true; alvo.acertou = false; sgRegistrarResultado(false); }
    SG.anéis.shift();
    SG.anéisPassados++;
    document.getElementById("sgTotal").textContent = SG.anéisPassados;
    if (SG.anéisPassados >= 20) { sgFinalizar(); return; }
  }
}

function sgRegistrarResultado(acertou) {
  sgTocarBlip(acertou);
  if (acertou) {
    SG.acertos++; SG.combo++; SG.comboMaximo = Math.max(SG.comboMaximo, SG.combo);
    SG.pontos += 100 + SG.combo * 10;
    sgTocarCombo(SG.combo);
  } else {
    SG.combo = 0;
  }
  document.getElementById("sgPontos").textContent = SG.pontos.toLocaleString("pt-BR");
  document.getElementById("sgCombo").textContent = `combo x${SG.combo}`;
  document.getElementById("sgCombo").classList.toggle("sg-combo-ativo", SG.combo >= 3);
}

// ── Desenho (o mesmo truque de perspectiva do mockup aprovado) ──
function sgEl(id) { return document.getElementById(id); }

function sgDesenhar() {
  const canvas = sgEl("sgCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height, CX = W / 2;
  const HORIZONTE_Y = H * 0.30, CAMERA_Y = H * 0.92;
  const projetar = (z) => ({ y: HORIZONTE_Y + (CAMERA_Y - HORIZONTE_Y) * Math.pow(Math.min(1, z), 1.0), escala: 0.015 + Math.pow(Math.min(1, z), 1.6) * 1.0 });

  ctx.clearRect(0, 0, W, H);
  const fundo = ctx.createRadialGradient(CX, HORIZONTE_Y, 30, CX, HORIZONTE_Y, W * 1.1);
  fundo.addColorStop(0, "#241a12"); fundo.addColorStop(0.45, "#120c08"); fundo.addColorStop(1, "#030202");
  ctx.fillStyle = fundo; ctx.fillRect(0, 0, W, H);

  ctx.save();
  ctx.strokeStyle = "rgba(249,150,80,0.14)"; ctx.lineWidth = 1.2;
  for (let i = -6; i <= 6; i++) { if (i === 0) continue; ctx.beginPath(); ctx.moveTo(CX + i * 4, HORIZONTE_Y); ctx.lineTo(CX + i * W * 0.26, CAMERA_Y + 30); ctx.stroke(); }
  ctx.restore();

  const faixaMin = SG.modo === "escala" ? SG.escalaBase - 2 : SG.perfilMin;
  const faixaMax = SG.modo === "escala" ? SG.escalaBase + 14 : SG.perfilMax;

  SG.anéis.slice().reverse().forEach((a) => {
    const { y, escala } = projetar(a.z);
    const raioX = W * 0.23 * escala, raioY = H * 0.09 * escala;
    const posY = 1 - (a.midi - faixaMin) / Math.max(1, faixaMax - faixaMin);
    const centroAbertura = (posY - 0.5) * raioY * 1.7;
    const cor = a.julgado ? (a.acertou ? "34,211,238" : "239,68,68") : "249,115,22";
    const ativo = a === SG.anéis[0];
    ctx.save();
    ctx.translate(CX, y);
    ctx.strokeStyle = `rgba(120,90,60,${0.25 * escala + 0.08})`;
    ctx.lineWidth = Math.max(1, 8 * escala);
    ctx.beginPath(); ctx.ellipse(0, 0, raioX, raioY, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.shadowColor = `rgba(${cor},${ativo ? 0.95 : 0.4})`; ctx.shadowBlur = (ativo ? 40 : 16) * escala;
    ctx.strokeStyle = `rgba(${cor},${ativo ? 0.9 : 0.35})`;
    ctx.lineWidth = Math.max(2, 14 * escala);
    const meiaAlt = Math.max(3, raioY * 0.42);
    ctx.beginPath(); ctx.ellipse(0, centroAbertura, raioX * 0.78, meiaAlt, 0, Math.PI * 0.08, Math.PI * 0.92); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(0, centroAbertura, raioX * 0.78, meiaAlt, 0, Math.PI * 1.08, Math.PI * 1.92); ctx.stroke();
    ctx.restore();
  });

  // bolinha: posição horizontal fixa, altura = sua voz AGORA (dentro da faixa visível)
  const alvo = SG.anéis[0];
  if (alvo) sgEl("sgNotaAlvo").textContent = sgMidiParaNome(alvo.midi);
  const midiBola = SG.freqSuavMidi !== null ? SG.freqSuavMidi : (faixaMin + faixaMax) / 2;
  const posYBola = 1 - (midiBola - faixaMin) / Math.max(1, faixaMax - faixaMin);
  const raioYZ1 = H * 0.09 * projetar(1).escala;        // mesma escala do anel mais próximo (z=1), pra alinhar com as aberturas
  const yBolaClamp = CAMERA_Y + (posYBola - 0.5) * raioYZ1 * 1.7;
  const r = 22;
  ctx.save();
  ctx.shadowColor = "rgba(249,115,22,0.95)"; ctx.shadowBlur = 50;
  const g = ctx.createRadialGradient(CX - r * 0.3, yBolaClamp - r * 0.35, r * 0.1, CX, yBolaClamp, r);
  g.addColorStop(0, "#fff7ed"); g.addColorStop(0.35, "#fdba74"); g.addColorStop(0.7, "#f97316"); g.addColorStop(1, "#9a3412");
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(CX, yBolaClamp, r, 0, 7); ctx.fill();
  ctx.restore();

  const vinheta = ctx.createRadialGradient(CX, H * 0.5, H * 0.25, CX, H * 0.5, H * 0.8);
  vinheta.addColorStop(0, "rgba(0,0,0,0)"); vinheta.addColorStop(1, "rgba(0,0,0,0.55)");
  ctx.fillStyle = vinheta; ctx.fillRect(0, 0, W, H);
}

// ── Ciclo de vida ──
async function sgIniciar(modo, dificuldade) {
  const erro = sgEl("sgErro");
  erro.textContent = "";
  try {
    SG.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    erro.textContent = "Sem permissão de microfone.";
    return;
  }
  SG.ctx = new (window.AudioContext || window.webkitAudioContext)();
  const fonte = SG.ctx.createMediaStreamSource(SG.stream);
  SG.analyser = SG.ctx.createAnalyser();
  SG.analyser.fftSize = 4096;
  fonte.connect(SG.analyser);

  SG.modo = modo; SG.dificuldade = dificuldade;
  SG.anéisPassados = 0; SG.proximoIndice = 0; SG.pontos = 0; SG.combo = 0; SG.comboMaximo = 0; SG.acertos = 0;
  SG.anéis = []; SG.historicoFreq = []; SG.freqSuavMidi = null; SG.cancelado = false;

  if (modo === "escala") {
    const esc = (typeof escalaAtual === "function") ? escalaAtual() : null;
    const nome = esc ? `${esc.nota} ${esc.nome}` : "C4 maior";
    const base = esc ? 12 * (esc.oitava + 1) + NOMES_NOTAS.indexOf(esc.tonica) : 60;
    SG.escalaBase = base;
    SG.escalaIntervalos = esc ? esc.intervalos : [0, 2, 4, 5, 7, 9, 11, 12];
    SG.escalaNome = nome;
  } else {
    SG.escalaNome = "";
  }

  sgEl("sgConfig").hidden = true;
  sgEl("sgJogo").hidden = false;
  sgEl("sgFim").hidden = true;
  sgEl("sgPontos").textContent = "0";
  sgEl("sgCombo").textContent = "combo x0";
  sgEl("sgTotal").textContent = "0";

  SG.ativo = true; SG.pausado = false; SG.ultimoFrame = 0;
  SG.raf = requestAnimationFrame(sgLoop);
}

function sgPararMicrofone() {
  if (SG.stream) SG.stream.getTracks().forEach((t) => t.stop());
  if (SG.ctx) SG.ctx.close().catch(() => {});
  SG.stream = null; SG.ctx = null; SG.analyser = null;
}

async function sgFinalizar() {
  SG.ativo = false;
  cancelAnimationFrame(SG.raf);
  sgPararMicrofone();
  sgEl("sgJogo").hidden = true;
  sgEl("sgFim").hidden = false;
  sgEl("sgFimPontos").textContent = SG.pontos.toLocaleString("pt-BR");
  sgEl("sgFimDetalhe").textContent = `${SG.acertos} de ${SG.anéisPassados} notas certas · combo máximo x${SG.comboMaximo}`;

  const form = new FormData();
  form.append("modo", SG.modo);
  form.append("dificuldade", SG.dificuldade);
  form.append("pontos", String(SG.pontos));
  form.append("acertos", String(SG.acertos));
  form.append("total", String(SG.anéisPassados));
  form.append("combo_maximo", String(SG.comboMaximo));
  if (SG.escalaNome) form.append("escala_nome", SG.escalaNome);
  try {
    const resp = await fetch(`${API_BASE}/api/singergame/pontuacao`, { method: "POST", body: form });
    const dados = await resp.json();
    sgEl("sgFimRecorde").textContent = dados.bateu_recorde
      ? "🏆 Novo recorde nesse modo!"
      : `Recorde atual: ${Number(dados.recorde).toLocaleString("pt-BR")} pontos`;
  } catch (err) {
    sgEl("sgFimRecorde").textContent = "";
  }
}

function sgCancelar() {
  if (!SG.ativo) return;
  SG.ativo = false; SG.cancelado = true;
  cancelAnimationFrame(SG.raf);
  sgPararMicrofone();
  sgEl("sgJogo").hidden = true;
  sgEl("sgConfig").hidden = false;
}

function sgVoltarConfig() {
  sgEl("sgFim").hidden = true;
  sgEl("sgConfig").hidden = false;
}

async function sgCarregarRecordes() {
  try {
    const resp = await fetch(`${API_BASE}/api/singergame/recordes`);
    const dados = await resp.json();
    const lista = sgEl("sgRecordes");
    lista.replaceChildren();
    const rotulos = { livre_facil: "Livre · Fácil", livre_medio: "Livre · Médio", livre_dificil: "Livre · Difícil", escala_facil: "Escala · Fácil", escala_medio: "Escala · Médio", escala_dificil: "Escala · Difícil" };
    const chaves = Object.keys(dados.recordes || {});
    if (!chaves.length) { lista.appendChild(Object.assign(document.createElement("p"), { className: "oh-hint", textContent: "Ainda sem recordes — jogue uma partida!" })); return; }
    chaves.forEach((k) => {
      const r = dados.recordes[k];
      const li = document.createElement("div");
      li.className = "sg-recorde-item";
      li.textContent = `${rotulos[k] || k}: ${Number(r.pontos).toLocaleString("pt-BR")} pontos`;
      lista.appendChild(li);
    });
  } catch (err) { /* sem recordes carregados: tela fica sem essa lista, sem travar */ }
}

function sgInicializar() {
  const botao = document.querySelector('.oh-nav-item[data-page="singergame"]');
  const canvas = sgEl("sgCanvas");
  if (!botao || !canvas) return;

  // ajusta o perfil vocal, se já existir (perfil vem como "C3", "G#4" etc.)
  fetch(`${API_BASE}/api/avaliacao/perfil`).then((r) => r.json()).then((p) => {
    if (p && p.nota_grave && p.nota_aguda) {
      const paraMidi = (n) => { const m = n.match(/^([A-G]#?)(\d)$/); if (!m) return null; const nomes = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"]; return 12 * (parseInt(m[2],10)+1) + nomes.indexOf(m[1]); };
      const min = paraMidi(p.nota_grave), max = paraMidi(p.nota_aguda);
      if (min !== null && max !== null && max > min) { SG.perfilMin = min; SG.perfilMax = max; }
    }
  }).catch(() => {});

  botao.addEventListener("click", sgCarregarRecordes);
  document.querySelectorAll(".sg-modo-btn").forEach((b) => {
    b.addEventListener("click", () => sgIniciar(b.dataset.modo, sgEl("sgDificuldade").value));
  });
  sgEl("btnSgCancelar").addEventListener("click", sgCancelar);
  sgEl("btnSgJogarDeNovo").addEventListener("click", sgVoltarConfig);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", sgInicializar);
else sgInicializar();
