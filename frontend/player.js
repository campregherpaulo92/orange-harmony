// ══════════════════════════════════════════════════════════════
// player.js — Player de áudio personalizado, no visual da marca.
// Substitui o <audio controls> nativo (caixa branca genérica) em
// qualquer lugar do app: revisão de gravação, "Minhas gravações",
// Conversor, Produção, Edição Vocal.
// ══════════════════════════════════════════════════════════════

/**
 * Monta um player dentro de `container`.
 * @param {HTMLElement} container
 * @param {Object} opcoes
 * @param {string} opcoes.src - URL do áudio (blob: ou http)
 * @param {string} [opcoes.cor] - cor do espectro/detalhes (padrão laranja da marca)
 * @param {string} [opcoes.nomeArquivo] - nome sugerido pro download
 * @param {boolean} [opcoes.semDownload] - esconde o botão de baixar
 */
function criarPlayer(container, opcoes = {}) {
  const cor = opcoes.cor || "#f97316";
  const src = opcoes.src;
  const nomeArquivo = opcoes.nomeArquivo || "audio.wav";
  const semDownload = !!opcoes.semDownload;

  container.innerHTML = `
    <div class="oh-player-box">
      <canvas class="oh-player-canvas"></canvas>
      <div class="oh-player-controles">
        <button type="button" class="oh-player-play" aria-label="Tocar">▶</button>
        <span class="oh-player-tempo">0:00 / 0:00</span>
        <input type="range" class="oh-player-progresso" min="0" max="100" value="0">
        <button type="button" class="oh-player-mute" aria-label="Mudo">🔊</button>
        <select class="oh-player-velocidade" aria-label="Velocidade">
          <option value="0.5">0.5x</option>
          <option value="1" selected>1x</option>
          <option value="1.5">1.5x</option>
          <option value="2">2x</option>
        </select>
        ${semDownload ? "" : `<a class="oh-player-download" download="${nomeArquivo}" aria-label="Baixar">⬇️</a>`}
      </div>
      <audio class="oh-player-audio" preload="metadata"></audio>
    </div>
  `;

  const canvas = container.querySelector(".oh-player-canvas");
  const btnPlay = container.querySelector(".oh-player-play");
  const tempoEl = container.querySelector(".oh-player-tempo");
  const progresso = container.querySelector(".oh-player-progresso");
  const btnMute = container.querySelector(".oh-player-mute");
  const selectVel = container.querySelector(".oh-player-velocidade");
  const linkDownload = container.querySelector(".oh-player-download");
  const audio = container.querySelector(".oh-player-audio");
  const ctx2d = canvas.getContext("2d");

  audio.src = src;
  if (linkDownload) linkDownload.href = src;

  let audioCtx = null;
  let analyser = null;
  let fonteConectada = false;
  let animando = false;
  let arrastandoProgresso = false;

  function formatarTempo(seg) {
    if (!isFinite(seg) || isNaN(seg)) return "0:00";
    const m = Math.floor(seg / 60);
    const s = Math.floor(seg % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  // MediaElementSource só pode ser criado UMA vez por elemento <audio> —
  // como cada criarPlayer() monta seu próprio <audio> do zero, isso é seguro.
  function conectarAnalyser() {
    if (fonteConectada) return;
    fonteConectada = true;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const fonte = audioCtx.createMediaElementSource(audio);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 128;
    fonte.connect(analyser);
    analyser.connect(audioCtx.destination);
  }

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
    const n = 48;
    const espacamento = w / n;
    const larguraBarra = Math.max(1.5, espacamento * 0.4);
    const raio = larguraBarra / 2;
    ctx2d.fillStyle = cor;
    for (let i = 0; i < n; i++) {
      const v = dados[Math.floor(i * dados.length / n)] / 255;
      const altura = Math.max(2, v * h);
      const x = i * espacamento + (espacamento - larguraBarra) / 2;
      ctx2d.globalAlpha = 0.35 + v * 0.65;
      ctx2d.beginPath();
      ctx2d.roundRect(x, h - altura, larguraBarra, altura, raio);
      ctx2d.fill();
    }
    ctx2d.globalAlpha = 1;
  }

  btnPlay.addEventListener("click", async () => {
    conectarAnalyser();
    if (audioCtx.state === "suspended") await audioCtx.resume();
    if (audio.paused) audio.play(); else audio.pause();
  });

  audio.addEventListener("play", () => {
    btnPlay.textContent = "⏸";
    animando = true;
    redimensionarCanvas();
    desenharEspectro();
  });
  audio.addEventListener("pause", () => {
    btnPlay.textContent = "▶";
    animando = false;
  });
  audio.addEventListener("ended", () => {
    btnPlay.textContent = "▶";
    animando = false;
    ctx2d.clearRect(0, 0, canvas.width, canvas.height);
  });

  audio.addEventListener("loadedmetadata", () => {
    progresso.max = Math.floor(audio.duration) || 0;
    tempoEl.textContent = `0:00 / ${formatarTempo(audio.duration)}`;
  });

  audio.addEventListener("timeupdate", () => {
    if (!arrastandoProgresso) progresso.value = Math.floor(audio.currentTime);
    tempoEl.textContent = `${formatarTempo(audio.currentTime)} / ${formatarTempo(audio.duration)}`;
  });

  progresso.addEventListener("mousedown", () => { arrastandoProgresso = true; });
  progresso.addEventListener("touchstart", () => { arrastandoProgresso = true; });
  progresso.addEventListener("change", () => {
    audio.currentTime = parseFloat(progresso.value);
    arrastandoProgresso = false;
  });

  btnMute.addEventListener("click", () => {
    audio.muted = !audio.muted;
    btnMute.textContent = audio.muted ? "🔇" : "🔊";
  });

  selectVel.addEventListener("change", () => {
    audio.playbackRate = parseFloat(selectVel.value);
  });

  window.addEventListener("resize", redimensionarCanvas);
  redimensionarCanvas();

  return {
    audio,
    destruir: () => {
      animando = false;
      if (audioCtx) audioCtx.close();
    },
  };
}
