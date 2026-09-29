// ══════════════════════════════════════════════════════════════
// recorder.js — Componente de gravação com espectro animado
// Reaproveitável em qualquer página: cria um botão de mic + canvas
// de espectro dentro do elemento indicado, e devolve o áudio gravado
// (Blob) através do callback onGravado. Depende de criarPlayer()
// (player.js) para mostrar a revisão da gravação com o visual da marca.
// ══════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════
// Utilitários globais de gravação
// ══════════════════════════════════════════════════════════════

// Codifica um AudioBuffer (mono) como WAV 16-bit PCM.
function _bufferParaWavBlob(buffer) {
  const n = buffer.length;
  const canal = buffer.getChannelData(0);
  const ab = new ArrayBuffer(44 + n * 2);
  const v = new DataView(ab);
  const txt = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
  txt(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); txt(8, "WAVE"); txt(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, buffer.sampleRate, true); v.setUint32(28, buffer.sampleRate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true); txt(36, "data"); v.setUint32(40, n * 2, true);
  for (let i = 0, o = 44; i < n; i++, o += 2) {
    const x = Math.max(-1, Math.min(1, canal[i]));
    v.setInt16(o, x < 0 ? x * 0x8000 : x * 0x7fff, true);
  }
  return new Blob([ab], { type: "audio/wav" });
}

// O navegador grava em formatos diferentes (Chrome: WebM/Opus, Safari/iPhone:
// MP4/AAC, Firefox: OGG) e o servidor gratuito nem sempre consegue ler todos.
// Aqui o próprio navegador decodifica o que ele mesmo gravou e reenvia como WAV
// mono de 22050 Hz (a taxa que a análise usa) — leve, universal, sem depender do servidor.
async function converterGravacaoParaWav(blob, taxaAlvo = 22050) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  try {
    const bruto = await blob.arrayBuffer();
    const decodificado = await new Promise((ok, erro) => ctx.decodeAudioData(bruto, ok, erro));
    const OffCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const off = new OffCtx(1, Math.max(1, Math.ceil(decodificado.duration * taxaAlvo)), taxaAlvo);
    const fonte = off.createBufferSource();
    fonte.buffer = decodificado;
    fonte.connect(off.destination);
    fonte.start();
    const pronto = await new Promise((ok, erro) => {
      const r = off.startRendering();
      if (r && r.then) r.then(ok, erro); else off.oncomplete = (e) => ok(e.renderedBuffer);
    });
    return _bufferParaWavBlob(pronto);
  } finally {
    try { ctx.close(); } catch (e) { /* ignora */ }
  }
}

// Empacota a gravação como arquivo com nome/tipo coerentes com o conteúdo.
function arquivoDeGravacao(blob, base = "gravacao") {
  const tipo = blob.type || "audio/webm";
  const ext = tipo.includes("wav") ? "wav" : tipo.includes("mp4") ? "m4a" : tipo.includes("ogg") ? "ogg" : "webm";
  return new File([blob], `${base}.${ext}`, { type: tipo });
}

/**
 * Monta o gravador dentro de `container` (um elemento DOM).
 * @param {HTMLElement} container
 * @param {Object} opcoes
 * @param {(blob: Blob, duracaoSegundos: number) => void} opcoes.onGravado
 * @param {() => void} [opcoes.onExcluido] - chamado quando o usuário descarta a gravação atual
 * @param {string} [opcoes.cor] - cor do espectro (padrão laranja da marca)
 */
function criarGravador(container, opcoes = {}) {
  const cor = opcoes.cor || "#f97316";
  const onGravado = opcoes.onGravado || (() => {});
  const onExcluido = opcoes.onExcluido || (() => {});

  container.innerHTML = `
    <div class="oh-rec-box">
      <canvas class="oh-rec-canvas"></canvas>
      <button type="button" class="oh-rec-btn" aria-label="Gravar">
        <span class="oh-rec-icon">🎙️</span>
      </button>
      <div class="oh-rec-info">
        <span class="oh-rec-status">Toque para gravar</span>
        <span class="oh-rec-tempo">00:00</span>
      </div>
      <button type="button" class="oh-rec-excluir" hidden title="Descartar esta gravação">🗑️</button>
    </div>
    <div class="oh-rec-player-container" hidden></div>
  `;

  const canvas = container.querySelector(".oh-rec-canvas");
  const btn = container.querySelector(".oh-rec-btn");
  const btnExcluir = container.querySelector(".oh-rec-excluir");
  const statusEl = container.querySelector(".oh-rec-status");
  const tempoEl = container.querySelector(".oh-rec-tempo");
  const playerContainer = container.querySelector(".oh-rec-player-container");
  const ctx2d = canvas.getContext("2d");

  let stream = null;
  let audioCtx = null;
  let analyser = null;
  let mediaRecorder = null;
  let chunks = [];
  let gravando = false;
  let animando = false;
  let inicioMs = 0;
  let timerId = null;
  let playerAtual = null;

  function redimensionarCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function desenharEspectro() {
    if (!animando) return;
    requestAnimationFrame(desenharEspectro);
    const w = canvas.getBoundingClientRect().width;
    const h = canvas.getBoundingClientRect().height;
    ctx2d.clearRect(0, 0, w, h);

    if (!analyser) return;
    const dados = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(dados);

    // Barras finas e detalhadas (espaçadas, pontas arredondadas) — igual
    // ao símbolo de equalizador da marca, em vez de blocos largos e retos.
    const n = 48;
    const espacamento = w / n;
    const larguraBarra = Math.max(1.5, espacamento * 0.4);
    const raio = larguraBarra / 2;
    const meio = h / 2;
    ctx2d.fillStyle = cor;
    for (let i = 0; i < n; i++) {
      const v = dados[Math.floor(i * dados.length / n)] / 255;
      const altura = Math.max(2, v * (h / 2 - 4));
      const x = i * espacamento + (espacamento - larguraBarra) / 2;
      ctx2d.globalAlpha = 0.35 + v * 0.65;
      ctx2d.beginPath();
      ctx2d.roundRect(x, meio - altura, larguraBarra, altura, raio);
      ctx2d.roundRect(x, meio, larguraBarra, altura, raio);
      ctx2d.fill();
    }
    ctx2d.globalAlpha = 1;
  }

  function formatarTempo(ms) {
    const totalSeg = Math.floor(ms / 1000);
    const min = Math.floor(totalSeg / 60);
    const seg = totalSeg % 60;
    return `${String(min).padStart(2, "0")}:${String(seg).padStart(2, "0")}`;
  }

  async function iniciarGravacao() {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      statusEl.textContent = "Sem permissão de microfone.";
      return;
    }

    // Uma nova gravação começando descarta a revisão anterior, se houver
    limparRevisao();

    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const fonte = audioCtx.createMediaStreamSource(stream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 128;
    fonte.connect(analyser);

    chunks = [];
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    mediaRecorder.onstop = async () => {
      const tipoBruto = (mediaRecorder && mediaRecorder.mimeType) || "audio/webm";
      let blob = new Blob(chunks, { type: tipoBruto });
      const duracaoSegundos = (Date.now() - inicioMs) / 1000;
      statusEl.textContent = "Preparando o áudio…";
      try {
        blob = await converterGravacaoParaWav(blob);
      } catch (e) {
        // se o navegador não conseguir converter, segue com o original
        // (o servidor ainda tenta ler WebM/MP4 por conta própria)
      }
      statusEl.textContent = "Toque para gravar de novo";
      mostrarRevisao(blob);
      onGravado(blob, duracaoSegundos);
    };
    mediaRecorder.start();

    gravando = true;
    animando = true;
    inicioMs = Date.now();
    redimensionarCanvas();
    desenharEspectro();

    btn.classList.add("oh-rec-ativo");
    statusEl.textContent = "Gravando… toque para parar";

    timerId = setInterval(() => {
      tempoEl.textContent = formatarTempo(Date.now() - inicioMs);
    }, 200);
  }

  function pararGravacao() {
    gravando = false;
    animando = false;
    clearInterval(timerId);
    btn.classList.remove("oh-rec-ativo");
    statusEl.textContent = "Toque para gravar de novo";

    if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop();
    if (stream) stream.getTracks().forEach((t) => t.stop());
    if (audioCtx) audioCtx.close();

    ctx2d.clearRect(0, 0, canvas.width, canvas.height);
  }

  function mostrarRevisao(blob) {
    const url = URL.createObjectURL(blob);
    playerAtual = criarPlayer(playerContainer, { src: url, cor, semDownload: false, nomeArquivo: "gravacao.wav" });
    playerContainer.hidden = false;
    btnExcluir.hidden = false;
  }

  function limparRevisao() {
    if (playerAtual) {
      playerAtual.destruir();
      playerAtual = null;
    }
    playerContainer.innerHTML = "";
    playerContainer.hidden = true;
    btnExcluir.hidden = true;
  }

  btn.addEventListener("click", () => {
    if (!gravando) iniciarGravacao(); else pararGravacao();
  });

  btnExcluir.addEventListener("click", () => {
    limparRevisao();
    statusEl.textContent = "Toque para gravar";
    tempoEl.textContent = "00:00";
    onExcluido();
  });

  window.addEventListener("resize", redimensionarCanvas);
  redimensionarCanvas();

  return {
    parar: pararGravacao,
    limpar: limparRevisao,
  };
}
