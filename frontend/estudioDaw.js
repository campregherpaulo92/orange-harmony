// ══════════════════════════════════════════════════════════════════════════
// estudioDaw.js — Orange Studio (DAW), Etapa 1: a base.
//
//  • faixas e regiões de áudio editáveis (mover, aparar, dividir, copiar, colar, duplicar, excluir, fades)
//  • tocar com volume, pan, mudo, solo e limitador; medidores de verdade
//  • metrônomo, pré-contagem e gravação pelo microfone direto numa faixa
//  • importar áudio; separar uma música em voz e instrumental (reaproveita o fluxo do Colab/servidor)
//  • desfazer e refazer sem perder qualidade (guarda só a lista de edições, nunca o áudio)
//  • exportar a mixagem em WAV
//
// Tudo roda no navegador. A edição NUNCA altera o áudio original: regiões apenas apontam para um trecho dele.
// Usa funções que já existem no app: separarLocal, separarViaColab, escolherDaBiblioteca, audioBufferParaWavBlob.
// ══════════════════════════════════════════════════════════════════════════
(function () {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  // ── ícones (desenhados, sem emoji) ──
  const P = {
    play: '<path d="M8 5v14l11-7z"/>', pause: '<path d="M7 5h4v14H7zM13 5h4v14h-4z"/>', stop: '<rect x="6" y="6" width="12" height="12" rx="1.5"/>', rec: '<circle cx="12" cy="12" r="6"/>', rew: '<path d="M6 5h2v14H6zM20 5v14L9 12z"/>',
    sel: '<path d="M5 3l14 8-6 2 3 7-3 1-3-7-5 4z"/>', tes: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M8.5 8l11 10M8.5 16L19.5 6"/>',
    mao: '<path d="M8 12V5a1.5 1.5 0 013 0v6M11 11V4a1.5 1.5 0 013 0v7M14 11V6a1.5 1.5 0 013 0v8c0 4-2 6-5 6-3 0-5-2-6-5l-1-3a1.5 1.5 0 012.5-1z"/>',
    lupa: '<circle cx="10" cy="10" r="6"/><path d="M15 15l6 6"/>', undo: '<path d="M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3"/>', redo: '<path d="M15 14l5-5-5-5M20 9H10a6 6 0 000 12h3"/>',
    mais: '<path d="M12 5v14M5 12h14"/>', seta: '<path d="M6 9l6 6 6-6"/>', onda: '<path d="M4 12h2v4H4zm4-4h2v12H8zm4-4h2v16h-2zm4 6h2v8h-2zm4 2h2v4h-2z"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v3"/>', pasta: '<path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>',
    divide: '<path d="M12 3v18M5 8l-3 4 3 4M19 8l3 4-3 4"/>', metro: '<path d="M8 21h8l-1.6-15h-4.8zM12 15l4.5-8"/>', baixar: '<path d="M12 3v12M7 10l5 5 5-5M4 20h16"/>',
  };
  const TRACADOS = new Set(["metro", "tes", "mao", "lupa", "undo", "redo", "mais", "seta", "mic", "pasta", "divide", "baixar"]);
  const ic = (n) => `<svg class="dw-ic ${TRACADOS.has(n) ? "tr" : ""}" viewBox="0 0 24 24" aria-hidden="true">${P[n]}</svg>`;
  const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const corA = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };

  // ── estado do projeto (só dados simples: é isto que o desfazer guarda) ──
  const ALT = 84, BIN = 0.005, FOLGA = 20;
  const COMPASSOS = { "4/4": { n: 4, u: 1 }, "3/4": { n: 3, u: 1 }, "2/4": { n: 2, u: 1 }, "6/8": { n: 6, u: 0.5 } };
  const CORES = ["#a855f7", "#ec4899", "#eab308", "#38bdf8", "#84cc16", "#fb7185"];
  const S = {
    id: "p" + Date.now().toString(36), nome: "Meu projeto", bpm: 100, compasso: "4/4", tom: "", pps: 40, snap: "off", ferr: "sel", tAtual: 0, tocando: false, seguir: true,
    metro: "off", contagem: 1, latencia: 0, mestreVol: 0.9, faixas: [], regioes: [], faixaSel: null, regiaoSel: null, sujo: false, gravando: false, contando: false,
  };
  let proxId = 1;
  const bufs = new Map();     // id do áudio -> AudioBuffer (o áudio em si; nunca é alterado)
  const picos = new Map();    // id do áudio -> picos de volume (para desenhar a forma de onda)
  const beatDur = () => (60 / S.bpm) * COMPASSOS[S.compasso].u;
  const BAR = () => beatDur() * COMPASSOS[S.compasso].n;
  const faixaPorId = (id) => S.faixas.find((f) => f.id === id);
  const regiaoPorId = (id) => S.regioes.find((r) => r.id === id);
  const fimProjeto = () => S.regioes.reduce((m, r) => Math.max(m, r.ini + r.dur), 0);
  const duracaoTL = () => Math.max(30, fimProjeto() + FOLGA);
  const px = (t) => t * S.pps;
  const algumSolo = () => S.faixas.some((f) => f.solo);
  const audivel = (id) => { const f = faixaPorId(id); return !!f && !f.mudo && (!algumSolo() || f.solo); };
  const fmt = (t) => { const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s.toFixed(1).padStart(4, "0")}`; };
  function snap(t, livre) {
    if (livre || S.snap === "off") return t;
    const passo = S.snap === "bar" ? BAR() : S.snap === "beat" ? beatDur() : beatDur() / 2;
    return Math.round(t / passo) * passo;
  }
  function dica(msg) { const e = $("#dwStatus"); if (e) e.textContent = msg; }

  // ── desfazer / refazer ──
  const pilha = [], refaz = [];
  const foto = () => JSON.stringify({ faixas: S.faixas, regioes: S.regioes, bpm: S.bpm, compasso: S.compasso, nome: S.nome, tom: S.tom });
  function restaurar(js) {
    const o = JSON.parse(js);
    S.faixas = o.faixas; S.regioes = o.regioes; S.bpm = o.bpm; S.compasso = o.compasso; S.nome = o.nome; S.tom = o.tom;
    if (!regiaoPorId(S.regiaoSel)) S.regiaoSel = null;
    if (!faixaPorId(S.faixaSel)) S.faixaSel = S.faixas[0] ? S.faixas[0].id : null;
    $("#dwBpm").value = S.bpm; $("#dwComp").value = S.compasso; $("#dwNome").value = S.nome; $("#dwTom").textContent = S.tom || "—";
    renderTudo(); atualizarNos(); if (S.tocando) reagendar(); agendarSalvar();
  }
  function empilhar(antes) { pilha.push(antes); if (pilha.length > 80) pilha.shift(); refaz.length = 0; agendarSalvar(); atualizarUndo(); }
  function desfazer() { if (S.gravando || S.contando) return dica("Pare a gravação antes de desfazer."); if (!pilha.length) return dica("Nada para desfazer."); refaz.push(foto()); restaurar(pilha.pop()); atualizarUndo(); dica("Desfeito."); }
  function refazer() { if (!refaz.length) return dica("Nada para refazer."); pilha.push(foto()); restaurar(refaz.pop()); atualizarUndo(); dica("Refeito."); }
  function atualizarUndo() { const u = $("#dwUndo"), r = $("#dwRedo"); if (u) u.disabled = !pilha.length; if (r) r.disabled = !refaz.length; }
  function mudar(fn) { const antes = foto(); fn(); empilhar(antes); renderTudo(); if (S.tocando) reagendar(); }

  // ══ ÁUDIO ═════════════════════════════════════════════════════════════
  let ctx = null, mestre = null, limitador = null, anMestre = null;
  const nos = new Map();      // id da faixa -> { gain, pan, an }
  let fontes = [], baseCtx = 0, base0 = 0, proxBeat = 0, cliquesTotal = 0, cliqueLog = [];
  function garantirAudio() {
    if (!ctx) {
      const A = window.AudioContext || window.webkitAudioContext; if (!A) return false;
      ctx = new A(); mestre = ctx.createGain(); mestre.gain.value = S.mestreVol;
      limitador = criarLimitador(ctx); anMestre = ctx.createAnalyser(); anMestre.fftSize = 512;
      mestre.connect(limitador); limitador.connect(ctx.destination); limitador.connect(anMestre);
    }
    if (ctx.state === "suspended") ctx.resume();
    return true;
  }
  function criarLimitador(c) { const l = c.createDynamicsCompressor(); l.threshold.value = -2; l.knee.value = 0; l.ratio.value = 20; l.attack.value = 0.003; l.release.value = 0.12; return l; }
  function noDe(f) {
    let n = nos.get(f.id);
    if (!n) {
      const gain = ctx.createGain(), pan = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain(), an = ctx.createAnalyser();
      an.fftSize = 512; gain.connect(pan); pan.connect(an); pan.connect(mestre);
      gain.gain.value = audivel(f.id) ? f.vol : 0; if (pan.pan) pan.pan.value = f.pan;
      n = { gain, pan, an }; nos.set(f.id, n);
    }
    return n;
  }
  function atualizarNos() {
    if (!ctx) return;
    S.faixas.forEach((f) => { const n = noDe(f); n.gain.gain.setTargetAtTime(audivel(f.id) ? f.vol : 0, ctx.currentTime, 0.01); if (n.pan.pan) n.pan.pan.setTargetAtTime(f.pan, ctx.currentTime, 0.01); });
  }
  // Programa UMA região num contexto (ao vivo ou na exportação). t0 = ponto do projeto onde a reprodução começa.
  function programarRegiao(c, r, destino, t0, base) {
    const buf = bufs.get(r.buf); if (!buf || r.ini + r.dur <= t0) return null;
    const dentro = Math.max(0, t0 - r.ini), quando = base + Math.max(0, r.ini - t0), dur = r.dur - dentro;
    if (dur <= 0.004) return null;
    const src = c.createBufferSource(), g = c.createGain(), vol = Math.pow(10, r.ganho / 20); src.buffer = buf;
    const pts = [[0, 1]];                                       // [segundos desde o início agendado, fator de volume]
    if (r.fi > 0 && dentro < r.fi) { pts[0] = [0, dentro / r.fi]; pts.push([r.fi - dentro, 1]); }
    if (r.fo > 0) { const inicioFo = (r.dur - r.fo) - dentro; if (inicioFo <= 0) { pts.length = 0; pts.push([0, Math.min(1, Math.max(0, (r.dur - dentro) / r.fo))]); pts.push([dur, 0]); } else { pts.push([inicioFo, 1]); pts.push([dur, 0]); } }
    g.gain.setValueAtTime(vol * Math.max(pts[0][1], 0.0001), quando);
    for (let i = 1; i < pts.length; i++) g.gain.linearRampToValueAtTime(vol * Math.max(pts[i][1], 0.0001), quando + Math.max(pts[i][0], 0.001));
    src.connect(g); g.connect(destino); src.start(quando, r.off + dentro, dur);
    return src;
  }
  function pararFontes() { fontes.forEach((s) => { try { s.stop(); } catch (e) { /* já terminou */ } }); fontes = []; }
  function agendarRegioes(t0) {
    pararFontes();
    S.regioes.forEach((r) => { const f = faixaPorId(r.f); if (!f) return; const s = programarRegiao(ctx, r, noDe(f).gain, t0, ctx.currentTime); if (s) fontes.push(s); });
    proxBeat = Math.ceil(t0 / beatDur() - 1e-6);
  }
  let reagendando = null;
  function reagendar() {
    if (!S.tocando || !ctx) return;
    clearTimeout(reagendando);
    reagendando = setTimeout(() => { base0 = S.tAtual; baseCtx = ctx.currentTime; agendarRegioes(S.tAtual); }, 25);
  }

  // ── metrônomo ──
  function cliqueEm(quando, forte) {
    if (!garantirAudio()) return;
    const o = ctx.createOscillator(), g = ctx.createGain(); o.type = "square"; o.frequency.value = forte ? 1500 : 1000;
    g.gain.setValueAtTime(0.0001, quando); g.gain.exponentialRampToValueAtTime(0.3, quando + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, quando + 0.05);
    o.connect(g); g.connect(ctx.destination); o.start(quando); o.stop(quando + 0.06);
    cliquesTotal++; cliqueLog.push(!!forte); if (cliqueLog.length > 60) cliqueLog.shift();
    setTimeout(() => { const b = $("#dwMetroBtn"); if (!b) return; b.classList.add("pulso"); setTimeout(() => b.classList.remove("pulso"), 90); }, Math.max(0, (quando - ctx.currentTime) * 1000));
  }
  const metroAtivo = () => S.metro === "on" || (S.metro === "rec" && S.gravando);
  function agendarMetro() {
    if (!ctx || !metroAtivo()) return;
    const bd = beatDur(), n = COMPASSOS[S.compasso].n;
    while (proxBeat * bd < S.tAtual + 0.15) { const dt = proxBeat * bd - S.tAtual; if (dt >= -0.02) cliqueEm(ctx.currentTime + Math.max(0, dt), proxBeat % n === 0); proxBeat++; }
  }

  // ── formas de onda ──
  function calcularPicos(buf) {
    let mx = 0.001; const n = Math.ceil(buf.duration / BIN), out = new Float32Array(n), passo = Math.max(1, Math.floor(buf.sampleRate * BIN));
    const chs = []; for (let c = 0; c < buf.numberOfChannels; c++) chs.push(buf.getChannelData(c));
    for (let i = 0; i < n; i++) { let m = 0; const a = i * passo, b = Math.min(buf.length, a + passo); for (const ch of chs) for (let k = a; k < b; k += 4) { const v = Math.abs(ch[k]); if (v > m) m = v; } out[i] = m; if (m > mx) mx = m; }
    out.max = mx; return out;
  }
  function desenharOnda(cv, r, cor, w, h) {
    w = Math.max(2, Math.min(16000, Math.round(w))); cv.width = w; cv.height = h;
    const c = cv.getContext("2d"), p = picos.get(r.buf); c.clearRect(0, 0, w, h); if (!p || !p.length) return;
    const maxG = Math.max(0.05, p.max || 1), esc_ = Math.min(4, 0.95 / maxG); c.fillStyle = corA(cor, 0.92);
    for (let x = 0; x < w; x++) {
      const b0 = Math.floor((r.off + (x / w) * r.dur) / BIN), b1 = Math.max(b0 + 1, Math.floor((r.off + ((x + 1) / w) * r.dur) / BIN)); let m = 0;
      for (let b = b0; b < b1 && b < p.length; b++) if (p[b] > m) m = p[b];
      const a = Math.min(1, m * esc_) * (h / 2 - 1); c.fillRect(x, h / 2 - Math.max(0.5, a), 1, Math.max(1, a * 2));
    }
  }

  // ══ PROJETO: faixas e regiões ═════════════════════════════════════════
  function novaFaixa(nome, cor, extra) { const f = { id: "f" + proxId++, nome, cor: cor || CORES[S.faixas.length % CORES.length], vol: 0.85, pan: 0, mudo: false, solo: false, arm: false, ...extra }; S.faixas.push(f); if (!S.faixaSel) S.faixaSel = f.id; return f; }
  function guardarAudio(buf, arquivo) { const id = "b" + proxId++; bufs.set(id, buf); picos.set(id, calcularPicos(buf)); if (arquivo) blobs.set(id, arquivo); return id; }
  function novaRegiao(f, bufId, nome, ini, off, dur) {
    const buf = bufs.get(bufId), r = { id: proxId++, f: f.id, ini, dur: dur != null ? dur : buf.duration - (off || 0), off: off || 0, buf: bufId, nome, ganho: 0, fi: 0.005, fo: 0.005 };
    S.regioes.push(r); return r;
  }
  async function decodificar(dados) { garantirAudio(); return ctx.decodeAudioData(dados); }

  // ══ DESENHO ═══════════════════════════════════════════════════════════
  function montar() {
    const raiz = $("#dwRaiz"); if (!raiz || raiz.dataset.pronto) return; raiz.dataset.pronto = "1";
    raiz.innerHTML = `
    <div class="dw" id="dw">
      <header class="dw-topo">
        <div class="dw-marca"><div class="dw-avatar"><svg viewBox="0 0 24 24">${P.onda}</svg></div><div><div class="t1">Orange Studio</div><input class="dw-nome-proj" id="dwNome" value="Meu projeto" title="Nome do projeto (vira o nome do arquivo exportado)"></div></div>
        <div class="dw-transp">
          <button class="dw-tb" id="dwRew" title="Voltar ao início (Home)">${ic("rew")}</button>
          <button class="dw-tb play" id="dwPlay" title="Tocar / pausar (Espaço)">${ic("play")}</button>
          <button class="dw-tb" id="dwStop" title="Parar e voltar ao início">${ic("stop")}</button>
          <button class="dw-tb gravar" id="dwRec" title="Gravar na faixa armada (R). Sem faixa armada, cria uma faixa de voz.">${ic("rec")}</button>
        </div>
        <div class="dw-relogio" id="dwRelogio">0:00.0<small>Compasso 1 · tempo 1</small></div>
        <label class="dw-campo">Andamento<input type="number" id="dwBpm" value="100" min="40" max="220" title="Batidas por minuto: define a grade e o metrônomo"></label>
        <label class="dw-campo">Compasso<select id="dwComp"><option>4/4</option><option>3/4</option><option>2/4</option><option>6/8</option></select></label>
        <div class="dw-campo">Tom<b id="dwTom">—</b></div>
        <div class="dw-vu-mestre" title="Volume geral"><i id="dwVuMestre"></i></div>
        <div class="dw-esp"></div>
        <button class="dw-btn cheio" id="dwSeparar">${ic("divide")} Separar música</button>
        <button class="dw-btn" id="dwArquivo">Arquivo ${ic("seta")}</button>
      </header>
      <div class="dw-ferr">
        <div class="dw-grupo" id="dwFerr">
          <button class="dw-fb on" data-f="sel" title="Selecionar e mover (V)">${ic("sel")}</button>
          <button class="dw-fb" data-f="tes" title="Dividir (C): clique numa região">${ic("tes")}</button>
          <button class="dw-fb" data-f="mao" title="Mão (H): arraste para rolar">${ic("mao")}</button>
          <button class="dw-fb" data-f="lupa" title="Zoom (Z): clique aproxima; Alt + clique afasta">${ic("lupa")}</button>
        </div>
        <div class="dw-grupo"><button class="dw-fb" id="dwUndo" title="Desfazer (Ctrl+Z)">${ic("undo")}</button><button class="dw-fb" id="dwRedo" title="Refazer (Ctrl+Y)">${ic("redo")}</button></div>
        <div class="dw-sep"></div>
        <label>Grade <select id="dwSnap"><option value="off" selected>Livre</option><option value="bar">Compasso</option><option value="beat">Tempo</option><option value="half">Meio tempo</option></select></label>
        <label>Zoom <input type="range" id="dwZoom" min="8" max="120" value="40"></label>
        <button class="dw-btn peq" id="dwAjustar" title="Ajusta o zoom para caber o projeto todo">Ajustar</button>
        <label title="Seguir o cursor: a tela acompanha enquanto toca"><input type="checkbox" id="dwSeguir" checked> Seguir</label>
        <div class="dw-grupo dw-rec-grupo">
        <button class="dw-tb" id="dwMetroBtn" title="Liga e desliga o metrônomo" style="width:28px;height:28px"></button>
        <select id="dwMetro" title="Metrônomo: desligado, ligado ou só ao gravar"><option value="off">Desligado</option><option value="on">Ligado</option><option value="rec">Só ao gravar</option></select>
        <label>Contagem <select id="dwContagem" title="Pré-contagem antes de gravar"><option value="0">Nenhuma</option><option value="1" selected>1 compasso</option><option value="2">2 compassos</option></select></label>
        <label title="Se a voz gravada ficar atrasada em relação à música, aumente. Ex.: 80">Atraso <input type="number" id="dwLat" value="0" min="0" max="500" step="10"> ms</label>
        </div>
      </div>
      <div class="dw-area">
        <div class="dw-cab-col"><div class="dw-cab-topo"><span>FAIXAS</span><button class="dw-btn peq" id="dwAddFaixa">${ic("mais")} Faixa</button></div><div class="dw-cab-lista" id="dwCabLista"></div></div>
        <div class="dw-tl-scroll" id="dwTlScroll"><div class="dw-tl" id="dwTl"><div class="dw-regua" id="dwRegua"></div><div class="dw-faixas" id="dwFaixas"></div><div class="dw-playhead" id="dwPlayhead"></div></div>
          <div class="dw-vazio" id="dwVazio" hidden>
            <h2>Comece o seu projeto</h2><p>Traga uma música, grave a sua voz ou importe um áudio. Depois é só mexer: cortar, mover, ajustar volume e exportar.</p>
            <div class="opcoes">
              <button class="opcao" id="dwOpSep">${ic("divide")}<b>Separar uma música</b><small>divide em voz e instrumental (Demucs)</small></button>
              <button class="opcao" id="dwOpGravar">${ic("mic")}<b>Gravar uma voz</b><small>cria a faixa e grava pelo microfone</small></button>
              <button class="opcao" id="dwOpImportar">${ic("pasta")}<b>Importar áudio</b><small>traz um arquivo do aparelho</small></button>
            </div>
          </div>
        </div>
      </div>
      <section class="dw-editor" id="dwEditor">
        <div class="dw-abas">
          <button class="dw-aba on" data-aba="mix">Mixer</button><button class="dw-aba" data-aba="reg">Região</button>
          <button class="dw-aba" data-aba="afin">Afinação <small>EM BREVE</small></button><button class="dw-aba" data-aba="fx">Efeitos <small>EM BREVE</small></button>
          <span class="esp"></span><button class="dw-btn peq" id="dwRecolher">${ic("seta")} Recolher</button>
        </div>
        <div class="dw-painel-aba on" id="dwP-mix"><div class="dw-mix" id="dwMix"></div></div>
        <div class="dw-painel-aba" id="dwP-reg"><div class="dw-regp" id="dwRegp"></div></div>
        <div class="dw-painel-aba" id="dwP-afin"><div class="dw-breve"><b>Afinação por blocos de nota (estilo Melodyne)</b><br>Na próxima etapa, cada nota que você cantou vira um bloco numa grade. Você arrasta o bloco para afinar e ouve na hora. A tela já está na maquete que aprovamos.</div></div>
        <div class="dw-painel-aba" id="dwP-fx"><div class="dw-breve"><b>Efeitos por faixa</b><br>Na etapa seguinte entram equalizador, compressor, reverb e delay em cada faixa, com predefinições como "Voz limpa" e "Voz de rádio".</div></div>
      </section>
      <div class="dw-status"><span class="e" id="dwStatus">Pronto.</span><span id="dwStatusSel"></span><span id="dwSalvo"></span><span>Espaço toca/pausa · R grava · V seleciona · C divide · S divide no cursor · Ctrl+Z desfaz</span></div>
      <div class="dw-contagem" id="dwContagemOv" hidden></div>
      <div class="dw-modal" id="dwModalSep" hidden>
        <div class="dw-modal-cartao">
          <div class="dw-modal-topo"><b>Separar uma música em voz e instrumental</b><button id="dwSepFechar" aria-label="Fechar">×</button></div>
          <div class="dw-colab" id="dwColab" hidden><span class="dw-pilula" id="dwColabPilula">Desligado</span><p id="dwColabTexto"></p><a class="dw-btn peq" id="dwColabLink" href="#" target="_blank" rel="noopener" style="width:fit-content;text-decoration:none">Abrir o separador no Colab</a></div>
          <div>
            <input type="file" id="dwSepArq" accept=".wav,.mp3,.m4a,.ogg,.flac,.webm" hidden>
            <div class="dw-acoes" style="justify-content:flex-start"><button class="dw-btn" id="dwSepUpload">${ic("pasta")} Escolher do aparelho</button><button class="dw-btn" id="dwSepBib">${ic("pasta")} Escolher da biblioteca</button></div>
            <div class="dw-dica" id="dwSepNome" style="margin-top:8px">Nenhum áudio escolhido.</div>
          </div>
          <ol class="dw-passos" id="dwPassos" hidden><li data-p="enviando">Enviando o áudio</li><li data-p="fila">Na fila do separador</li><li data-p="separando">Separando voz e instrumental</li><li data-p="baixando">Trazendo o resultado</li></ol>
          <div class="dw-dica" id="dwSepStatus"></div>
          <div class="dw-acoes"><button class="dw-btn" id="dwSepCancelar">Cancelar</button><button class="dw-btn cheio" id="dwSepIniciar" disabled>Separar e abrir no Estúdio</button></div>
        </div>
      </div>
      <div class="dw-modal" id="dwModalProj" hidden>
        <div class="dw-modal-cartao">
          <div class="dw-modal-topo"><b>Projetos salvos neste aparelho</b><button id="dwProjFechar" aria-label="Fechar">×</button></div>
          <div id="dwProjLista"></div>
          <div class="dw-dica">Os projetos ficam guardados no navegador deste aparelho (não vão para a nuvem). Exporte a mixagem para ter um arquivo seguro.</div>
        </div>
      </div>
      <input type="file" id="dwArqAudio" accept="audio/*,.wav,.mp3,.m4a,.ogg,.flac,.webm" hidden>
    </div>
    <div class="dw-menu" id="dwMenuArquivo" hidden>
      <button data-a="importar"><b>Importar áudio</b><small>traz um arquivo do aparelho para uma faixa nova</small></button>
      <button data-a="exportar"><b>Exportar mixagem (WAV)</b><small>junta todas as faixas, com volume e pan, num arquivo</small></button>
      <button data-a="salvar"><b>Salvar agora (Ctrl+S)</b><small>ele também salva sozinho enquanto você mexe</small></button>
      <button data-a="abrir"><b>Abrir projeto…</b><small>seus projetos salvos neste aparelho</small></button>
      <button data-a="novo"><b>Novo projeto</b><small>o atual fica salvo; começa um em branco</small></button>
      <button data-a="classico"><b>Abrir o Estúdio clássico</b><small>a versão antiga, enquanto você valida esta</small></button>
    </div>
    <div class="dw-menu" id="dwMenuFaixa" hidden>
      <button data-n="voz"><b>Nova faixa de voz</b><small>cria a faixa já armada, pronta para gravar</small></button>
      <button data-n="audio"><b>Importar áudio</b><small>traz um arquivo do aparelho para uma faixa nova</small></button>
      <button data-n="vazia"><b>Faixa vazia</b><small>só a faixa, sem áudio</small></button>
    </div>`;
    $("#dwMetroBtn").innerHTML = ic("metro");
    ligarEventos();
  }

  function renderCab() {
    $("#dwCabLista").innerHTML = S.faixas.map((f) => `
      <div class="dw-cab ${f.id === S.faixaSel ? "sel" : ""}" data-f="${f.id}">
        <i class="cor" style="background:${f.cor}"></i>
        <div class="l1"><input class="nome" value="${esc(f.nome)}" data-nome="${f.id}">
          <button class="dw-mini m ${f.mudo ? "on" : ""}" data-m="${f.id}" title="Mudo">M</button><button class="dw-mini s ${f.solo ? "on" : ""}" data-s="${f.id}" title="Solo">S</button><button class="dw-mini r ${f.arm ? "on" : ""}" data-r="${f.id}" title="Armar para gravar">R</button></div>
        <div class="l2"><span>Vol</span><input type="range" min="0" max="1.5" step="0.01" value="${f.vol}" data-vol="${f.id}"><span>Pan</span><input type="range" min="-1" max="1" step="0.1" value="${f.pan}" data-pan="${f.id}" style="max-width:46px"></div>
        <div class="l3"><div class="medidor"><i data-vu="${f.id}"></i></div><button class="excl" data-del="${f.id}" title="Excluir a faixa e as regiões dela">Excluir</button></div>
      </div>`).join("");
  }
  function renderLinhas() {
    const dur = duracaoTL(), larg = Math.ceil(px(dur)) + 40, bar = BAR();
    $("#dwTl").style.width = larg + "px";
    let h = ""; const nb = Math.ceil(dur / bar);
    for (let b = 0; b < nb; b++) { h += `<div class="barra" style="left:${px(b * bar)}px;width:${px(bar)}px">${b + 1}</div>`; for (let t = 1; t < COMPASSOS[S.compasso].n; t++) h += `<i class="tempo" style="left:${px(b * bar + t * beatDur())}px"></i>`; }
    $("#dwRegua").innerHTML = h;
    const linhas = S.faixas.map((f) => {
      const rs = S.regioes.filter((r) => r.f === f.id).map((r) => `
        <div class="dw-regiao ${r.id === S.regiaoSel ? "sel" : ""} ${f.mudo ? "mudo" : ""} ${r.gravando ? "gravando" : ""}" data-r="${r.id}" style="left:${px(r.ini)}px;width:${px(r.dur)}px;background:${corA(f.cor, 0.16)};border-color:${corA(f.cor, 0.85)}">
          <div class="rot" style="background:${corA(f.cor, 0.95)}">${esc(r.nome)}</div><canvas></canvas>
          ${r.fi > 0.02 ? `<i class="fade i" style="width:${px(r.fi)}px"></i>` : ""}${r.fo > 0.02 ? `<i class="fade o" style="width:${px(r.fo)}px"></i>` : ""}
          <i class="alca e" data-alca="e"></i><i class="alca d" data-alca="d"></i></div>`).join("");
      return `<div class="dw-linha" data-lf="${f.id}">${rs}</div>`;
    }).join("") + '<div class="dw-linha vazia"></div>';
    $("#dwFaixas").innerHTML = linhas + `<div class="dw-grade-fundo" style="background-image:repeating-linear-gradient(90deg, rgba(255,255,255,.07) 0 1px, transparent 1px ${px(bar)}px)"></div>`;
    $$(".dw-regiao", $("#dwFaixas")).forEach((el) => { const r = regiaoPorId(+el.dataset.r), f = faixaPorId(r.f); desenharOnda($("canvas", el), r, f.cor, px(r.dur), el.clientHeight - 18 || 60); });
    $("#dwVazio").hidden = S.faixas.length > 0;
    posicionar();
  }
  function renderMixer() {
    const strip = (f) => `<div class="dw-strip"><div class="nome" style="color:${f.cor}">${esc(f.nome)}</div>
      <div class="fw"><div class="fader"><input type="range" min="0" max="1.5" step="0.01" value="${f.vol}" data-vol="${f.id}"></div><div class="vu"><i data-vu2="${f.id}"></i></div></div>
      <div class="db" data-db="${f.id}">${dbTxt(f.vol)}</div>
      <div style="display:flex;gap:4px"><button class="dw-mini m ${f.mudo ? "on" : ""}" data-m="${f.id}">M</button><button class="dw-mini s ${f.solo ? "on" : ""}" data-s="${f.id}">S</button></div></div>`;
    $("#dwMix").innerHTML = (S.faixas.length ? S.faixas.map(strip).join("") : '<div class="dw-aviso-vazio" style="flex:1">Ainda não há faixas. Importe, grave ou separe uma música.</div>') +
      `<div class="strip dw-strip master"><div class="nome" style="color:#fff">Geral</div><div class="fw"><div class="fader"><input type="range" id="dwMestreVol" min="0" max="1.2" step="0.01" value="${S.mestreVol}"></div><div class="vu"><i data-vu2="mestre"></i></div></div><div class="db">limitador ligado</div></div>`;
  }
  const dbTxt = (v) => (v <= 0 ? "-∞ dB" : (20 * Math.log10(v)).toFixed(1) + " dB");
  function renderRegiao() {
    const r = regiaoPorId(S.regiaoSel), el = $("#dwRegp");
    if (!r) { el.innerHTML = '<div class="dw-aviso-vazio">Clique numa região na linha do tempo para editar nome, volume e fades.</div>'; return; }
    el.innerHTML = `
      <div class="dw-bloco"><h4>Região</h4><input type="text" value="${esc(r.nome)}" data-rnome><div style="color:var(--dw-suave);font-size:11px">Início ${fmt(r.ini)} · duração ${fmt(r.dur)} · compasso ${(r.ini / BAR() + 1).toFixed(1)}</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap"><button class="dw-btn peq" data-ra="dividir">Dividir no cursor</button><button class="dw-btn peq" data-ra="duplicar">Duplicar</button><button class="dw-btn peq" data-ra="excluir">Excluir</button></div></div>
      <div class="dw-bloco"><h4>Volume</h4>
        <div class="dw-param"><span>Ganho</span><input type="range" min="-24" max="12" step="0.5" value="${r.ganho}" data-rg="ganho"><b>${r.ganho} dB</b></div>
        <div class="dw-param"><span>Fade in</span><input type="range" min="0" max="5" step="0.05" value="${r.fi}" data-rg="fi"><b>${r.fi.toFixed(2)}s</b></div>
        <div class="dw-param"><span>Fade out</span><input type="range" min="0" max="5" step="0.05" value="${r.fo}" data-rg="fo"><b>${r.fo.toFixed(2)}s</b></div></div>`;
  }
  function renderTudo() {
    renderCab(); renderLinhas(); renderMixer(); renderRegiao();
    selStatus(); atualizarUndo();
  }
  function selStatus() { const r = regiaoPorId(S.regiaoSel), e = $("#dwStatusSel"); if (e) e.textContent = r ? `Região: ${r.nome}` : ""; }
  function posicionar() {
    const ph = $("#dwPlayhead"); if (!ph) return; ph.style.left = px(S.tAtual) + "px";
    const bd = beatDur(), c = Math.floor(S.tAtual / BAR()), bt = Math.floor((S.tAtual % BAR()) / bd);
    $("#dwRelogio").innerHTML = `${fmt(S.tAtual)}<small>Compasso ${c + 1} · tempo ${bt + 1}</small>`;
  }

  // ══ TRANSPORTE ════════════════════════════════════════════════════════
  function nivel(an) { const d = new Uint8Array(an.fftSize); an.getByteTimeDomainData(d); let m = 0; for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i] - 128) / 128); return Math.min(1, m * 1.4); }
  function medidores(vivo) {
    S.faixas.forEach((f) => { const n = nos.get(f.id), v = vivo && n ? nivel(n.an) : 0, a = $(`[data-vu="${f.id}"]`), b = $(`[data-vu2="${f.id}"]`); if (a) a.style.width = v * 100 + "%"; if (b) b.style.height = Math.max(3, v * 100) + "%"; });
    const m = vivo && anMestre ? nivel(anMestre) : 0; const vm = $("#dwVuMestre"); if (vm) vm.style.height = Math.max(3, m * 100) + "%"; const bm = $('[data-vu2="mestre"]'); if (bm) bm.style.height = Math.max(3, m * 100) + "%";
  }
  function tick() {
    if (!S.tocando) return;
    S.tAtual = base0 + (ctx.currentTime - baseCtx);
    if (!S.gravando && S.tAtual > fimProjeto() + 0.3) { pausar(); S.tAtual = Math.max(0, fimProjeto()); posicionar(); return; }
    posicionar(); agendarMetro(); if (S.gravando) atualizarGravacao();
    if (S.seguir) { const sc = $("#dwTlScroll"), x = px(S.tAtual); if (x > sc.scrollLeft + sc.clientWidth * 0.88 || x < sc.scrollLeft) sc.scrollLeft = Math.max(0, x - sc.clientWidth * 0.15); }
    medidores(true); requestAnimationFrame(tick);
  }
  function tocar() {
    if (S.tocando) return; if (!garantirAudio()) return dica("Este navegador não toca áudio aqui.");
    atualizarNos(); S.tocando = true; base0 = S.tAtual; baseCtx = ctx.currentTime; agendarRegioes(S.tAtual);
    $("#dwPlay").innerHTML = ic("pause"); $("#dwPlay").classList.add("on"); requestAnimationFrame(tick); dica("Tocando…");
  }
  function pausar() {
    if (!S.tocando) return; S.tocando = false; pararFontes(); if (S.gravando) finalizarGravacao();
    $("#dwPlay").innerHTML = ic("play"); $("#dwPlay").classList.remove("on"); medidores(false); posicionar(); dica("Pausado.");
  }
  function parar() { pausar(); S.tAtual = 0; posicionar(); $("#dwTlScroll").scrollLeft = 0; dica("Parado no início."); }
  function ir(t) { if (S.gravando) return; S.tAtual = Math.max(0, t); posicionar(); if (S.tocando) { base0 = S.tAtual; baseCtx = ctx.currentTime; agendarRegioes(S.tAtual); } }
  function mudarZoom(v) { S.pps = Math.max(8, Math.min(120, v)); $("#dwZoom").value = S.pps; renderLinhas(); }

  // ══ GRAVAÇÃO ══════════════════════════════════════════════════════════
  let gravacao = null, contTimers = [];
  function mostrarContagem(txt) { const c = $("#dwContagemOv"); c.hidden = !txt; c.innerHTML = txt ? `<span>${txt}</span><small>pré-contagem</small>` : ""; }
  function mostrarFaixa(id) {
    const sc = $("#dwTlScroll"), i = S.faixas.findIndex((f) => f.id === id), alt = ($(".dw-linha") || { offsetHeight: ALT }).offsetHeight; if (i < 0) return;
    const topo = i * alt, base = topo + alt, vis = sc.clientHeight - 28; if (base > sc.scrollTop + vis) sc.scrollTop = base - vis + 6; else if (topo < sc.scrollTop) sc.scrollTop = topo;
  }
  function criarFaixaVoz() { const n = S.faixas.filter((f) => f.gravada).length + 2; S.faixas.forEach((x) => { x.arm = false; }); return novaFaixa("Voz " + n, CORES[n % CORES.length], { arm: true, gravada: true }); }
  async function iniciarGravacao() {
    if (S.gravando || S.contando) return pararGravacao();
    if (!garantirAudio()) return dica("Este navegador não deixa gravar áudio.");
    if (S.tocando) pausar();
    const antes = foto(); let alvo = S.faixas.find((f) => f.arm);
    if (!alvo) alvo = criarFaixaVoz();
    S.faixaSel = alvo.id; renderTudo(); mostrarFaixa(alvo.id);
    let stream = null, simulado = false;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }); } catch (e) { simulado = true; }
    gravacao = { antes, alvo, stream, simulado, regiao: null, rec: null, chunks: [], an: null, dados: null, ini: snap(S.tAtual) };
    $("#dwRec").classList.add("on");
    const total = S.contagem * COMPASSOS[S.compasso].n;
    if (!total) { comecarGravacao(); return; }
    S.contando = true; dica(simulado ? "Microfone não liberado: vou SIMULAR a gravação, só para você ver o fluxo." : "Pré-contagem… prepare-se para cantar.");
    const bd = beatDur(), n = COMPASSOS[S.compasso].n;
    for (let i = 0; i < total; i++) contTimers.push(setTimeout(() => { cliqueEm(ctx.currentTime + 0.005, i % n === 0); mostrarContagem(String((i % n) + 1)); }, 60 + i * bd * 1000));
    contTimers.push(setTimeout(() => { mostrarContagem(""); comecarGravacao(); }, 60 + total * bd * 1000));
  }
  function comecarGravacao() {
    S.contando = false; S.gravando = true;
    const g = gravacao, id = proxId++, bufId = "rec" + id;
    picos.set(bufId, []);
    g.regiao = { id, f: g.alvo.id, ini: g.ini, dur: 0.05, off: 0, buf: bufId, nome: g.alvo.nome + " · gravação", ganho: 0, fi: 0.005, fo: 0.005, gravando: true };
    S.regioes.push(g.regiao); S.regiaoSel = id; S.tAtual = g.ini;
    if (g.stream) {
      const src = ctx.createMediaStreamSource(g.stream); g.an = ctx.createAnalyser(); g.an.fftSize = 1024; src.connect(g.an); g.dados = new Uint8Array(g.an.fftSize);
      const tipo = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t));
      g.rec = new MediaRecorder(g.stream, tipo ? { mimeType: tipo } : undefined); g.rec.ondataavailable = (ev) => { if (ev.data.size) g.chunks.push(ev.data); }; g.rec.start();
    }
    renderTudo(); tocar(); dica("Gravando… aperte o botão vermelho (ou a barra de espaço) para parar.");
  }
  function atualizarGravacao() {
    const g = gravacao; if (!g || !g.regiao) return; const r = g.regiao; r.dur = Math.max(0.05, S.tAtual - r.ini);
    let a;
    if (g.an) { g.an.getByteTimeDomainData(g.dados); let m = 0; for (let i = 0; i < g.dados.length; i++) m = Math.max(m, Math.abs(g.dados[i] - 128) / 128); a = Math.min(1, m * 1.6); }
    else a = 0.2 + 0.55 * Math.abs(Math.sin(S.tAtual * 3.1)) * (0.6 + 0.4 * Math.random());
    const p = picos.get(r.buf), bin = Math.floor((S.tAtual - r.ini) / BIN); p[bin] = Math.max(p[bin] || 0, a);
    const el = $(`.dw-regiao[data-r="${r.id}"]`);
    if (el) { el.style.width = px(r.dur) + "px"; desenharOnda($("canvas", el), r, g.alvo.cor, px(r.dur), el.clientHeight - 18 || 60); }
    const vu = $(`[data-vu="${g.alvo.id}"]`); if (vu) vu.style.width = a * 100 + "%";
  }
  function finalizarGravacao() {
    const g = gravacao; if (!g || !g.regiao) return;
    S.gravando = false; $("#dwRec").classList.remove("on");
    const r = g.regiao;
    const pronto = (buf, blob) => {
      if (buf) {
        const off = Math.min(S.latencia / 1000, Math.max(0, buf.duration - 0.2)), id = guardarAudio(buf, blob);
        picos.delete(r.buf); r.buf = id; r.off = off; r.dur = buf.duration - off;
      } else { const p = picos.get(r.buf); r.dur = Math.max(0.1, (p.length || 1) * BIN); }
      r.gravando = false; empilhar(g.antes); gravacao = null; renderTudo();
      dica(buf ? `Gravação pronta: ${fmt(r.dur)}. Já faz parte do projeto: mexa nela como em qualquer região.` : "Gravação simulada pronta (sem microfone: não há áudio de verdade).");
    };
    if (g.rec && g.rec.state !== "inactive") {
      g.rec.onstop = async () => { g.stream.getTracks().forEach((t) => t.stop()); try { const blob = new Blob(g.chunks); pronto(await decodificar(await blob.arrayBuffer()), blob); } catch (e) { pronto(null); } };
      g.rec.stop();
    } else { if (g.stream) g.stream.getTracks().forEach((t) => t.stop()); pronto(null); }
  }
  function pararGravacao() {
    if (S.contando) {
      contTimers.forEach(clearTimeout); contTimers = []; S.contando = false; mostrarContagem(""); $("#dwRec").classList.remove("on");
      if (gravacao && gravacao.stream) gravacao.stream.getTracks().forEach((t) => t.stop());
      gravacao = null; dica("Gravação cancelada antes de começar."); return;
    }
    if (S.gravando) pausar();
  }

  // ══ IMPORTAR E SEPARAR ════════════════════════════════════════════════
  async function importarAudio(arq) {
    if (!garantirAudio()) return;
    dica("Lendo o áudio…");
    try {
      const buf = await decodificar(await arq.arrayBuffer()), antes = foto();
      const f = novaFaixa(arq.name.replace(/\.[^.]+$/, "").slice(0, 26)); const ini = snap(S.tAtual);
      const r = novaRegiao(f, guardarAudio(buf, arq), f.nome, ini, 0); S.faixaSel = f.id; S.regiaoSel = r.id;
      if (S.faixas.length === 1) S.nome = f.nome, $("#dwNome").value = f.nome;
      empilhar(antes); renderTudo(); mostrarFaixa(f.id); dica(`Áudio "${f.nome}" trazido para uma faixa nova (${fmt(buf.duration)}).`);
    } catch (e) { dica("Não consegui ler esse arquivo de áudio."); }
  }
  let configEst = null, timerColab = null, sepArquivo = null, sepRodando = false, sepCancelado = false;
  async function carregarConfig() {
    try { const r = await fetch(`${API_BASE}/api/estudio/config`); configEst = await r.json(); } catch (e) { configEst = configEst || { modo: "fila", colab: { online: false }, colab_url: "#" }; }
    atualizarColab(); return configEst;
  }
  function atualizarColab() {
    const card = $("#dwColab"); if (!card || !configEst) return;
    if (configEst.modo !== "fila") { card.hidden = true; atualizarBotaoSep(); return; }
    card.hidden = false; const on = !!(configEst.colab && configEst.colab.online);
    card.classList.toggle("on", on); $("#dwColabPilula").textContent = on ? (configEst.colab.gpu ? "Ligado · GPU" : "Ligado") : "Desligado";
    $("#dwColabTexto").textContent = on ? "Pronto! Escolha um áudio e clique em Separar." : "A separação roda no Google Colab (o servidor gratuito não tem memória para o Demucs). Ligue o separador uma vez: abra o Colab, use Ambiente de execução → Executar tudo e volte aqui. Este cartão fica verde sozinho.";
    $("#dwColabLink").href = configEst.colab_url || "#"; $("#dwColabLink").hidden = on; atualizarBotaoSep();
  }
  function colabPronto() { return !configEst || configEst.modo !== "fila" || !!(configEst.colab && configEst.colab.online); }
  function atualizarBotaoSep() { const b = $("#dwSepIniciar"); if (b) b.disabled = sepRodando || !sepArquivo || !colabPronto(); }
  function abrirSeparar() {
    $("#dwModalSep").hidden = false; $("#dwPassos").hidden = true; $("#dwSepStatus").textContent = ""; sepCancelado = false;
    carregarConfig(); clearInterval(timerColab); timerColab = setInterval(() => { if ($("#dwModalSep").hidden) clearInterval(timerColab); else carregarConfig(); }, 5000);
    atualizarBotaoSep();
  }
  function fecharSeparar() { $("#dwModalSep").hidden = true; clearInterval(timerColab); if (sepRodando) { sepCancelado = true; dica("A separação continua no servidor, mas o resultado será descartado."); } }
  function etapaSep(e) { const ordem = ["enviando", "fila", "separando", "baixando"], i = ordem.indexOf(e); $$("#dwPassos li").forEach((li, k) => { li.className = k < i ? "feito" : k === i ? "atual" : ""; }); }
  async function iniciarSeparacao() {
    if (!sepArquivo || sepRodando) return; sepRodando = true; sepCancelado = false; atualizarBotaoSep(); $("#dwPassos").hidden = false; $("#dwSepStatus").textContent = "";
    try {
      let res;
      if (configEst && configEst.modo === "fila") res = await separarViaColab(sepArquivo, etapaSep);
      else { $("#dwPassos").hidden = true; $("#dwSepStatus").textContent = "Separando no servidor… isso pode levar alguns minutos."; res = await separarLocal(sepArquivo); }
      if (sepCancelado) return;
      $("#dwSepStatus").textContent = "Abrindo no Estúdio…";
      const [bv, bi, bo] = await Promise.all([decodificar(await res.vozBlob.arrayBuffer()), decodificar(await res.instBlob.arrayBuffer()), decodificar(await sepArquivo.arrayBuffer())]);
      aplicarSeparacao(bv, bi, bo, res, sepArquivo);
      $("#dwModalSep").hidden = true; clearInterval(timerColab);
    } catch (err) { $("#dwSepStatus").textContent = (err && err.message) || "A separação falhou."; $("#dwPassos").hidden = true; }
    finally { sepRodando = false; atualizarBotaoSep(); }
  }
  function aplicarSeparacao(bv, bi, bo, res, arq) {
    if (S.regioes.length) novoProjeto();   // o projeto atual fica salvo: Arquivo → Abrir projeto
    const antes = foto();
    S.faixas = []; S.regioes = []; S.faixaSel = null; S.regiaoSel = null; S.tAtual = 0;
    const voz = novaFaixa("Voz (stem vocal)", "#f97316", { vol: 0.9 }), inst = novaFaixa("Instrumental", "#14b8a6", { vol: 0.8 }), orig = novaFaixa("Original (referência)", "#94a3b8", { vol: 0.7, mudo: true });
    novaRegiao(voz, guardarAudio(bv, res.vozBlob), "Voz", 0, 0); novaRegiao(inst, guardarAudio(bi, res.instBlob), "Instrumental", 0, 0); novaRegiao(orig, guardarAudio(bo, arq), "Original (referência)", 0, 0);
    S.faixaSel = voz.id; S.nome = arq.name.replace(/\.[^.]+$/, "").slice(0, 40); $("#dwNome").value = S.nome;
    if (res && Number.isFinite(+res.bpm) && +res.bpm >= 40 && +res.bpm <= 220) { S.bpm = Math.round(+res.bpm); $("#dwBpm").value = S.bpm; }
    S.tom = res && res.tom ? String(res.tom) : ""; $("#dwTom").textContent = S.tom || "—";
    empilhar(antes); renderTudo(); atualizarNos(); parar();
    dica(`Música separada em voz e instrumental${S.tom ? ` · tom ${S.tom}` : ""}${res && res.bpm ? ` · ${S.bpm} BPM` : ""}. A faixa Original fica muda, só de referência.`);
  }

  // ══ EXPORTAR ══════════════════════════════════════════════════════════
  async function renderizarMixagem() {
    if (!S.regioes.some((r) => bufs.has(r.buf))) throw new Error("Não há áudio para exportar.");
    garantirAudio();
    const sr = ctx.sampleRate, fim = fimProjeto() + 0.3, OC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const off = new OC(2, Math.ceil(fim * sr), sr), m = off.createGain(); m.gain.value = S.mestreVol;
    const lim = criarLimitador(off); m.connect(lim); lim.connect(off.destination);
    S.faixas.forEach((f) => {
      if (!audivel(f.id)) return;
      const g = off.createGain(); g.gain.value = f.vol; if (off.createStereoPanner) { const p = off.createStereoPanner(); p.pan.value = f.pan; g.connect(p); p.connect(m); } else g.connect(m);
      S.regioes.filter((r) => r.f === f.id).forEach((r) => programarRegiao(off, r, g, 0, 0));
    });
    return off.startRendering();
  }
  async function exportar() {
    dica("Exportando a mixagem…");
    try {
      const buf = await renderizarMixagem(), blob = audioBufferParaWavBlob(buf), a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = (S.nome || "mixagem").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "_") + "_mixagem.wav";
      document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
      dica(`Mixagem exportada (${fmt(buf.duration)}, WAV).`);
    } catch (e) { dica(e.message || "Não consegui exportar."); }
  }

  // ══ EDIÇÃO DE REGIÕES ═════════════════════════════════════════════════
  let areaCopia = null;
  function dividirRegiao(r, t) {
    if (t <= r.ini + 0.02 || t >= r.ini + r.dur - 0.02) return dica("Coloque o cursor (ou clique) dentro da região para dividir.");
    mudar(() => { const fim = r.ini + r.dur; r.dur = t - r.ini; const n = { ...r, id: proxId++, ini: t, off: r.off + (t - r.ini), dur: fim - t, nome: r.nome + " (parte 2)" }; r.fo = 0.005; S.regioes.push(n); });
    dica("Região dividida em duas.");
  }
  function excluirRegiao(id) { mudar(() => { S.regioes = S.regioes.filter((x) => x.id !== id); S.regiaoSel = null; }); dica("Região excluída."); }
  function duplicarRegiao(r) { mudar(() => { const n = { ...r, id: proxId++, ini: r.ini + r.dur, nome: r.nome + " (cópia)" }; S.regioes.push(n); S.regiaoSel = n.id; }); dica("Região duplicada logo depois da original."); }
  function usarFerramenta(k) { S.ferr = k; $$("#dwFerr .dw-fb").forEach((b) => b.classList.toggle("on", b.dataset.f === k)); const tl = $("#dwTlScroll"); if (tl) tl.style.cursor = k === "mao" ? "grab" : k === "tes" ? "crosshair" : k === "lupa" ? "zoom-in" : ""; }
  function linhaSob(y) { const sc = $("#dwTlScroll"), top = sc.getBoundingClientRect().top + 28 - sc.scrollTop, i = Math.floor((y - top) / (($(".dw-linha") || { offsetHeight: ALT }).offsetHeight)); return S.faixas[i] || null; }

  function aoPressionarFaixas(e) {
    const rg = e.target.closest(".dw-regiao"), tlc = $("#dwTlScroll");
    if (S.ferr === "mao") { const x0 = e.clientX, s0 = tlc.scrollLeft; const mv = (ev) => { tlc.scrollLeft = s0 - (ev.clientX - x0); }; const up = () => { removeEventListener("pointermove", mv); removeEventListener("pointerup", up); }; addEventListener("pointermove", mv); addEventListener("pointerup", up); return; }
    if (S.ferr === "lupa") { const t = (e.clientX - $("#dwTl").getBoundingClientRect().left) / S.pps; mudarZoom(S.pps * (e.altKey ? 0.8 : 1.25)); tlc.scrollLeft = Math.max(0, t * S.pps - (e.clientX - tlc.getBoundingClientRect().left)); return; }
    if (!rg) { const lh = e.target.closest(".dw-linha"); if (lh && lh.dataset.lf) { S.faixaSel = lh.dataset.lf; S.regiaoSel = null; renderTudo(); } return; }
    const r = regiaoPorId(+rg.dataset.r); if (!r || r.gravando) return;
    if (S.ferr === "tes") { dividirRegiao(r, snap((e.clientX - $("#dwTl").getBoundingClientRect().left) / S.pps, e.altKey)); return; }
    S.faixaSel = r.f; S.regiaoSel = r.id;
    const antes = foto(), alca = e.target.dataset.alca, x0 = e.clientX, ini0 = r.ini, dur0 = r.dur, off0 = r.off, f0 = r.f, buf = bufs.get(r.buf); let mexeu = false;
    $$(".dw-regiao", $("#dwFaixas")).forEach((el) => el.classList.toggle("sel", +el.dataset.r === r.id)); $$(".dw-cab").forEach((el) => el.classList.toggle("sel", el.dataset.f === r.f)); renderRegiao(); selStatus();
    const mv = (ev) => {
      const dx = (ev.clientX - x0) / S.pps; mexeu = true;
      if (alca === "e") { const novo = Math.max(ini0 - off0, Math.min(ini0 + dur0 - 0.05, snap(ini0 + dx, ev.altKey))); r.dur = dur0 - (novo - ini0); r.off = off0 + (novo - ini0); r.ini = novo; }
      else if (alca === "d") { r.dur = Math.max(0.05, Math.min(buf ? buf.duration - r.off : 1e9, snap(ini0 + dur0 + dx, ev.altKey) - ini0)); }
      else { r.ini = Math.max(0, snap(ini0 + dx, ev.altKey)); const alvo = linhaSob(ev.clientY); if (alvo && alvo.id !== r.f) { r.f = alvo.id; const dest = $(`.dw-linha[data-lf="${alvo.id}"]`); const el0 = $(`.dw-regiao[data-r="${r.id}"]`); if (dest && el0) dest.appendChild(el0); } }
      const el = $(`.dw-regiao[data-r="${r.id}"]`); if (el) { el.style.left = px(r.ini) + "px"; el.style.width = px(r.dur) + "px"; el.style.cursor = "grabbing"; }
    };
    const up = () => {
      removeEventListener("pointermove", mv); removeEventListener("pointerup", up);
      if (mexeu) { empilhar(antes); S.faixaSel = r.f; renderTudo(); if (S.tocando) reagendar(); dica(alca ? "Região ajustada." : r.f !== f0 ? "Região levada para outra faixa." : "Região movida."); }
    };
    addEventListener("pointermove", mv); addEventListener("pointerup", up);
  }

  // ══ EVENTOS ═══════════════════════════════════════════════════════════
  function menu(id, ancora, alinharDireita) {
    const m = $(id), r = ancora.getBoundingClientRect(), outros = ["#dwMenuArquivo", "#dwMenuFaixa"].filter((x) => x !== id); outros.forEach((x) => { $(x).hidden = true; });
    m.style.top = r.bottom + 6 + "px"; m.style.left = (alinharDireita ? Math.max(8, r.right - 290) : r.left) + "px"; m.hidden = !m.hidden;
  }
  function ligarEventos() {
    $("#dwRew").addEventListener("click", () => { ir(0); $("#dwTlScroll").scrollLeft = 0; });
    $("#dwPlay").addEventListener("click", () => { if (S.gravando || S.contando) pararGravacao(); else S.tocando ? pausar() : tocar(); });
    $("#dwStop").addEventListener("click", () => { if (S.gravando || S.contando) pararGravacao(); parar(); });
    $("#dwRec").addEventListener("click", iniciarGravacao);
    $("#dwBpm").addEventListener("change", (e) => { const novo = Math.max(40, Math.min(220, +e.target.value || 100)); e.target.value = novo; mudar(() => { S.bpm = novo; }); dica(`Andamento: ${novo} BPM. A grade e o metrônomo acompanham (o áudio não muda).`); });
    $("#dwComp").addEventListener("change", (e) => { mudar(() => { S.compasso = e.target.value; }); dica("Compasso: " + e.target.value); });
    $("#dwNome").addEventListener("change", (e) => { S.nome = e.target.value.trim() || "Meu projeto"; agendarSalvar(); });
    $("#dwFerr").addEventListener("click", (e) => { const b = e.target.closest("[data-f]"); if (b) usarFerramenta(b.dataset.f); });
    $("#dwUndo").addEventListener("click", desfazer); $("#dwRedo").addEventListener("click", refazer);
    $("#dwSnap").addEventListener("change", (e) => { S.snap = e.target.value; dica("Grade: " + e.target.options[e.target.selectedIndex].text); });
    $("#dwZoom").addEventListener("input", (e) => mudarZoom(+e.target.value));
    $("#dwAjustar").addEventListener("click", () => { const fim = Math.max(fimProjeto(), 10), w = $("#dwTlScroll").clientWidth - 60; mudarZoom(w / fim); $("#dwTlScroll").scrollLeft = 0; });
    $("#dwSeguir").addEventListener("change", (e) => { S.seguir = e.target.checked; });
    $("#dwMetroBtn").addEventListener("click", () => { $("#dwMetro").value = S.metro === "off" ? "on" : "off"; $("#dwMetro").dispatchEvent(new Event("change")); });
    $("#dwMetro").addEventListener("change", (e) => { S.metro = e.target.value; $("#dwMetroBtn").classList.toggle("on", S.metro !== "off"); garantirAudio(); localStorage.setItem("oh-dw-metro", S.metro); dica({ off: "Metrônomo desligado.", on: "Metrônomo ligado: um clique por tempo, o 1º de cada compasso é mais agudo.", rec: "Metrônomo só toca enquanto você grava." }[S.metro]); });
    $("#dwContagem").addEventListener("change", (e) => { S.contagem = +e.target.value; localStorage.setItem("oh-dw-contagem", S.contagem); dica(S.contagem ? `Pré-contagem de ${S.contagem} compasso(s) antes de gravar.` : "Sem pré-contagem: a gravação começa na hora."); });
    $("#dwLat").addEventListener("change", (e) => { S.latencia = Math.max(0, Math.min(500, +e.target.value || 0)); e.target.value = S.latencia; localStorage.setItem("oh-dw-lat", S.latencia); dica(`Atraso de gravação: ${S.latencia} ms (as próximas gravações começam esse tanto mais adiantadas).`); });
    // faixas
    $("#dwFaixas").addEventListener("pointerdown", aoPressionarFaixas);
    $("#dwRegua").addEventListener("pointerdown", (e) => { const x = e.clientX - $("#dwRegua").getBoundingClientRect().left; ir(snap(x / S.pps, e.altKey)); });
    $("#dwTlScroll").addEventListener("wheel", (e) => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); mudarZoom(S.pps * (e.deltaY < 0 ? 1.12 : 0.89)); } }, { passive: false });
    let sync = false;
    $("#dwTlScroll").addEventListener("scroll", () => { if (sync) return; sync = true; $("#dwCabLista").scrollTop = $("#dwTlScroll").scrollTop; sync = false; });
    $("#dwCabLista").addEventListener("scroll", () => { if (sync) return; sync = true; $("#dwTlScroll").scrollTop = $("#dwCabLista").scrollTop; sync = false; });
    function aoClicarFaixaUI(e) {
      const t = e.target, a = (k) => t.closest(`[data-${k}]`) && t.closest(`[data-${k}]`).dataset[k];
      const m = a("m"), s = a("s"), r = a("r"), del = a("del");
      if (m) { const f = faixaPorId(m); mudar(() => { f.mudo = !f.mudo; }); atualizarNos(); return; }
      if (s) { const f = faixaPorId(s); mudar(() => { f.solo = !f.solo; }); atualizarNos(); return; }
      if (r) { const f = faixaPorId(r); mudar(() => { const novo = !f.arm; S.faixas.forEach((x) => { x.arm = false; }); f.arm = novo; }); dica(f.arm ? `Faixa "${f.nome}" armada: o botão vermelho grava nela.` : "Faixa desarmada."); return; }
      if (del) { const f = faixaPorId(del); mudar(() => { S.faixas = S.faixas.filter((x) => x.id !== del); S.regioes = S.regioes.filter((x) => x.f !== del); if (S.faixaSel === del) S.faixaSel = S.faixas[0] ? S.faixas[0].id : null; }); dica(`Faixa "${f.nome}" excluída (Ctrl+Z traz de volta).`); return; }
      const cab = t.closest(".dw-cab"); if (cab && !t.closest("input")) { S.faixaSel = cab.dataset.f; S.regiaoSel = null; renderTudo(); }
    }
    $("#dwCabLista").addEventListener("click", aoClicarFaixaUI); $("#dwMix").addEventListener("click", aoClicarFaixaUI);
    $("#dwRaiz").addEventListener("input", (e) => {
      const t = e.target;
      if (t.dataset.vol) { const f = faixaPorId(t.dataset.vol); f.vol = +t.value; $$(`[data-vol="${f.id}"]`).forEach((i) => { if (i !== t) i.value = t.value; }); const db = $(`[data-db="${f.id}"]`); if (db) db.textContent = dbTxt(f.vol); atualizarNos(); agendarSalvar(); }
      if (t.dataset.pan) { faixaPorId(t.dataset.pan).pan = +t.value; atualizarNos(); agendarSalvar(); }
      if (t.dataset.nome) { faixaPorId(t.dataset.nome).nome = t.value; agendarSalvar(); }
      if (t.id === "dwMestreVol") { S.mestreVol = +t.value; if (mestre) mestre.gain.value = S.mestreVol; }
      if (t.dataset.rg) { const r = regiaoPorId(S.regiaoSel); r[t.dataset.rg] = +t.value; const b = t.parentElement.querySelector("b"); b.textContent = t.dataset.rg === "ganho" ? t.value + " dB" : (+t.value).toFixed(2) + "s"; if (t.dataset.rg !== "ganho") renderLinhas(); agendarSalvar(); if (S.tocando) reagendar(); }
      if (t.hasAttribute("data-rnome")) { const r = regiaoPorId(S.regiaoSel); r.nome = t.value; const rot = $(`.dw-regiao[data-r="${r.id}"] .rot`); if (rot) rot.textContent = t.value; agendarSalvar(); }
    });
    $("#dwRegp").addEventListener("click", (e) => { const b = e.target.closest("[data-ra]"); const r = regiaoPorId(S.regiaoSel); if (!b || !r) return; if (b.dataset.ra === "excluir") excluirRegiao(r.id); else if (b.dataset.ra === "duplicar") duplicarRegiao(r); else dividirRegiao(r, S.tAtual); });
    // abas do editor
    $$(".dw-aba").forEach((a) => a.addEventListener("click", () => abrirAba(a.dataset.aba)));
    $("#dwRecolher").addEventListener("click", () => { const f = $("#dwEditor").classList.toggle("fechado"); $("#dwRecolher").innerHTML = ic("seta") + (f ? " Abrir" : " Recolher"); });
    // tela inicial
    $("#dwOpSep").addEventListener("click", abrirSeparar); $("#dwOpImportar").addEventListener("click", () => $("#dwArqAudio").click());
    $("#dwOpGravar").addEventListener("click", () => { const antes = foto(); const f = criarFaixaVoz(); S.faixaSel = f.id; empilhar(antes); renderTudo(); dica(`Faixa "${f.nome}" criada e armada. Aperte o botão vermelho (ou R) para gravar.`); });
    // arquivo e faixa
    $("#dwArquivo").addEventListener("click", (e) => { menu("#dwMenuArquivo", e.currentTarget, true); e.stopPropagation(); });
    $("#dwAddFaixa").addEventListener("click", (e) => { menu("#dwMenuFaixa", e.currentTarget, false); e.stopPropagation(); });
    document.addEventListener("click", (e) => { if (!e.target.closest(".dw-menu") && !e.target.closest("#dwArquivo") && !e.target.closest("#dwAddFaixa")) { $("#dwMenuArquivo").hidden = true; $("#dwMenuFaixa").hidden = true; } });
    $("#dwMenuArquivo").addEventListener("click", (e) => {
      const b = e.target.closest("[data-a]"); if (!b) return; $("#dwMenuArquivo").hidden = true;
      if (b.dataset.a === "importar") $("#dwArqAudio").click();
      else if (b.dataset.a === "exportar") exportar();
      else if (b.dataset.a === "classico") { const f = document.getElementById("fabEstudio"); if (f) f.click(); }
      else if (b.dataset.a === "novo") novoProjeto();
      else if (b.dataset.a === "salvar") salvarProjeto().then((okk) => { if (okk) dica("Projeto salvo neste aparelho."); });
      else if (b.dataset.a === "abrir") abrirListaProjetos();
    });
    $("#dwMenuFaixa").addEventListener("click", (e) => {
      const b = e.target.closest("[data-n]"); if (!b) return; $("#dwMenuFaixa").hidden = true; const antes = foto();
      if (b.dataset.n === "voz") { const f = criarFaixaVoz(); S.faixaSel = f.id; empilhar(antes); renderTudo(); mostrarFaixa(f.id); dica(`Faixa "${f.nome}" criada e armada. Aperte o botão vermelho (ou R) para gravar nela.`); }
      else if (b.dataset.n === "vazia") { const f = novaFaixa("Faixa " + (S.faixas.length + 1)); S.faixaSel = f.id; empilhar(antes); renderTudo(); mostrarFaixa(f.id); dica("Faixa vazia criada."); }
      else $("#dwArqAudio").click();
    });
    $("#dwArqAudio").addEventListener("change", (e) => { const a = e.target.files[0]; if (a) importarAudio(a); e.target.value = ""; });
    // separação
    $("#dwSeparar").addEventListener("click", abrirSeparar); $("#dwSepFechar").addEventListener("click", fecharSeparar); $("#dwSepCancelar").addEventListener("click", fecharSeparar);
    $("#dwSepUpload").addEventListener("click", () => $("#dwSepArq").click());
    $("#dwSepBib").addEventListener("click", (e) => { if (window.escolherDaBiblioteca) window.escolherDaBiblioteca($("#dwSepArq"), e.currentTarget); else $("#dwSepStatus").textContent = "A biblioteca não está disponível agora."; });
    $("#dwSepArq").addEventListener("change", (e) => { sepArquivo = e.target.files[0] || null; $("#dwSepNome").textContent = sepArquivo ? `Escolhido: ${sepArquivo.name}` : "Nenhum áudio escolhido."; atualizarBotaoSep(); });
    $("#dwSepIniciar").addEventListener("click", iniciarSeparacao);
    $("#dwProjFechar").addEventListener("click", () => { $("#dwModalProj").hidden = true; });
    $("#dwProjLista").addEventListener("click", async (e) => {
      const a = e.target.closest("[data-abrir]"), x = e.target.closest("[data-excluir]");
      if (a) { $("#dwModalProj").hidden = true; dica("Abrindo o projeto…"); await salvarProjeto(); const okk = await abrirProjeto(a.dataset.abrir); if (okk) dica(`Projeto "${S.nome}" aberto.`); else dica("Não encontrei esse projeto."); }
      if (x) { if (!confirm("Excluir este projeto salvo? Não dá para desfazer.")) return; await excluirProjeto(x.dataset.excluir); if (x.dataset.excluir === S.id) { S.sujo = true; } abrirListaProjetos(); }
    });
    // teclado
    document.addEventListener("keydown", (e) => {
      const pag = $("#page-estudio"); if (!pag || !pag.classList.contains("oh-page-ativa")) return;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable) return;
      if (!$("#dwModalSep").hidden || !$("#dwModalProj").hidden) return;
      const meta = e.ctrlKey || e.metaKey, k = e.key.toLowerCase(), r = regiaoPorId(S.regiaoSel);
      if (e.key === " " || e.code === "Space") { if (/^(BUTTON|A|SUMMARY)$/.test(e.target.tagName)) return; e.preventDefault(); if (S.gravando || S.contando) pararGravacao(); else S.tocando ? pausar() : tocar(); }
      else if (meta && k === "z" && !e.shiftKey) { e.preventDefault(); desfazer(); }
      else if (meta && (k === "y" || (k === "z" && e.shiftKey))) { e.preventDefault(); refazer(); }
      else if (meta && k === "c") { if (r) { areaCopia = { ...r }; dica("Região copiada. Ctrl+V cola no cursor."); } }
      else if (meta && k === "v" && areaCopia) { e.preventDefault(); const alvo = faixaPorId(S.faixaSel) || faixaPorId(areaCopia.f); mudar(() => { const n = { ...areaCopia, id: proxId++, f: alvo.id, ini: snap(S.tAtual), nome: areaCopia.nome + " (cópia)" }; S.regioes.push(n); S.regiaoSel = n.id; }); dica("Região colada no cursor."); }
      else if (meta && k === "d") { e.preventDefault(); if (r) duplicarRegiao(r); }
      else if (meta && k === "s") { e.preventDefault(); salvarProjeto().then((okk) => { if (okk) dica("Projeto salvo neste aparelho."); }); }
      else if ((e.key === "Delete" || e.key === "Backspace") && r) { e.preventDefault(); excluirRegiao(r.id); }
      else if (!meta && k === "s" && r) dividirRegiao(r, S.tAtual);
      else if (!meta && k === "r") { e.preventDefault(); iniciarGravacao(); }
      else if (!meta && ["v", "c", "h", "z"].includes(k)) usarFerramenta({ v: "sel", c: "tes", h: "mao", z: "lupa" }[k]);
      else if (e.key === "Home") { ir(0); $("#dwTlScroll").scrollLeft = 0; }
      else if (e.key === "Escape") { S.regiaoSel = null; renderTudo(); }
    });
    // clicar num botão solta o foco: a barra de espaço sempre toca/pausa
    $("#dwRaiz").addEventListener("click", (e) => { const b = e.target.closest("button, input[type=checkbox]"); if (b) setTimeout(() => b.blur(), 0); });
    window.addEventListener("beforeunload", (e) => { if (S.sujo && S.regioes.length) { e.preventDefault(); e.returnValue = ""; } });
  }
  function abrirAba(n) { $$(".dw-aba").forEach((a) => a.classList.toggle("on", a.dataset.aba === n)); $$(".dw-painel-aba").forEach((p) => p.classList.toggle("on", p.id === "dwP-" + n)); $("#dwEditor").classList.remove("fechado"); $("#dwRecolher").innerHTML = ic("seta") + " Recolher"; }
  function novoProjeto() {
    salvarProjeto();                                   // o projeto atual fica guardado (Arquivo → Abrir projeto)
    if (S.tocando) pausar(); pararFontes(); nos.forEach((n) => { try { n.gain.disconnect(); n.pan.disconnect(); } catch (e) { /* solto */ } }); nos.clear();
    S.id = "p" + Date.now().toString(36); S.faixas = []; S.regioes = []; S.faixaSel = null; S.regiaoSel = null; S.tAtual = 0; S.nome = "Meu projeto"; S.tom = ""; S.bpm = 100; S.sujo = false;
    bufs.clear(); picos.clear(); blobs.clear(); noBanco.clear(); pilha.length = 0; refaz.length = 0;
    try { localStorage.removeItem("oh-dw-ultimo"); } catch (e) { /* sem armazenamento */ }
    $("#dwNome").value = S.nome; $("#dwBpm").value = S.bpm; $("#dwTom").textContent = "—"; mostrarSalvo(""); renderTudo(); dica("Projeto novo. O anterior ficou salvo em Arquivo → Abrir projeto.");
  }

  // ══ SALVAR PROJETO (no próprio aparelho, em IndexedDB) ════════════════
  // Guarda a lista de faixas/regiões (pequena) e os áudios (como arquivos originais, sem recodificar).
  const blobs = new Map();      // id do áudio -> arquivo original
  const noBanco = new Set();    // áudios deste projeto que já estão guardados
  let timerSalvar = null, salvandoAgora = Promise.resolve();
  function abrirDB() {
    return new Promise((ok, no) => {
      const rq = indexedDB.open("oh-estudio", 1);
      rq.onupgradeneeded = () => { rq.result.createObjectStore("projetos", { keyPath: "id" }); rq.result.createObjectStore("audios"); };
      rq.onsuccess = () => ok(rq.result); rq.onerror = () => no(rq.error);
    });
  }
  const idb = (rq) => new Promise((ok, no) => { rq.onsuccess = () => ok(rq.result); rq.onerror = () => no(rq.error); });
  function mostrarSalvo(txt, erro) { const e = $("#dwSalvo"); if (e) { e.textContent = txt; e.style.color = erro ? "#ef4444" : ""; } }
  function agendarSalvar() { S.sujo = true; mostrarSalvo("Alterações ainda não salvas…"); clearTimeout(timerSalvar); timerSalvar = setTimeout(() => salvarProjeto(), 1500); }
  function salvarProjeto() {
    clearTimeout(timerSalvar);
    if (!S.faixas.length && !S.regioes.length) return Promise.resolve(false);
    if (S.gravando || S.contando) { agendarSalvar(); return Promise.resolve(false); }
    // tira uma "foto" agora, de forma síncrona: mesmo que o projeto mude logo em seguida, salva o que estava na tela
    const regs = S.regioes.filter((r) => !r.gravando), pid = S.id;
    const proj = { id: pid, nome: S.nome, atualizado: Date.now(), faixas: JSON.parse(JSON.stringify(S.faixas)), regioes: JSON.parse(JSON.stringify(regs)), bpm: S.bpm, compasso: S.compasso, tom: S.tom, mestreVol: S.mestreVol, proxId, nFaixas: S.faixas.length };
    const fontes = [...new Set(regs.map((r) => r.buf))].filter((b) => bufs.has(b)).map((b) => [b, blobs.get(b), bufs.get(b), noBanco.has(b)]);
    const trabalho = salvandoAgora.then(async () => {
      mostrarSalvo("Salvando…");
      try {
        const novos = [];
        for (const [b, blob, buf, jaTem] of fontes) { if (jaTem) continue; novos.push([pid + ":" + b, await (blob || audioBufferParaWavBlob(buf)).arrayBuffer(), b]); }
        const db = await abrirDB();
        await new Promise((ok, no) => {
          const t = db.transaction(["projetos", "audios"], "readwrite"); novos.forEach(([k, ab]) => t.objectStore("audios").put(ab, k)); t.objectStore("projetos").put(proj);
          t.oncomplete = ok; t.onerror = () => no(t.error); t.onabort = () => no(t.error);
        });
        db.close(); if (pid === S.id) { novos.forEach(([, , b]) => noBanco.add(b)); S.sujo = false; mostrarSalvo("Projeto salvo neste aparelho ✓"); }
        if (pid === S.id) { try { localStorage.setItem("oh-dw-ultimo", pid); } catch (e) { /* sem armazenamento */ } }   // só o projeto aberto agora conta como "o último"
        if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
        return true;
      } catch (e) {
        if (pid === S.id) mostrarSalvo("Não consegui salvar", true);
        dica(e && e.name === "QuotaExceededError" ? "Não consegui salvar: acabou o espaço do aparelho. Exporte a mixagem e libere espaço." : "Não consegui salvar o projeto: o navegador bloqueou o armazenamento. Exporte a mixagem para não perder o trabalho.");
        return false;
      }
    });
    salvandoAgora = trabalho.catch(() => false);
    return trabalho;
  }
  async function listarProjetos() {
    const db = await abrirDB(), todos = await idb(db.transaction("projetos").objectStore("projetos").getAll()); db.close();
    return todos.map((p) => ({ id: p.id, nome: p.nome, atualizado: p.atualizado, nFaixas: p.nFaixas, nRegioes: p.regioes.length })).sort((a, b) => b.atualizado - a.atualizado);
  }
  async function abrirProjeto(id) {
    const db = await abrirDB(), proj = await idb(db.transaction("projetos").objectStore("projetos").get(id));
    if (!proj) { db.close(); return false; }
    const ids = [...new Set(proj.regioes.map((r) => r.buf))], novosBufs = new Map(), novosPicos = new Map(), novosBlobs = new Map();
    for (const b of ids) {
      const ab = await idb(db.transaction("audios").objectStore("audios").get(id + ":" + b)); if (!ab) continue;
      novosBlobs.set(b, new Blob([ab])); const buf = await decodificar(ab.slice(0)); novosBufs.set(b, buf); novosPicos.set(b, calcularPicos(buf));
    }
    // limpeza: tira do banco os áudios que este projeto não usa mais (regiões excluídas há tempo)
    const chaves = await idb(db.transaction("audios").objectStore("audios").getAllKeys(IDBKeyRange.bound(id + ":", id + ":\uffff"))), usados = new Set(ids.map((b) => id + ":" + b)), sobra = chaves.filter((k) => !usados.has(k));
    if (sobra.length) await new Promise((ok) => { const t = db.transaction("audios", "readwrite"); sobra.forEach((k) => t.objectStore("audios").delete(k)); t.oncomplete = ok; t.onerror = ok; });
    db.close();
    if (S.tocando) pausar(); pararFontes(); nos.forEach((n) => { try { n.gain.disconnect(); n.pan.disconnect(); } catch (e) { /* solto */ } }); nos.clear();
    bufs.clear(); picos.clear(); blobs.clear(); noBanco.clear(); novosBufs.forEach((v, k) => { bufs.set(k, v); picos.set(k, novosPicos.get(k)); blobs.set(k, novosBlobs.get(k)); noBanco.add(k); });
    const faltaram = proj.regioes.filter((r) => !bufs.has(r.buf)).length;
    S.id = proj.id; S.nome = proj.nome; S.faixas = proj.faixas; S.regioes = proj.regioes.filter((r) => bufs.has(r.buf)); S.bpm = proj.bpm; S.compasso = proj.compasso; S.tom = proj.tom || ""; S.mestreVol = proj.mestreVol == null ? 0.9 : proj.mestreVol;
    proxId = Math.max(proxId, proj.proxId || 0) + 1; S.faixaSel = S.faixas[0] ? S.faixas[0].id : null; S.regiaoSel = null; S.tAtual = 0; S.sujo = false; pilha.length = 0; refaz.length = 0;
    $("#dwNome").value = S.nome; $("#dwBpm").value = S.bpm; $("#dwComp").value = S.compasso; $("#dwTom").textContent = S.tom || "—";
    try { localStorage.setItem("oh-dw-ultimo", S.id); } catch (e) { /* sem armazenamento */ }
    renderTudo(); atualizarNos(); mostrarSalvo("Projeto salvo neste aparelho ✓");
    if (faltaram) dica(`Atenção: ${faltaram} região(ões) perderam o áudio (o navegador apagou parte dos dados salvos) e foram removidas.`);
    return true;
  }
  async function excluirProjeto(id) {
    const db = await abrirDB();
    await new Promise((ok) => { const t = db.transaction(["projetos", "audios"], "readwrite"); t.objectStore("projetos").delete(id); t.objectStore("audios").delete(IDBKeyRange.bound(id + ":", id + ":\uffff")); t.oncomplete = ok; t.onerror = ok; });
    db.close();
  }
  async function abrirListaProjetos() {
    $("#dwModalProj").hidden = false; const el = $("#dwProjLista"); el.innerHTML = '<div class="dw-dica">Carregando…</div>';
    try {
      await salvarProjeto(); const lista = await listarProjetos();
      el.innerHTML = lista.length ? lista.map((p) => `<div class="dw-proj-item" data-p="${p.id}"><div class="info"><b>${esc(p.nome)}</b>${p.id === S.id ? " <small>(aberto agora)</small>" : ""}<br><small>${new Date(p.atualizado).toLocaleString("pt-BR")} · ${p.nFaixas} faixa(s) · ${p.nRegioes} região(ões)</small></div><button class="dw-btn peq" data-abrir="${p.id}" ${p.id === S.id ? "disabled" : ""}>Abrir</button><button class="dw-btn peq" data-excluir="${p.id}">Excluir</button></div>`).join("") : '<div class="dw-dica">Nenhum projeto salvo ainda. Ele é salvo sozinho assim que você começa a mexer.</div>';
    } catch (e) { el.innerHTML = '<div class="dw-dica">Não consegui ler os projetos salvos neste navegador.</div>'; }
  }

  // ══ INÍCIO ════════════════════════════════════════════════════════════
  let restauradoUmaVez = false;
  function aoAbrir() {
    montar(); renderTudo(); atualizarNos();
    if (restauradoUmaVez) return; restauradoUmaVez = true;
    let ultimo = null; try { ultimo = localStorage.getItem("oh-dw-ultimo"); } catch (e) { /* sem armazenamento */ }
    if (ultimo && !S.faixas.length) abrirProjeto(ultimo).then((okk) => { if (okk) dica(`Projeto "${S.nome}" retomado de onde você parou.`); }).catch(() => {});
  }
  function iniciar() {
    montar();
    try { S.metro = localStorage.getItem("oh-dw-metro") || "off"; S.contagem = +(localStorage.getItem("oh-dw-contagem") ?? 1); S.latencia = +(localStorage.getItem("oh-dw-lat") || 0); } catch (e) { /* sem armazenamento */ }
    $("#dwMetro").value = S.metro; $("#dwMetroBtn").classList.toggle("on", S.metro !== "off"); $("#dwContagem").value = String(S.contagem); $("#dwLat").value = S.latencia;
    usarFerramenta("sel"); renderTudo();
  }
  window.EstudioDaw = {
    aoAbrir,
    _teste: {
      salvarProjeto, listarProjetos, abrirProjeto, S, bufs, picos, foto, desfazer, refazer, renderizarMixagem, importarAudio, aplicarSeparacao, garantirAudio,
      fontes: () => fontes.length, cliques: () => cliquesTotal, cliqueLog: () => cliqueLog.slice(),
      ganhoDe: (id) => { const n = nos.get(id); return n ? n.gain.gain.value : null; },
      nivelDe: (id) => { const n = nos.get(id); return n ? nivel(n.an) : null; },
      metas: () => ({ ctxEstado: ctx && ctx.state, sr: ctx && ctx.sampleRate }),
    },
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar); else iniciar();
})();
