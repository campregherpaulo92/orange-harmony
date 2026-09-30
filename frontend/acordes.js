// ══════════════════════════════════════════════════════════════
// acordes.js — Aba "Acordes": braço de violão clicável que identifica o acorde,
// procura acorde por nome (com posições no braço) e mostra onde ele se encaixa.
// A teoria musical roda no servidor (acordes.py) — a mesma que a Laranjinha usa.
// ══════════════════════════════════════════════════════════════

const ACORDES_AFINACAO = [40, 45, 50, 55, 59, 64];          // Mi Lá Ré Sol Si mi (MIDI), da mais grave à mais aguda
const ACORDES_ROTULOS = ["E", "A", "D", "G", "B", "e"];
const ACORDES_NOTAS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const CASAS_VISIVEIS = 5;

const acordesEstado = { cordas: [-1, -1, -1, -1, -1, -1], base: 1, nomesPorNota: null, ultimo: null, seq: 0 };
let acordesTimer = null;

function _el(tag, classe, texto) {
  const e = document.createElement(tag);
  if (classe) e.className = classe;
  if (texto !== undefined) e.textContent = texto;
  return e;
}

// "x32010" (casas de 2 dígitos ficam entre parênteses: "x(10)(10)9xx")
function cordasParaTexto(cordas) {
  return cordas.map((c) => (c < 0 ? "x" : c < 10 ? String(c) : `(${c})`)).join("");
}

// ── Desenho do braço (SVG). `interativo` = false gera os mini diagramas da busca ──
function svgBraco(cordas, base, nomesPorNota, interativo = true) {
  const X0 = 52, DX = 34, Y0 = 56, DY = 44, W = 270, H = 318;
  let s = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" class="oh-braco-svg" role="img" aria-label="Braço do violão">`;

  for (let r = 0; r <= CASAS_VISIVEIS; r++) {                 // casas (linhas horizontais); a pestana é mais grossa
    const y = Y0 + r * DY;
    const pestana = r === 0 && base === 1;
    s += `<line x1="${X0}" y1="${y}" x2="${X0 + 5 * DX}" y2="${y}" stroke="${pestana ? "#e8e8e8" : "#585858"}" stroke-width="${pestana ? 6 : 1.5}"/>`;
  }
  for (let i = 0; i < 6; i++) {                                // cordas (as graves são mais grossas)
    const x = X0 + i * DX;
    s += `<line x1="${x}" y1="${Y0}" x2="${x}" y2="${Y0 + CASAS_VISIVEIS * DY}" stroke="#a5a5a5" stroke-width="${1 + (5 - i) * 0.3}"/>`;
  }
  if (base > 1) {
    s += `<text x="6" y="${Y0 + DY / 2 + 6}" fill="#f97316" font-size="17" font-weight="800" font-family="Baloo 2,sans-serif">${base}ª</text>`;
  }
  for (let i = 0; i < 6; i++) {
    const x = X0 + i * DX, f = cordas[i];
    if (f === -1) s += `<text x="${x}" y="38" text-anchor="middle" fill="#ef4444" font-size="20" font-weight="800">×</text>`;
    else if (f === 0) s += `<circle cx="${x}" cy="32" r="7" fill="none" stroke="#22c55e" stroke-width="2.5"/>`;
    s += `<text x="${x}" y="${Y0 + CASAS_VISIVEIS * DY + 20}" text-anchor="middle" fill="#6f6f6f" font-size="12" font-family="Baloo 2,sans-serif">${ACORDES_ROTULOS[i]}</text>`;
    if (f > 0 && f >= base && f < base + CASAS_VISIVEIS) {
      const cy = Y0 + (f - base) * DY + DY / 2;
      const pc = (ACORDES_AFINACAO[i] + f) % 12;
      const nome = (nomesPorNota && nomesPorNota[pc]) || ACORDES_NOTAS[pc];
      s += `<circle cx="${x}" cy="${cy}" r="14" fill="#f97316" stroke="#fff" stroke-opacity=".35" stroke-width="1.5"/>`;
      s += `<text x="${x}" y="${cy + 4.5}" text-anchor="middle" fill="#fff" font-size="12" font-weight="800" font-family="Baloo 2,sans-serif">${nome}</text>`;
    } else if (f > 0) {
      s += `<text x="${x}" y="${H - 2}" text-anchor="middle" fill="#7a7a7a" font-size="11">${f}ª</text>`;   // fora da janela visível
    }
  }
  if (interativo) {
    for (let i = 0; i < 6; i++) {
      const x = X0 + i * DX - DX / 2;
      s += `<rect class="oh-braco-topo" x="${x}" y="10" width="${DX}" height="42" fill="rgba(0,0,0,0.001)" data-c="${i}" data-topo="1"/>`;
      for (let r = 0; r < CASAS_VISIVEIS; r++) {
        s += `<rect class="oh-braco-celula" x="${x}" y="${Y0 + r * DY}" width="${DX}" height="${DY}" fill="rgba(0,0,0,0.001)" data-c="${i}" data-r="${r}"/>`;
      }
    }
  }
  return s + "</svg>";
}

function redesenharBraco() {
  document.getElementById("acordeBraco").innerHTML = svgBraco(acordesEstado.cordas, acordesEstado.base, acordesEstado.nomesPorNota, true);
  document.getElementById("acordeBaseTexto").textContent = `Casa inicial: ${acordesEstado.base}`;
}

// ── Som de violão (corda dedilhada: síntese Karplus–Strong, com afinação corrigida) ──
const _cacheCorda = new Map();
function bufferCordaViolao(ctx, freq, dur = 2.8) {
  const chave = `${ctx.sampleRate}|${freq.toFixed(2)}`;
  if (_cacheCorda.has(chave)) return _cacheCorda.get(chave);
  const sr = ctx.sampleRate, n = Math.floor(sr * dur);
  const buf = ctx.createBuffer(1, n, sr);
  const y = buf.getChannelData(0);
  const atrasoTotal = sr / freq - 0.5;                         // o filtro de média já atrasa 0,5 amostra
  const N = Math.floor(atrasoTotal), frac = atrasoTotal - N;
  const perda = Math.pow(10, -1 / (2.4 * freq));               // cai 20 dB em ~2,4 s (os agudos caem antes)
  for (let i = 0; i <= N; i++) y[i] = Math.random() * 2 - 1;   // "palhetada"
  for (let i = 1; i <= N; i++) y[i] = 0.55 * y[i] + 0.45 * y[i - 1];   // palheta macia
  let anterior = 0;
  for (let i = N + 1; i < n; i++) {
    const atrasada = y[i - N] * (1 - frac) + y[i - N - 1] * frac;
    y[i] = perda * 0.5 * (atrasada + anterior);
    anterior = atrasada;
  }
  let pico = 0;
  for (let i = 0; i < Math.min(n, sr * 0.3); i++) pico = Math.max(pico, Math.abs(y[i]));
  const ganho = pico > 0 ? 0.8 / pico : 1;
  for (let i = 0; i < n; i++) y[i] *= ganho;
  const fade = Math.floor(sr * 0.25);
  for (let i = 0; i < fade; i++) y[n - 1 - i] *= i / fade;      // sem clique no fim
  _cacheCorda.set(chave, buf);
  return buf;
}

function agendarCordasViolao(ctx, destino, cordas, quando, espacamento = 0.045) {
  let k = 0;
  cordas.forEach((casa, i) => {
    if (casa < 0) return;
    const freq = 440 * Math.pow(2, (ACORDES_AFINACAO[i] + casa - 69) / 12);
    const fonte = ctx.createBufferSource();
    fonte.buffer = bufferCordaViolao(ctx, freq);
    const g = ctx.createGain();
    g.gain.value = 1.15;
    fonte.connect(g).connect(destino);
    fonte.start(quando + k * espacamento);                      // "arrasta" da corda grave à aguda
    k++;
  });
}

function tocarAcordeAtual() {
  if (acordesEstado.cordas.filter((c) => c >= 0).length < 1) return;
  const { ctx, entrada } = obterPiano();                        // reaproveita o contexto e o reverb do piano
  agendarCordasViolao(ctx, entrada, acordesEstado.cordas, ctx.currentTime + 0.03);
}

// ── Resultado ──
function mostrarResultado(dados) {
  const nomeEl = document.getElementById("acordeNome");
  const tipoEl = document.getElementById("acordeTipo");
  const altEl = document.getElementById("acordeAlternativas");
  const notasEl = document.getElementById("acordeNotas");
  const encaixeEl = document.getElementById("acordeEncaixe");
  const botoes = ["btnAcordeTocar", "btnAcordeComposicao", "btnAcordeLaranjinha"].map((id) => document.getElementById(id));

  notasEl.replaceChildren();
  encaixeEl.replaceChildren();
  if (!dados || dados.erro) {
    acordesEstado.ultimo = null;
    acordesEstado.nomesPorNota = null;
    nomeEl.textContent = "—";
    tipoEl.textContent = (dados && dados.erro) || "Marque pelo menos 2 notas no braço.";
    altEl.textContent = "";
    botoes.forEach((b) => { b.disabled = true; });
    document.getElementById("btnAcordeTocar").disabled = acordesEstado.cordas.filter((c) => c >= 0).length < 1;
    return;
  }
  acordesEstado.ultimo = dados;
  nomeEl.textContent = dados.nome;
  tipoEl.textContent = dados.tipo ? `Acorde ${dados.tipo}` : "";
  altEl.textContent = dados.alternativas && dados.alternativas.length ? `Também pode ser: ${dados.alternativas.join(" · ")}` : "";
  botoes.forEach((b) => { b.disabled = false; });

  const mapa = {};
  (dados.notas || []).forEach((n) => {
    const chip = _el("span", "oh-chip", `${n.letra} · ${n.solfejo}`);
    chip.title = n.funcao;
    notasEl.appendChild(chip);
  });
  (dados.notas || []).forEach((n) => { mapa[acharPc(n.letra)] = n.letra; });
  acordesEstado.nomesPorNota = mapa;

  const enc = dados.encaixe || {};
  const blocoTons = _el("div", "oh-encaixe-bloco");
  blocoTons.appendChild(_el("div", "oh-encaixe-titulo", "🎼 Onde ele se encaixa (tonalidades)"));
  if (enc.tonalidades && enc.tonalidades.length) {
    const lista = _el("div", "oh-chips");
    enc.tonalidades.forEach((t) => {
      const chip = _el("span", "oh-chip oh-chip-tom", `${t.tonalidade} · ${t.grau}`);
      if (t.relativa) chip.title = `Relativa: ${t.relativa}`;
      lista.appendChild(chip);
    });
    blocoTons.appendChild(lista);
  }
  if (enc.observacao) blocoTons.appendChild(_el("p", "oh-hint", enc.observacao));
  encaixeEl.appendChild(blocoTons);

  if (enc.escalas && enc.escalas.length) {
    const blocoEsc = _el("div", "oh-encaixe-bloco");
    blocoEsc.appendChild(_el("div", "oh-encaixe-titulo", "🎸 Escalas que você pode tocar por cima"));
    const ul = _el("ul", "oh-lista-escalas");
    enc.escalas.forEach((e) => {
      const li = _el("li");
      li.appendChild(_el("b", "", e.nome));
      li.appendChild(_el("span", "oh-escala-notas", e.notas));
      ul.appendChild(li);
    });
    blocoEsc.appendChild(ul);
    encaixeEl.appendChild(blocoEsc);
  }
}

function acharPc(letra) {
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[letra[0]];
  return (base + (letra.includes("#") ? 1 : 0) - (letra.includes("b") ? 1 : 0) + 12) % 12;
}

// ── Chamadas ao servidor ──
async function identificarAgora() {
  const cordas = acordesEstado.cordas;
  const sons = cordas.filter((c) => c >= 0).length;
  const minha = ++acordesEstado.seq;
  document.getElementById("acordeStatus").textContent = "";
  if (sons < 2) { mostrarResultado(null); redesenharBraco(); return; }
  const form = new FormData();
  form.append("cordas", cordas.join(","));
  try {
    const resp = await fetch(`${API_BASE}/api/acordes/identificar`, { method: "POST", body: form });
    const dados = await resp.json();
    if (minha !== acordesEstado.seq) return;                    // chegou uma resposta mais nova; ignora esta
    mostrarResultado(dados);
    redesenharBraco();                                          // redesenha com a grafia certa das notas (Bb, não A#)
  } catch (err) {
    if (minha !== acordesEstado.seq) return;
    mostrarResultado({ erro: `Não consegui falar com o servidor: ${mensagemDeErroDeRede(err)}` });
  }
}

function agendarIdentificacao() {
  clearTimeout(acordesTimer);
  acordesTimer = setTimeout(identificarAgora, 150);
}

function carregarNoBraco(cordas, base) {
  acordesEstado.cordas = cordas.slice();
  acordesEstado.base = Math.max(1, Math.min(12, base || 1));
  acordesEstado.nomesPorNota = null;
  redesenharBraco();
  identificarAgora();
  document.getElementById("acordeBraco").scrollIntoView({ behavior: "smooth", block: "center" });
}

async function procurarAcordePorNome() {
  const campo = document.getElementById("acordeBusca");
  const info = document.getElementById("acordeBuscaInfo");
  const grade = document.getElementById("acordePosicoes");
  const nome = (campo.value || "").trim();
  grade.replaceChildren();
  if (!nome) { info.textContent = "Digite o nome de um acorde. Ex: Am7, C7M, F#m, G/B."; return; }
  info.textContent = "Procurando…";
  const form = new FormData();
  form.append("nome", nome);
  try {
    const resp = await fetch(`${API_BASE}/api/acordes/procurar`, { method: "POST", body: form });
    const dados = await resp.json();
    if (dados.erro) { info.textContent = dados.erro; return; }
    info.textContent = `${dados.nome} — acorde ${dados.tipo}. Notas: ${dados.notas.map((n) => n.letra).join(" ")}. ` +
      (dados.posicoes.length ? "Toque numa posição para ver no braço:" : "Não achei posições simples para esse acorde — mas veja abaixo onde ele se encaixa.");
    dados.posicoes.forEach((p) => {
      const botao = _el("button", "oh-mini-braco");
      botao.type = "button";
      botao.title = `${dados.nome} — ${cordasParaTexto(p.cordas)}`;
      botao.innerHTML = svgBraco(p.cordas, p.base, null, false);
      botao.appendChild(_el("span", "oh-mini-legenda", `${cordasParaTexto(p.cordas)}${p.base > 1 ? ` · casa ${p.base}` : ""}`));
      botao.addEventListener("click", () => carregarNoBraco(p.cordas, p.base));
      grade.appendChild(botao);
    });
    mostrarResultado({ nome: dados.nome, tipo: dados.tipo, alternativas: [], notas: dados.notas, encaixe: dados.encaixe });
  } catch (err) {
    info.textContent = `Erro: ${mensagemDeErroDeRede(err)}`;
  }
}

// ── Integração com o resto do app ──
function perguntarParaLaranjinha() {
  const u = acordesEstado.ultimo;
  if (!u) return;
  const sons = acordesEstado.cordas.filter((c) => c >= 0).length;
  const digitacao = sons >= 2 ? ` (cordas ${cordasParaTexto(acordesEstado.cordas)}, da mais grave à mais aguda)` : "";
  const painel = document.getElementById("laranjinhaPainel");
  if (painel.hidden) document.getElementById("fabLaranjinha").click();
  const campo = document.getElementById("laranjinhaInput");
  campo.value = `Montei o acorde ${u.nome}${digitacao} no violão. Em quais tonalidades e escalas ele se encaixa, e que ideias você tem pra usar ele numa música?`;
  campo.focus();
}

function usarNaComposicao() {
  const u = acordesEstado.ultimo;
  const letra = document.getElementById("composicaoLetra");
  const status = document.getElementById("acordeStatus");
  if (!u || !letra) return;
  letra.value = `${letra.value}${letra.value && !letra.value.endsWith(" ") && !letra.value.endsWith("\n") ? " " : ""}[${u.nome}] `;
  status.textContent = `✅ [${u.nome}] adicionado ao fim da sua composição (aba Composições).`;
}

function inicializarAcordes() {
  const braco = document.getElementById("acordeBraco");
  if (!braco) return;
  redesenharBraco();
  mostrarResultado(null);

  braco.addEventListener("click", (e) => {
    const alvo = e.target.closest("[data-c]");
    if (!alvo) return;
    const c = parseInt(alvo.dataset.c, 10);
    const cordas = acordesEstado.cordas;
    if (alvo.dataset.topo) {
      cordas[c] = cordas[c] === 0 ? -1 : 0;                      // marca de cima: alterna muda ↔ solta
    } else {
      const casa = acordesEstado.base + parseInt(alvo.dataset.r, 10);
      cordas[c] = cordas[c] === casa ? -1 : casa;                // tocar de novo na mesma casa tira a nota
    }
    redesenharBraco();
    agendarIdentificacao();
  });

  document.getElementById("btnAcordeBaseMenos").addEventListener("click", () => { acordesEstado.base = Math.max(1, acordesEstado.base - 1); redesenharBraco(); });
  document.getElementById("btnAcordeBaseMais").addEventListener("click", () => { acordesEstado.base = Math.min(12, acordesEstado.base + 1); redesenharBraco(); });
  document.getElementById("btnAcordeLimpar").addEventListener("click", () => {
    acordesEstado.cordas = [-1, -1, -1, -1, -1, -1];
    acordesEstado.base = 1;
    acordesEstado.nomesPorNota = null;
    redesenharBraco();
    identificarAgora();
  });
  document.getElementById("btnAcordeTocar").addEventListener("click", tocarAcordeAtual);
  document.getElementById("btnAcordeLaranjinha").addEventListener("click", perguntarParaLaranjinha);
  document.getElementById("btnAcordeComposicao").addEventListener("click", usarNaComposicao);
  document.getElementById("btnAcordeBuscar").addEventListener("click", procurarAcordePorNome);
  document.getElementById("acordeBusca").addEventListener("keydown", (e) => { if (e.key === "Enter") procurarAcordePorNome(); });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", inicializarAcordes);
else inicializarAcordes();
