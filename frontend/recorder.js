// ══════════════════════════════════════════════════════════════
// recorder.js — Componente de gravação com espectro animado
// Reaproveitável em qualquer página: cria um botão de mic + canvas
// de espectro dentro do elemento indicado, e devolve o áudio gravado
// (Blob) através do callback onGravado. Depende de criarPlayer()
// (player.js) para mostrar a revisão da gravação com o visual da marca.
// ══════════════════════════════════════════════════════════════

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
    mediaRecorder.onstop = () => {
      const blob = new Blob(chunks, { type: "audio/webm" });
      const duracaoSegundos = (Date.now() - inicioMs) / 1000;
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
    playerAtual = criarPlayer(playerContainer, { src: url, cor, semDownload: false, nomeArquivo: "gravacao.webm" });
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
