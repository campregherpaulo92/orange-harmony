// ══════════════════════════════════════════════════════════════
// estudio.js — Orange Studio: timeline estilo DAW.
// - Forma de onda estática quando parado, espectro de frequências ao vivo
//   durante o play (Web Audio: source -> gain -> analyser -> destino).
// - Nome de cada faixa editável — o agente reconhece o nome mencionado na
//   mensagem (ex: "abaixa o volume da guitarra"), sem precisar trocar o select.
// - Corte (início/fim) e deslocamento (adiantar/atrasar) por faixa, com
//   desfazer de 1 nível, e upload/download individual por faixa.
// ══════════════════════════════════════════════════════════════

const faixasEstudio = {
  vocal: null,
  instrumental: null,
  original: null,
};

const CANVAS_POR_FAIXA = { vocal: "waveformVocal", instrumental: "waveformInstrumental", original: "waveformOriginal" };
const COR_POR_FAIXA = { vocal: "#f97316", instrumental: "#22d3ee", original: "#8b8b8b" };
const NOME_PADRAO_FAIXA = { vocal: "Vocals", instrumental: "Instrumental", original: "Original (referência)" };

let studioAudioCtx = null;
let studioTocando = false;
let studioRAF = null;

function base64ParaBlob(base64, mimeType) {
  const bytes = atob(base64);
  const buffer = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) buffer[i] = bytes.charCodeAt(i);
  return new Blob([buffer], { type: mimeType });
}

function formatarTempoStudio(seg) {
  if (!isFinite(seg) || isNaN(seg)) return "0:00";
  const m = Math.floor(seg / 60);
  const s = Math.floor(seg % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

// ── Codifica um AudioBuffer de volta pra WAV (16-bit PCM) — usado depois de
// cortar/deslocar uma faixa, já que o resultado precisa virar um Blob de novo. ──
function audioBufferParaWavBlob(buffer) {
  const numCanais = buffer.numberOfChannels;
  const taxaAmostragem = buffer.sampleRate;
  const numAmostras = buffer.length;
  const tamanhoDados = numAmostras * numCanais * 2;
  const arrayBuffer = new ArrayBuffer(44 + tamanhoDados);
  const view = new DataView(arrayBuffer);

  function escreverString(offset, texto) {
    for (let i = 0; i < texto.length; i++) view.setUint8(offset + i, texto.charCodeAt(i));
  }

  escreverString(0, "RIFF");
  view.setUint32(4, 36 + tamanhoDados, true);
  escreverString(8, "WAVE");
  escreverString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numCanais, true);
  view.setUint32(24, taxaAmostragem, true);
  view.setUint32(28, taxaAmostragem * numCanais * 2, true);
  view.setUint16(32, numCanais * 2, true);
  view.setUint16(34, 16, true);
  escreverString(36, "data");
  view.setUint32(40, tamanhoDados, true);

  const canais = [];
  for (let c = 0; c < numCanais; c++) canais.push(buffer.getChannelData(c));

  let offset = 44;
  for (let i = 0; i < numAmostras; i++) {
    for (let c = 0; c < numCanais; c++) {
      let amostra = Math.max(-1, Math.min(1, canais[c][i]));
      amostra = amostra < 0 ? amostra * 0x8000 : amostra * 0x7fff;
      view.setInt16(offset, amostra, true);
      offset += 2;
    }
  }
  return new Blob([arrayBuffer], { type: "audio/wav" });
}

function cortarBuffer(buffer, inicioSeg, fimSeg) {
  const sr = buffer.sampleRate;
  const inicioAmostra = Math.max(0, Math.floor(inicioSeg * sr));
  const fimAmostra = Math.min(buffer.length, Math.floor(fimSeg * sr));
  if (fimAmostra <= inicioAmostra) throw new Error("Intervalo de corte inválido — o fim precisa ser depois do início.");
  const novoBuffer = studioAudioCtx.createBuffer(buffer.numberOfChannels, fimAmostra - inicioAmostra, sr);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    novoBuffer.getChannelData(c).set(buffer.getChannelData(c).subarray(inicioAmostra, fimAmostra));
  }
  return novoBuffer;
}

function deslocarBuffer(buffer, deslocamentoSeg) {
  const sr = buffer.sampleRate;
  const deslocamentoAmostras = Math.floor(deslocamentoSeg * sr);
  if (deslocamentoAmostras === 0) return buffer;
  if (deslocamentoAmostras > 0) {
    const novoBuffer = studioAudioCtx.createBuffer(buffer.numberOfChannels, buffer.length + deslocamentoAmostras, sr);
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      novoBuffer.getChannelData(c).set(buffer.getChannelData(c), deslocamentoAmostras);
    }
    return novoBuffer;
  }
  const corteAmostras = Math.min(buffer.length, -deslocamentoAmostras);
  const novoBuffer = studioAudioCtx.createBuffer(buffer.numberOfChannels, buffer.length - corteAmostras, sr);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    novoBuffer.getChannelData(c).set(buffer.getChannelData(c).subarray(corteAmostras));
  }
  return novoBuffer;
}

async function decodificarParaBuffer(blob) {
  if (!studioAudioCtx) studioAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const arrayBuffer = await blob.arrayBuffer();
  return studioAudioCtx.decodeAudioData(arrayBuffer.slice(0));
}

function desenharFormaDeOnda(canvas, audioBuffer, cor) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const w = rect.width, h = rect.height;
  ctx.clearRect(0, 0, w, h);

  const dados = audioBuffer.getChannelData(0);
  const passos = Math.max(1, Math.floor(dados.length / w));
  ctx.fillStyle = cor;
  const meio = h / 2;
  for (let x = 0; x < w; x++) {
    let min = 1.0, max = -1.0;
    const inicio = x * passos;
    for (let i = 0; i < passos; i++) {
      const v = dados[inicio + i] || 0;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const y1 = meio + min * meio * 0.9;
    const y2 = meio + max * meio * 0.9;
    ctx.fillRect(x, y1, 1, Math.max(1, y2 - y1));
  }
}

// ── Espectro de frequências AO VIVO (analisado em tempo real via Web Audio),
// desenhado durante o play — é o que estava faltando antes (só tinha a forma
// de onda estática). Quando pausa, volta a mostrar a forma de onda. ──
function desenharEspectroAoVivo(canvas, analyser, cor) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const w = rect.width, h = rect.height;
  ctx.clearRect(0, 0, w, h);

  const dadosFreq = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(dadosFreq);
  const larguraBarra = w / dadosFreq.length;
  ctx.fillStyle = cor;
  for (let i = 0; i < dadosFreq.length; i++) {
    const altura = (dadosFreq[i] / 255) * h;
    ctx.fillRect(i * larguraBarra, h - altura, Math.max(1, larguraBarra * 0.8), altura);
  }
}

function redesenharFormasEstaticas() {
  Object.entries(faixasEstudio).forEach(([nome, f]) => {
    if (!f) return;
    const canvas = document.getElementById(CANVAS_POR_FAIXA[nome]);
    if (canvas) desenharFormaDeOnda(canvas, f.buffer, COR_POR_FAIXA[nome]);
  });
}

async function montarFaixa(nomeFaixa, blob, corHex) {
  const audio = new Audio();
  audio.src = URL.createObjectURL(blob);
  audio.preload = "auto";

  const buffer = await decodificarParaBuffer(blob);

  // Roteia via Web Audio (fonte -> ganho -> analisador -> saída), necessário
  // pro espectro ao vivo e pro controle de volume/mute consistente entre faixas.
  const source = studioAudioCtx.createMediaElementSource(audio);
  const gainNode = studioAudioCtx.createGain();
  const analyser = studioAudioCtx.createAnalyser();
  analyser.fftSize = 256;
  source.connect(gainNode).connect(analyser).connect(studioAudioCtx.destination);

  const mudoInicial = nomeFaixa === "original"; // a faixa de referência começa mudinha
  faixasEstudio[nomeFaixa] = {
    blob, audio, buffer, source, gainNode, analyser,
    nomeCustom: NOME_PADRAO_FAIXA[nomeFaixa],
    muted: mudoInicial,
    solo: false,
    volume: 1,
    historico: null,
  };
  gainNode.gain.value = mudoInicial ? 0 : 1;

  desenharFormaDeOnda(document.getElementById(CANVAS_POR_FAIXA[nomeFaixa]), buffer, corHex);

  const btnMute = document.querySelector(`[data-mute="${nomeFaixa}"]`);
  if (btnMute) btnMute.classList.toggle("oh-studio-mini-btn-ativo", mudoInicial);

  return faixasEstudio[nomeFaixa];
}

function atualizarGanhoFaixa(nome) {
  const f = faixasEstudio[nome];
  if (!f) return;
  const algumSolo = Object.values(faixasEstudio).some((x) => x && x.solo);
  const deveTocar = algumSolo ? f.solo : !f.muted;
  f.gainNode.gain.value = deveTocar ? f.volume : 0;
}

function aplicarMuteSolo() {
  Object.keys(faixasEstudio).forEach((nome) => { if (faixasEstudio[nome]) atualizarGanhoFaixa(nome); });
}

function atualizarTempoTransporte() {
  const referencia = faixasEstudio.original || faixasEstudio.vocal || faixasEstudio.instrumental;
  if (!referencia) return;
  const atual = referencia.audio.currentTime;
  const duracao = referencia.audio.duration || 0;
  const tempoEl = document.getElementById("studioTempo");
  if (tempoEl) tempoEl.textContent = `${formatarTempoStudio(atual)} / ${formatarTempoStudio(duracao)}`;

  const pct = duracao > 0 ? (atual / duracao) * 100 : 0;
  document.querySelectorAll(".oh-studio-playhead").forEach((el) => { el.style.left = `${pct}%`; });

  Object.entries(faixasEstudio).forEach(([nome, f]) => {
    if (!f || !f.analyser) return;
    const canvas = document.getElementById(CANVAS_POR_FAIXA[nome]);
    if (canvas && f.gainNode.gain.value > 0) {
      desenharEspectroAoVivo(canvas, f.analyser, COR_POR_FAIXA[nome]);
    }
  });

  if (studioTocando) studioRAF = requestAnimationFrame(atualizarTempoTransporte);
}

function tocarTudo() {
  if (studioAudioCtx && studioAudioCtx.state === "suspended") studioAudioCtx.resume();
  const referencia = faixasEstudio.original || faixasEstudio.vocal;
  if (!referencia) return;
  const tempoAtual = referencia.audio.currentTime;
  Object.values(faixasEstudio).forEach((f) => {
    if (!f) return;
    f.audio.currentTime = tempoAtual;
    f.audio.play();
  });
  studioTocando = true;
  const btn = document.getElementById("studioBtnPlay");
  if (btn) btn.textContent = "⏸";
  atualizarTempoTransporte();
}

function pausarTudo() {
  Object.values(faixasEstudio).forEach((f) => { if (f) f.audio.pause(); });
  studioTocando = false;
  const btn = document.getElementById("studioBtnPlay");
  if (btn) btn.textContent = "▶";
  if (studioRAF) cancelAnimationFrame(studioRAF);
  redesenharFormasEstaticas();
}

function pararTudo() {
  pausarTudo();
  Object.values(faixasEstudio).forEach((f) => { if (f) f.audio.currentTime = 0; });
  atualizarTempoTransporte();
  redesenharFormasEstaticas();
}

function inicializarControlesFaixa() {
  document.querySelectorAll("[data-mute]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const nome = btn.dataset.mute;
      const f = faixasEstudio[nome];
      if (!f) return;
      f.muted = !f.muted;
      btn.classList.toggle("oh-studio-mini-btn-ativo", f.muted);
      aplicarMuteSolo();
    });
  });

  document.querySelectorAll("[data-solo]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const nome = btn.dataset.solo;
      const f = faixasEstudio[nome];
      if (!f) return;
      f.solo = !f.solo;
      btn.classList.toggle("oh-studio-mini-btn-ativo", f.solo);
      aplicarMuteSolo();
    });
  });

  document.querySelectorAll("[data-vol]").forEach((slider) => {
    slider.addEventListener("input", () => {
      const nome = slider.dataset.vol;
      const f = faixasEstudio[nome];
      if (!f) return;
      f.volume = parseFloat(slider.value);
      atualizarGanhoFaixa(nome);
    });
  });
}

// ── Nome editável por faixa — o agente do Estúdio passa a reconhecer esse
// nome quando mencionado na mensagem (ex: "abaixa o volume da guitarra"). ──
function inicializarNomesFaixa() {
  document.querySelectorAll("[data-nome-faixa]").forEach((input) => {
    input.addEventListener("change", () => {
      const nome = input.dataset.nomeFaixa;
      const f = faixasEstudio[nome];
      if (!f) return;
      f.nomeCustom = input.value.trim() || NOME_PADRAO_FAIXA[nome];
      input.value = f.nomeCustom;
      atualizarOpcoesFaixaSelect();
      montarDownloads();
    });
  });
}

function atualizarOpcoesFaixaSelect() {
  const select = document.getElementById("studioFaixaSelect");
  if (!select) return;
  const valorAtual = select.value;
  select.innerHTML = ["vocal", "instrumental"].map((chave) => {
    const f = faixasEstudio[chave];
    const rotulo = (f && f.nomeCustom) ? f.nomeCustom : NOME_PADRAO_FAIXA[chave];
    return `<option value="${chave}">${rotulo}</option>`;
  }).join("");
  if ([...select.options].some((o) => o.value === valorAtual)) select.value = valorAtual;
}

// ── Aplica um novo buffer numa faixa (corte, deslocamento, upload de
// substituição) — guarda o estado anterior pra permitir desfazer 1 nível. ──
async function substituirBufferFaixa(nomeFaixa, novoBuffer, guardarHistorico = true) {
  const f = faixasEstudio[nomeFaixa];
  if (!f) return;
  if (guardarHistorico) f.historico = { blob: f.blob, buffer: f.buffer };
  const novoBlob = audioBufferParaWavBlob(novoBuffer);
  const estavaTocando = !f.audio.paused;
  f.blob = novoBlob;
  f.buffer = novoBuffer;
  f.audio.src = URL.createObjectURL(novoBlob);
  if (estavaTocando) { try { await f.audio.play(); } catch (e) { /* ignora */ } }
  desenharFormaDeOnda(document.getElementById(CANVAS_POR_FAIXA[nomeFaixa]), novoBuffer, COR_POR_FAIXA[nomeFaixa]);
  montarDownloads();
}

// ── Corte, deslocamento, upload de substituição e desfazer por faixa. ──
function inicializarEdicaoFaixa() {
  document.querySelectorAll("[data-acao-cortar]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const nome = btn.dataset.acaoCortar;
      const f = faixasEstudio[nome];
      if (!f) return;
      const inicioInput = document.querySelector(`[data-corte-inicio="${nome}"]`);
      const fimInput = document.querySelector(`[data-corte-fim="${nome}"]`);
      const inicio = parseFloat(inicioInput.value) || 0;
      const fim = fimInput.value ? parseFloat(fimInput.value) : f.buffer.duration;
      try {
        const novoBuffer = cortarBuffer(f.buffer, inicio, fim);
        await substituirBufferFaixa(nome, novoBuffer);
      } catch (err) {
        alert(err.message);
      }
    });
  });

  document.querySelectorAll("[data-acao-deslocar]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const nome = btn.dataset.acaoDeslocar;
      const f = faixasEstudio[nome];
      if (!f) return;
      const valorInput = document.querySelector(`[data-deslocar-valor="${nome}"]`);
      const valor = parseFloat(valorInput.value) || 0;
      const novoBuffer = deslocarBuffer(f.buffer, valor);
      await substituirBufferFaixa(nome, novoBuffer);
    });
  });

  document.querySelectorAll("[data-upload-stem]").forEach((input) => {
    input.addEventListener("change", async () => {
      const nome = input.dataset.uploadStem;
      const arquivo = input.files[0];
      if (!arquivo) return;
      const buffer = await decodificarParaBuffer(arquivo);
      await substituirBufferFaixa(nome, buffer);
    });
  });

  document.querySelectorAll("[data-acao-desfazer]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const nome = btn.dataset.acaoDesfazer;
      const f = faixasEstudio[nome];
      if (!f || !f.historico) return;
      const anterior = f.historico;
      f.historico = null;
      await substituirBufferFaixa(nome, anterior.buffer, false);
    });
  });
}

function montarDownloads() {
  const container = document.getElementById("studioDownloads");
  if (!container) return;
  const itens = [
    ["vocal", faixasEstudio.vocal],
    ["instrumental", faixasEstudio.instrumental],
  ];
  container.innerHTML = itens.map(([chave, f]) => {
    if (!f) return "";
    const rotulo = f.nomeCustom || NOME_PADRAO_FAIXA[chave];
    const url = URL.createObjectURL(f.blob);
    const extensao = f.blob.type.includes("wav") ? "wav" : "mp3";
    return `<a class="oh-btn oh-btn-secundario" href="${url}" download="${rotulo.replace(/[^\w-]/g, "_")}.${extensao}">⬇️ ${rotulo}</a>`;
  }).join("");
}

// ══════════════════════════════════════════════════════════════
// Separação de stems: local (servidor com Demucs) ou via Colab (fila no Firebase)
// ══════════════════════════════════════════════════════════════
const esperar = (ms) => new Promise((ok) => setTimeout(ok, ms));
let configEstudio = null;      // {modo: "local"|"fila", colab: {online, gpu}, colab_url}
let timerColab = null;

async function carregarConfigEstudio() {
  try {
    const r = await fetch(`${API_BASE}/api/estudio/config`);
    configEstudio = await r.json();
  } catch (e) {
    configEstudio = configEstudio || { modo: "fila", colab: { online: false }, colab_url: "#" };
  }
  atualizarCardColab();
  return configEstudio;
}

// Desenha o card: verde quando o Colab está ligado, cinza com botão quando não está.
function atualizarCardColab() {
  const card = document.getElementById("studioColabCard");
  if (!card || !configEstudio) return;
  if (configEstudio.modo !== "fila") { card.hidden = true; return; }   // servidor tem Demucs próprio
  card.hidden = false;
  const on = !!(configEstudio.colab && configEstudio.colab.online);
  card.classList.toggle("oh-colab-online", on);
  const pill = document.getElementById("studioColabPill");
  pill.className = `oh-pill ${on ? "oh-pill-on" : "oh-pill-off"}`;
  pill.textContent = on ? (configEstudio.colab.gpu ? "🟢 Ligado · GPU" : "🟢 Ligado") : "⚪ Desligado";
  document.getElementById("studioColabTexto").textContent = on
    ? "Pronto! Escolha um áudio abaixo e clique em Separar stems."
    : "A separação roda no Google Colab (o servidor gratuito não tem memória pro Demucs). Ligue o separador uma vez e use à vontade.";
  document.getElementById("studioColabLink").href = configEstudio.colab_url || "#";
  // Tira o aviso "Ligue o separador…" assim que o Colab liga
  const status = document.getElementById("studioStatus");
  if (on && status && status.textContent.startsWith("Ligue o separador")) status.textContent = "";
}

function iniciarMonitoramentoColab() {
  carregarConfigEstudio();
  clearInterval(timerColab);
  timerColab = setInterval(carregarConfigEstudio, 8000);
}
function pararMonitoramentoColab() { clearInterval(timerColab); timerColab = null; }

// Marca no indicador de progresso em qual etapa a separação está.
function definirEtapaSeparacao(etapa) {
  const ordem = ["enviando", "fila", "separando", "baixando"];
  const lista = document.getElementById("studioProgresso");
  lista.hidden = false;
  const atual = ordem.indexOf(etapa);
  lista.querySelectorAll("li").forEach((li) => {
    const i = ordem.indexOf(li.dataset.etapa);
    li.classList.toggle("oh-feita", i < atual);
    li.classList.toggle("oh-ativa", i === atual);
  });
}

const TEXTO_ETAPA = {
  enviando: "Enviando o áudio pro separador…",
  fila: "Na fila — esperando o Colab pegar o seu áudio…",
  separando: "Separando no Colab… (com GPU leva ~30 s; sem GPU, alguns minutos)",
  baixando: "Baixando voz e instrumental…",
};

// Caminho 1: o próprio servidor tem Demucs (ex: rodando no Colab ou no seu PC)
async function separarLocal(arquivo) {
  const form = new FormData();
  form.append("arquivo", arquivo);
  const controlador = new AbortController();
  const tempoLimite = setTimeout(() => controlador.abort(), 6 * 60 * 1000);
  try {
    const resp = await fetch(`${API_BASE}/api/estudio/separar`, { method: "POST", body: form, signal: controlador.signal });
    if (!resp.ok) {
      const erro = await resp.json().catch(() => ({}));
      throw new Error(erro.detail || "Não foi possível separar os stems.");
    }
    const dados = await resp.json();
    return {
      vozBlob: base64ParaBlob(dados.voz_base64, "audio/mpeg"),
      instBlob: base64ParaBlob(dados.instrumental_base64, "audio/mpeg"),
      bpm: dados.bpm, tom: dados.tom,
    };
  } catch (err) {
    if (err.name === "AbortError") throw new Error("Isso demorou demais (mais de 6 min) e foi cancelado.");
    throw err;
  } finally {
    clearTimeout(tempoLimite);
  }
}

// Caminho 2: manda pra fila (Firebase) e acompanha até o Colab devolver os stems
async function separarViaColab(arquivo, aoMudarEtapa) {
  aoMudarEtapa("enviando");
  const form = new FormData();
  form.append("arquivo", arquivo);
  const envio = await fetch(`${API_BASE}/api/estudio/fila`, { method: "POST", body: form });
  if (!envio.ok) {
    const erro = await envio.json().catch(() => ({}));
    throw new Error(erro.detail || "Não consegui enviar o áudio pro separador.");
  }
  const { job_id } = await envio.json();
  aoMudarEtapa("fila");

  const inicio = Date.now();
  let falhasSeguidas = 0;
  let semColabDesde = null;
  while (true) {
    await esperar(3000);
    if (Date.now() - inicio > 20 * 60 * 1000) throw new Error("A separação demorou mais de 20 minutos e foi cancelada.");

    let info;
    try {
      const r = await fetch(`${API_BASE}/api/estudio/fila/${job_id}`);
      if (r.status === 404) throw new Error("Perdi o trabalho no servidor. Tente de novo.");
      info = await r.json();
      falhasSeguidas = 0;
    } catch (err) {
      if (String(err.message).startsWith("Perdi")) throw err;
      if (++falhasSeguidas >= 6) throw new Error(mensagemDeErroDeRede(err));   // servidor reiniciando: tenta algumas vezes
      continue;
    }

    if (info.status === "erro") throw new Error(info.erro || "O separador falhou.");
    if (info.status === "processando") { aoMudarEtapa("separando"); semColabDesde = null; }
    if (info.status === "pendente") {
      aoMudarEtapa("fila");
      if (info.colab_online === false) {
        semColabDesde = semColabDesde || Date.now();
        if (Date.now() - semColabDesde > 60000) throw new Error("O Colab foi desligado antes de pegar o seu áudio. Ligue de novo e tente outra vez.");
      } else { semColabDesde = null; }
    }
    if (info.status === "pronto") {
      aoMudarEtapa("baixando");
      const [rv, ri] = await Promise.all([
        fetch(`${API_BASE}/api/estudio/fila/${job_id}/voz`),
        fetch(`${API_BASE}/api/estudio/fila/${job_id}/instrumental`),
      ]);
      if (!rv.ok || !ri.ok) throw new Error("Não consegui baixar os stems prontos.");
      const resultado = { vozBlob: await rv.blob(), instBlob: await ri.blob(), bpm: info.bpm, tom: info.tom };
      fetch(`${API_BASE}/api/estudio/fila/${job_id}`, { method: "DELETE" }).catch(() => {});   // limpa o Firebase
      return resultado;
    }
  }
}

function inicializarEstudio() {
  const fab = document.getElementById("fabEstudio");
  const painel = document.getElementById("studioPainel");
  const btnFechar = document.getElementById("btnFecharStudio");
  const arquivoInput = document.getElementById("studioArquivo");
  const nomeArquivoEl = document.getElementById("studioNomeArquivo");
  const btnSeparar = document.getElementById("btnSepararStems");
  const statusEl = document.getElementById("studioStatus");
  const setupEl = document.getElementById("studioSetup");
  const timelineEl = document.getElementById("studioTimeline");
  const transporteEl = document.getElementById("studioTransporte");
  const infoProjetoEl = document.getElementById("studioInfoProjeto");

  if (!fab || !painel) return;

  let blobGravado = null;
  const gravadorContainer = document.getElementById("studioGravador");
  if (gravadorContainer) {
    criarGravador(gravadorContainer, {
      onGravado: (blob) => { blobGravado = blob; },
      onExcluido: () => { blobGravado = null; },
    });
  }

  fab.addEventListener("click", () => {
    painel.hidden = !painel.hidden;
    if (painel.hidden) pararMonitoramentoColab(); else iniciarMonitoramentoColab();
  });
  btnFechar.addEventListener("click", () => { painel.hidden = true; pausarTudo(); pararMonitoramentoColab(); });

  arquivoInput.addEventListener("change", () => {
    if (arquivoInput.files[0]) {
      blobGravado = null;
      nomeArquivoEl.textContent = `Selecionado: ${arquivoInput.files[0].name}`;
    }
  });

  btnSeparar.addEventListener("click", async () => {
    const arquivoOriginal = arquivoInput.files[0] || (blobGravado
      ? arquivoDeGravacao(blobGravado, "gravacao")
      : null);
    if (!arquivoOriginal) { statusEl.textContent = "Grave ou suba um áudio primeiro."; return; }

    const cfg = configEstudio || await carregarConfigEstudio();
    const viaColab = cfg.modo === "fila";

    // Colab desligado: em vez de falhar, destaca o card e explica o que fazer
    if (viaColab && !(cfg.colab && cfg.colab.online)) {
      const card = document.getElementById("studioColabCard");
      card.classList.add("oh-colab-destaque");
      setTimeout(() => card.classList.remove("oh-colab-destaque"), 2500);
      card.scrollIntoView({ behavior: "smooth", block: "center" });
      statusEl.textContent = "Ligue o separador no Colab primeiro (botão laranja acima) — o card fica verde sozinho.";
      return;
    }

    btnSeparar.disabled = true;
    const progresso = document.getElementById("studioProgresso");
    const aoMudarEtapa = (etapa) => { definirEtapaSeparacao(etapa); statusEl.textContent = TEXTO_ETAPA[etapa]; };
    statusEl.textContent = "Separando… pode levar de dezenas de segundos a alguns minutos.";

    try {
      const { vozBlob, instBlob, bpm, tom } = viaColab
        ? await separarViaColab(arquivoOriginal, aoMudarEtapa)
        : await separarLocal(arquivoOriginal);

      // A timeline precisa ficar visível ANTES de desenhar as formas de onda —
      // senão o canvas tem largura 0 (ainda escondido) e desenha em branco.
      setupEl.hidden = true;
      timelineEl.hidden = false;
      transporteEl.hidden = false;

      await montarFaixa("vocal", vozBlob, "#f97316");
      await montarFaixa("instrumental", instBlob, "#22d3ee");
      await montarFaixa("original", arquivoOriginal, "#8b8b8b");

      inicializarControlesFaixa();
      inicializarNomesFaixa();
      inicializarEdicaoFaixa();
      atualizarOpcoesFaixaSelect();
      montarDownloads();

      infoProjetoEl.textContent = [
        bpm ? `${bpm} BPM` : null,
        tom ? `Tom ${tom}` : null,
        "3 faixas",
      ].filter(Boolean).join(" · ");
      statusEl.textContent = "";
      pararMonitoramentoColab();
    } catch (err) {
      statusEl.textContent = `Erro: ${err.message}`;
    } finally {
      progresso.hidden = true;
      btnSeparar.disabled = false;
    }
  });

  document.getElementById("studioBtnPlay").addEventListener("click", () => {
    if (studioTocando) pausarTudo(); else tocarTudo();
  });
  document.getElementById("studioBtnStop").addEventListener("click", pararTudo);

  inicializarChatEstudio();
}

function inicializarChatEstudio() {
  const btnAbrir = document.getElementById("btnAbrirChatEstudio");
  const btnFechar = document.getElementById("btnFecharChatEstudio");
  const chatPainel = document.getElementById("studioChatPainel");
  const mensagens = document.getElementById("studioMensagens");
  const input = document.getElementById("studioComandoInput");
  const btnEnviar = document.getElementById("btnEnviarComandoStudio");
  const faixaSelect = document.getElementById("studioFaixaSelect");
  if (!btnEnviar) return;

  btnAbrir.addEventListener("click", () => { chatPainel.hidden = !chatPainel.hidden; });
  btnFechar.addEventListener("click", () => { chatPainel.hidden = true; });

  async function enviar() {
    const texto = (input.value || "").trim();
    if (!texto) return;
    input.value = "";
    adicionarMensagemChat(mensagens, texto, "usuario");
    const bolha = adicionarMensagemChat(mensagens, "Pensando…", "assistente");

    // Reconhece o nome da faixa mencionado na mensagem (ex: "abaixa o volume
    // da guitarra") — se não achar nenhum nome, usa a faixa selecionada no menu.
    let faixa = faixaSelect.value;
    const textoBusca = texto.toLowerCase();
    for (const chave of ["vocal", "instrumental"]) {
      const f = faixasEstudio[chave];
      const nome = ((f && f.nomeCustom) || NOME_PADRAO_FAIXA[chave]).toLowerCase();
      if (nome && textoBusca.includes(nome)) { faixa = chave; break; }
    }
    if (faixa !== faixaSelect.value && [...faixaSelect.options].some((o) => o.value === faixa)) {
      faixaSelect.value = faixa;
    }

    const estadoFaixa = faixasEstudio[faixa];
    const form = new FormData();
    form.append("mensagem", texto);
    form.append("faixa", faixa === "vocal" ? "Vocals" : "Instrumental");
    if (estadoFaixa) {
      form.append("arquivo", new File([estadoFaixa.blob], "stem.mp3", { type: "audio/mpeg" }));
    }

    try {
      const resp = await fetch(`${API_BASE}/api/estudio/comando`, { method: "POST", body: form });
      const dados = await resp.json();
      bolha.textContent = dados.resposta;
      if (dados.audio_base64 && faixasEstudio[faixa]) {
        const novoBlob = base64ParaBlob(dados.audio_base64, "audio/wav");
        const novoBuffer = await decodificarParaBuffer(novoBlob);
        await substituirBufferFaixa(faixa, novoBuffer);
      }
    } catch (err) {
      bolha.textContent = `Erro: ${err.message}`;
    }
  }

  btnEnviar.addEventListener("click", enviar);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      enviar();
    }
  });
}
