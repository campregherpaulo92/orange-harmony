// ══════════════════════════════════════════════════════════════
// vocalise.js — Vocalise ("eu faço, você copia"), terceiro modo do Singergame.
// O piano toca um padrão (bolinhas num arco), depois vem uma contagem e é a SUA vez:
// você canta o mesmo padrão no mesmo andamento. A cada rodada o padrão sobe meio tom
// e depois desce. Cada bolinha é julgada pelo CENTRO da nota (a mediana do que você cantou
// na janela dela), com a margem da dificuldade escolhida (±75 / ±50 / ±25 cents).
// Reaproveita: piano (obterPiano / sintetizarNotaPiano, app.js), detecção de voz
// (detectarPitchAutocorr, afinador.js), perfil vocal e opção "qualquer oitava" (singergame.js).
// O piano e a voz NUNCA soam ao mesmo tempo: na vez do aluno não sai som nenhum — assim o
// microfone não capta o piano e não precisa de fone de ouvido.
// ══════════════════════════════════════════════════════════════

let VZ_RODADAS = 6;
const VZ_LATENCIA = 0.10;                 // s — tempo de reação da voz + atraso do microfone
const VZ_VELOCIDADES = { lento: 60, medio: 90, rapido: 130 };           // BPM (uma nota por tempo)
const VZ_TOL = { facil: 75, medio: 50, dificil: 25 };                    // cents (mesmo seletor dos outros modos)
const VZ_PADROES = {
  escadinha: { nome: "Escadinha (escala subindo e descendo)", offsets: [0, 2, 4, 5, 7, 5, 4, 2, 0], vogais: ["i", "i", "e", "e", "a", "a", "a", "a", "a"] },
  arpejo:    { nome: "Arpejo maior (ida e volta)",            offsets: [0, 4, 7, 12, 7, 4, 0],     vogais: ["i", "i", "e", "a", "e", "i", "i"] },
  terca:     { nome: "Alternando duas notas (terça)",         offsets: [0, 4, 0, 4, 0, 4, 0],      vogais: ["i", "i", "i", "i", "i", "i", "i"] },
};

const VZ = {
  ativo: false, ctx: null, analyser: null, stream: null, fonte: null, raf: null,
  padrao: "escadinha", vel: "medio", dif: "medio", beat: 1, tol: 50, oitava: true,
  raizes: [], rodadaIdx: 0, rodada: null, fase: "parado",
  pontos: 0, combo: 0, comboMaximo: 0, acertos: 0, total: 0, errosAbs: [], porRodada: [],
  voz: null, rastro: [],
  // nota que deveria estar sendo cantada AGORA (null fora da vez do aluno) — usado pelos testes
  alvoAgora() {
    const r = VZ.rodada;
    if (!r || !VZ.ctx) return null;
    const i = Math.floor((VZ.ctx.currentTime - r.singStart - VZ_LATENCIA) / VZ.beat);
    return i >= 0 && i < r.notas.length ? r.notas[i] : null;
  },
};

function vzEl(id) { return document.getElementById(id); }
function vzHz(midi) { return 440 * Math.pow(2, (midi - 69) / 12); }

// quanto a voz está acima (+) ou abaixo (−) do alvo, em semitons (dobra para a oitava mais próxima se permitido)
function vzDesvio(vozMidi, alvoMidi) {
  const d = vozMidi - alvoMidi;
  return VZ.oitava ? ((d % 12) + 18) % 12 - 6 : d;
}
function vzMediana(v) { const o = [...v].sort((a, b) => a - b); return o.length ? o[Math.floor(o.length / 2)] : null; }

// raízes de cada rodada: sobe meio tom por rodada e volta (dentro da extensão do aluno)
function vzRaizes(n, span, perfilMin, perfilMax) {
  const rMin = perfilMin, rMax = Math.max(perfilMin, perfilMax - span);
  const base = Math.max(rMin, Math.min(rMax, Math.round((rMin + rMax) / 2) - 1));
  const zigue = [0, 1, 2, 3, 2, 1];
  return Array.from({ length: n }, (_, i) => Math.max(rMin, Math.min(rMax, base + zigue[i % zigue.length])));
}

function vzTick(ctx, quando, forte) {
  const osc = ctx.createOscillator(), g = ctx.createGain();
  osc.type = "sine"; osc.frequency.value = forte ? 1500 : 1100;
  g.gain.setValueAtTime(0.0001, quando); g.gain.exponentialRampToValueAtTime(0.16, quando + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, quando + 0.07);
  osc.connect(g).connect(ctx.destination); osc.start(quando); osc.stop(quando + 0.1);
}

// ── Uma rodada: piano toca → contagem → vez do aluno → resultado ──
function vzIniciarRodada() {
  const { ctx, entrada } = obterPiano();
  const padrao = VZ_PADROES[VZ.padrao], beat = VZ.beat, raiz = VZ.raizes[VZ.rodadaIdx];
  const notas = padrao.offsets.map((o) => raiz + o), n = notas.length;
  const T0 = ctx.currentTime + 0.3, listenStart = T0 + 0.5, listenEnd = listenStart + n * beat;
  const tick1 = listenEnd + 0.6, tick2 = tick1 + beat, singStart = tick2 + beat;
  const singEnd = singStart + n * beat + VZ_LATENCIA + 0.15;

  notas.forEach((m, i) => sintetizarNotaPiano(ctx, entrada, vzHz(m), listenStart + i * beat, Math.max(1.2, beat * 1.6), 1));
  vzTick(ctx, tick1, true); vzTick(ctx, tick2, false);

  VZ.rodada = {
    raiz, notas, vogais: padrao.vogais, T0, listenStart, listenEnd, tick1, tick2, singStart, singEnd, fim: singEnd + 1.6,
    devs: notas.map(() => []), resultados: notas.map(() => null),
  };
  VZ.rastro = [];
  vzEl("vzRodada").textContent = `Rodada ${VZ.rodadaIdx + 1} de ${VZ.raizes.length} · começa em ${sgNome(raiz)}`;
}

// ── Voz ──
function vzCapturarPitch(t) {
  if (!VZ.analyser) return;
  const buffer = new Float32Array(VZ.analyser.fftSize);
  VZ.analyser.getFloatTimeDomainData(buffer);
  const freq = detectarPitchAutocorr(buffer, VZ.ctx.sampleRate);
  if (freq === null || freq === undefined) return;
  const midi = 69 + 12 * Math.log2(freq / 440);
  VZ.voz = { midi, t };
  const r = VZ.rodada;
  if (!r) return;
  // só vale dentro da janela de cada bolinha (pula o começo, quando a voz ainda está chegando na nota)
  const x = (t - r.singStart - VZ_LATENCIA) / VZ.beat, i = Math.floor(x), f = x - i;
  if (i >= 0 && i < r.notas.length && f >= 0.28 && f <= 0.92) r.devs[i].push(vzDesvio(midi, r.notas[i]) * 100);
}

function vzJulgar(i) {
  const r = VZ.rodada, devs = r.devs[i];
  const med = devs.length >= 4 ? vzMediana(devs) : null;                 // poucos quadros com voz = "sem som"
  const ok = med !== null && Math.abs(med) <= VZ.tol;
  r.resultados[i] = { ok, dev: med };
  VZ.total++;
  if (med !== null) VZ.errosAbs.push(Math.abs(med));
  if (ok) {
    VZ.acertos++; VZ.combo++; VZ.comboMaximo = Math.max(VZ.comboMaximo, VZ.combo);
    VZ.pontos += 100 + VZ.combo * 10 + Math.round(50 * (1 - Math.abs(med) / VZ.tol));
  } else {
    VZ.combo = 0;
  }
  vzEl("vzPontos").textContent = VZ.pontos.toLocaleString("pt-BR");
  vzEl("vzCombo").textContent = `combo x${VZ.combo}`;
}

// ── Desenho ──
function vzDesenhar(t, fase) {
  const canvas = vzEl("vzCanvas"); if (!canvas) return;
  const ctx = canvas.getContext("2d"), W = canvas.width, H = canvas.height, r = VZ.rodada, n = r.notas.length;
  const fundo = ctx.createLinearGradient(0, 0, 0, H);
  fundo.addColorStop(0, "#1a1410"); fundo.addColorStop(1, "#070504");
  ctx.fillStyle = fundo; ctx.fillRect(0, 0, W, H);

  const minM = Math.min(...r.notas), maxM = Math.max(...r.notas), margem = 64;
  const px = (i) => margem + (n > 1 ? (i * (W - 2 * margem)) / (n - 1) : (W - 2 * margem) / 2);
  const py = (m) => H * 0.78 - ((m - minM) / Math.max(1, maxM - minM)) * (H * 0.52);

  ctx.strokeStyle = "rgba(249,150,80,0.22)"; ctx.lineWidth = 2; ctx.beginPath();            // o arco que liga as notas
  r.notas.forEach((m, i) => (i ? ctx.lineTo(px(i), py(m)) : ctx.moveTo(px(i), py(m)))); ctx.stroke();

  const idxCanto = fase === "cantar" ? Math.floor((t - r.singStart - VZ_LATENCIA) / VZ.beat) : -1;
  r.notas.forEach((m, i) => {
    const x = px(i), y = py(m), res = r.resultados[i];
    const tocando = fase === "ouvir" && t >= r.listenStart + i * VZ.beat && t < r.listenStart + (i + 1) * VZ.beat;
    const alvo = i === idxCanto;
    ctx.save();
    ctx.shadowBlur = 0;
    let preenchimento = "rgba(18,18,18,0.96)", borda = "rgba(255,255,255,0.28)", largura = 2;
    if (tocando) { preenchimento = "#3a1a08"; borda = "#f97316"; largura = 4; ctx.shadowColor = "rgba(249,115,22,0.95)"; ctx.shadowBlur = 28; }
    if (alvo) { borda = "#ffffff"; largura = 4; ctx.shadowColor = "rgba(255,255,255,0.8)"; ctx.shadowBlur = 24; }
    if (res) { preenchimento = res.dev === null ? "#4b5563" : res.ok ? "rgba(34,197,94,0.92)" : "rgba(239,68,68,0.92)"; borda = "rgba(255,255,255,0.5)"; }
    ctx.fillStyle = preenchimento; ctx.strokeStyle = borda; ctx.lineWidth = largura;
    ctx.beginPath(); ctx.arc(x, y, 24, 0, 7); ctx.fill(); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#fff"; ctx.font = "800 21px Nunito, sans-serif"; ctx.textAlign = "center";
    ctx.fillText(r.vogais[i], x, y + 7);
    ctx.fillStyle = "rgba(255,255,255,0.38)"; ctx.font = "700 11px Nunito, sans-serif";
    ctx.fillText(sgNome(m), x, y + 42);
    if (res) {
      ctx.fillStyle = res.dev === null ? "#9ca3af" : res.ok ? "#86efac" : "#fca5a5"; ctx.font = "800 12px Nunito, sans-serif";
      ctx.fillText(res.dev === null ? "sem som" : `${res.dev > 0 ? "+" : res.dev < 0 ? "−" : ""}${Math.round(Math.abs(res.dev))}¢`, x, y - 34);
    }
    ctx.restore();
  });

  // sua voz ao vivo (só na sua vez): um pontinho que sobe e desce junto com a sua nota
  if (fase === "cantar") {
    const xf = Math.max(0, Math.min(n - 1, (t - r.singStart - VZ_LATENCIA) / VZ.beat - 0.5));
    if (VZ.voz && t - VZ.voz.t < 0.15 && idxCanto >= 0 && idxCanto < n) {
      const m = r.notas[idxCanto] + vzDesvio(VZ.voz.midi, r.notas[idxCanto]);
      const x = margem + (n > 1 ? (xf * (W - 2 * margem)) / (n - 1) : 0);
      VZ.rastro.push({ x, y: Math.max(24, Math.min(H - 24, py(m))), t });
    }
    VZ.rastro = VZ.rastro.filter((p) => t - p.t < 0.9);
    VZ.rastro.forEach((p) => { ctx.fillStyle = `rgba(249,150,80,${Math.max(0, 0.55 - (t - p.t) * 0.6)})`; ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, 7); ctx.fill(); });
    const ult = VZ.rastro[VZ.rastro.length - 1];
    if (ult && t - ult.t < 0.15) {
      ctx.save(); ctx.shadowColor = "rgba(249,115,22,0.95)"; ctx.shadowBlur = 24; ctx.fillStyle = "#f97316";
      ctx.beginPath(); ctx.arc(ult.x, ult.y, 9, 0, 7); ctx.fill(); ctx.restore();
    }
  }

  // mensagem grande no topo
  let msg = "";
  if (fase === "preparar") msg = "Prepare-se…";
  else if (fase === "ouvir") msg = "🎧 Ouça";
  else if (fase === "contagem") msg = t >= r.tick2 ? "2" : t >= r.tick1 ? "1" : "Já já é a sua vez…";
  else if (fase === "cantar") msg = "🎤 Sua vez!";
  else if (fase === "resultado") { const ok = r.resultados.filter((x) => x && x.ok).length; msg = `${ok} de ${n} nesta rodada`; }
  ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.font = "800 26px 'Baloo 2', sans-serif";
  ctx.shadowColor = "rgba(249,115,22,0.6)"; ctx.shadowBlur = 14; ctx.fillText(msg, W / 2, 46); ctx.shadowBlur = 0;
  vzEl("vzStatus").textContent = msg;
}

function vzLoop() {
  if (!VZ.ativo) return;
  VZ.raf = requestAnimationFrame(vzLoop);
  const r = VZ.rodada, t = VZ.ctx.currentTime;
  let fase = "resultado";
  if (t < r.listenStart) fase = "preparar";
  else if (t < r.listenEnd) fase = "ouvir";
  else if (t < r.singStart) fase = "contagem";
  else if (t < r.singEnd) fase = "cantar";
  VZ.fase = fase;

  vzCapturarPitch(t);
  r.notas.forEach((_, i) => {
    if (!r.resultados[i] && t >= r.singStart + (i + 1) * VZ.beat + VZ_LATENCIA) vzJulgar(i);
  });
  if (t >= r.singEnd && r.resultados.some((x) => !x)) r.notas.forEach((_, i) => { if (!r.resultados[i]) vzJulgar(i); });

  vzDesenhar(t, fase);

  if (t >= r.fim) {
    VZ.porRodada.push({ raiz: r.raiz, ok: r.resultados.filter((x) => x && x.ok).length, total: r.notas.length });
    VZ.rodadaIdx++;
    if (VZ.rodadaIdx >= VZ.raizes.length) vzFinalizar();
    else vzIniciarRodada();
  }
}

// ── Ciclo de vida ──
async function vzIniciar() {
  const erro = vzEl("vzErro"); erro.textContent = "";
  try { VZ.stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch (e) { erro.textContent = "Sem permissão de microfone."; return; }

  VZ.padrao = vzEl("vzPadrao").value; VZ.vel = vzEl("vzVelocidade").value; VZ.dif = vzEl("sgDificuldade").value;
  VZ.beat = 60 / VZ_VELOCIDADES[VZ.vel]; VZ.tol = VZ_TOL[VZ.dif]; VZ.oitava = vzEl("sgQualquerOitava").checked;
  const span = Math.max(...VZ_PADROES[VZ.padrao].offsets);
  VZ.raizes = vzRaizes(VZ_RODADAS, span, SG.perfilMin, SG.perfilMax);
  VZ.rodadaIdx = 0; VZ.pontos = 0; VZ.combo = 0; VZ.comboMaximo = 0; VZ.acertos = 0; VZ.total = 0; VZ.errosAbs = []; VZ.porRodada = []; VZ.voz = null;

  const { ctx } = obterPiano();                      // um só contexto de áudio: toca o piano e escuta o microfone
  VZ.ctx = ctx;
  VZ.fonte = ctx.createMediaStreamSource(VZ.stream);
  VZ.analyser = ctx.createAnalyser(); VZ.analyser.fftSize = 4096; VZ.fonte.connect(VZ.analyser);

  vzEl("sgConfig").hidden = true; vzEl("sgFim").hidden = true; vzEl("vzJogo").hidden = false;
  vzEl("vzPontos").textContent = "0"; vzEl("vzCombo").textContent = "combo x0";
  VZ.ativo = true;
  vzIniciarRodada();
  VZ.raf = requestAnimationFrame(vzLoop);
}

function vzPararMicrofone() {
  if (VZ.fonte) { try { VZ.fonte.disconnect(); } catch (e) { /* já desconectado */ } }
  if (VZ.stream) VZ.stream.getTracks().forEach((t) => t.stop());
  VZ.fonte = null; VZ.stream = null; VZ.analyser = null;
}

async function vzFinalizar() {
  VZ.ativo = false; cancelAnimationFrame(VZ.raf); vzPararMicrofone();
  vzEl("vzJogo").hidden = true; vzEl("sgFim").hidden = false;
  const medio = VZ.errosAbs.length ? Math.round(VZ.errosAbs.reduce((a, b) => a + b, 0) / VZ.errosAbs.length) : null;
  vzEl("sgFimPontos").textContent = VZ.pontos.toLocaleString("pt-BR");
  vzEl("sgFimDetalhe").textContent = `${VZ.acertos} de ${VZ.total} notas certas · combo máximo x${VZ.comboMaximo}` +
    (medio !== null ? ` · erro médio ${medio}¢ (margem ±${VZ.tol}¢)` : "") +
    ` · por rodada: ${VZ.porRodada.map((x) => `${sgNome(x.raiz)} ${x.ok}/${x.total}`).join(", ")}`;

  const form = new FormData();
  form.append("modo", "vocalise"); form.append("dificuldade", `${VZ.vel}_${VZ.dif}_v2`);
  form.append("pontos", String(VZ.pontos)); form.append("acertos", String(VZ.acertos));
  form.append("total", String(VZ.total)); form.append("combo_maximo", String(VZ.comboMaximo));
  form.append("escala_nome", VZ_PADROES[VZ.padrao].nome);
  try {
    const dados = await (await fetch(`${API_BASE}/api/singergame/pontuacao`, { method: "POST", body: form })).json();
    vzEl("sgFimRecorde").textContent = dados.bateu_recorde ? "🏆 Novo recorde nesse modo!" : `Recorde atual: ${Number(dados.recorde).toLocaleString("pt-BR")} pontos`;
  } catch (err) { vzEl("sgFimRecorde").textContent = ""; }
}

function vzCancelar() {
  if (!VZ.ativo) return;
  VZ.ativo = false; cancelAnimationFrame(VZ.raf); vzPararMicrofone();
  vzEl("vzJogo").hidden = true; vzEl("sgConfig").hidden = false;
}

function vzInicializar() {
  const sel = vzEl("vzPadrao");
  if (!sel || !vzEl("btnVzIniciar")) return;
  Object.entries(VZ_PADROES).forEach(([chave, p]) => { const o = document.createElement("option"); o.value = chave; o.textContent = p.nome; sel.appendChild(o); });
  vzEl("btnVzIniciar").addEventListener("click", vzIniciar);
  vzEl("btnVzCancelar").addEventListener("click", vzCancelar);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", vzInicializar);
else vzInicializar();
