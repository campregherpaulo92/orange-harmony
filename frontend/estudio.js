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

  fab.addEventListener("click", () => { painel.hidden = !painel.hidden; });
  btnFechar.addEventListener("click", () => { painel.hidden = true; pausarTudo(); });

  arquivoInput.addEventListener("change", () => {
    if (arquivoInput.files[0]) {
      blobGravado = null;
      nomeArquivoEl.textContent = `Selecionado: ${arquivoInput.files[0].name}`;
    }
  });

  btnSeparar.addEventListener("click", async () => {
    const arquivoOriginal = arquivoInput.files[0] || (blobGravado
      ? new File([blobGravado], "gravacao.webm", { type: "audio/webm" })
      : null);

    if (!arquivoOriginal) { statusEl.textContent = "Grave ou suba um áudio primeiro."; return; }

    btnSeparar.disabled = true;
    statusEl.textContent = "Separando… pode levar de dezenas de segundos a alguns minutos (a 1ª vez baixa o modelo).";

    const form = new FormData();
    form.append("arquivo", arquivoOriginal);

    const controlador = new AbortController();
    const tempoLimite = setTimeout(() => controlador.abort(), 6 * 60 * 1000);

    try {
      const resp = await fetch(`${API_BASE}/api/estudio/separar`, {
        method: "POST", body: form, signal: controlador.signal,
      });
      clearTimeout(tempoLimite);
      if (!resp.ok) {
        const erro = await resp.json();
        statusEl.textContent = erro.detail || "Não foi possível separar os stems.";
        return;
      }
      const dados = await resp.json();
      const vozBlob = base64ParaBlob(dados.voz_base64, "audio/mpeg");
      const instBlob = base64ParaBlob(dados.instrumental_base64, "audio/mpeg");

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

      const infoTexto = [
        dados.bpm ? `${dados.bpm} BPM` : null,
        dados.tom ? `Tom ${dados.tom}` : null,
        "3 faixas",
      ].filter(Boolean).join(" · ");
      infoProjetoEl.textContent = infoTexto;

      statusEl.textContent = "";
    } catch (err) {
      clearTimeout(tempoLimite);
      if (err.name === "AbortError") {
        statusEl.textContent = "Isso demorou demais (mais de 6 min) e foi cancelado. Tente um trecho mais curto, ou verifique se o servidor ainda está de pé.";
      } else {
        statusEl.textContent = `Erro: ${err.message}`;
      }
    } finally {
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
