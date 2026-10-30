// ══════════════════════════════════════════════════════════════
// miniplayer.js — Mini player flutuante (como o do Spotify), para tocar a Biblioteca enquanto você usa o resto do app.
//  • play/pause, música anterior e próxima, clicar na linha do tempo para adiantar ou atrasar, tempo, espectro, nome da música;
//  • aleatório, repetir (desligado / todas / uma) e velocidade;
//  • no computador: janela solta que dá para arrastar, redimensionar e fechar; no celular: barra fixa na base;
//  • continua tocando quando você troca de aba (ex.: vai ler a letra cifrada em Composições);
//  • botões do fone e da tela de bloqueio (Media Session).
// API: MiniPlayer.tocar(fila, indice) · .alternar(fila, indice) · .atualizarFila(fila) · .fechar() · .atual() · .estaTocando()
//   fila = [{ id, nome }, ...] — as gravações da Biblioteca, na ordem da lista. O áudio vem de /api/gravacoes/{id}.
// Evento: "oh-mp-estado" (document) com detail { id, tocando } sempre que a música ou o play/pause muda.
// ══════════════════════════════════════════════════════════════
(function () {
  "use strict";

  const CHAVE = "oh_miniplayer";
  const LARG_PADRAO = 330, ALT_PADRAO = 196, LARG_MIN = 270, ALT_MIN = 176, LARG_MAX = 640, ALT_MAX = 420, MARGEM = 8;
  const VELOCIDADES = [1, 1.25, 1.5, 2, 0.75, 0.5];
  const REPETIR = ["off", "todas", "uma"];
  // No iPhone, ligar o áudio ao analisador do Web Audio pode fazer a música parar quando a tela bloqueia.
  // Lá as barras são só uma animação (não seguem o som); nos outros aparelhos elas seguem o som de verdade.
  const EH_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const base = () => (typeof API_BASE === "string" ? API_BASE : "");
  const celular = window.matchMedia("(max-width: 560px)");

  const audio = new Audio();
  audio.preload = "metadata";

  let caixa = null, partes = null;             // elementos da tela (criados na primeira vez)
  let fila = [], ordem = [], pos = 0;          // fila (como veio da lista), ordem de execução e posição nela
  let aleatorio = false, repetir = "off", velocidade = 1;
  let compacto = null;                          // null = automático (minimizado no celular); true/false = escolha da pessoa
  let geometria = { x: null, y: null, w: LARG_PADRAO, h: ALT_PADRAO };
  let tocando = false, arrastandoBarra = false, corrigindo = false, tentouCorrigir = false, querTocar = false;
  let falhasSeguidas = 0, desenhando = false;
  let audioCtx = null, analisador = null;

  // ───────────── utilidades ─────────────
  // Ícones próprios do Orange Harmony: silhueta preta sobre círculo laranja (ver identidade.css)
  const ICONES = {
    aleatorio: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h3.2c1.6 0 2.6.7 3.4 1.9l1.9 2.9 1.9-2.9C14.2 6.7 15.2 6 16.8 6H21v2.2h-4.2c-.6 0-1 .3-1.4.8L13.4 12l2 3c.4.5.8.8 1.4.8H21V18h-4.2c-1.6 0-2.6-.7-3.4-1.9l-1.9-2.9-1.9 2.9C9 17.3 8 18 6.4 18H3v-2.2h3.4c.6 0 1-.3 1.4-.8L10.6 12l-1.8-3c-.4-.5-.8-.8-1.4-.8H3z"/><path d="M17.5 3.5 21 6.5l-3.5 3z"/><path d="M17.5 14.5 21 17.5l-3.5 3z"/></svg>',
    anterior: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="6" width="2.4" height="12" rx=".6"/><path d="M19 6v12l-9-6z"/></svg>',
    proxima: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6v12l9-6z"/><rect x="16.6" y="6" width="2.4" height="12" rx=".6"/></svg>',
    tocar: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13c0 .7.8 1.1 1.4.7l10-6.5c.5-.3.5-1.1 0-1.4l-10-6.5C8.8 4.4 8 4.8 8 5.5z"/></svg>',
    pausar: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>',
    repetir: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h10.5a2.5 2.5 0 0 1 2.5 2.5V11h-2.2V9.5a.3.3 0 0 0-.3-.3H7a.3.3 0 0 0-.3.3V11H4.5V9.5A2.5 2.5 0 0 1 7 7z"/><path d="M17 17H6.5A2.5 2.5 0 0 1 4 14.5V13h2.2v1.5c0 .2.1.3.3.3H17c.2 0 .3-.1.3-.3V13H19.5v1.5A2.5 2.5 0 0 1 17 17z"/><path d="M15.5 3.8 19.4 7l-3.9 3.2z"/><path d="M8.5 13.2 4.6 17l3.9 3.2z"/></svg>',
    repetirUma: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h10.5a2.5 2.5 0 0 1 2.5 2.5V11h-2.2V9.5a.3.3 0 0 0-.3-.3H7a.3.3 0 0 0-.3.3V11H4.5V9.5A2.5 2.5 0 0 1 7 7z"/><path d="M17 17H6.5A2.5 2.5 0 0 1 4 14.5V13h2.2v1.5c0 .2.1.3.3.3H17c.2 0 .3-.1.3-.3V13H19.5v1.5A2.5 2.5 0 0 1 17 17z"/><path d="M15.5 3.8 19.4 7l-3.9 3.2z"/><path d="M8.5 13.2 4.6 17l3.9 3.2z"/><text x="12" y="14.3" font-size="6.5" font-weight="800" text-anchor="middle" fill="#fff" stroke="#0d0a08" stroke-width=".6" font-family="sans-serif">1</text></svg>',
    nota: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 17.5V6.2l10-2v11.3" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="6.8" cy="17.6" r="2.6"/><circle cx="16.8" cy="15.6" r="2.6"/></svg>',
    descer: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    subir: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 15l6-6 6 6" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    fechar: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>',
  };
  const el = (tag, classe, texto) => { const e = document.createElement(tag); if (classe) e.className = classe; if (texto !== undefined) e.textContent = texto; return e; };
  const limitar = (v, a, b) => Math.min(Math.max(v, a), Math.max(a, b));
  const tempo = (s) => { if (!isFinite(s) || s < 0) return "0:00"; return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`; };
  const faixa = () => fila[ordem[pos]] || null;
  const estaCompacto = () => (compacto === null ? celular.matches : compacto);

  function lerPreferencias() {
    try {
      const p = JSON.parse(localStorage.getItem(CHAVE) || "{}");
      if (p && typeof p === "object") {
        ["x", "y", "w", "h"].forEach((k) => { if (Number.isFinite(p[k])) geometria[k] = p[k]; });
        aleatorio = !!p.aleatorio;
        repetir = REPETIR.includes(p.repetir) ? p.repetir : "off";
        velocidade = VELOCIDADES.includes(p.velocidade) ? p.velocidade : 1;
        compacto = typeof p.compacto === "boolean" ? p.compacto : null;
      }
    } catch (e) { /* sem preferências guardadas */ }
  }
  function guardarPreferencias() {
    try { localStorage.setItem(CHAVE, JSON.stringify({ ...geometria, aleatorio, repetir, velocidade, compacto })); } catch (e) { /* navegador sem armazenamento */ }
  }
  function avisar() {
    const f = faixa();
    document.dispatchEvent(new CustomEvent("oh-mp-estado", { detail: { id: caixa && !caixa.hidden && f ? f.id : null, tocando } }));
  }

  // ───────────── tela ─────────────
  function montar() {
    caixa = el("div", "oh-mp");
    caixa.id = "ohMiniPlayer";
    caixa.setAttribute("role", "region");
    caixa.setAttribute("aria-label", "Mini player");
    caixa.hidden = true;

    const topo = el("div", "oh-mp-topo");
    topo.appendChild(el("span", "oh-mp-icone oh-mp-icone-svg", "")); topo.lastChild.innerHTML = ICONES.nota;
    const titulo = el("div", "oh-mp-titulo");
    titulo.setAttribute("aria-live", "polite");
    const tituloTexto = el("span", "oh-mp-titulo-texto", "");
    titulo.appendChild(tituloTexto);
    const minimizar = el("button", "oh-mp-minimizar", ""); minimizar.innerHTML = ICONES.descer;
    minimizar.type = "button";
    const fechar = el("button", "oh-mp-fechar", ""); fechar.innerHTML = ICONES.fechar;
    fechar.type = "button";
    fechar.setAttribute("aria-label", "Fechar o player");
    topo.append(titulo, minimizar, fechar);

    const canvas = el("canvas", "oh-mp-espectro");
    canvas.setAttribute("aria-hidden", "true");

    const linha = el("div", "oh-mp-linha");
    const atual = el("span", "oh-mp-tempo", "0:00");
    const barra = el("input", "oh-mp-barra");
    barra.type = "range"; barra.min = "0"; barra.max = "1000"; barra.step = "1"; barra.value = "0";
    barra.setAttribute("aria-label", "Posição da música");
    const total = el("span", "oh-mp-tempo", "0:00");
    linha.append(atual, barra, total);

    const controles = el("div", "oh-mp-controles");
    const botao = (classe, texto, rotulo) => { const b = el("button", classe, ""); if (texto.startsWith("<")) b.innerHTML = texto; else b.textContent = texto; b.type = "button"; b.setAttribute("aria-label", rotulo); b.title = rotulo; return b; };
    const bAleatorio = botao("oh-mp-btn oh-mp-aleatorio", ICONES.aleatorio, "Aleatório");
    const bAnterior = botao("oh-mp-btn oh-mp-anterior", ICONES.anterior, "Música anterior");
    const bPlay = botao("oh-mp-btn oh-mp-play", ICONES.tocar, "Tocar");
    const bProxima = botao("oh-mp-btn oh-mp-proxima", ICONES.proxima, "Próxima música");
    const bRepetir = botao("oh-mp-btn oh-mp-repetir", ICONES.repetir, "Repetir: desligado");
    const bVelocidade = botao("oh-mp-btn oh-mp-velocidade", "1x", "Velocidade");
    const tomSlot = el("span", "oh-mp-tom");
    controles.append(bAleatorio, bAnterior, bPlay, bProxima, bRepetir, bVelocidade, tomSlot);

    const alca = el("div", "oh-mp-redimensionar");
    alca.setAttribute("aria-hidden", "true");
    caixa.append(topo, canvas, linha, controles, alca);
    document.body.appendChild(caixa);
    partes = { topo, tituloTexto, minimizar, fechar, canvas, atual, barra, total, bAleatorio, bAnterior, bPlay, bProxima, bRepetir, bVelocidade, alca, tomSlot, tom: null, ctx2d: canvas.getContext("2d") };

    fechar.addEventListener("click", fecharPlayer);
    minimizar.addEventListener("click", () => { compacto = !estaCompacto(); guardarPreferencias(); aplicarCompacto(); });
    bPlay.addEventListener("click", alternarPlay);
    bProxima.addEventListener("click", () => proxima(false));
    bAnterior.addEventListener("click", anterior);
    bAleatorio.addEventListener("click", () => { aleatorio = !aleatorio; reconstruirOrdem(); desenharModos(); guardarPreferencias(); });
    bRepetir.addEventListener("click", () => { repetir = REPETIR[(REPETIR.indexOf(repetir) + 1) % REPETIR.length]; desenharModos(); guardarPreferencias(); });
    bVelocidade.addEventListener("click", () => { velocidade = VELOCIDADES[(VELOCIDADES.indexOf(velocidade) + 1) % VELOCIDADES.length]; audio.playbackRate = velocidade; desenharModos(); guardarPreferencias(); });

    barra.addEventListener("input", () => {                       // arrastando: só mostra o tempo; o salto é no "change"
      arrastandoBarra = true;
      if (isFinite(audio.duration)) partes.atual.textContent = tempo((barra.value / 1000) * audio.duration);
      pintarBarra();
    });
    barra.addEventListener("change", () => {
      if (isFinite(audio.duration) && audio.duration > 0) audio.currentTime = (barra.value / 1000) * audio.duration;
      arrastandoBarra = false;
    });

    instalarArrastar();
    instalarRedimensionar();
    new ResizeObserver(() => { ajustarCanvas(); if (celular.matches && !caixa.hidden) document.documentElement.style.setProperty("--oh-mp-altura", `${caixa.offsetHeight}px`); }).observe(caixa);
    window.addEventListener("resize", aplicarGeometria);
    celular.addEventListener("change", aplicarCompacto);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) iniciarDesenho(); });
    lerPreferencias();
    desenharModos();
    aplicarCompacto();
  }

  function aplicarCompacto() {
    if (!partes) return;
    const c = estaCompacto();
    caixa.classList.toggle("oh-mp-compacto", c);
    partes.minimizar.innerHTML = c ? ICONES.subir : ICONES.descer;
    const texto = c ? "Expandir o player" : "Minimizar o player";
    partes.minimizar.title = texto;
    partes.minimizar.setAttribute("aria-label", texto);
    partes.minimizar.setAttribute("aria-expanded", String(!c));
    aplicarGeometria();
    ajustarCanvas();
    if (!c) iniciarDesenho();
  }

  function desenharModos() {
    if (!partes) return;
    partes.bAleatorio.classList.toggle("oh-mp-ligado", aleatorio);
    partes.bAleatorio.setAttribute("aria-pressed", String(aleatorio));
    const textoAleatorio = aleatorio ? "Aleatório: ligado" : "Aleatório: desligado";
    partes.bAleatorio.title = textoAleatorio; partes.bAleatorio.setAttribute("aria-label", textoAleatorio);
    partes.bRepetir.innerHTML = repetir === "uma" ? ICONES.repetirUma : ICONES.repetir;
    partes.bRepetir.classList.toggle("oh-mp-ligado", repetir !== "off");
    partes.bRepetir.setAttribute("aria-pressed", String(repetir !== "off"));
    const textoRepetir = repetir === "off" ? "Repetir: desligado" : repetir === "todas" ? "Repetir: todas as músicas" : "Repetir: esta música";
    partes.bRepetir.title = textoRepetir; partes.bRepetir.setAttribute("aria-label", textoRepetir);
    partes.bVelocidade.textContent = `${velocidade}x`.replace(".", ",");
    partes.bVelocidade.setAttribute("aria-label", `Velocidade ${velocidade}x`);
    audio.playbackRate = audio.defaultPlaybackRate = velocidade;
  }

  function desenharEstado() {
    if (!partes) return;
    partes.bPlay.innerHTML = tocando ? ICONES.pausar : ICONES.tocar;
    partes.bPlay.setAttribute("aria-label", tocando ? "Pausar" : "Tocar");
    partes.bPlay.title = tocando ? "Pausar" : "Tocar";
    caixa.classList.toggle("oh-mp-tocando", tocando);
  }

  function pintarBarra() {
    const pct = (partes.barra.value / 1000) * 100;
    partes.barra.style.setProperty("--mp-prog", `${pct}%`);
  }

  function atualizarTempo() {
    if (!partes || corrigindo) return;
    const dur = audio.duration, finito = isFinite(dur) && dur > 0;
    partes.total.textContent = finito ? tempo(dur) : "--:--";
    partes.barra.disabled = !finito;
    if (!arrastandoBarra) {
      partes.atual.textContent = tempo(audio.currentTime);
      partes.barra.value = finito ? String(Math.round((audio.currentTime / dur) * 1000)) : "0";
      pintarBarra();
    }
    partes.barra.setAttribute("aria-valuetext", finito ? `${tempo(audio.currentTime)} de ${tempo(dur)}` : tempo(audio.currentTime));
    if (finito && "mediaSession" in navigator && navigator.mediaSession.setPositionState) {
      try { navigator.mediaSession.setPositionState({ duration: dur, position: Math.min(audio.currentTime, dur), playbackRate: audio.playbackRate || 1 }); } catch (e) { /* valores fora do limite */ }
    }
  }

  // ───────────── espectro ─────────────
  function ajustarCanvas() {
    if (!partes) return;
    const dpr = window.devicePixelRatio || 1, r = partes.canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    partes.canvas.width = Math.round(r.width * dpr);
    partes.canvas.height = Math.round(r.height * dpr);
    partes.ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function ligarAnalisador() {
    if (EH_IOS || audioCtx) return;
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const fonte = audioCtx.createMediaElementSource(audio);
      analisador = audioCtx.createAnalyser();
      analisador.fftSize = 128;
      fonte.connect(analisador);
      analisador.connect(audioCtx.destination);
    } catch (e) { audioCtx = analisador = null; }
  }

  function desenharEspectro(agora) {
    if (!desenhando) return;
    if (!tocando || document.hidden || !caixa || caixa.hidden) { desenhando = false; limparEspectro(); return; }
    requestAnimationFrame(desenharEspectro);
    const { ctx2d, canvas } = partes, r = canvas.getBoundingClientRect(), w = r.width, h = r.height, n = Math.max(16, Math.min(64, Math.round(w / 6)));
    ctx2d.clearRect(0, 0, w, h);
    let dados = null;
    if (analisador) { dados = new Uint8Array(analisador.frequencyBinCount); analisador.getByteFrequencyData(dados); }
    const passo = w / n, largura = Math.max(2, passo * 0.5), raio = largura / 2;
    ctx2d.fillStyle = "#f97316";
    for (let i = 0; i < n; i++) {
      const v = dados ? dados[Math.floor((i * dados.length) / n)] / 255
        : 0.18 + 0.5 * Math.abs(Math.sin(agora / 380 + i * 0.7)) * (0.55 + 0.45 * Math.sin(agora / 910 + i * 1.3));   // animação (iPhone)
      const altura = Math.max(2, v * h), x = i * passo + (passo - largura) / 2;
      ctx2d.globalAlpha = 0.35 + v * 0.65;
      ctx2d.beginPath();
      if (ctx2d.roundRect) ctx2d.roundRect(x, h - altura, largura, altura, raio); else ctx2d.rect(x, h - altura, largura, altura);
      ctx2d.fill();
    }
    ctx2d.globalAlpha = 1;
  }

  function limparEspectro() {
    if (!partes) return;
    const r = partes.canvas.getBoundingClientRect();
    partes.ctx2d.clearRect(0, 0, r.width, r.height);
    const n = Math.max(16, Math.min(64, Math.round(r.width / 6))), passo = r.width / n, largura = Math.max(2, passo * 0.5);
    partes.ctx2d.fillStyle = "rgba(249,115,22,0.35)";
    for (let i = 0; i < n; i++) partes.ctx2d.fillRect(i * passo + (passo - largura) / 2, r.height - 2, largura, 2);   // barrinhas baixas quando parado
  }

  function iniciarDesenho() {
    if (desenhando || !tocando || !caixa || caixa.hidden) return;
    desenhando = true;
    ajustarCanvas();
    requestAnimationFrame(desenharEspectro);
  }

  // ───────────── posição, arrastar e redimensionar ─────────────
  function aplicarGeometria() {
    if (!caixa || caixa.hidden) return;                          // escondido: nada a posicionar (a altura ainda seria zero)
    if (celular.matches) {                                         // no celular: barra fixa na base (CSS cuida do resto)
      ["left", "top", "width", "height"].forEach((p) => caixa.style.removeProperty(p));
      document.body.classList.toggle("oh-mp-aberto", !caixa.hidden);
      document.documentElement.style.setProperty("--oh-mp-altura", `${caixa.offsetHeight}px`);
      return;
    }
    document.body.classList.remove("oh-mp-aberto");
    const vw = window.innerWidth, vh = window.innerHeight, c = estaCompacto();
    geometria.w = limitar(geometria.w, LARG_MIN, Math.min(LARG_MAX, vw - 2 * MARGEM));
    geometria.h = limitar(geometria.h, ALT_MIN, Math.min(ALT_MAX, vh - 2 * MARGEM));
    caixa.style.height = c ? "auto" : `${geometria.h}px`;           // minimizado: a altura é a do conteúdo (uma linha + a linha do tempo)
    caixa.style.width = `${geometria.w}px`;
    const altura = c ? caixa.offsetHeight : geometria.h;
    if (geometria.x === null || geometria.y === null) {            // posição inicial: canto inferior direito, ao lado dos botões redondos
      geometria.x = vw - geometria.w - 112;
      geometria.y = vh - altura - 24;
    }
    geometria.x = limitar(geometria.x, MARGEM, vw - geometria.w - MARGEM);
    geometria.y = limitar(geometria.y, MARGEM, vh - altura - MARGEM);
    Object.assign(caixa.style, { left: `${geometria.x}px`, top: `${geometria.y}px` });
  }

  function instalarArrastar() {
    let inicio = null;
    caixa.addEventListener("pointerdown", (ev) => {
      if (celular.matches || (ev.pointerType === "mouse" && ev.button !== 0) || ev.target.closest("button, input, .oh-mp-redimensionar")) return;
      inicio = { px: ev.clientX, py: ev.clientY, x: geometria.x, y: geometria.y };
      caixa.setPointerCapture(ev.pointerId);
      caixa.classList.add("oh-mp-movendo");
    });
    caixa.addEventListener("pointermove", (ev) => {
      if (!inicio) return;
      geometria.x = inicio.x + (ev.clientX - inicio.px);
      geometria.y = inicio.y + (ev.clientY - inicio.py);
      aplicarGeometria();
    });
    const soltar = () => { if (!inicio) return; inicio = null; caixa.classList.remove("oh-mp-movendo"); guardarPreferencias(); };
    caixa.addEventListener("pointerup", soltar);
    caixa.addEventListener("pointercancel", soltar);
  }

  function instalarRedimensionar() {
    let inicio = null;
    partes.alca.addEventListener("pointerdown", (ev) => {
      if (celular.matches) return;
      inicio = { px: ev.clientX, py: ev.clientY, w: geometria.w, h: geometria.h };
      partes.alca.setPointerCapture(ev.pointerId);
      ev.stopPropagation();
    });
    partes.alca.addEventListener("pointermove", (ev) => {
      if (!inicio) return;
      geometria.w = inicio.w + (ev.clientX - inicio.px);
      geometria.h = inicio.h + (ev.clientY - inicio.py);
      aplicarGeometria();
    });
    const soltar = () => { if (!inicio) return; inicio = null; guardarPreferencias(); };
    partes.alca.addEventListener("pointerup", soltar);
    partes.alca.addEventListener("pointercancel", soltar);
  }

  // ───────────── fila e reprodução ─────────────
  function embaralhar(lista) {
    for (let i = lista.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [lista[i], lista[j]] = [lista[j], lista[i]]; }
    return lista;
  }

  function reconstruirOrdem() {
    const atualIdx = ordem.length ? ordem[pos] : 0;
    let indices = fila.map((_, i) => i);
    if (aleatorio) indices = [atualIdx, ...embaralhar(indices.filter((i) => i !== atualIdx))];
    ordem = indices;
    pos = Math.max(0, ordem.indexOf(atualIdx));
  }

  // ── Tom (− / +) por gravação, guardado neste aparelho ──
  let srcOriginal = "";

  async function aplicarTom(semitons, idFaixa) {
    const f = faixa();
    if (!partes || !f || String(f.id) !== String(idFaixa)) return;   // trocou de música no meio do caminho
    const estavaTocando = !audio.paused;
    const pos = audio.currentTime;
    const cont = partes.tom && partes.tom.el;
    if (cont) cont.classList.add("oh-tom-processando");
    try {
      const url = await window.Transposicao.obterUrl(srcOriginal, semitons);
      if (!partes || !faixa() || String(faixa().id) !== String(idFaixa)) return;
      audio.src = url;
      audio.addEventListener("loadedmetadata", () => {
        audio.currentTime = pos;
        if (estavaTocando) audio.play().catch(() => {});
      }, { once: true });
    } catch (erro) {
      console.error("Falha ao mudar o tom:", erro);
      if (partes.tom) partes.tom.definir(0);
      alert("Não consegui mudar o tom desta gravação neste aparelho.");
    } finally {
      if (cont) cont.classList.remove("oh-tom-processando");
    }
  }

  function montarTom(f) {
    if (!partes || !window.Transposicao) return;
    partes.tomSlot.replaceChildren();
    const t = window.Transposicao.montarControle({
      chave: String(f.id),
      onMudar: (s) => aplicarTom(s, f.id),
    });
    partes.tom = t;
    partes.tomSlot.appendChild(t.el);
    if (t.semitons) aplicarTom(t.semitons, f.id);
  }

  function carregar(querTocarAgora) {
    const f = faixa();
    if (!f) return;
    querTocar = querTocarAgora;
    tentouCorrigir = false;
    corrigindo = false;
    arrastandoBarra = false;
    partes.tituloTexto.textContent = f.nome || "Gravação";
    partes.tituloTexto.parentElement.title = f.nome || "";
    partes.barra.value = "0"; pintarBarra();
    partes.atual.textContent = "0:00"; partes.total.textContent = "--:--";
    audio.src = `${base()}/api/gravacoes/${encodeURIComponent(f.id)}`;
    srcOriginal = audio.src;
    montarTom(f);
    audio.playbackRate = velocidade;
    atualizarMediaSession();
    if (querTocarAgora) {
      ligarAnalisador();
      if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
      const p = audio.play();
      if (p && p.catch) p.catch(() => { /* o navegador pode pedir um toque; o botão de play continua disponível */ });
    }
    avisar();
  }

  function tocar(novaFila, indice) {
    if (!Array.isArray(novaFila) || !novaFila[indice]) return;
    if (!caixa) montar();
    fila = novaFila.map((g) => ({ id: g.id, nome: g.nome }));
    ordem = fila.map((_, i) => i);
    pos = indice;
    reconstruirOrdem();
    falhasSeguidas = 0;
    caixa.hidden = false;
    controlarMidia(true);
    aplicarGeometria();
    carregar(true);
    ajustarCanvas();
  }

  function alternarPlay() {
    if (!faixa()) return;
    if (audio.ended) { audio.currentTime = 0; }
    if (audio.paused) {
      ligarAnalisador();
      if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
      const p = audio.play();
      if (p && p.catch) p.catch(() => {});
    } else audio.pause();
  }

  function alternar(novaFila, indice) {
    const alvo = novaFila && novaFila[indice];
    const f = faixa();
    if (caixa && !caixa.hidden && f && alvo && f.id === alvo.id) alternarPlay();
    else tocar(novaFila, indice);
  }

  function irPara(novaPos, tocarAgora) {
    pos = novaPos;
    carregar(tocarAgora);
  }

  function proxima(automatica) {
    if (!fila.length) return;
    if (pos + 1 < ordem.length) { irPara(pos + 1, true); return; }
    if (repetir === "todas" || (!automatica && fila.length > 1)) {          // fim da fila: volta ao começo (com novo sorteio se for aleatório)
      if (aleatorio) { const ultimo = ordem[pos]; let novo = embaralhar(fila.map((_, i) => i)); if (novo.length > 1 && novo[0] === ultimo) novo.push(novo.shift()); ordem = novo; }
      irPara(0, true);
      return;
    }
    if (automatica) { audio.pause(); audio.currentTime = 0; atualizarTempo(); return; }   // acabou a fila: para
    audio.currentTime = 0;                                                  // só uma música na fila e a pessoa tocou em "próxima": recomeça
    if (audio.paused) alternarPlay();
  }

  function anterior() {
    if (!fila.length) return;
    if (audio.currentTime > 3) { audio.currentTime = 0; return; }          // já tocou mais de 3 s: volta ao início desta música
    if (pos > 0) { irPara(pos - 1, true); return; }
    if (repetir === "todas" && ordem.length > 1) { irPara(ordem.length - 1, true); return; }   // primeira da fila com "repetir todas": vai para a última
    audio.currentTime = 0;                                                  // primeira da fila: volta ao início
  }

  function atualizarFila(novaFila) {
    if (!caixa || caixa.hidden || !Array.isArray(novaFila)) return;
    const f = faixa();
    const nova = novaFila.map((g) => ({ id: g.id, nome: g.nome }));
    if (f) {
      const idx = nova.findIndex((g) => g.id === f.id);
      if (idx >= 0) {                                                       // a música atual continua na lista: mantém a reprodução, só atualiza o nome
        const idsDaOrdem = ordem.map((i) => fila[i] && fila[i].id);
        fila = nova;
        if (aleatorio) {                                                    // mantém a ordem sorteada (as que saíram somem, as novas vão para o fim)
          const mapa = new Map(fila.map((g, i) => [g.id, i]));
          ordem = idsDaOrdem.filter((id) => mapa.has(id)).map((id) => mapa.get(id));
          fila.forEach((_, i) => { if (!ordem.includes(i)) ordem.push(i); });
          pos = ordem.indexOf(idx);
        } else { ordem = fila.map((_, i) => i); pos = idx; }
        partes.tituloTexto.textContent = fila[idx].nome || "Gravação";
        partes.tituloTexto.parentElement.title = fila[idx].nome || "";
        atualizarMediaSession();
        avisar();
        return;
      }
    }
    // a música atual foi excluída
    const antigaPos = pos;
    fila = nova;
    if (!fila.length) { fecharPlayer(); return; }
    ordem = fila.map((_, i) => i);
    pos = Math.min(antigaPos, fila.length - 1);
    reconstruirOrdem();
    carregar(tocando);
  }

  function fecharPlayer() {
    if (!caixa) return;
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    tocando = false; desenhando = false; corrigindo = false;
    caixa.hidden = true;
    document.body.classList.remove("oh-mp-aberto");
    if ("mediaSession" in navigator) { navigator.mediaSession.metadata = null; navigator.mediaSession.playbackState = "none"; }
    controlarMidia(false);
    desenharEstado();
    avisar();
    fila = []; ordem = []; pos = 0;
  }

  // ───────────── duração das gravações feitas no Chrome ─────────────
  // O Chrome grava .webm sem a duração (aparece como "infinito"): o tempo total some e pular na linha do tempo falha.
  // Truque conhecido: pular para um ponto absurdo faz o navegador descobrir a duração real; depois volta ao começo.
  function corrigirDuracao() {
    tentouCorrigir = true;
    corrigindo = true;
    const retomar = querTocar || !audio.paused;
    const terminar = () => {
      if (!corrigindo) return;
      corrigindo = false;
      audio.removeEventListener("durationchange", aoMudar);
      clearTimeout(limite);
      audio.currentTime = 0;
      if (retomar) { const p = audio.play(); if (p && p.catch) p.catch(() => {}); }
      atualizarTempo();
    };
    const aoMudar = () => { if (isFinite(audio.duration)) terminar(); };
    const limite = setTimeout(terminar, 4000);                              // se não deu certo, segue sem o tempo total
    audio.addEventListener("durationchange", aoMudar);
    audio.currentTime = 1e101;
  }

  audio.addEventListener("loadedmetadata", () => {
    if (audio.duration === Infinity && !tentouCorrigir) corrigirDuracao();
    else atualizarTempo();
  });
  audio.addEventListener("durationchange", () => { if (!corrigindo) atualizarTempo(); });
  audio.addEventListener("timeupdate", atualizarTempo);
  audio.addEventListener("play", () => {
    if (corrigindo) return;
    tocando = true; falhasSeguidas = 0;
    desenharEstado(); iniciarDesenho(); avisar();
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "playing";
    document.querySelectorAll("audio").forEach((a) => { if (a !== audio && !a.paused) a.pause(); });   // nunca dois áudios ao mesmo tempo
  });
  audio.addEventListener("pause", () => {
    if (corrigindo || audio.ended) return;
    tocando = false; desenharEstado(); limparEspectro(); avisar();
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "paused";
  });
  audio.addEventListener("ended", () => {
    if (corrigindo) return;
    if (repetir === "uma") { audio.currentTime = 0; const p = audio.play(); if (p && p.catch) p.catch(() => {}); return; }
    tocando = false;
    proxima(true);
    if (!audio.paused) return;
    desenharEstado(); limparEspectro(); avisar();
  });
  audio.addEventListener("error", () => {
    if (!audio.getAttribute("src")) return;                                 // erro de quando fechamos o player
    const f = faixa();
    falhasSeguidas += 1;
    tocando = false; desenharEstado(); avisar();
    if (partes) partes.tituloTexto.textContent = `Não consegui tocar “${(f && f.nome) || "esta gravação"}”`;
    if (fila.length > 1 && falhasSeguidas < fila.length) setTimeout(() => { if (caixa && !caixa.hidden) proxima(true); }, 900);   // pula para a próxima
  });
  document.addEventListener("play", (ev) => {                               // outro áudio do app começou: este para
    if (ev.target instanceof HTMLAudioElement && ev.target !== audio && !audio.paused) audio.pause();
  }, true);

  // ───────────── fone e tela de bloqueio ─────────────
  function atualizarMediaSession() {
    if (!("mediaSession" in navigator) || typeof MediaMetadata === "undefined") return;
    const f = faixa();
    navigator.mediaSession.metadata = f ? new MediaMetadata({ title: f.nome || "Gravação", artist: "Orange Harmony", album: "Biblioteca" }) : null;
  }
  const ACOES_MIDIA = {
    play: () => { if (audio.paused) alternarPlay(); },
    pause: () => audio.pause(),
    previoustrack: () => anterior(),
    nexttrack: () => proxima(false),
    seekto: (d) => { if (d && isFinite(d.seekTime)) audio.currentTime = d.seekTime; },
    // seekbackward/seekforward (±10 s) ficam de fora de propósito: no iPhone, se elas existirem,
    // a tela de bloqueio e a central de controle mostram ±10 s no lugar de anterior/próxima.
  };
  // Os botões do fone e da tela de bloqueio só são nossos enquanto o player está aberto (não atrapalham outros áudios do app).
  function controlarMidia(ligar) {
    if (!("mediaSession" in navigator)) return;
    Object.keys(ACOES_MIDIA).forEach((nome) => { try { navigator.mediaSession.setActionHandler(nome, ligar ? ACOES_MIDIA[nome] : null); } catch (e) { /* ação não suportada */ } });
  }

  window.MiniPlayer = {
    tocar, alternar, atualizarFila, fechar: fecharPlayer,
    atual: () => { const f = faixa(); return caixa && !caixa.hidden && f ? { ...f } : null; },
    estaTocando: () => tocando,
    _debug: () => ({ analisador: !!analisador, ios: EH_IOS, aleatorio, repetir, velocidade, ordem: ordem.map((i) => fila[i] && fila[i].id), pos,
      audio: { t: audio.currentTime, d: audio.duration, pausado: audio.paused, src: audio.getAttribute("src"), taxa: audio.playbackRate } }),   // só para testes
  };
})();
