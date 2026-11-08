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
    loop: '<path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 013-3h15"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 01-3 3H3"/>',
    play: '<path d="M8 5v14l11-7z"/>', pause: '<path d="M7 5h4v14H7zM13 5h4v14h-4z"/>', stop: '<rect x="6" y="6" width="12" height="12" rx="1.5"/>', rec: '<circle cx="12" cy="12" r="6"/>', rew: '<path d="M6 5h2v14H6zM20 5v14L9 12z"/>',
    sel: '<path d="M5 3l14 8-6 2 3 7-3 1-3-7-5 4z"/>', tes: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M8.5 8l11 10M8.5 16L19.5 6"/>',
    mao: '<path d="M8 12V5a1.5 1.5 0 013 0v6M11 11V4a1.5 1.5 0 013 0v7M14 11V6a1.5 1.5 0 013 0v8c0 4-2 6-5 6-3 0-5-2-6-5l-1-3a1.5 1.5 0 012.5-1z"/>',
    lupa: '<circle cx="10" cy="10" r="6"/><path d="M15 15l6 6"/>', undo: '<path d="M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3"/>', redo: '<path d="M15 14l5-5-5-5M20 9H10a6 6 0 000 12h3"/>',
    mais: '<path d="M12 5v14M5 12h14"/>', seta: '<path d="M6 9l6 6 6-6"/>', onda: '<path d="M4 12h2v4H4zm4-4h2v12H8zm4-4h2v16h-2zm4 6h2v8h-2zm4 2h2v4h-2z"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v3"/>', pasta: '<path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>',
    divide: '<path d="M12 3v18M5 8l-3 4 3 4M19 8l3 4-3 4"/>', metro: '<path d="M8 21h8l-1.6-15h-4.8zM12 15l4.5-8"/>', baixar: '<path d="M12 3v12M7 10l5 5 5-5M4 20h16"/>',
  };
  const TRACADOS = new Set(["loop", "metro", "tes", "mao", "lupa", "undo", "redo", "mais", "seta", "mic", "pasta", "divide", "baixar"]);
  const ic = (n) => `<svg class="dw-ic ${TRACADOS.has(n) ? "tr" : ""}" viewBox="0 0 24 24" aria-hidden="true">${P[n]}</svg>`;
  const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const corA = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };

  // ── estado do projeto (só dados simples: é isto que o desfazer guarda) ──
  const ALT = 84, BIN = 0.005, FOLGA = 20;
  const COMPASSOS = { "4/4": { n: 4, u: 1 }, "3/4": { n: 3, u: 1 }, "2/4": { n: 2, u: 1 }, "6/8": { n: 6, u: 0.5 } };
  const CORES = ["#a855f7", "#ec4899", "#eab308", "#38bdf8", "#84cc16", "#fb7185"];
  const S = {
    loop: { on: false, ini: 0, fim: 0 }, id: "p" + Date.now().toString(36), nome: "Meu projeto", bpm: 100, compasso: "4/4", tom: "", pps: 40, snap: "off", ferr: "sel", tAtual: 0, tocando: false, seguir: true,
    metro: "off", contagem: 1, latencia: 0, mestreVol: 0.9, monitor: "caixa", faixas: [], regioes: [], faixaSel: null, regiaoSel: null, sujo: false, gravando: false, contando: false,
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
      if (window.EstudioFx && ctx.audioWorklet) EstudioFx.carregarWorklet(ctx).then(() => { fxOk = true; S.faixas.forEach((f) => { const n = nos.get(f.id); if (n) montarCadeia(f, n); }); }).catch((e) => { fxErro = e; });
    }
    if (ctx.state === "suspended") ctx.resume();
    return true;
  }
  function criarLimitador(c) { const l = c.createDynamicsCompressor(); l.threshold.value = -2; l.knee.value = 0; l.ratio.value = 20; l.attack.value = 0.003; l.release.value = 0.12; return l; }
  let fxOk = false, fxErro = null;
  const ambFx = () => ({ bpm: S.bpm, origem: S.tocando ? baseCtx - base0 : 0 });   // origem = instante do relógio de áudio em que o projeto estaria no tempo 0
  // Cadeia de efeitos da faixa. Só reconstrói quando a LISTA muda (adicionar, remover, ordem, ligar/desligar); mexer num parâmetro só atualiza.
  function montarCadeia(f, n) {
    if (!window.EstudioFx) return;
    const lista = f.fx || [], efetiva = fxOk ? lista : lista.filter((x) => !EstudioFx.precisaWorklet([x])), sig = EstudioFx.assinatura(efetiva);
    if (n.cadeia && n.cadeia.assinatura === sig) { n.cadeia.atualizar(efetiva, ambFx()); return; }
    const nova = EstudioFx.criarCadeia(ctx, efetiva, ambFx());
    try { n.entrada.disconnect(); } catch (e) { /* solto */ }
    if (n.cadeia) { try { n.cadeia.saida.disconnect(); } catch (e) { /* solto */ } n.cadeia.parar(); }
    n.entrada.connect(nova.entrada); nova.saida.connect(n.gain); n.cadeia = nova;
  }
  function descartarNos() { nos.forEach((n) => { try { n.entrada.disconnect(); n.gain.disconnect(); n.pan.disconnect(); if (n.cadeia) { n.cadeia.saida.disconnect(); n.cadeia.parar(); } } catch (e) { /* solto */ } }); nos.clear(); }
  function noDe(f) {
    let n = nos.get(f.id);
    if (!n) {
      const entrada = ctx.createGain(), gain = ctx.createGain(), pan = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain(), an = ctx.createAnalyser();
      an.fftSize = 512; entrada.connect(gain); gain.connect(pan); pan.connect(an); pan.connect(mestre);
      gain.gain.value = audivel(f.id) ? f.vol : 0; if (pan.pan) pan.pan.value = f.pan;
      n = { entrada, gain, pan, an, cadeia: null }; nos.set(f.id, n); montarCadeia(f, n);
    }
    return n;
  }
  function atualizarNos() {
    if (!ctx) return;
    S.faixas.forEach((f) => { const n = noDe(f); montarCadeia(f, n); n.gain.gain.setTargetAtTime(audivel(f.id) ? f.vol : 0, ctx.currentTime, 0.01); if (n.pan.pan) n.pan.pan.setTargetAtTime(f.pan, ctx.currentTime, 0.01); });
  }
  // Programa UMA região num contexto (ao vivo ou na exportação). t0 = ponto do projeto onde a reprodução começa.
  function programarRegiao(c, r, destino, t0, base) {
    const buf = bufs.get(r.buf); if (!buf || r.ini + r.dur <= t0) return null;
    const dentro = Math.max(0, t0 - r.ini), quando = base + Math.max(0, r.ini - t0), dur = r.dur - dentro;
    if (dur <= 0.004) return null;
    const src = c.createBufferSource(), g = c.createGain(), vol = Math.pow(10, r.ganho / 20) * (buf.numberOfChannels === 1 ? Math.SQRT1_2 : 1); src.buffer = buf;   // áudio mono: −3 dB no centro (como a lei de panorâmica faz), já aqui, para o volume não depender de haver efeitos
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
    S.regioes.forEach((r) => { const f = faixaPorId(r.f); if (!f) return; const s = programarRegiao(ctx, r, noDe(f).entrada, t0, ctx.currentTime); if (s) fontes.push(s); });
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
          <button class="dw-tb" id="dwLoop" title="Loop: repete um trecho (tecla L). Para escolher o trecho, arraste na régua segurando Shift.">${ic("loop")}</button>
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
          <button class="dw-btn peq" id="dwCalibrar" title="Mede o atraso do seu equipamento: toca cliques e vê quanto eles demoram a aparecer na gravação">Calibrar</button>
          <label title="Como você ouve a música enquanto grava. Com fone de ouvido a voz sai limpa. Com caixa de som o navegador tenta cancelar o eco, mas parte da música pode vazar no microfone.">Ouço com <select id="dwMonitor"><option value="caixa">Caixa de som</option><option value="fone">Fone de ouvido</option></select></label>
        </div>
      </div>
      <div class="dw-area">
        <div class="dw-cab-col"><div class="dw-cab-topo"><span>FAIXAS</span><button class="dw-btn peq" id="dwAddFaixa">${ic("mais")} Faixa</button></div><div class="dw-cab-lista" id="dwCabLista"></div></div>
        <div class="dw-tl-scroll" id="dwTlScroll"><div class="dw-tl" id="dwTl"><div class="dw-regua" id="dwRegua"></div><div class="dw-loop" id="dwLoopBand" hidden></div><div class="dw-faixas" id="dwFaixas"></div><div class="dw-playhead" id="dwPlayhead"></div></div>
          <div class="dw-vazio" id="dwVazio" hidden>
            <h2>Comece o seu projeto</h2><p>Traga uma música, grave a sua voz ou importe um áudio. Depois é só mexer: cortar, mover, ajustar volume e exportar.</p>
            <div class="opcoes">
              <button class="opcao" id="dwOpSep">${ic("divide")}<b>Separar uma música</b><small>divide em voz, bateria, baixo, guitarra, piano e outros</small></button>
              <button class="opcao" id="dwOpGravar">${ic("mic")}<b>Gravar uma voz</b><small>cria a faixa e grava pelo microfone</small></button>
              <button class="opcao" id="dwOpImportar">${ic("pasta")}<b>Importar áudio</b><small>traz um arquivo do aparelho</small></button>
            </div>
          </div>
        </div>
      </div>
      <section class="dw-editor" id="dwEditor">
        <div class="dw-ed-redim" id="dwEdRedim" title="Arraste para mudar a altura deste painel (duplo clique volta ao padrão)"></div>
        <div class="dw-abas">
          <button class="dw-aba on" data-aba="mix">Mixer</button><button class="dw-aba" data-aba="reg">Região</button>
          <button class="dw-aba" data-aba="afin">Afinação</button><button class="dw-aba" data-aba="fx">Efeitos</button><button class="dw-aba" data-aba="sm">Samples</button><button class="dw-aba" data-aba="voz">Edição vocal</button><button class="dw-aba" data-aba="prod">Produtor</button>
          <span class="esp"></span><button class="dw-btn peq" id="dwRecolher">${ic("seta")} Recolher</button>
        </div>
        <div class="dw-painel-aba on" id="dwP-mix"><div class="dw-mix" id="dwMix"></div></div>
        <div class="dw-painel-aba" id="dwP-reg"><div class="dw-regp" id="dwRegp"></div></div>
        <div class="dw-painel-aba" id="dwP-afin"><div class="dw-afin" id="dwAfin"></div></div>
        <div class="dw-painel-aba" id="dwP-fx"><div class="dw-fx" id="dwFx"></div></div>
        <div class="dw-painel-aba" id="dwP-sm"><div class="dw-sm" id="dwSm"></div></div>
        <div class="dw-painel-aba" id="dwP-voz"><div class="dw-vz" id="dwVoz"></div></div>
        <div class="dw-painel-aba" id="dwP-prod"><div class="dw-vz" id="dwProd"></div></div>
      </section>
      <div class="dw-status"><span class="e" id="dwStatus">Pronto.</span><span id="dwStatusSel"></span><span id="dwSalvo"></span><span>Espaço toca/pausa · R grava · V seleciona · C divide · S divide no cursor · Ctrl+Z desfaz</span></div>
      <div class="dw-contagem" id="dwContagemOv" hidden></div>
      <div class="dw-modal" id="dwModalSep" hidden>
        <div class="dw-modal-cartao">
          <div class="dw-modal-topo"><b>Separar uma música em faixas</b><button id="dwSepFechar" aria-label="Fechar">×</button></div>
          <div class="dw-colab" id="dwColab" hidden><span class="dw-pilula" id="dwColabPilula">Desligado</span><p id="dwColabTexto"></p><a class="dw-btn peq" id="dwColabLink" href="#" target="_blank" rel="noopener" style="width:fit-content;text-decoration:none">Abrir o separador no Colab</a></div>
          <div>
            <input type="file" id="dwSepArq" accept=".wav,.mp3,.m4a,.ogg,.flac,.webm" hidden>
            <div class="dw-acoes" style="justify-content:flex-start"><button class="dw-btn" id="dwSepUpload">${ic("pasta")} Escolher do aparelho</button><button class="dw-btn" id="dwSepBib">${ic("pasta")} Escolher da biblioteca</button></div>
            <div class="dw-dica" id="dwSepNome" style="margin-top:8px">Nenhum áudio escolhido.</div>
          </div>
          <div class="dw-modos" id="dwModos">
            <label class="dw-modo"><input type="radio" name="dwModoSep" value="completo"><span><b>Todos os instrumentos</b><small>6 faixas: voz, bateria, baixo, guitarra, piano e outros</small></span></label>
            <label class="dw-modo"><input type="radio" name="dwModoSep" value="rapido"><span><b>Só voz e instrumental</b><small>2 faixas: mais leve e rápido</small></span></label>
          </div>
          <div class="dw-dica" id="dwModoAviso"></div>
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
      <div class="dw-modal" id="dwModalCal" hidden>
        <div class="dw-modal-cartao">
          <div class="dw-modal-topo"><b>Calibrar o atraso da gravação</b><button id="dwCalFechar" aria-label="Fechar">×</button></div>
          <div class="dw-dica">Mede quanto tempo o som leva, no SEU equipamento, entre o app tocar e a gravação “ouvir”. Assim as próximas gravações já nascem alinhadas com a música.<br><br><b>1.</b> Use o mesmo fone e microfone com que você grava.<br><b>2.</b> Aproxime o microfone do fone (ou da caixa de som) e suba um pouco o volume.<br><b>3.</b> Fique em silêncio: o app toca 6 cliques e mede quando eles aparecem.</div>
          <div class="dw-dica" id="dwCalRes"></div>
          <div class="dw-acoes"><button class="dw-btn" id="dwCalFechar2">Fechar</button><button class="dw-btn cheio" id="dwCalIniciar">Começar a medir</button></div>
        </div>
      </div>
      <input type="file" id="dwArqSample" accept="audio/*" hidden>
      <input type="file" id="dwArqProj" accept=".ohstudio,.zip" hidden>
      <div class="dw-modal" id="dwModalExp" hidden>
        <div class="dw-modal-cartao">
          <div class="dw-modal-topo"><b>Exportar</b><button id="dwExpFechar" aria-label="Fechar">×</button></div>
          <div class="dw-exp-grade">
            <label>O que exportar<select id="dwExpO"><option value="mix">A mixagem final (um arquivo)</option><option value="stems">Cada faixa separada (stems, num .zip)</option></select></label>
            <label>Formato<select id="dwExpF"><option value="wav">WAV (qualidade total)</option><option value="mp3-192">MP3 192 kbps (bom e leve)</option><option value="mp3-128">MP3 128 kbps (o menor)</option><option value="mp3-320">MP3 320 kbps (máximo)</option></select></label>
            <label>Trecho<select id="dwExpT"><option value="tudo">O projeto inteiro</option><option value="loop">Só o trecho do loop</option></select></label>
          </div>
          <div class="dw-dica" id="dwExpInfo"></div>
          <div class="dw-acoes"><button class="dw-btn" id="dwExpFechar2">Fechar</button><button class="dw-btn cheio" id="dwExpIr">Exportar</button></div>
        </div>
      </div>
      <input type="file" id="dwArqAudio" accept="audio/*,.wav,.mp3,.m4a,.ogg,.flac,.webm" hidden>
    </div>
    <div class="dw-menu" id="dwMenuArquivo" hidden>
      <button data-a="importar"><b>Importar áudio</b><small>traz um arquivo do aparelho para uma faixa nova</small></button>
      <button data-a="exportar"><b>Exportar…</b><small>mixagem ou cada faixa separada, em WAV ou MP3</small></button>
      <button data-a="projsalvar"><b>Salvar projeto em arquivo…</b><small>um arquivo .ohstudio com tudo, para guardar ou levar a outro computador</small></button>
      <button data-a="projabrir"><b>Abrir projeto de um arquivo…</b><small>um arquivo .ohstudio salvo antes</small></button>
      <button data-a="salvar"><b>Salvar agora (Ctrl+S)</b><small>ele também salva sozinho enquanto você mexe</small></button>
      <button data-a="abrir"><b>Abrir projeto…</b><small>seus projetos salvos neste aparelho</small></button>
      <button data-a="novo"><b>Novo projeto</b><small>o atual fica salvo; começa um em branco</small></button>
      <button data-a="classico"><b>Abrir o Estúdio clássico</b><small>a versão antiga, enquanto você valida esta</small></button>
    </div>
    <div class="dw-menu" id="dwMenuFx" hidden></div>
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
      <div class="dw-cab ${f.id === S.faixaSel ? "sel" : ""} ${f.vazia ? "vazia" : ""}" data-f="${f.id}" ${f.vazia ? 'title="Esta faixa quase não tem som nesta música (deixei muda)"' : ""}>
        <i class="cor" style="background:${f.cor}"></i>
        <div class="l1"><input class="nome" value="${esc(f.nome)}" data-nome="${f.id}">
          <button class="dw-mini m ${f.mudo ? "on" : ""}" data-m="${f.id}" title="Mudo">M</button><button class="dw-mini s ${f.solo ? "on" : ""}" data-s="${f.id}" title="Solo">S</button><button class="dw-mini r ${f.arm ? "on" : ""}" data-r="${f.id}" title="Armar para gravar">R</button></div>
        <div class="l2"><span>Vol</span><input type="range" min="0" max="1.5" step="0.01" value="${f.vol}" data-vol="${f.id}"><span>Pan</span><input type="range" min="-1" max="1" step="0.1" value="${f.pan}" data-pan="${f.id}" style="max-width:46px"></div>
        <div class="l3"><div class="medidor"><i data-vu="${f.id}"></i></div><button class="excl" data-fxabrir="${f.id}" title="Efeitos desta faixa">FX${(f.fx || []).filter((x) => x.ligado).length ? " " + (f.fx || []).filter((x) => x.ligado).length : ""}</button><button class="excl" data-del="${f.id}" title="Excluir a faixa e as regiões dela">Excluir</button></div>
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
          <div class="rot" style="background:${corA(f.cor, 0.95)}">${esc(r.nome)}${r.limpo ? " · limpa" : ""}${r.afinada ? " · afinada" : ""}</div><canvas></canvas>
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
        <div class="dw-param"><span>Fade out</span><input type="range" min="0" max="5" step="0.05" value="${r.fo}" data-rg="fo"><b>${r.fo.toFixed(2)}s</b></div></div>
      <div class="dw-bloco"><h4>Sincronia (posição fina)</h4>
        <div class="dw-dica">Começa em <b>${r.ini.toFixed(3)} s</b> (compasso ${(r.ini / BAR() + 1).toFixed(2)}). Se a voz gravada ficou atrasada em relação à música, empurre a região para a esquerda (valores negativos). Atalho: Alt + ← / → move 1 ms (com Shift, 10 ms).</div>
        <div class="dw-sinc"><button class="dw-btn peq" data-rs="-10">−10 ms</button><button class="dw-btn peq" data-rs="-1">−1 ms</button><input type="number" id="dwSincMs" value="0" step="1" title="Quantos milissegundos mover (negativo = para a esquerda)"><button class="dw-btn peq" data-rs="aplicar">Mover</button><button class="dw-btn peq" data-rs="1">+1 ms</button><button class="dw-btn peq" data-rs="10">+10 ms</button></div>
        <div class="dw-sinc"><button class="dw-btn peq" data-rs="cursor">Alinhar ao cursor</button><button class="dw-btn peq" data-rs="batida">Alinhar à batida mais próxima</button></div>
      </div>
      <div class="dw-bloco"><h4>Repetir (loop)</h4>
        <div class="dw-dica">Repete só este trecho ao tocar: ótimo para ensaiar, afinar e regravar. Também dá para arrastar na régua segurando Shift.</div>
        <div class="dw-sinc"><button class="dw-btn peq" data-rs="loop">Repetir esta região</button><button class="dw-btn peq" data-rs="loopoff">Desligar o loop</button></div>
      </div>
      <div class="dw-bloco"><h4>Limpeza de ruído</h4>
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
          <select id="dwLimpaInt" title="Quanto o ruído é atenuado">${[["0.6", "Leve"], ["0.8", "Média"], ["0.95", "Forte"]].map(([v, n]) => `<option value="${v}" ${+v === limpaInt ? "selected" : ""}>${n}</option>`).join("")}</select>
          <button class="dw-btn peq" data-ra="limpar" ${limpando || r.afin ? "disabled" : ""} ${r.afin ? 'title="Esta região tem afinação aplicada: desfaça a afinação antes de limpar o ruído"' : ""}>Limpar ruído</button>${limpando ? '<button class="dw-btn peq" data-ra="cancelar">Cancelar</button>' : ""}
          ${r.alt ? `<button class="dw-btn peq" data-ra="alternar" title="Compara com a outra versão">Ouvir ${(r.afin ? r.afinada : r.limpo) ? (r.afin ? "a versão sem afinação" : "o original") : (r.afin ? "a versão afinada" : "a versão limpa")}</button><button class="dw-btn peq" data-ra="manter" title="Descarta a outra versão">Manter esta versão</button>` : ""}
        </div>
        <div class="dw-dica" id="dwLimpaStatus">${esc(limpaTxt)}</div>
        <div class="dw-dica">${r.alt ? `Toca agora: <b>${(r.afin ? r.afinada : r.limpo) ? (r.afin ? "a versão afinada ✓" : "a versão limpa ✓") : (r.afin ? "a versão sem afinação" : "o original")}</b>.` : "Mede o ruído nas pausas da gravação (respiros, silêncio). Pensado para voz; o original fica guardado."}</div>
      </div>`;
  }
  function renderTudo() {
    renderCab(); renderLinhas(); renderMixer(); renderRegiao();
    selStatus(); atualizarUndo(); if (abaAtiva === "fx") renderFx(); if (abaAtiva === "sm") renderSm(); if (abaAtiva === "voz") renderVoz(); if (abaAtiva === "prod") renderProd(); desenharLoop();
  }
  function selStatus() { const r = regiaoPorId(S.regiaoSel), e = $("#dwStatusSel"); if (e) e.textContent = r ? `Região: ${r.nome}` : ""; if (abaAtiva === "afin") prepararAfinacao(); }
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
    if (S.loop.on && !S.gravando && S.loop.fim > S.loop.ini && S.tAtual >= S.loop.fim) { ir(S.loop.ini); requestAnimationFrame(tick); return; }   // loop: volta ao início do trecho
    if (!S.gravando && S.tAtual > fimProjeto() + 0.3) { pausar(); S.tAtual = Math.max(0, fimProjeto()); posicionar(); return; }
    posicionar(); agendarMetro(); if (S.gravando) atualizarGravacao();
    if (S.seguir) { const sc = $("#dwTlScroll"), x = px(S.tAtual); if (x > sc.scrollLeft + sc.clientWidth * 0.88 || x < sc.scrollLeft) sc.scrollLeft = Math.max(0, x - sc.clientWidth * 0.15); }
    medidores(true); medidoresFx(); requestAnimationFrame(tick);
  }
  function tocar() {
    if (S.tocando) return; if (!garantirAudio()) return dica("Este navegador não toca áudio aqui.");
    atualizarNos(); S.tocando = true; base0 = S.tAtual; baseCtx = ctx.currentTime; agendarRegioes(S.tAtual); atualizarNos();   // 2ª vez: agora os efeitos presos ao andamento conhecem a origem do play
    $("#dwPlay").innerHTML = ic("pause"); $("#dwPlay").classList.add("on"); requestAnimationFrame(tick); dica("Tocando…");
  }
  function pausar() {
    if (!S.tocando) return; S.tocando = false; pararFontes(); if (S.gravando) finalizarGravacao();
    $("#dwPlay").innerHTML = ic("play"); $("#dwPlay").classList.remove("on"); medidores(false); posicionar(); dica("Pausado.");
  }
  function parar() { pausar(); S.tAtual = 0; posicionar(); $("#dwTlScroll").scrollLeft = 0; dica("Parado no início."); }
  function ir(t) { if (S.gravando) return; S.tAtual = Math.max(0, t); posicionar(); if (S.tocando) { base0 = S.tAtual; baseCtx = ctx.currentTime; agendarRegioes(S.tAtual); atualizarNos(); } }
  function mudarZoom(v) { S.pps = Math.max(8, Math.min(120, v)); $("#dwZoom").value = S.pps; renderLinhas(); desenharLoop(); }

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
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: S.monitor === "caixa", noiseSuppression: false, autoGainControl: false } }); } catch (e) { simulado = true; }
    // Com caixa de som a música sai pelo ar e entra no microfone. Só o cancelamento de eco do navegador ajuda; o fone resolve de vez.
    let aviso = "";
    if (stream && S.monitor === "caixa" && S.regioes.some((r) => r.f !== alvo.id && audivel(r.f))) {
      let aec = null; try { const tr = stream.getAudioTracks()[0]; aec = tr && tr.getSettings ? tr.getSettings().echoCancellation : null; } catch (e) { aec = null; }
      aviso = aec === false ? " ⚠️ Este navegador não ativou o cancelamento de eco: a música pode vazar no microfone. Use fone de ouvido." : " Com caixa de som, parte da música ainda pode vazar no microfone; o fone deixa a gravação mais limpa.";
    }
    gravacao = { aviso, antes, alvo, stream, simulado, regiao: null, rec: null, chunks: [], an: null, dados: null, ini: snap(S.tAtual) };
    $("#dwRec").classList.add("on");
    const total = S.contagem * COMPASSOS[S.compasso].n;
    if (!total) { comecarGravacao(); return; }
    S.contando = true; dica((simulado ? "Microfone não liberado: vou SIMULAR a gravação, só para você ver o fluxo." : "Pré-contagem… prepare-se para cantar.") + (gravacao.aviso || ""));
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
    tocar(); renderTudo(); dica("Gravando… aperte o botão vermelho (ou a barra de espaço) para parar." + (g.aviso || ""));
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
    const comp = configEst.colab ? configEst.colab.completo : undefined;      // true = notebook novo (6 faixas); false = antigo; undefined = servidor ainda não informa
    card.classList.toggle("on", on); $("#dwColabPilula").textContent = on ? (configEst.colab.gpu ? "Ligado · GPU" : "Ligado") + (comp === true ? " · 6 faixas" : comp === false ? " · versão antiga (só 2 faixas)" : "") : "Desligado";
    $("#dwColabTexto").textContent = on && comp === false ? "O Colab que está ligado é a versão ANTIGA do notebook: ele só separa voz e instrumental. Pare-o (no Colab: Ambiente de execução → Desconectar e excluir ambiente de execução), abra o notebook novo pelo botão abaixo e rode Executar tudo." : on ? "Pronto! Escolha um áudio e clique em Separar." : "A separação roda no Google Colab (o servidor gratuito não tem memória para o Demucs). Ligue o separador uma vez: abra o Colab, use Ambiente de execução → Executar tudo e volte aqui. Este cartão fica verde sozinho.";
    $("#dwColabLink").href = configEst.colab_url || "#"; $("#dwColabLink").hidden = on && comp !== false; atualizarBotaoSep(); atualizarAvisoModo();
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
  // ── modos de separação: rápido (2 faixas) ou completo (6 faixas, modelo htdemucs_6s) ──
  const NOMES_FAIXA = {                       // nome do modelo -> [nome na tela, cor, volume inicial]
    vocals: ["Voz", "#f97316", 0.9], drums: ["Bateria", "#ef4444", 0.85], bass: ["Baixo", "#38bdf8", 0.85],
    guitar: ["Guitarra", "#eab308", 0.85], piano: ["Piano", "#a855f7", 0.8], other: ["Outros", "#14b8a6", 0.8],
  };
  const ORDEM_FAIXAS = ["vocals", "drums", "bass", "guitar", "piano", "other"];
  const aparelhoLeve = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || !!(navigator.deviceMemory && navigator.deviceMemory < 4);
  const modoSep = () => { const r = document.querySelector('input[name="dwModoSep"]:checked'); return r ? r.value : "rapido"; };
  function atualizarAvisoModo() {
    const el = $("#dwModoAviso"); if (!el) return;
    const m = modoSep(), c = configEst && configEst.colab; let t = "";
    if (m === "completo") {
      if (aparelhoLeve()) t = "Atenção: neste aparelho o modo completo pode travar por falta de memória (são 6 faixas de áudio abertas ao mesmo tempo). Se travar, use o modo rápido.";
      if (configEst && configEst.modo === "fila" && c && c.online && c.completo === false) t = "O notebook do Colab está na versão antiga e vai entregar só voz e instrumental. Atualize o notebook e rode de novo para liberar as 6 faixas." + (t ? " " + t : "");
      if (!t) t = "O piano é a faixa menos confiável. Sintetizador, cordas e metais caem em “Outros”. Voz principal e backing vocal ficam juntas na faixa de voz. A faixa Original não é aberta neste modo, para poupar memória.";
    } else t = "Modo leve: a voz numa faixa e tudo o que não é voz noutra (mais a faixa Original, só de referência).";
    el.textContent = t;
  }
  function ajustarModoInicial() {
    let m = null; try { m = localStorage.getItem("oh-dw-modosep"); } catch (e) { /* sem armazenamento */ }
    if (m !== "rapido" && m !== "completo") m = aparelhoLeve() ? "rapido" : "completo";
    const r = document.querySelector(`input[name="dwModoSep"][value="${m}"]`); if (r) r.checked = true; atualizarAvisoModo();
  }
  const rmsDe = (buf) => { const ch = buf.getChannelData(0); let s = 0, n = 0; for (let i = 0; i < ch.length; i += 37) { s += ch[i] * ch[i]; n++; } return Math.sqrt(s / Math.max(n, 1)); };
  async function separarCompletoViaColab(arq, etapa) {
    etapa("enviando");
    const form = new FormData(); form.append("arquivo", arq); form.append("modo", "completo");
    const envio = await fetch(`${API_BASE}/api/estudio/fila`, { method: "POST", body: form });
    if (!envio.ok) { const erro = await envio.json().catch(() => ({})); throw new Error(erro.detail || "Não consegui enviar o áudio pro separador."); }
    const { job_id } = await envio.json(); etapa("fila");
    const inicio = Date.now(); let falhas = 0, semColabDesde = null;
    while (true) {
      await esperar(3000);
      if (sepCancelado) throw new Error("Separação cancelada.");
      if (Date.now() - inicio > 20 * 60 * 1000) throw new Error("A separação demorou mais de 20 minutos e foi cancelada.");
      let info;
      try { const r = await fetch(`${API_BASE}/api/estudio/fila/${job_id}`); if (r.status === 404) throw new Error("Perdi o trabalho no servidor. Tente de novo."); info = await r.json(); falhas = 0; }
      catch (err) { if (String(err.message).startsWith("Perdi")) throw err; if (++falhas >= 6) throw new Error(mensagemDeErroDeRede(err)); continue; }
      if (info.status === "erro") throw new Error(info.erro || "O separador falhou.");
      if (info.status === "processando") { etapa("separando"); semColabDesde = null; }
      if (info.status === "pendente") {
        etapa("fila");
        if (info.colab_online === false) { semColabDesde = semColabDesde || Date.now(); if (Date.now() - semColabDesde > 60000) throw new Error("O Colab foi desligado antes de pegar o seu áudio. Ligue de novo e tente outra vez."); } else semColabDesde = null;
      }
      if (info.status === "pronto") {
        etapa("baixando");
        const nomes = Array.isArray(info.stems) && info.stems.length ? info.stems : null;      // sem lista = Colab antigo: só voz e instrumental
        const pedir = nomes || ["voz", "instrumental"];
        const blobs = await Promise.all(pedir.map(async (n) => { const r = await fetch(`${API_BASE}/api/estudio/fila/${job_id}/${n}`); if (!r.ok) throw new Error("Não consegui baixar os stems prontos."); return r.blob(); }));
        fetch(`${API_BASE}/api/estudio/fila/${job_id}`, { method: "DELETE" }).catch(() => {});
        if (nomes) { const stems = {}; nomes.forEach((n, i) => { stems[n] = blobs[i]; }); return { stems, bpm: info.bpm, tom: info.tom }; }
        return { vozBlob: blobs[0], instBlob: blobs[1], bpm: info.bpm, tom: info.tom };
      }
    }
  }
  async function separarCompletoLocal(arq) {
    const form = new FormData(); form.append("arquivo", arq); form.append("modo", "completo");
    const ctrl = new AbortController(), limite = setTimeout(() => ctrl.abort(), 10 * 60 * 1000);
    try {
      const resp = await fetch(`${API_BASE}/api/estudio/separar`, { method: "POST", body: form, signal: ctrl.signal });
      if (!resp.ok) { const erro = await resp.json().catch(() => ({})); throw new Error(erro.detail || "Não foi possível separar os stems."); }
      const d = await resp.json();
      if (d.stems) { const stems = {}; Object.keys(d.stems).forEach((n) => { stems[n] = base64ParaBlob(d.stems[n], "audio/mpeg"); }); return { stems, bpm: d.bpm, tom: d.tom }; }
      return { vozBlob: base64ParaBlob(d.voz_base64, "audio/mpeg"), instBlob: base64ParaBlob(d.instrumental_base64, "audio/mpeg"), bpm: d.bpm, tom: d.tom };
    } catch (err) { if (err.name === "AbortError") throw new Error("Isso demorou demais (mais de 10 min) e foi cancelado."); throw err; } finally { clearTimeout(limite); }
  }
  // Abre as faixas separadas, uma por vez (poupa memória), com nome e cor de cada instrumento.
  async function aplicarSeparacaoCompleta(res, arq) {
    if (S.regioes.length) novoProjeto();   // o projeto atual fica salvo: Arquivo → Abrir projeto
    const antes = foto();
    S.faixas = []; S.regioes = []; S.faixaSel = null; S.regiaoSel = null; S.tAtual = 0;
    const nomes = Object.keys(res.stems).sort((a, b) => { const ia = ORDEM_FAIXAS.indexOf(a), ib = ORDEM_FAIXAS.indexOf(b); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib); });
    const feitas = [];
    for (let k = 0; k < nomes.length; k++) {
      const n = nomes[k], def = NOMES_FAIXA[n] || [n.charAt(0).toUpperCase() + n.slice(1), CORES[k % CORES.length], 0.8];
      $("#dwSepStatus").textContent = `Abrindo as faixas… ${def[0]} (${k + 1} de ${nomes.length})`;
      const blob = res.stems[n], buf = await decodificar(await blob.arrayBuffer());
      const f = novaFaixa(def[0], def[1], { vol: def[2] }); novaRegiao(f, guardarAudio(buf, blob), def[0], 0, 0);
      feitas.push({ f, rms: rmsDe(buf) });
    }
    // faixa quase sem som (ex.: música sem piano): fica muda e marcada, para não sujar a mixagem
    const maior = Math.max(...feitas.map((x) => x.rms), 1e-9), vazias = [];
    feitas.forEach((x) => { if (x.rms < maior * 0.04) { x.f.mudo = true; x.f.vazia = true; vazias.push(x.f.nome); } });
    S.faixaSel = S.faixas[0].id; S.nome = arq.name.replace(/\.[^.]+$/, "").slice(0, 40); $("#dwNome").value = S.nome;
    if (res && Number.isFinite(+res.bpm) && +res.bpm >= 40 && +res.bpm <= 220) { S.bpm = Math.round(+res.bpm); $("#dwBpm").value = S.bpm; }
    S.tom = res && res.tom ? String(res.tom) : ""; $("#dwTom").textContent = S.tom || "—";
    empilhar(antes); renderTudo(); atualizarNos(); parar();
    dica(`Música separada em ${S.faixas.length} faixas${S.tom ? ` · tom ${S.tom}` : ""}${res && res.bpm ? ` · ${S.bpm} BPM` : ""}.` +
      (vazias.length ? ` ${vazias.join(" e ")} quase não têm som nesta música: deixei mudas.` : ""));
  }
  async function iniciarSeparacao() {
    if (!sepArquivo || sepRodando) return; sepRodando = true; sepCancelado = false; atualizarBotaoSep(); $("#dwPassos").hidden = false; $("#dwSepStatus").textContent = "";
    try {
      const modo = modoSep(), fila = !!(configEst && configEst.modo === "fila"), msgLocal = "Separando no servidor… isso pode levar alguns minutos.";
      let res;
      if (modo === "completo") {
        if (fila) res = await separarCompletoViaColab(sepArquivo, etapaSep);
        else { $("#dwPassos").hidden = true; $("#dwSepStatus").textContent = msgLocal; res = await separarCompletoLocal(sepArquivo); }
      } else if (fila) res = await separarViaColab(sepArquivo, etapaSep);
      else { $("#dwPassos").hidden = true; $("#dwSepStatus").textContent = msgLocal; res = await separarLocal(sepArquivo); }
      if (sepCancelado) return;
      $("#dwSepStatus").textContent = "Abrindo no Estúdio…";
      if (res.stems) await aplicarSeparacaoCompleta(res, sepArquivo);
      else {
        const [bv, bi, bo] = await Promise.all([decodificar(await res.vozBlob.arrayBuffer()), decodificar(await res.instBlob.arrayBuffer()), decodificar(await sepArquivo.arrayBuffer())]);
        aplicarSeparacao(bv, bi, bo, res, sepArquivo);
        if (modo === "completo") dica("O separador entregou só voz e instrumental: o notebook do Colab está na versão antiga. Atualize o notebook e rode de novo para ter as 6 faixas.");
      }
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
  async function renderizarMixagem(opc) {
    opc = opc || {};
    if (!S.regioes.some((r) => bufs.has(r.buf))) throw new Error("Não há áudio para exportar.");
    garantirAudio();
    const t0 = Math.max(0, opc.ini || 0), audiveis = opc.faixas ? S.faixas.filter((f) => opc.faixas.includes(f.id)) : S.faixas.filter((f) => audivel(f.id)), temFx = (f) => (f.fx || []).some((x) => x.ligado);
    const cauda = window.EstudioFx ? Math.max(0, ...audiveis.filter(temFx).map((f) => EstudioFx.cauda(f.fx))) : 0;   // o reverb e o eco continuam soando depois do fim da música
    const sr = ctx.sampleRate, fimT = opc.fim != null ? opc.fim : fimProjeto(), dur = Math.max(0.05, fimT - t0) + 0.3 + cauda, OC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const off = new OC(2, Math.ceil(dur * sr), sr), m = off.createGain(); m.gain.value = opc.semMestre ? 1 : S.mestreVol;
    if (opc.semMestre) m.connect(off.destination); else { const lim = criarLimitador(off); m.connect(lim); lim.connect(off.destination); }   // faixas separadas: sem o volume geral e sem o limitador (a soma delas dá a mixagem)
    if (window.EstudioFx && audiveis.some((f) => EstudioFx.precisaWorklet(f.fx))) await EstudioFx.carregarWorklet(off);
    audiveis.forEach((f) => {
      const g = off.createGain(); g.gain.value = f.vol; if (off.createStereoPanner) { const p = off.createStereoPanner(); p.pan.value = f.pan; g.connect(p); p.connect(m); } else g.connect(m);
      const cad = window.EstudioFx ? EstudioFx.criarCadeia(off, f.fx || [], Object.assign(ambFx(), { origem: -t0 })) : null, alvo = cad ? cad.entrada : g; if (cad) cad.saida.connect(g);
      S.regioes.filter((r) => r.f === f.id).forEach((r) => programarRegiao(off, r, alvo, t0, 0));
    });
    return off.startRendering();
  }
  // ══ ARQUIVOS: ZIP simples (sem compressão), MP3 e a janela de exportação ═══
  const CRC_TAB = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (u8) => { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC_TAB[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  function criarZip(arqs) {   // arqs: [{ nome, dados: Uint8Array }] → Blob .zip (guardado, sem compressão: WAV e MP3 já são pesados ou compactados)
    const enc = new TextEncoder(), partes = [], central = [], ag = new Date(), dt = ((ag.getFullYear() - 1980) << 9) | ((ag.getMonth() + 1) << 5) | ag.getDate(), hr = (ag.getHours() << 11) | (ag.getMinutes() << 5) | (ag.getSeconds() >> 1); let desloc = 0;
    for (const a of arqs) {
      const nome = enc.encode(a.nome), crc = crc32(a.dados), tam = a.dados.length, lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(10, hr, true); lh.setUint16(12, dt, true); lh.setUint32(14, crc, true); lh.setUint32(18, tam, true); lh.setUint32(22, tam, true); lh.setUint16(26, nome.length, true);
      partes.push(lh.buffer, nome, a.dados);
      const ch = new DataView(new ArrayBuffer(46)); ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(12, hr, true); ch.setUint16(14, dt, true); ch.setUint32(16, crc, true); ch.setUint32(20, tam, true); ch.setUint32(24, tam, true); ch.setUint16(28, nome.length, true); ch.setUint32(42, desloc, true);
      central.push(ch.buffer, nome); desloc += 30 + nome.length + tam;
    }
    const tamC = central.reduce((s, p) => s + p.byteLength, 0), fim = new DataView(new ArrayBuffer(22)); fim.setUint32(0, 0x06054b50, true); fim.setUint16(8, arqs.length, true); fim.setUint16(10, arqs.length, true); fim.setUint32(12, tamC, true); fim.setUint32(16, desloc, true);
    return new Blob([...partes, ...central, fim.buffer], { type: "application/zip" });
  }
  async function lerZip(ab) {   // devolve Map nome → Uint8Array (aceita guardado e "deflate")
    const dv = new DataView(ab), u8 = new Uint8Array(ab); let fim = -1;
    for (let i = ab.byteLength - 22; i >= Math.max(0, ab.byteLength - 66000); i--) if (dv.getUint32(i, true) === 0x06054b50) { fim = i; break; }
    if (fim < 0) throw new Error("Este arquivo não é um projeto válido (não parece um .zip).");
    const n = dv.getUint16(fim + 10, true), dec = new TextDecoder(), out = new Map(); let p = dv.getUint32(fim + 16, true);
    for (let k = 0; k < n; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error("O arquivo do projeto está corrompido.");
      const met = dv.getUint16(p + 10, true), crc = dv.getUint32(p + 16, true), tamC = dv.getUint32(p + 20, true), ln = dv.getUint16(p + 28, true), le = dv.getUint16(p + 30, true), lc = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true), nome = dec.decode(u8.subarray(p + 46, p + 46 + ln)); p += 46 + ln + le + lc;
      const ini = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true), bruto = u8.subarray(ini, ini + tamC); let dados;
      if (met === 0) dados = bruto; else if (met === 8 && window.DecompressionStream) dados = new Uint8Array(await new Response(new Blob([bruto]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer()); else throw new Error("Este arquivo usa uma compressão que este navegador não abre.");
      if (crc32(dados) !== crc) throw new Error(`O arquivo do projeto está corrompido (“${nome}” não confere).`);
      out.set(nome, dados);
    }
    return out;
  }
  function carregarLame() {
    if (window.lamejs && window.lamejs.Mp3Encoder) return Promise.resolve();
    return new Promise((ok, no) => { const sc = document.createElement("script"); sc.src = "lame.min.js?v=1"; sc.onload = () => (window.lamejs && window.lamejs.Mp3Encoder ? ok() : no(new Error("O codificador de MP3 não iniciou."))); sc.onerror = () => no(new Error("Não consegui carregar o codificador de MP3 (arquivo lame.min.js). Confira se ele foi enviado junto com o app.")); document.head.appendChild(sc); });
  }
  async function audioBufferParaMp3Blob(buf, kbps, progresso) {
    await carregarLame(); const canais = Math.min(2, buf.numberOfChannels), enc = new window.lamejs.Mp3Encoder(canais, buf.sampleRate, kbps), n = buf.length, L = new Int16Array(n), R = canais === 2 ? new Int16Array(n) : null;
    const cv = (x) => { const v = x > 1 ? 1 : x < -1 ? -1 : x; return v < 0 ? v * 32768 : v * 32767; }, c0 = buf.getChannelData(0), c1 = canais === 2 ? buf.getChannelData(1) : null;
    for (let i = 0; i < n; i++) { L[i] = cv(c0[i]); if (R) R[i] = cv(c1[i]); }
    const blocos = [], B = 1152 * 24; let k = 0;
    for (let i = 0; i < n; i += B, k++) { const m = R ? enc.encodeBuffer(L.subarray(i, i + B), R.subarray(i, i + B)) : enc.encodeBuffer(L.subarray(i, i + B)); if (m.length) blocos.push(new Uint8Array(m.buffer.slice(m.byteOffset, m.byteOffset + m.length))); if (progresso && k % 6 === 0) { progresso(i / n); await new Promise((r) => setTimeout(r, 0)); } }
    const f = enc.flush(); if (f.length) blocos.push(new Uint8Array(f.buffer.slice(f.byteOffset, f.byteOffset + f.length))); return new Blob(blocos, { type: "audio/mpeg" });
  }
  const nomeLimpo = (t, padrao) => (String(t || padrao || "projeto").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "_") || padrao || "projeto");
  function baixar(blob, nome) { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = nome; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000); }
  function infoExportar() {
    const o = $("#dwExpO").value, [f, kb] = $("#dwExpF").value.split("-"), usaLoop = $("#dwExpT").value === "loop" && S.loop.fim > S.loop.ini, dur = usaLoop ? S.loop.fim - S.loop.ini : fimProjeto(), n = S.faixas.filter((x) => audivel(x.id) && S.regioes.some((r) => r.f === x.id)).length, sr = (ctx && ctx.sampleRate) || 44100, mult = o === "stems" ? n : 1;
    const bytes = f === "wav" ? dur * sr * 4 * mult : (dur * (+kb) * 125) * mult, mb = bytes / 1048576;
    $("#dwExpInfo").textContent = `${o === "stems" ? `${n} faixa(s) separada(s)` : "Mixagem de " + n + " faixa(s)"} · ${fmt(dur)} · tamanho aproximado ${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB.${o === "stems" ? " Cada faixa sai com o seu volume, panorâmica e efeitos, sem o volume geral." : ""}`;
    $("#dwExpT").querySelector('option[value="loop"]').disabled = !(S.loop.fim > S.loop.ini);
  }
  function abrirExportar() { if (!S.regioes.some((r) => bufs.has(r.buf))) return dica("Não há áudio para exportar."); $("#dwExpO").value = "mix"; /* abre sempre na mixagem (o formato fica lembrado) */ const t = $("#dwExpT"); t.value = S.loop.on && S.loop.fim > S.loop.ini ? "loop" : "tudo"; infoExportar(); $("#dwModalExp").hidden = false; }
  async function exportarAgora() {
    const botao = $("#dwExpIr"), o = $("#dwExpO").value, [fm, kb] = $("#dwExpF").value.split("-"), trecho = $("#dwExpT").value === "loop" && S.loop.fim > S.loop.ini ? { ini: S.loop.ini, fim: S.loop.fim } : {}, base = nomeLimpo(S.nome, "projeto"), ext = fm === "wav" ? "wav" : "mp3";
    const codificar = async (buf, rot) => (fm === "wav" ? audioBufferParaWavBlob(buf) : audioBufferParaMp3Blob(buf, +kb, (p) => dica(`${rot} codificando MP3… ${Math.round(p * 100)}%`)));
    botao.disabled = true; $("#dwModalExp").hidden = true;
    try {
      if (o === "mix") { dica("Exportando a mixagem…"); const buf = await renderizarMixagem(trecho), blob = await codificar(buf, "Mixagem:"); baixar(blob, `${base}_mixagem.${ext}`); dica(`Mixagem exportada (${fmt(buf.duration)}, ${ext.toUpperCase()}${fm === "wav" ? "" : " " + kb + " kbps"}).`); }
      else {
        const faixas = S.faixas.filter((f) => audivel(f.id) && S.regioes.some((r) => r.f === f.id && bufs.has(r.buf))); if (!faixas.length) throw new Error("Nenhuma faixa audível para exportar. Confira mudo e solo.");
        const arqs = []; for (let i = 0; i < faixas.length; i++) { const f = faixas[i], rot = `Faixa ${i + 1} de ${faixas.length} (${f.nome}):`; dica(`${rot} renderizando…`); const buf = await renderizarMixagem(Object.assign({}, trecho, { faixas: [f.id], semMestre: true })), blob = await codificar(buf, rot); arqs.push({ nome: `${String(i + 1).padStart(2, "0")} - ${nomeLimpo(f.nome, "faixa")}.${ext}`, dados: new Uint8Array(await blob.arrayBuffer()) }); }
        baixar(criarZip(arqs), `${base}_faixas.zip`); dica(`${arqs.length} faixa(s) exportada(s) num .zip (${ext.toUpperCase()}).`);
      }
    } catch (e) { dica(e.message || "Não consegui exportar."); } finally { botao.disabled = false; }
  }
  function exportar() { abrirExportar(); }

  // ══ PROJETO EM ARQUIVO (.ohstudio): tudo num arquivo só, para guardar ou levar a outro computador ═══
  async function exportarProjetoArquivo() {
    const regs = S.regioes.filter((r) => !r.gravando); if (!S.faixas.length && !regs.length) return dica("Ainda não há nada neste projeto para salvar em arquivo.");
    if (S.gravando || S.contando) return dica("Pare a gravação antes de salvar o projeto em arquivo.");
    dica("Montando o arquivo do projeto…");
    try {
      const ids = [...new Set(regs.flatMap((r) => (r.alt ? [r.buf, r.alt.buf] : [r.buf])))].filter((b) => bufs.has(b)), proj = { id: S.id, nome: S.nome, atualizado: Date.now(), faixas: JSON.parse(JSON.stringify(S.faixas)), regioes: JSON.parse(JSON.stringify(regs)), bpm: S.bpm, compasso: S.compasso, tom: S.tom, mestreVol: S.mestreVol, proxId, nFaixas: S.faixas.length };
      const arqs = [], info = []; for (const b of ids) { const blob = blobs.get(b) || audioBufferParaWavBlob(bufs.get(b)); arqs.push({ nome: "audios/" + b, dados: new Uint8Array(await blob.arrayBuffer()) }); info.push({ id: b, tipo: blob.type || "" }); }
      arqs.unshift({ nome: "projeto.json", dados: new TextEncoder().encode(JSON.stringify({ app: "orange-estudio", versao: 1, criado: Date.now(), proj, audios: info })) });
      const zip = criarZip(arqs); baixar(zip, `${nomeLimpo(S.nome, "projeto")}.ohstudio`); dica(`Projeto salvo em arquivo (${(zip.size / 1048576).toFixed(1)} MB, ${ids.length} áudio(s)). Guarde-o onde quiser: ele abre em qualquer computador.`);
    } catch (e) { dica("Não consegui montar o arquivo: " + (e.message || "erro inesperado")); }
  }
  async function abrirProjetoArquivo(arq) {
    dica("Abrindo o arquivo do projeto…");
    try {
      const mapa = await lerZip(await arq.arrayBuffer()), j = mapa.get("projeto.json"); if (!j) throw new Error("Este arquivo não parece um projeto do Orange Estúdio.");
      const d = JSON.parse(new TextDecoder().decode(j)); if (d.app !== "orange-estudio" || !d.proj || !Array.isArray(d.proj.regioes)) throw new Error("Este arquivo não parece um projeto do Orange Estúdio.");
      await salvarProjeto();                                         // o projeto aberto agora fica guardado antes de trocar
      const pid = "p" + Date.now().toString(36), proj = d.proj; proj.id = pid; proj.atualizado = Date.now();   // id novo: abrir o mesmo arquivo de novo cria uma CÓPIA, nunca sobrescreve
      const db = await abrirDB();
      await new Promise((ok, no) => { const t = db.transaction(["projetos", "audios"], "readwrite"); (d.audios || []).forEach((a) => { const dados = mapa.get("audios/" + a.id); if (dados) t.objectStore("audios").put(dados.slice().buffer, pid + ":" + a.id); }); t.objectStore("projetos").put(proj); t.oncomplete = ok; t.onerror = () => no(t.error); t.onabort = () => no(t.error); });
      db.close(); const abriu = await abrirProjeto(pid); if (abriu) dica(`Projeto “${proj.nome}” aberto a partir do arquivo.`);
    } catch (e) { dica("Não consegui abrir o arquivo: " + (e.message || "erro inesperado")); }
  }

  // ══ LOOP: repete um trecho ao tocar (tecla L; Shift + arrastar na régua escolhe o trecho) ═══
  function desenharLoop() {
    const b = $("#dwLoopBand"), L = S.loop; if (!b) return; const ok = L.fim > L.ini; b.hidden = !ok; b.classList.toggle("on", ok && L.on); $("#dwLoop").classList.toggle("on", !!L.on);
    if (ok) { b.style.left = px(L.ini) + "px"; b.style.width = Math.max(2, px(L.fim) - px(L.ini)) + "px"; }
  }
  function definirLoop(ini, fim, ligar) { ini = Math.max(0, ini); if (fim - ini < 0.1) return; S.loop.ini = Math.round(ini * 1000) / 1000; S.loop.fim = Math.round(fim * 1000) / 1000; if (ligar !== false) S.loop.on = true; desenharLoop(); dica(`Loop ${S.loop.on ? "ligado" : "definido"}: ${fmt(S.loop.ini)} a ${fmt(S.loop.fim)}. A tecla L liga e desliga.`); }
  function alternarLoop() {
    const L = S.loop;
    if (!(L.fim > L.ini)) { const r = regiaoPorId(S.regiaoSel); if (r) return definirLoop(r.ini, r.ini + r.dur, true); if (fimProjeto() > 0.2) return definirLoop(0, fimProjeto(), true); return dica("Selecione uma região, ou arraste na régua segurando Shift para escolher o trecho."); }
    L.on = !L.on; desenharLoop(); dica(L.on ? `Loop ligado: ${fmt(L.ini)} a ${fmt(L.fim)}.` : "Loop desligado.");
  }

  // ══ EDIÇÃO DE REGIÕES ═════════════════════════════════════════════════
  let areaCopia = null;
  function dividirRegiao(r, t) {
    if (t <= r.ini + 0.02 || t >= r.ini + r.dur - 0.02) return dica("Coloque o cursor (ou clique) dentro da região para dividir.");
    mudar(() => { const fim = r.ini + r.dur; r.dur = t - r.ini; const n = { ...r, id: proxId++, ini: t, off: r.off + (t - r.ini), dur: fim - t, nome: r.nome + " (parte 2)" }; if (r.alt) n.alt = { buf: r.alt.buf, off: r.alt.off + (t - r.ini) }; if (r.afin) { delete r.afin; delete n.afin; } r.fo = 0.005; S.regioes.push(n); });
    dica("Região dividida em duas.");
  }
  function excluirRegiao(id) { mudar(() => { S.regioes = S.regioes.filter((x) => x.id !== id); S.regiaoSel = null; }); dica("Região excluída."); }
  function duplicarRegiao(r) { mudar(() => { const n = { ...r, id: proxId++, ini: r.ini + r.dur, nome: r.nome + " (cópia)" }; if (n.alt) n.alt = { ...n.alt }; S.regioes.push(n); S.regiaoSel = n.id; }); dica("Região duplicada logo depois da original."); }
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
    const antes = foto(), alca = e.target.dataset.alca, x0 = e.clientX, ini0 = r.ini, dur0 = r.dur, off0 = r.off, altOff0 = r.alt ? r.alt.off : 0, f0 = r.f, buf = bufs.get(r.buf), bufAlt = r.alt ? bufs.get(r.alt.buf) : null; let mexeu = false;
    $$(".dw-regiao", $("#dwFaixas")).forEach((el) => el.classList.toggle("sel", +el.dataset.r === r.id)); $$(".dw-cab").forEach((el) => el.classList.toggle("sel", el.dataset.f === r.f)); renderRegiao(); selStatus();
    const mv = (ev) => {
      const dx = (ev.clientX - x0) / S.pps; mexeu = true;
      if (alca === "e") { const novo = Math.max(ini0 - (r.alt ? Math.min(off0, altOff0) : off0), Math.min(ini0 + dur0 - 0.05, snap(ini0 + dx, ev.altKey))); r.dur = dur0 - (novo - ini0); r.off = off0 + (novo - ini0); if (r.alt) r.alt.off = altOff0 + (novo - ini0); if (r.afin) delete r.afin; r.ini = novo; }
      else if (alca === "d") { r.dur = Math.max(0.05, Math.min(buf ? buf.duration - r.off : 1e9, bufAlt ? bufAlt.duration - r.alt.off : 1e9, snap(ini0 + dur0 + dx, ev.altKey) - ini0)); }
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
    const m = $(id), r = ancora.getBoundingClientRect(), outros = ["#dwMenuArquivo", "#dwMenuFaixa", "#dwMenuFx"].filter((x) => x !== id); outros.forEach((x) => { $(x).hidden = true; });
    m.style.top = r.bottom + 6 + "px"; m.style.left = (alinharDireita ? Math.max(8, r.right - 290) : r.left) + "px"; m.hidden = !m.hidden;
  }
  function ligarEventos() {
    $("#dwRew").addEventListener("click", () => { ir(0); $("#dwTlScroll").scrollLeft = 0; });
    $("#dwPlay").addEventListener("click", () => { if (S.gravando || S.contando) pararGravacao(); else if (S.tocando) pausar(); else { tocar(); if (afin && afin.pendente && afin.pendente()) dica("Atenção: há ajustes de afinação ainda NÃO aplicados, então este play toca o áudio original. Na aba Afinação, clique em “Aplicar na região”."); } });
    $("#dwStop").addEventListener("click", () => { if (S.gravando || S.contando) pararGravacao(); parar(); });
    $("#dwRec").addEventListener("click", iniciarGravacao);
    $("#dwBpm").addEventListener("change", (e) => { const novo = Math.max(40, Math.min(220, +e.target.value || 100)); e.target.value = novo; mudar(() => { S.bpm = novo; }); atualizarNos(); dica(`Andamento: ${novo} BPM. A grade e o metrônomo acompanham (o áudio não muda).`); });
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
    $("#dwMonitor").addEventListener("change", (e) => { S.monitor = e.target.value; try { localStorage.setItem("oh-dw-monitor", S.monitor); } catch (err) { /* sem armazenamento */ } dica(S.monitor === "fone" ? "Fone de ouvido: o microfone grava a voz crua, sem nada da música (é o ideal)." : "Caixa de som: o navegador tenta cancelar o eco da música no microfone. Funciona em parte; o fone deixa mais limpo."); });
    $("#dwContagem").addEventListener("change", (e) => { S.contagem = +e.target.value; localStorage.setItem("oh-dw-contagem", S.contagem); dica(S.contagem ? `Pré-contagem de ${S.contagem} compasso(s) antes de gravar.` : "Sem pré-contagem: a gravação começa na hora."); });
    $("#dwLat").addEventListener("change", (e) => { S.latencia = Math.max(0, Math.min(500, +e.target.value || 0)); e.target.value = S.latencia; localStorage.setItem("oh-dw-lat", S.latencia); dica(`Atraso de gravação: ${S.latencia} ms (as próximas gravações começam esse tanto mais adiantadas).`); });
    // faixas
    $("#dwFaixas").addEventListener("pointerdown", aoPressionarFaixas);
    $("#dwRegua").addEventListener("pointerdown", (e) => {
      const rg = $("#dwRegua"), tDe = (ev) => snap(Math.max(0, (ev.clientX - rg.getBoundingClientRect().left) / S.pps), ev.altKey);
      if (!e.shiftKey) return void ir(tDe(e));
      e.preventDefault(); const t0 = tDe(e); rg.setPointerCapture(e.pointerId);
      const mover = (ev) => { const t1 = tDe(ev); S.loop.ini = Math.min(t0, t1); S.loop.fim = Math.max(t0, t1); S.loop.on = true; desenharLoop(); };
      const soltar = () => { rg.removeEventListener("pointermove", mover); rg.removeEventListener("pointerup", soltar); rg.removeEventListener("pointercancel", soltar); if (S.loop.fim - S.loop.ini < 0.1) { S.loop.ini = S.loop.fim = 0; S.loop.on = false; } desenharLoop(); if (S.loop.fim > S.loop.ini) dica(`Loop de ${fmt(S.loop.ini)} a ${fmt(S.loop.fim)} ligado. A tecla L liga e desliga.`); };
      rg.addEventListener("pointermove", mover); rg.addEventListener("pointerup", soltar); rg.addEventListener("pointercancel", soltar);
    });
    $("#dwLoop").addEventListener("click", alternarLoop);
    $("#dwExpFechar").addEventListener("click", () => { $("#dwModalExp").hidden = true; }); $("#dwExpFechar2").addEventListener("click", () => { $("#dwModalExp").hidden = true; }); $("#dwExpIr").addEventListener("click", exportarAgora);
    ["dwExpO", "dwExpF", "dwExpT"].forEach((id) => $("#" + id).addEventListener("change", infoExportar));
    $("#dwArqProj").addEventListener("change", (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) abrirProjetoArquivo(f); });
    $("#dwTlScroll").addEventListener("wheel", (e) => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); mudarZoom(S.pps * (e.deltaY < 0 ? 1.12 : 0.89)); } }, { passive: false });
    let sync = false;
    $("#dwTlScroll").addEventListener("scroll", () => { if (sync) return; sync = true; $("#dwCabLista").scrollTop = $("#dwTlScroll").scrollTop; sync = false; });
    $("#dwCabLista").addEventListener("scroll", () => { if (sync) return; sync = true; $("#dwTlScroll").scrollTop = $("#dwCabLista").scrollTop; sync = false; });
    function aoClicarFaixaUI(e) {
      const t = e.target, a = (k) => t.closest(`[data-${k}]`) && t.closest(`[data-${k}]`).dataset[k];
      const m = a("m"), s = a("s"), r = a("r"), del = a("del"), fxa = a("fxabrir");
      if (fxa) { S.faixaSel = fxa; abrirAba("fx"); renderTudo(); return; }
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
      if (t.dataset.nome) { faixaPorId(t.dataset.nome).nome = t.value; delete catFxMap[t.dataset.nome]; agendarSalvar(); }   // renomear a faixa refaz a sugestão de instrumento
      if (t.id === "dwLimpaInt") limpaInt = +t.value;
      if (t.id === "dwMestreVol") { S.mestreVol = +t.value; if (mestre) mestre.gain.value = S.mestreVol; }
      if (t.dataset.rg) { const r = regiaoPorId(S.regiaoSel); r[t.dataset.rg] = +t.value; const b = t.parentElement.querySelector("b"); b.textContent = t.dataset.rg === "ganho" ? t.value + " dB" : (+t.value).toFixed(2) + "s"; if (t.dataset.rg !== "ganho") renderLinhas(); agendarSalvar(); if (S.tocando) reagendar(); }
      if (t.hasAttribute("data-rnome")) { const r = regiaoPorId(S.regiaoSel); r.nome = t.value; const rot = $(`.dw-regiao[data-r="${r.id}"] .rot`); if (rot) rot.textContent = t.value; agendarSalvar(); }
    });
    $("#dwRegp").addEventListener("click", (e) => { const rs = e.target.closest("[data-rs]"); if (rs) { const r0 = regiaoPorId(S.regiaoSel); if (r0) acaoSinc(r0, rs.dataset.rs); return; } const b = e.target.closest("[data-ra]"); const r = regiaoPorId(S.regiaoSel); if (!b || !r) return; const acao = b.dataset.ra;
      if (acao === "excluir") excluirRegiao(r.id); else if (acao === "duplicar") duplicarRegiao(r); else if (acao === "dividir") dividirRegiao(r, S.tAtual);
      else if (acao === "limpar") limparRegiao(r); else if (acao === "cancelar") limpezaCancelada = true;
      else if (acao === "alternar") alternarLimpeza(r); else if (acao === "manter") manterVersao(r); });
    // abas do editor
    $$(".dw-aba").forEach((a) => a.addEventListener("click", () => abrirAba(a.dataset.aba)));
    $("#dwRecolher").addEventListener("click", () => { const f = $("#dwEditor").classList.toggle("fechado"); $("#dwRecolher").innerHTML = ic("seta") + (f ? " Abrir" : " Recolher"); });
    // tela inicial
    $("#dwOpSep").addEventListener("click", abrirSeparar); $("#dwOpImportar").addEventListener("click", () => $("#dwArqAudio").click());
    $("#dwOpGravar").addEventListener("click", () => { const antes = foto(); const f = criarFaixaVoz(); S.faixaSel = f.id; empilhar(antes); renderTudo(); dica(`Faixa "${f.nome}" criada e armada. Aperte o botão vermelho (ou R) para gravar.`); });
    // arquivo e faixa
    $("#dwArquivo").addEventListener("click", (e) => { menu("#dwMenuArquivo", e.currentTarget, true); e.stopPropagation(); });
    $("#dwAddFaixa").addEventListener("click", (e) => { menu("#dwMenuFaixa", e.currentTarget, false); e.stopPropagation(); });
    document.addEventListener("click", (e) => { if (!e.target.closest(".dw-menu") && !e.target.closest("#dwArquivo") && !e.target.closest("#dwAddFaixa") && !e.target.closest("#dwFxAdd")) { $("#dwMenuArquivo").hidden = true; $("#dwMenuFaixa").hidden = true; $("#dwMenuFx").hidden = true; } });
    $("#dwMenuArquivo").addEventListener("click", (e) => {
      const b = e.target.closest("[data-a]"); if (!b) return; $("#dwMenuArquivo").hidden = true;
      if (b.dataset.a === "importar") $("#dwArqAudio").click();
      else if (b.dataset.a === "exportar") exportar();
      else if (b.dataset.a === "projsalvar") exportarProjetoArquivo();
      else if (b.dataset.a === "projabrir") $("#dwArqProj").click();
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
    ligarEventosFx(); ligarEventosSm(); ligarEventosVoz(); ligarEventosProd();
    { // altura do painel de baixo: arrastar a alça da borda de cima (fica guardada; duplo clique volta ao padrão)
      const ed = $("#dwEditor"), alca = $("#dwEdRedim"), lim = (h) => Math.max(120, Math.min(window.innerHeight - 330, h));   // sempre sobra espaço para a linha do tempo
      const salvo = parseInt(localStorage.getItem("oh-dw-ed-h"), 10); if (salvo) ed.style.height = lim(salvo) + "px";
      alca.addEventListener("pointerdown", (e) => {
        if (ed.classList.contains("fechado") || ed.classList.contains("ampliado") || (e.button != null && e.button !== 0)) return;
        e.preventDefault(); const y0 = e.clientY, h0 = ed.getBoundingClientRect().height; alca.setPointerCapture(e.pointerId); ed.classList.add("redimensionando"); document.body.style.userSelect = "none";
        const mover = (ev) => { ed.style.height = lim(h0 + (y0 - ev.clientY)) + "px"; };
        const soltar = () => { alca.removeEventListener("pointermove", mover); alca.removeEventListener("pointerup", soltar); alca.removeEventListener("pointercancel", soltar); ed.classList.remove("redimensionando"); document.body.style.userSelect = ""; try { localStorage.setItem("oh-dw-ed-h", Math.round(ed.getBoundingClientRect().height)); } catch (err) { /* sem armazenamento */ } };
        alca.addEventListener("pointermove", mover); alca.addEventListener("pointerup", soltar); alca.addEventListener("pointercancel", soltar);
      });
      alca.addEventListener("dblclick", () => { ed.style.height = ""; try { localStorage.removeItem("oh-dw-ed-h"); } catch (err) { /* sem armazenamento */ } });
    }
    $("#dwCalibrar").addEventListener("click", () => { $("#dwCalRes").textContent = ""; $("#dwModalCal").hidden = false; });
    $("#dwCalFechar").addEventListener("click", () => { $("#dwModalCal").hidden = true; }); $("#dwCalFechar2").addEventListener("click", () => { $("#dwModalCal").hidden = true; }); $("#dwCalIniciar").addEventListener("click", calibrarAtraso);
    $("#dwModos").addEventListener("change", () => { try { localStorage.setItem("oh-dw-modosep", modoSep()); } catch (e) { /* sem armazenamento */ } atualizarAvisoModo(); });
    $("#dwProjFechar").addEventListener("click", () => { $("#dwModalProj").hidden = true; });
    $("#dwProjLista").addEventListener("click", async (e) => {
      const a = e.target.closest("[data-abrir]"), x = e.target.closest("[data-excluir]");
      if (a) { $("#dwModalProj").hidden = true; dica("Abrindo o projeto…"); await salvarProjeto(); const okk = await abrirProjeto(a.dataset.abrir); if (okk) dica(`Projeto "${S.nome}" aberto.`); else dica("Não encontrei esse projeto."); }
      if (x) { if (!confirm("Excluir este projeto salvo? Não dá para desfazer.")) return; await excluirProjeto(x.dataset.excluir); if (x.dataset.excluir === S.id) { S.sujo = true; } abrirListaProjetos(); }
    });
    // teclado
    document.addEventListener("keydown", (e) => {
      const pag = $("#page-estudio"); if (!pag || !pag.classList.contains("oh-page-ativa")) return;
      if ((/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) && !(e.target.tagName === "INPUT" && e.target.type === "range" && (e.ctrlKey || e.metaKey))) || e.target.isContentEditable) return;
      if (!$("#dwModalSep").hidden || !$("#dwModalProj").hidden || !$("#dwModalCal").hidden || !$("#dwModalExp").hidden) return;
      if (abaAtiva === "afin") {
        if (afin && afin.tecla(e)) return;
        if (e.code === "Space") { if (!/^(BUTTON|A)$/.test(e.target.tagName)) { e.preventDefault(); const p = document.getElementById("afPlay"); if (p) p.click(); } return; }
        if (!(e.ctrlKey || e.metaKey)) return;
      }
      const meta = e.ctrlKey || e.metaKey, k = e.key.toLowerCase(), r = regiaoPorId(S.regiaoSel);
      if (e.key === " " || e.code === "Space") { if (/^(BUTTON|A|SUMMARY)$/.test(e.target.tagName)) return; e.preventDefault(); if (S.gravando || S.contando) pararGravacao(); else S.tocando ? pausar() : tocar(); }
      else if (e.altKey && !meta && (e.key === "ArrowLeft" || e.key === "ArrowRight") && r) { e.preventDefault(); moverRegiaoMs(r, (e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 10 : 1)); }
      else if (meta && k === "z" && !e.shiftKey) { e.preventDefault(); desfazer(); }
      else if (meta && (k === "y" || (k === "z" && e.shiftKey))) { e.preventDefault(); refazer(); }
      else if (meta && k === "c") { if (r) { areaCopia = { ...r }; dica("Região copiada. Ctrl+V cola no cursor."); } }
      else if (meta && k === "v" && areaCopia) { e.preventDefault(); const alvo = faixaPorId(S.faixaSel) || faixaPorId(areaCopia.f); mudar(() => { const n = { ...areaCopia, id: proxId++, f: alvo.id, ini: snap(S.tAtual), nome: areaCopia.nome + " (cópia)" }; if (n.alt) n.alt = { ...n.alt }; S.regioes.push(n); S.regiaoSel = n.id; }); dica("Região colada no cursor."); }
      else if (meta && k === "d") { e.preventDefault(); if (r) duplicarRegiao(r); }
      else if (meta && k === "s") { e.preventDefault(); salvarProjeto().then((okk) => { if (okk) dica("Projeto salvo neste aparelho."); }); }
      else if ((e.key === "Delete" || e.key === "Backspace") && r) { e.preventDefault(); excluirRegiao(r.id); }
      else if (!meta && k === "s" && r) dividirRegiao(r, S.tAtual);
      else if (!meta && k === "r") { e.preventDefault(); iniciarGravacao(); }
      else if (!meta && k === "l") { e.preventDefault(); alternarLoop(); }
      else if (!meta && ["v", "c", "h", "z"].includes(k)) usarFerramenta({ v: "sel", c: "tes", h: "mao", z: "lupa" }[k]);
      else if (e.key === "Home") { ir(0); $("#dwTlScroll").scrollLeft = 0; }
      else if (e.key === "Escape") { S.regiaoSel = null; renderTudo(); }
    });
    // clicar num botão solta o foco: a barra de espaço sempre toca/pausa
    $("#dwRaiz").addEventListener("click", (e) => { const b = e.target.closest("button, input[type=checkbox]"); if (b) setTimeout(() => b.blur(), 0); });
    window.addEventListener("beforeunload", (e) => { if (S.sujo && S.regioes.length) { e.preventDefault(); e.returnValue = ""; } });
  }
  function abrirAba(n) {
    abaAtiva = n; $$(".dw-aba").forEach((a) => a.classList.toggle("on", a.dataset.aba === n)); $$(".dw-painel-aba").forEach((p) => p.classList.toggle("on", p.id === "dwP-" + n));
    const ed = $("#dwEditor"); ed.classList.remove("fechado"); ed.classList.toggle("alto", n === "afin" || n === "prod"); ed.classList.toggle("medio", n === "fx" || n === "sm" || n === "voz"); $("#dwRecolher").innerHTML = ic("seta") + " Recolher";
    if (n !== "afin") { ed.classList.remove("ampliado"); if (afin) { afin.parar(); afin.definirModoAmpliado(false); } }
    if (n === "afin") prepararAfinacao(); else if (n === "fx") renderFx(); else if (n === "sm") renderSm(); else if (n === "voz") renderVoz(); else if (n === "prod") renderProd();
  }
  function novoProjeto() {
    salvarProjeto();                                   // o projeto atual fica guardado (Arquivo → Abrir projeto)
    if (S.tocando) pausar(); pararFontes(); descartarNos();
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
    const fontes = [...new Set(regs.flatMap((r) => (r.alt ? [r.buf, r.alt.buf] : [r.buf])))].filter((b) => bufs.has(b)).map((b) => [b, blobs.get(b), bufs.get(b), noBanco.has(b)]);
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
    const ids = [...new Set(proj.regioes.flatMap((r) => (r.alt ? [r.buf, r.alt.buf] : [r.buf])))], novosBufs = new Map(), novosPicos = new Map(), novosBlobs = new Map();
    for (const b of ids) {
      const ab = await idb(db.transaction("audios").objectStore("audios").get(id + ":" + b)); if (!ab) continue;
      novosBlobs.set(b, new Blob([ab])); const buf = await decodificar(ab.slice(0)); novosBufs.set(b, buf); novosPicos.set(b, calcularPicos(buf));
    }
    // limpeza: tira do banco os áudios que este projeto não usa mais (regiões excluídas há tempo)
    const chaves = await idb(db.transaction("audios").objectStore("audios").getAllKeys(IDBKeyRange.bound(id + ":", id + ":\uffff"))), usados = new Set(ids.map((b) => id + ":" + b)), sobra = chaves.filter((k) => !usados.has(k));
    if (sobra.length) await new Promise((ok) => { const t = db.transaction("audios", "readwrite"); sobra.forEach((k) => t.objectStore("audios").delete(k)); t.oncomplete = ok; t.onerror = ok; });
    db.close();
    if (S.tocando) pausar(); pararFontes(); descartarNos();
    bufs.clear(); picos.clear(); blobs.clear(); noBanco.clear(); novosBufs.forEach((v, k) => { bufs.set(k, v); picos.set(k, novosPicos.get(k)); blobs.set(k, novosBlobs.get(k)); noBanco.add(k); });
    const faltaram = proj.regioes.filter((r) => !bufs.has(r.buf)).length;
    S.id = proj.id; S.nome = proj.nome; S.faixas = proj.faixas; S.regioes = proj.regioes.filter((r) => bufs.has(r.buf)); S.regioes.forEach((r) => { if (r.alt && !bufs.has(r.alt.buf)) { r.alt = null; } }); S.bpm = proj.bpm; S.compasso = proj.compasso; S.tom = proj.tom || ""; S.mestreVol = proj.mestreVol == null ? 0.9 : proj.mestreVol;
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

  // ══ LIMPEZA DE RUÍDO (roda no navegador; o original fica guardado dentro da própria região) ═══
  let limpaInt = 0.8, limpaTxt = "", limpando = false, limpezaCancelada = false;
  function msgLimpa(t) { limpaTxt = t; const e = $("#dwLimpaStatus"); if (e) e.textContent = t; dica(t); }
  async function limparRegiao(r) {
    if (limpando) return;
    if (r.afin) return msgLimpa("Esta região tem afinação aplicada. Desfaça a afinação (aba Afinação → Reverter tudo → Aplicar, ou Ctrl+Z) antes de limpar o ruído.");
    if (S.gravando || S.contando) return dica("Pare a gravação antes de limpar o ruído.");
    if (!window.EstudioDsp) return msgLimpa("O módulo de limpeza não carregou. Atualize a página.");
    const buf = bufs.get(r.buf); if (!buf) return msgLimpa("Esta região ainda não tem áudio gravado.");
    limpando = true; limpezaCancelada = false; renderRegiao();
    const sr = buf.sampleRate, ini = Math.max(0, Math.round(r.off * sr)), fim = Math.min(buf.length, Math.round((r.off + r.dur) * sr));
    const canais = []; for (let c = 0; c < buf.numberOfChannels; c++) canais.push(buf.getChannelData(c).slice(ini, fim));
    const nome = { 0.6: "leve", 0.8: "média", 0.95: "forte" }[limpaInt] || "média";
    try {
      msgLimpa(`Limpando o ruído (${nome})… 0%`);
      let ultimo = -1;
      const res = await EstudioDsp.limparRuido(canais, sr, { intensidade: limpaInt }, (p) => { const pct = Math.round(p * 100); if (pct !== ultimo) { ultimo = pct; const e = $("#dwLimpaStatus"); if (e) e.textContent = `Limpando o ruído (${nome})… ${pct}%`; } }, () => limpezaCancelada);
      if (res.cancelado) return msgLimpa("Limpeza cancelada. Nada foi alterado.");
      if (res.aviso === "sem_pausas") return msgLimpa("Não achei uma pausa só com ruído nesta região, então não dá para medir o ruído (e eu não mexo no áudio sem isso). Dica: deixe uns 2 segundos em silêncio no começo da gravação, ou use uma região que tenha pausas.");
      if (res.aviso === "silencio") return msgLimpa("Esta região está em silêncio: não há o que limpar.");
      if (res.aviso === "curto") return msgLimpa("A região é curta demais (menos de 1 segundo) para medir o ruído.");
      garantirAudio();
      const novo = ctx.createBuffer(res.canais.length, res.canais[0].length, sr); res.canais.forEach((c, i) => novo.copyToChannel(c, i));
      const blob = audioBufferParaWavBlob(novo);
      mudar(() => { const id = guardarAudio(novo, blob); r.alt = { buf: r.buf, off: r.off }; r.buf = id; r.off = 0; r.dur = Math.min(r.dur, novo.duration); r.limpo = true; });
      msgLimpa(`Ruído reduzido (${nome}) ✓. Compare com “Ouvir o original”.`);
    } catch (e) { msgLimpa("Não consegui limpar o ruído: " + ((e && e.message) || "erro inesperado") + "."); }
    finally { limpando = false; renderRegiao(); }
  }
  function alternarLimpeza(r) {
    if (!r.alt) return;
    mudar(() => { const a = r.alt; r.alt = { buf: r.buf, off: r.off }; r.buf = a.buf; r.off = a.off; if (r.afin) r.afinada = !r.afinada; else r.limpo = !r.limpo; const b = bufs.get(r.buf); if (b) r.dur = Math.min(r.dur, b.duration - r.off); });
    dica(r.afin ? (r.afinada ? "Tocando a versão afinada." : "Tocando a versão sem afinação.") : (r.limpo ? "Tocando a versão limpa." : "Tocando o original (sem limpeza)."));
  }
  function manterVersao(r) { if (!r.alt) return; const tipo = r.afin ? "afinação" : "limpeza", ativa = r.afin ? r.afinada : r.limpo; mudar(() => { r.alt = null; if (r.afin) delete r.afin; }); dica(ativa ? `Mantive a versão com ${tipo} e descartei a outra desta região.` : `Mantive a versão sem ${tipo} e descartei a outra.`); }

  // ══ AFINAÇÃO (aba Afinação: editor de linha contínua; o resultado é gravado na região e a versão sem afinação fica guardada) ═══
  let afin = null, abaAtiva = "mix", afinTutVisto = false;
  function baseDaRegiao(r) {   // o áudio ANTES da afinação (se a região já foi afinada, é a versão guardada em alt)
    const ref = r.afinada && r.alt ? r.alt : { buf: r.buf, off: r.off }, buf = bufs.get(ref.buf); if (!buf) return null;
    const sr = buf.sampleRate, ini = Math.max(0, Math.round(ref.off * sr)), fim = Math.min(buf.length, ini + Math.round(r.dur * sr));
    return { buf, ini, fim, sr, ref };
  }
  function criarAfin() {
    if (afin || !window.EstudioAfinacaoUI || !window.EstudioAfinacao) return afin;
    afin = EstudioAfinacaoUI.criar($("#dwAfin"), { modo: "estudio", aoAplicar: aplicarAfinacao, aoPendente: (p) => { const t = $('.dw-aba[data-aba="afin"]'); if (t) t.classList.toggle("pend", p); }, aoAmpliar: ampliarAfin, aoTocar: () => { if (S.tocando) pausar(); } });
    return afin;
  }
  function prepararAfinacao() {
    const a = criarAfin(); if (!a) { $("#dwAfin").innerHTML = '<div class="dw-breve">O editor de afinação não carregou. Atualize a página.</div>'; return; }
    const r = regiaoPorId(S.regiaoSel);
    if (!r || r.gravando) { a.limpar("Selecione uma região de voz na linha do tempo (clique nela) para ver e ajustar a afinação."); return; }
    const base = baseDaRegiao(r); if (!base) { a.limpar("Esta região ainda não tem áudio."); return; }
    const chave = `${base.ref.buf}:${base.ref.off.toFixed(3)}:${r.dur.toFixed(3)}`, comp = COMPASSOS[S.compasso];
    const dados = { chave, cents: r.afin ? r.afin.cents : null, origemTempo: r.ini, batidaSeg: beatDur(), porCompasso: comp.n, tonica: S.tom, nome: r.nome };
    if (!(a.E.carregado && a.E.chave === chave)) {
      const nc = base.buf.numberOfChannels, n = base.fim - base.ini, mono = new Float32Array(n);
      for (let c = 0; c < nc; c++) { const d = base.buf.getChannelData(c); for (let i = 0; i < n; i++) mono[i] += d[base.ini + i] / nc; }
      dados.mono = mono; dados.sr = base.sr;
    }
    a.carregar(dados).then((okk) => { if (okk && !afinTutVisto) { afinTutVisto = true; a.definirTutorialAuto(); } }).catch(() => {});
  }
  function ampliarAfin() { const ed = $("#dwEditor"), on = ed.classList.toggle("ampliado"); if (afin) afin.definirModoAmpliado(on); }
  async function aplicarAfinacao(cents, det) {
    const r = regiaoPorId(S.regiaoSel); if (!r) return dica("Selecione uma região com voz primeiro.");
    const base = baseDaRegiao(r); if (!base) return;
    if (!cents.some((v) => Math.abs(v) > 0.5)) {
      if (r.afin && r.alt) { mudar(() => { if (r.afinada) { r.buf = r.alt.buf; r.off = r.alt.off; } r.alt = null; r.afinada = false; delete r.afin; }); if (afin) afin.zerarHistorico(); dica("Afinação desfeita: a região voltou ao áudio sem afinação."); }
      else dica("Não há nada para aplicar: a linha não foi mexida. Puxe pontos ou use “Corrigir tudo” primeiro.");
      return;
    }
    dica("Aplicando a afinação… (isso leva alguns segundos)"); await new Promise((ok) => setTimeout(ok, 40));
    try {
      garantirAudio(); const nc = base.buf.numberOfChannels, n = base.fim - base.ini, novo = ctx.createBuffer(nc, n, base.sr);
      for (let c = 0; c < nc; c++) novo.copyToChannel(EstudioAfinacao.corrigirAltura(base.buf.getChannelData(c).slice(base.ini, base.fim), base.sr, det, cents), c);
      const blob = audioBufferParaWavBlob(novo), guardar = Array.from(cents, (v) => Math.round(v * 10) / 10);
      mudar(() => { const id = guardarAudio(novo, blob); if (!r.afinada) r.alt = { buf: r.buf, off: r.off }; r.buf = id; r.off = 0; r.dur = Math.min(r.dur, novo.duration); r.afinada = true; r.limpo = false; r.afin = { cents: guardar, n: det.n }; });
      if (afin) afin.zerarHistorico();
      dica("Afinação aplicada ✓. Ouça a região; em Região você compara com “Ouvir a versão sem afinação”. Ctrl+Z desfaz.");
    } catch (e) { dica("Não consegui aplicar a afinação: " + ((e && e.message) || "erro inesperado") + "."); }
  }

  // ══ EFEITOS POR FAIXA (aba Efeitos: os cartões são gerados a partir do registro de efeitos) ═══
  let arrastandoFx = null; const catFxMap = {};
  function categoriaDaFaixa(f) { const n = (f.nome || "").toLowerCase(); return /voz|vocal|cant|backing/.test(n) ? "voz" : /viol/.test(n) ? "violao" : /guitarr|guitar/.test(n) ? "guitarra" : /baix|bass/.test(n) ? "baixo" : /bater|drum|percu/.test(n) ? "bateria" : "todos"; }
  const catAtual = (f) => catFxMap[f.id] || categoriaDaFaixa(f);
  function montarMenuFx(f) {
    const R = EstudioFx.REGISTRO, cat = catAtual(f), cats = [["todos", "Todos"], ...EstudioFx.CATEGORIAS];
    $("#dwMenuFx").innerHTML = `<div class="cats">${cats.map(([k, n]) => `<button class="${k === cat ? "on" : ""}" data-fxcat="${k}">${n}</button>`).join("")}</div>` + EstudioFx.GRUPOS.map((g) => { const itens = Object.keys(R).filter((k) => R[k].grupo === g && (cat === "todos" || R[k].inst.includes(cat))); return itens.length ? `<div class="grp">${esc(g)}</div>` + itens.map((k) => `<button data-fxnovo="${k}"><b>${esc(R[k].nome)}</b><small>${esc(R[k].descr)}</small></button>`).join("") : ""; }).join("");
  }
  const faixaFx = () => faixaPorId(S.faixaSel) || S.faixas[0] || null;
  const minhasPre = () => { try { return JSON.parse(localStorage.getItem("oh-dw-presets") || "[]"); } catch (e) { return []; } };
  const casasFx = (q) => (q.passo != null ? (String(q.passo).split(".")[1] || "").length : q.max - q.min >= 100 ? 0 : q.max - q.min >= 10 ? 1 : 2);
  const fmtFx = (q, v) => `${(+v).toFixed(casasFx(q))}${q.un ? " " + q.un : ""}`;
  const posFx = (q, v) => (q.log ? (Math.log(v / q.min) / Math.log(q.max / q.min)) * 1000 : ((v - q.min) / (q.max - q.min)) * 1000);
  const valFx = (q, pos) => { const v = q.log ? q.min * Math.pow(q.max / q.min, pos / 1000) : q.min + (pos / 1000) * (q.max - q.min), c = casasFx(q), passo = q.passo || Math.pow(10, -c); return Math.min(q.max, Math.max(q.min, +(Math.round(v / passo) * passo).toFixed(Math.max(c, 2)))); };
  function curvaEqSvg(p) {
    const c = EstudioFx.curvaEq(p, 80), W = 230, H = 64, y = (db) => H / 2 - (Math.max(-20, Math.min(20, db)) / 20) * (H / 2 - 4); let d = "";
    for (let i = 0; i < c.db.length; i++) d += (i ? "L" : "M") + ((i / (c.db.length - 1)) * W).toFixed(1) + " " + y(c.db[i]).toFixed(1);
    return `<svg class="curva" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><line x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}" stroke="rgba(255,255,255,.18)"/>${[100, 1000, 10000].map((f) => { const x = (Math.log(f / 20) / Math.log(1000)) * W; return `<line x1="${x}" x2="${x}" y1="0" y2="${H}" stroke="rgba(255,255,255,.08)"/>`; }).join("")}<path d="${d}" fill="none" stroke="#ff8a2a" stroke-width="2"/></svg>`;
  }
  function cartaoFx(fx, i, total) {
    const R = EstudioFx.REGISTRO[fx.tipo]; if (!R) return ""; const p = Object.assign(EstudioFx.padroes(fx.tipo), fx.p); let ult = null, h = "";
    for (const q of R.params) {
      if (q.mostrarSe && !(q.mostrarSe[0] === "!" ? !p[q.mostrarSe.slice(1)] : !!p[q.mostrarSe])) continue;
      if (q.grupo && q.grupo !== ult) { h += `<h5>${esc(q.grupo)}</h5>`; ult = q.grupo; }
      if (q.tipo === "num") h += `<label class="par"><span>${esc(q.rotulo)}</span><input type="range" min="0" max="1000" step="1" value="${Math.round(posFx(q, p[q.id]))}" data-fxi="${fx.id}" data-fxp="${q.id}"><b data-fxv="${fx.id}:${q.id}">${fmtFx(q, p[q.id])}</b></label>`;
      else if (q.tipo === "sel") h += `<label class="par sel"><span>${esc(q.rotulo)}</span><select data-fxi="${fx.id}" data-fxp="${q.id}">${q.opcoes.map(([v, nome]) => `<option value="${v}" ${String(v) === String(p[q.id]) ? "selected" : ""}>${esc(nome)}</option>`).join("")}</select></label>`;
      else h += `<label class="par bool"><input type="checkbox" data-fxi="${fx.id}" data-fxp="${q.id}" ${p[q.id] ? "checked" : ""}><span>${esc(q.rotulo)}</span></label>`;
    }
    return `<div class="dw-fxc ${fx.ligado ? "" : "desl"}" data-fxc="${fx.id}">
      <div class="cab"><button class="mini" data-fxm="esq" ${i === 0 ? "disabled" : ""} title="Mover para antes (o som passa primeiro por quem está à esquerda)">◀</button><span class="t" title="${esc(R.descr)}">${esc(R.nome)}</span><button class="mini" data-fxm="dir" ${i === total - 1 ? "disabled" : ""} title="Mover para depois">▶</button>
        <label class="chave" title="Liga e desliga este efeito"><input type="checkbox" data-fxon="${fx.id}" ${fx.ligado ? "checked" : ""}><i></i></label><button class="mini" data-fxdel="${fx.id}" title="Remover este efeito">×</button></div>
      <div class="desc">${esc(R.descr)}</div>${fx.tipo === "eq" ? curvaEqSvg(p) : ""}${R.medidor ? `<div class="gr" title="Quanto o efeito está reduzindo o volume agora"><i data-fxgr="${fx.id}"></i></div>` : ""}
      <div class="params">${h}</div><button class="dw-btn peq" data-fxreset="${fx.id}">Valores padrão</button></div>`;
  }
  function renderFx() {
    const el = $("#dwFx"); if (!el) return; if (!window.EstudioFx) { el.innerHTML = '<div class="dw-fx-vazio">O motor de efeitos não carregou. Atualize a página.</div>'; return; }
    const f = faixaFx(); if (!f) { el.innerHTML = '<div class="dw-fx-vazio">Ainda não há faixas. Importe, grave ou separe uma música.</div>'; return; }
    const lista = f.fx || [], mine = minhasPre();
    const top = el.querySelector(".dw-fx-cadeia"), rolagem = top ? top.scrollLeft : 0;
    el.innerHTML = `<div class="dw-fx-barra">
        <div class="chips">${S.faixas.map((x) => `<button class="dw-chip ${x.id === f.id ? "on" : ""}" data-fxfaixa="${x.id}"><i style="background:${x.cor}"></i>${esc(x.nome)}${(x.fx || []).filter((y) => y.ligado).length ? ` <small>${(x.fx || []).filter((y) => y.ligado).length}</small>` : ""}</button>`).join("")}</div>
        <select id="dwFxPre" title="Troca a cadeia desta faixa por uma pronta (dá para desfazer)"><option value="">Predefinição…</option>${(() => { const c0 = catAtual(f), ordem = [...EstudioFx.CATEGORIAS].sort((a, b) => (a[0] === c0 ? -1 : 0) - (b[0] === c0 ? -1 : 0)); return ordem.map(([k, n]) => { const ps = EstudioFx.PREDEFINICOES.filter((p) => p.inst === k); return ps.length ? `<optgroup label="${n}">${ps.map((p) => `<option value="p:${p.id}" title="${esc(p.descr)}">${esc(p.nome)}</option>`).join("")}</optgroup>` : ""; }).join(""); })()}${mine.length ? `<optgroup label="Minhas">${mine.map((m, k) => `<option value="m:${k}">${esc(m.nome)}</option>`).join("")}</optgroup>` : ""}</select>
        <button class="dw-btn peq" id="dwFxAdd">${ic("mais")} Adicionar efeito</button><button class="dw-btn peq" id="dwFxSalvar" title="Guarda a cadeia desta faixa para usar em outros projetos">Salvar como minha predefinição</button>
        <button class="dw-btn peq" id="dwFxTodos" title="Liga ou desliga todos os efeitos desta faixa (para comparar com e sem)">${lista.length && lista.every((x) => !x.ligado) ? "Ligar todos" : "Desligar todos"}</button><button class="dw-btn peq" id="dwFxLimpar">Limpar cadeia</button>
        ${fxErro ? '<span class="dw-dica" style="color:#ef4444">Este navegador não tem AudioWorklet: compressor, limitador, porta de ruído, de-esser, bitcrusher, flanger, phaser e harmonizador ficam mudos.</span>' : ""}</div>
      <div class="dw-fx-cadeia">${lista.length ? lista.map((x, i) => cartaoFx(x, i, lista.length)).join("") : `<div class="dw-fx-vazio"><b>${esc(f.nome)}</b> ainda não tem efeitos.<br>Escolha uma <b>predefinição</b> (por exemplo "Voz limpa") ou clique em <b>Adicionar efeito</b>: são ${Object.keys(EstudioFx.REGISTRO).length} à escolha, de equalizador e compressor a reverb, delay, chorus, phaser e até “robô”.</div>`}</div>`;
    const novo = el.querySelector(".dw-fx-cadeia"); if (novo) novo.scrollLeft = rolagem;
  }
  function mudarFx(fn) { const antes = foto(); fn(); empilhar(antes); renderTudo(); atualizarNos(); }
  function aplicarFxVivo(f, fx) { const n = nos.get(f.id); if (n && n.cadeia) n.cadeia.atualizar([fx], ambFx()); }
  function medidoresFx() {
    if (abaAtiva !== "fx") return; const f = faixaFx(), n = f && nos.get(f.id); if (!n || !n.cadeia) return;
    $$("[data-fxgr]").forEach((b) => { const inst = n.cadeia.itens.get(b.dataset.fxgr), v = inst && inst.reducao ? inst.reducao : 0; b.style.width = Math.min(100, Math.abs(v) * 5) + "%"; });
  }
  function ligarEventosFx() {
    const el = $("#dwFx");
    el.addEventListener("input", (e) => {
      const t = e.target, fid = t.dataset.fxi; if (!fid || t.type !== "range") return;
      const f = faixaFx(), fx = (f.fx || []).find((x) => x.id === fid); if (!fx) return; const q = EstudioFx.REGISTRO[fx.tipo].params.find((z) => z.id === t.dataset.fxp);
      if (arrastandoFx === null) arrastandoFx = foto();
      const v = valFx(q, +t.value); fx.p[q.id] = v; const lab = el.querySelector(`[data-fxv="${fid}:${q.id}"]`); if (lab) lab.textContent = fmtFx(q, v);
      aplicarFxVivo(f, fx); if (fx.tipo === "eq") { const sv = el.querySelector(`[data-fxc="${fid}"] svg.curva`); if (sv) sv.outerHTML = curvaEqSvg(Object.assign(EstudioFx.padroes("eq"), fx.p)); } agendarSalvar();
    });
    el.addEventListener("change", (e) => {
      const t = e.target, f = faixaFx(); if (!f) return;
      if (t.type === "range") { if (arrastandoFx !== null) { empilhar(arrastandoFx); arrastandoFx = null; } return; }
      if (t.id === "dwFxPre") {
        const v = t.value; t.value = ""; if (!v) return; let lista = null, nome = "";
        if (v.startsWith("p:")) { const pr = EstudioFx.PREDEFINICOES.find((x) => x.id === v.slice(2)); if (pr) { lista = EstudioFx.daPredefinicao(pr); nome = pr.nome; } } else { const m = minhasPre()[+v.slice(2)]; if (m) { lista = m.fx.map((x) => EstudioFx.novo(x.tipo, x.p)); nome = m.nome; } }
        if (lista) { mudarFx(() => { f.fx = lista; }); dica(`Predefinição “${nome}” aplicada em ${f.nome}. Ctrl+Z desfaz.`); } return;
      }
      if (t.dataset.fxon) { mudarFx(() => { const fx = f.fx.find((x) => x.id === t.dataset.fxon); if (fx) fx.ligado = t.checked; }); return; }
      if (t.dataset.fxi) { mudarFx(() => { const fx = f.fx.find((x) => x.id === t.dataset.fxi); if (!fx) return; fx.p[t.dataset.fxp] = t.type === "checkbox" ? t.checked : t.value; const R = EstudioFx.REGISTRO[fx.tipo]; if (R.aoMudar) R.aoMudar(fx.p, t.dataset.fxp); }); }
    });
    el.addEventListener("click", (e) => {
      const t = e.target, f = faixaFx(); if (!f) return; f.fx = f.fx || [];
      const chip = t.closest("[data-fxfaixa]"); if (chip) { S.faixaSel = chip.dataset.fxfaixa; renderTudo(); return; }
      const mv = t.closest("[data-fxm]"); if (mv) { const id = mv.closest("[data-fxc]").dataset.fxc, i = f.fx.findIndex((x) => x.id === id), j = i + (mv.dataset.fxm === "esq" ? -1 : 1); if (j >= 0 && j < f.fx.length) mudarFx(() => { const [x] = f.fx.splice(i, 1); f.fx.splice(j, 0, x); }); return; }
      const del = t.closest("[data-fxdel]"); if (del) { mudarFx(() => { f.fx = f.fx.filter((x) => x.id !== del.dataset.fxdel); }); dica("Efeito removido. Ctrl+Z traz de volta."); return; }
      const rs = t.closest("[data-fxreset]"); if (rs) { mudarFx(() => { const fx = f.fx.find((x) => x.id === rs.dataset.fxreset); if (fx) fx.p = EstudioFx.padroes(fx.tipo); }); return; }
      if (t.closest("#dwFxAdd")) {
        const m = $("#dwMenuFx"), r = t.closest("#dwFxAdd").getBoundingClientRect(); montarMenuFx(f);
        const altura = Math.min(520, innerHeight - 16); m.style.maxHeight = altura + "px"; m.style.top = Math.max(8, Math.min(r.bottom + 6, innerHeight - altura - 8)) + "px"; m.style.left = Math.max(8, Math.min(r.left, innerWidth - 330)) + "px"; $("#dwMenuArquivo").hidden = true; $("#dwMenuFaixa").hidden = true; m.hidden = !m.hidden; e.stopPropagation(); return;
      }
      if (t.closest("#dwFxSalvar")) { if (!f.fx.length) return dica("Esta faixa não tem efeitos para guardar."); const nome = (prompt("Nome da sua predefinição:", f.nome + " — minha cadeia") || "").trim(); if (!nome) return; const lista = minhasPre(); lista.push({ nome, fx: f.fx.map((x) => ({ tipo: x.tipo, p: JSON.parse(JSON.stringify(x.p)) })) }); try { localStorage.setItem("oh-dw-presets", JSON.stringify(lista)); dica(`Predefinição “${nome}” guardada neste aparelho (aparece em “Minhas”).`); } catch (err) { dica("Não consegui guardar a predefinição."); } renderFx(); return; }
      if (t.closest("#dwFxTodos")) { const todosOff = f.fx.length && f.fx.every((x) => !x.ligado); mudarFx(() => { f.fx.forEach((x) => { x.ligado = todosOff; }); }); dica(todosOff ? "Todos os efeitos ligados." : "Todos os efeitos desligados: ouça a faixa sem eles."); return; }
      if (t.closest("#dwFxLimpar")) { if (f.fx.length) { mudarFx(() => { f.fx = []; }); dica("Cadeia limpa. Ctrl+Z desfaz."); } }
    });
    $("#dwMenuFx").addEventListener("click", (e) => {
      const ct = e.target.closest("[data-fxcat]"); if (ct) { const f0 = faixaFx(); if (f0) { catFxMap[f0.id] = ct.dataset.fxcat; montarMenuFx(f0); } e.stopPropagation(); return; }
      const b = e.target.closest("[data-fxnovo]"); if (!b) return; const f = faixaFx(); if (!f) return; $("#dwMenuFx").hidden = true; let novoId = null;
      mudarFx(() => { f.fx = f.fx || []; const fx = EstudioFx.novo(b.dataset.fxnovo); f.fx.push(fx); novoId = fx.id; }); dica(`${EstudioFx.REGISTRO[b.dataset.fxnovo].nome} adicionado a ${f.nome}.`);
      const c = $(`[data-fxc="${novoId}"]`); if (c) c.scrollIntoView({ inline: "end", block: "nearest" });
    });
  }

  // ══ SAMPLES: transformar um trecho (solo, riff, batida) numa peça reutilizável, guardada no aparelho ═══
  const smBufs = new Map(); let amostras = [], smCarregadas = false, smSel = null, smTeclado = false, smBase = 4, smRaiz = 0, smSegurar = false; const smVivos = new Map();
  const smDB = () => new Promise((ok, err) => { const rq = indexedDB.open("oh-estudio-samples", 1); rq.onupgradeneeded = () => rq.result.createObjectStore("amostras", { keyPath: "id" }); rq.onsuccess = () => ok(rq.result); rq.onerror = () => err(rq.error); });
  const smTx = async (modo, fn) => { const db = await smDB(); return new Promise((ok, err) => { const tx = db.transaction("amostras", modo), r = fn(tx.objectStore("amostras")); tx.oncomplete = () => { db.close(); ok(r ? r.result : undefined); }; tx.onerror = () => err(tx.error); }); };
  async function carregarAmostras() { try { amostras = ((await smTx("readonly", (st) => st.getAll())) || []).sort((a, b) => b.criado - a.criado); smCarregadas = true; } catch (e) { amostras = []; smCarregadas = true; dica("Não consegui abrir a biblioteca de samples neste aparelho."); } if (abaAtiva === "sm") renderSm(); return amostras; }
  async function smBuffer(id) { if (smBufs.has(id)) return smBufs.get(id); const a = amostras.find((x) => x.id === id); if (!a) return null; garantirAudio(); const buf = await decodificar(await a.wav.arrayBuffer()); smBufs.set(id, buf); return buf; }
  // bounce: a região (e, se quiser, passando pelos efeitos da faixa, com a cauda do reverb e do eco)
  async function renderizarRegiao(r, comEfeitos) {
    garantirAudio(); const f = faixaPorId(r.f), OC = window.OfflineAudioContext || window.webkitOfflineAudioContext, sr = ctx.sampleRate, lista = comEfeitos && f ? f.fx || [] : [], temFx = lista.some((x) => x.ligado);
    const cauda = temFx && window.EstudioFx ? Math.min(8, EstudioFx.cauda(lista)) : 0.02, off = new OC(2, Math.max(1, Math.ceil((r.dur + cauda) * sr)), sr);
    if (temFx && window.EstudioFx && EstudioFx.precisaWorklet(lista)) await EstudioFx.carregarWorklet(off);
    const cad = temFx ? EstudioFx.criarCadeia(off, lista, Object.assign(ambFx(), { origem: -r.ini })) : null, g = off.createGain(); if (cad) { cad.saida.connect(g); } g.connect(off.destination);
    programarRegiao(off, Object.assign({}, r, { ini: 0 }), cad ? cad.entrada : g, 0, 0); return off.startRendering();
  }
  async function guardarAmostra(buf, nome) { const a = { id: "s" + Date.now().toString(36) + Math.floor(Math.random() * 1e4), nome: (nome || "Sample").slice(0, 40), criado: Date.now(), dur: buf.duration, sr: buf.sampleRate, canais: buf.numberOfChannels, wav: audioBufferParaWavBlob(buf) }; await smTx("readwrite", (st) => st.put(a)); amostras.unshift(a); smBufs.set(a.id, buf); return a; }
  async function criarAmostra(r, comEfeitos) {
    if (!r || r.gravando) return dica("Selecione uma região com áudio para criar o sample."); dica("Criando o sample…");
    try { const buf = await renderizarRegiao(r, comEfeitos), a = await guardarAmostra(buf, r.nome.replace(/\s*·.*$/, "")); smSel = a.id; dica(`Sample “${a.nome}” criado (${fmt(a.dur)})${comEfeitos ? " com os efeitos da faixa" : ""}. Ele fica guardado neste aparelho, na aba Samples.`); if (abaAtiva !== "sm") abrirAba("sm"); else renderSm(); return a; }
    catch (e) { dica("Não consegui criar o sample: " + ((e && e.message) || "erro inesperado") + "."); }
  }
  async function importarAmostra(arq) { garantirAudio(); try { const buf = await decodificar(await arq.arrayBuffer()), a = await guardarAmostra(buf, arq.name.replace(/\.[^.]+$/, "")); smSel = a.id; dica(`Sample “${a.nome}” importado (${fmt(a.dur)}).`); renderSm(); return a; } catch (e) { dica("Não consegui ler esse arquivo de áudio."); } }
  async function inserirAmostra(id, vezes) {
    const a = amostras.find((x) => x.id === id), buf = await smBuffer(id); if (!a || !buf) return; vezes = Math.max(1, Math.min(64, Math.round(vezes || 1)));
    const antes = foto(); let f = faixaPorId(S.faixaSel); if (!f) f = novaFaixa(a.nome); const ini = snap(S.tAtual), bid = guardarAudio(buf, a.wav); let ultimo = null;
    for (let k = 0; k < vezes; k++) ultimo = novaRegiao(f, bid, a.nome, Math.round((ini + k * buf.duration) * 1000) / 1000, 0);
    S.faixaSel = f.id; S.regiaoSel = ultimo.id; empilhar(antes); renderTudo(); dica(`“${a.nome}” inserido em ${f.nome}${vezes > 1 ? ` ${vezes}×, em sequência` : ""}, a partir de ${fmt(ini)}. Ctrl+Z desfaz.`);
  }
  async function renomearAmostra(id, nome) { const a = amostras.find((x) => x.id === id); if (!a || !nome.trim()) return; a.nome = nome.trim().slice(0, 40); await smTx("readwrite", (st) => st.put(a)); }
  async function excluirAmostra(id) { await smTx("readwrite", (st) => st.delete(id)); amostras = amostras.filter((x) => x.id !== id); smBufs.delete(id); if (smSel === id) smSel = null; renderSm(); dica("Sample excluído da biblioteca."); }
  const smTaxa = (semis) => Math.pow(2, semis / 12);
  async function tocarAmostra(id, semis, loop) {   // semis = quantos semitons acima ou abaixo do som original; devolve a taxa de reprodução usada
    const buf = await smBuffer(id); if (!buf) return null; garantirAudio(); if (ctx.state === "suspended") ctx.resume();
    const src = ctx.createBufferSource(), g = ctx.createGain(), taxa = smTaxa(semis || 0); src.buffer = buf; src.playbackRate.value = taxa; src.loop = !!loop; g.gain.value = 0.9; src.connect(g); g.connect(mestre || ctx.destination); src.start();
    const chave = id + ":" + semis; if (smVivos.has(chave)) { try { smVivos.get(chave).src.stop(); } catch (e) { /* já parou */ } } smVivos.set(chave, { src, g }); src.onended = () => { if (smVivos.get(chave) && smVivos.get(chave).src === src) smVivos.delete(chave); }; return taxa;
  }
  function soltarAmostra(id, semis) { const v = smVivos.get(id + ":" + semis); if (!v) return; const t = ctx.currentTime; v.g.gain.setTargetAtTime(0, t, 0.03); try { v.src.stop(t + 0.15); } catch (e) { /* já parou */ } smVivos.delete(id + ":" + semis); }
  function pararAmostras() { smVivos.forEach((v) => { try { v.src.stop(); } catch (e) { /* já parou */ } }); smVivos.clear(); }
  const NOTAS_NOME = ["Dó", "Dó#", "Ré", "Ré#", "Mi", "Fá", "Fá#", "Sol", "Sol#", "Lá", "Lá#", "Si"], PRETA = new Set([1, 3, 6, 8, 10]);
  function renderSm() {
    const el = $("#dwSm"); if (!el) return; if (!smCarregadas) { el.innerHTML = '<div class="dw-fx-vazio">Abrindo a biblioteca de samples…</div>'; carregarAmostras(); return; }
    const r = regiaoPorId(S.regiaoSel), f = faixaPorId(S.faixaSel), temFx = f && (f.fx || []).some((x) => x.ligado);
    const cartoes = amostras.map((a) => `<div class="dw-smc ${a.id === smSel ? "sel" : ""}" data-smid="${a.id}">
        <input class="nome" value="${esc(a.nome)}" data-smnome="${a.id}" title="Clique para renomear">
        <div class="meta">${fmt(a.dur)} · ${a.canais === 1 ? "mono" : "estéreo"} · ${Math.round(a.sr / 100) / 10} kHz</div>
        <div class="acoes"><button class="dw-btn peq" data-sma="ouvir">▶ Ouvir</button><button class="dw-btn peq" data-sma="inserir" title="Coloca o sample na faixa selecionada, no ponto onde está o cursor">Inserir na faixa</button>
          <span class="rep"><input type="number" min="2" max="64" value="4" data-smrep="${a.id}" title="Quantas vezes repetir em sequência"><button class="dw-btn peq" data-sma="repetir">Inserir ×</button></span>
          <button class="dw-btn peq ${a.id === smSel && smTeclado ? "on" : ""}" data-sma="teclas" title="Toca o sample nas teclas, mudando a altura da nota">Teclado</button><button class="dw-btn peq" data-sma="excluir">Excluir</button></div></div>`).join("");
    let tecl = ""; if (smTeclado && smSel) { const a = amostras.find((x) => x.id === smSel); if (a) { let teclas = ""; for (let i = 0; i < 24; i++) { const m = i % 12; teclas += `<button class="tecla ${PRETA.has(m) ? "preta" : ""}" data-smn="${i}" title="${NOTAS_NOME[m]}${smBase + (i >= 12 ? 1 : 0)}">${PRETA.has(m) ? "" : NOTAS_NOME[m]}</button>`; }
      tecl = `<div class="dw-smt"><div class="cfg"><b>Teclado de “${esc(a.nome)}”</b><label>A nota original do sample é <select id="dwSmRaiz">${NOTAS_NOME.map((n, k) => `<option value="${k}" ${k === smRaiz ? "selected" : ""}>${n}</option>`).join("")}</select></label><label>Oitava <select id="dwSmBase">${[2, 3, 4, 5].map((o) => `<option ${o === smBase ? "selected" : ""}>${o}</option>`).join("")}</select></label><label class="seg"><input type="checkbox" id="dwSmSeg" ${smSegurar ? "checked" : ""}> Segurar (repete enquanto a tecla estiver apertada)</label><span class="dica">No computador: A S D F G H J K L e W E T Y U O P (pretas).</span></div><div class="teclas">${teclas}</div></div>`; } }
    { const ed = $("#dwEditor"); if (ed && abaAtiva === "sm") { ed.classList.toggle("alto", !!tecl); ed.classList.toggle("medio", !tecl); } }   // com o teclado aberto o painel cresce um pouco
    el.innerHTML = `<div class="dw-fx-barra"><button class="dw-btn peq" id="dwSmCriar" ${r && !r.gravando ? "" : "disabled"} title="Transforma a região selecionada num sample reutilizável">Criar sample da região selecionada</button>
        <label class="dw-sm-fx" title="Aplica na hora os efeitos da faixa (equalizador, reverb etc.) dentro do sample"><input type="checkbox" id="dwSmComFx" ${temFx ? "checked" : ""}> com os efeitos da faixa</label>
        <button class="dw-btn peq" id="dwSmImportar">Importar áudio como sample</button><span class="dw-dica">${r ? `Região: <b>${esc(r.nome)}</b> (${fmt(r.dur)})` : "Selecione uma região na linha do tempo para criar um sample."}${f ? ` · Inserir em: <b>${esc(f.nome)}</b>` : ""}</span></div>
      <div class="dw-sm-corpo ${tecl ? "com-tec" : ""}"><div class="dw-sm-lista">${cartoes || '<div class="dw-fx-vazio">Ainda não há samples.<br>Selecione uma região (um solo, um riff, uma batida) e clique em <b>Criar sample da região selecionada</b>. Ele fica guardado neste aparelho para usar em qualquer projeto: dá para inserir na faixa, repetir em sequência ou tocar nas teclas.</div>'}</div>${tecl}</div>`;
  }
  function notaTecla(i) { return i + smBase * 12 + 12 - smRaiz - 0; }   // semitons em relação ao som original (a nota original é a raiz da oitava escolhida)
  const TECLAS_PC = { a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11, k: 12, o: 13, l: 14, p: 15 };
  const semisDaTecla = (i) => i - smRaiz + (smBase - 4) * 12;
  function ligarEventosSm() {
    const el = $("#dwSm");
    el.addEventListener("click", async (e) => {
      const t = e.target; if (t.closest("#dwSmCriar")) { const r = regiaoPorId(S.regiaoSel), c = $("#dwSmComFx"); return void criarAmostra(r, c && c.checked); }
      if (t.closest("#dwSmImportar")) return void $("#dwArqSample").click();
      const b = t.closest("[data-sma]"); if (!b) { const c = t.closest(".dw-smc"); if (c && !t.closest("input,button")) { smSel = c.dataset.smid; renderSm(); } return; }
      const id = b.closest(".dw-smc").dataset.smid, acao = b.dataset.sma; smSel = id;
      if (acao === "ouvir") { pararAmostras(); tocarAmostra(id, 0, false); renderSm(); } else if (acao === "inserir") inserirAmostra(id, 1);
      else if (acao === "repetir") inserirAmostra(id, +b.closest(".rep").querySelector("input").value || 4);
      else if (acao === "teclas") { smTeclado = !(smTeclado && smSel === id); renderSm(); } else if (acao === "excluir") { if (confirm("Excluir este sample da biblioteca?")) excluirAmostra(id); }
    });
    el.addEventListener("change", (e) => { const t = e.target; if (t.dataset.smnome) renomearAmostra(t.dataset.smnome, t.value); else if (t.id === "dwSmRaiz") smRaiz = +t.value; else if (t.id === "dwSmBase") { smBase = +t.value; renderSm(); } else if (t.id === "dwSmSeg") smSegurar = t.checked; });
    const aperta = (e) => { const k = e.target.closest("[data-smn]"); if (!k || !smSel) return; e.preventDefault(); k.classList.add("on"); k.setPointerCapture && k.setPointerCapture(e.pointerId); tocarAmostra(smSel, semisDaTecla(+k.dataset.smn), smSegurar); };
    const solta = (e) => { const k = e.target.closest("[data-smn]"); if (!k || !smSel) return; k.classList.remove("on"); if (smSegurar) soltarAmostra(smSel, semisDaTecla(+k.dataset.smn)); };
    el.addEventListener("pointerdown", aperta); el.addEventListener("pointerup", solta); el.addEventListener("pointercancel", solta);
    $("#dwArqSample").addEventListener("change", (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) importarAmostra(f); });
    const apertadas = new Set();   // teclado do computador (fase de captura: tem prioridade sobre os atalhos do Estúdio, como R e S)
    document.addEventListener("keydown", (e) => { if (abaAtiva !== "sm" || !smTeclado || !smSel || e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return; const i = TECLAS_PC[e.key.toLowerCase()]; if (i === undefined) return; e.preventDefault(); e.stopImmediatePropagation(); if (apertadas.has(i)) return; apertadas.add(i); const k = el.querySelector(`[data-smn="${i}"]`); if (k) k.classList.add("on"); tocarAmostra(smSel, semisDaTecla(i), smSegurar); }, true);
    document.addEventListener("keyup", (e) => { const i = TECLAS_PC[e.key.toLowerCase()]; if (i === undefined || !apertadas.has(i)) return; apertadas.delete(i); const k = el.querySelector(`[data-smn="${i}"]`); if (k) k.classList.remove("on"); if (smSegurar && smSel) soltarAmostra(smSel, semisDaTecla(i)); }, true);
  }

  // ══ EDIÇÃO VOCAL: ferramenta da região de voz (pedido em português ou escolha manual). Reaproveita a limpeza de ruído, a mudança de tom e os efeitos do Estúdio ═══
  let vozMsg = "", vozOcupado = false, vozTexto = "", vozMarcas = { reduzir_ruido: false, normalizar: false, eq_presenca: false, compressao: false, remover_sibilancia: false, reverb_leve: false }, vozTom = 0;
  const flagsVazias = () => ({ reduzir_ruido: false, normalizar: false, ajustar_tom: 0, eq_presenca: false, compressao: false, remover_sibilancia: false, reverb_leve: false });
  function interpretarLocal(texto) {   // o "plano B" sem servidor: as mesmas palavras-chave do servidor
    const c = (texto || "").toLowerCase(), f = flagsVazias(), tem = (...p) => p.some((x) => c.includes(x));
    if (tem("ruído", "ruido", "limpa", "limpe", "barulho")) f.reduzir_ruido = true;
    if (tem("normaliz", "volume")) f.normalizar = true;
    if (tem("grave", "mais baixo", "desce o tom", "descer o tom")) f.ajustar_tom = -1;
    if (tem("agudo", "mais alto", "sobe o tom", "subir o tom")) f.ajustar_tom = 1;
    if (tem("presente", "presença", "presenca", "eq", "clareza", "brilho")) f.eq_presenca = true;
    if (tem("compress", "dinamica", "dinâmica", "punch")) f.compressao = true;
    if (tem("sibil", "assobio", "chiado agudo", "dos s")) f.remover_sibilancia = true;
    if (tem("reverb", "ambiente", "espaço", "espaco", "sala")) f.reverb_leve = true;
    if (tem("profission", "melhor", "melhora", "capricha")) { f.reduzir_ruido = true; f.normalizar = true; f.eq_presenca = true; f.compressao = true; }
    return f;
  }
  async function interpretarEdicao(texto) {
    try { const fd = new FormData(); fd.append("comando", texto); const resp = await fetch(`${API_BASE}/api/edicao/interpretar`, { method: "POST", body: fd }); if (!resp.ok) throw new Error("http " + resp.status); const d = await resp.json(); if (!d || !d.flags) throw new Error("sem ajustes"); return { flags: Object.assign(flagsVazias(), d.flags), ia: !!d.usou_ia, servidor: true }; }
    catch (e) { return { flags: interpretarLocal(texto), ia: false, servidor: false }; }
  }
  async function aplicarEdicaoVoz(flags, prefixo) {
    const r = regiaoPorId(S.regiaoSel);
    if (!r || r.gravando) { vozMsg = "Selecione uma região de voz na linha do tempo primeiro."; return renderVoz(); }
    if (vozOcupado) return; const semis = Math.max(-12, Math.min(12, +flags.ajustar_tom || 0)), quer = flags.reduzir_ruido || flags.normalizar || flags.eq_presenca || flags.compressao || flags.remover_sibilancia || flags.reverb_leve || Math.abs(semis) >= 0.05;
    if (!quer) { vozMsg = (prefixo || "") + "Não entendi nenhum ajuste nesse pedido. Tente algo como “limpa o ruído e deixa mais presente”, ou marque as opções ao lado."; return renderVoz(); }
    vozOcupado = true; renderVoz(); const feitos = [], avisos = [];
    try {
      if (flags.reduzir_ruido) {   // 1) o áudio da região: primeiro a limpeza (ela se recusa depois de afinar), depois o tom
        if (r.limpo) avisos.push("o ruído já estava reduzido nesta região"); else if (r.afin) avisos.push("não limpei o ruído: esta região já tem afinação aplicada (desfaça-a antes)");
        else { await limparRegiao(r); if (r.limpo) feitos.push("ruído reduzido"); else avisos.push("a limpeza de ruído não rodou: " + limpaTxt); }
      }
      if (Math.abs(semis) >= 0.05) {
        if (r.afin) avisos.push("não mudei o tom: esta região já tem afinação aplicada (aba Afinação)");
        else if (!window.EstudioAfinacao) avisos.push("o módulo de afinação não carregou");
        else {
          const base = baseDaRegiao(r); dica(`Mudando o tom (${semis > 0 ? "+" : ""}${semis} semitons)…`); await new Promise((ok) => setTimeout(ok, 30));
          const det = base ? await EstudioAfinacao.detectarAltura(base.buf.getChannelData(0).slice(base.ini, base.fim), base.sr, {}) : null;
          if (!det || !det.voz || !Array.from(det.voz).some(Boolean)) avisos.push("não achei voz cantada para mudar o tom");
          else { await aplicarAfinacao(new Float32Array(det.n).fill(semis * 100), det); if (r.afin) { feitos.push(`tom ${semis > 0 ? "+" : ""}${semis} semitom${Math.abs(semis) === 1 ? "" : "s"}`); if (Math.abs(semis) > 3) avisos.push("acima de 3 semitons a voz fica artificial"); } else avisos.push("não consegui mudar o tom"); }
        }
      }
      if (flags.normalizar || flags.eq_presenca || flags.compressao || flags.remover_sibilancia || flags.reverb_leve) {   // 2) ganho e efeitos: um só passo de desfazer
        mudarFx(() => {
          if (flags.normalizar) {
            const b = bufs.get(r.buf); let pico = 0; if (b) { const sr = b.sampleRate, i0 = Math.max(0, Math.round(r.off * sr)), i1 = Math.min(b.length, Math.round((r.off + r.dur) * sr)); for (let c = 0; c < b.numberOfChannels; c++) { const d = b.getChannelData(c); for (let i = i0; i < i1; i++) { const v = d[i] < 0 ? -d[i] : d[i]; if (v > pico) pico = v; } } }
            if (pico > 1e-4) { r.ganho = Math.round(Math.max(-24, Math.min(24, -1 - 20 * Math.log10(pico))) * 10) / 10; feitos.push(`volume normalizado (${r.ganho > 0 ? "+" : ""}${r.ganho} dB na região, pico em −1 dB)`); } else avisos.push("a região está em silêncio: não normalizei");
          }
          const f = faixaPorId(r.f); f.fx = f.fx || [];
          const juntar = (tipo, p, rot) => { if (f.fx.some((x) => x.tipo === tipo)) { avisos.push(`${rot}: a faixa já tem esse efeito`); return; } f.fx.push(EstudioFx.novo(tipo, p)); feitos.push(`${rot} (efeito na faixa)`); };
          if (flags.eq_presenca) juntar("eq", { hpf: 80, b2g: -1.5, b2f: 300, b4g: 3, b4f: 4500, b5g: 1.5 }, "EQ de presença");
          if (flags.remover_sibilancia) juntar("deesser", { limiar: -30, razao: 4 }, "sibilância reduzida");
          if (flags.compressao) juntar("compressor", { limiar: -20, razao: 2.5, ataque: 15, liberacao: 150, ganho: 2 }, "compressão suave");
          if (flags.reverb_leve) juntar("reverb", { tipo: "quarto", tempo: 0.5, pre: 4, mistura: 12 }, "reverb leve");
        });
      }
      vozMsg = (prefixo || "") + (feitos.length ? "Apliquei: " + feitos.join(", ") + "." : "Nada foi alterado.") + (avisos.length ? " Atenção: " + avisos.join("; ") + "." : "") + (feitos.length ? " Os efeitos você ajusta na aba Efeitos; Ctrl+Z desfaz cada passo." : "");
    } catch (e) { vozMsg = "Não consegui aplicar: " + ((e && e.message) || "erro inesperado") + "."; }
    finally { vozOcupado = false; renderVoz(); dica(vozMsg); }
  }
  function renderVoz() {
    const el = $("#dwVoz"); if (!el) return; const r = regiaoPorId(S.regiaoSel), f = r && faixaPorId(r.f), ok = r && !r.gravando && !vozOcupado, M = vozMarcas;
    const caixa = (id, rot) => `<label class="bool"><input type="checkbox" data-vzm="${id}" ${M[id] ? "checked" : ""}> ${rot}</label>`;
    el.innerHTML = `<div class="dw-fx-barra"><span class="dw-dica">${r ? `Região: <b>${esc(r.nome)}</b> (${fmt(r.dur)}) · faixa <b>${esc(f ? f.nome : "")}</b>` : "Selecione uma região de voz na linha do tempo para editar."}</span></div>
      <div class="dw-vz-corpo">
        <div class="dw-vz-cartao"><h4>Peça em português</h4><div class="dw-dica">A IA entende o pedido e aplica as ferramentas do Estúdio nesta região. Dá para desfazer.</div>
          <div class="linha"><input type="text" id="dwVozTexto" value="${esc(vozTexto)}" placeholder="Ex.: limpa o ruído e deixa mais presente" ${vozOcupado ? "disabled" : ""}><button class="dw-btn cheio" id="dwVozIA" ${ok ? "" : "disabled"}>Aplicar com IA</button></div>
          <div class="exemplos">${["limpa o ruído e deixa mais presente", "deixa profissional", "tira o chiado dos S", "dá um espaço de sala", "um tom mais grave"].map((t) => `<button class="dw-ex" data-vzex="${esc(t)}" ${vozOcupado ? "disabled" : ""}>${esc(t)}</button>`).join("")}</div></div>
        <div class="dw-vz-cartao"><h4>Ou escolha</h4>
          <div class="grade">${caixa("reduzir_ruido", "Reduzir ruído")}${caixa("normalizar", "Normalizar volume")}${caixa("eq_presenca", "EQ de presença")}${caixa("compressao", "Compressão suave")}${caixa("remover_sibilancia", "Reduzir sibilância")}${caixa("reverb_leve", "Reverb leve")}</div>
          <div class="linha"><label class="num">Ajuste de tom (semitons) <input type="number" id="dwVozTom" min="-12" max="12" step="0.5" value="${vozTom}"></label><button class="dw-btn cheio" id="dwVozAplicar" ${ok ? "" : "disabled"}>Aplicar edição</button></div></div>
      </div>
      <div class="dw-vz-msg" id="dwVozMsg">${vozOcupado ? "Trabalhando… (limpar ruído e mudar o tom levam alguns segundos)" : esc(vozMsg)}</div>`;
  }
  function ligarEventosVoz() {
    const el = $("#dwVoz");
    el.addEventListener("input", (e) => { if (e.target.id === "dwVozTexto") vozTexto = e.target.value; else if (e.target.id === "dwVozTom") vozTom = +e.target.value || 0; });
    el.addEventListener("change", (e) => { const m = e.target.dataset.vzm; if (m) vozMarcas[m] = e.target.checked; });
    el.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.id === "dwVozTexto") { e.preventDefault(); $("#dwVozIA").click(); } });
    el.addEventListener("click", async (e) => {
      const t = e.target;
      if (t.dataset.vzex) { vozTexto = t.dataset.vzex; renderVoz(); return $("#dwVozIA").click(); }
      if (t.id === "dwVozIA") { const txt = ($("#dwVozTexto").value || "").trim(); vozTexto = txt; if (!txt) { vozMsg = "Descreva o que você quer primeiro."; return renderVoz(); }
        vozOcupado = true; vozMsg = ""; renderVoz(); dica("A IA está interpretando o pedido…"); const it = await interpretarEdicao(txt); vozOcupado = false;
        return aplicarEdicaoVoz(it.flags, it.servidor ? (it.ia ? "A IA entendeu o pedido. " : "Entendi pelas palavras-chave. ") : "Sem conexão com o servidor: entendi pelas palavras-chave. "); }
      if (t.id === "dwVozAplicar") { vozTom = +$("#dwVozTom").value || 0; return aplicarEdicaoVoz(Object.assign(flagsVazias(), vozMarcas, { ajustar_tom: vozTom }), ""); }
    });
  }

  // ══ PRODUTOR: gera instrumentos em cima da região selecionada; cada instrumento vira uma FAIXA nova, alinhada com ela ═══
  let prodMsg = "", prodOcupado = false, prodEstilosPedidos = false, prodForm = { estilo: "Pop", baixo: true, bateria: true, acordes: true, teclado: false, solo: false, pro: true, modoAcordes: "melodia", bpmModo: "projeto", bpmManual: "", ajustar: false, descricao: "" };
  const PROD_CAMADAS = [["bateria", "Bateria"], ["baixo", "Baixo"], ["acordes", "Acordes"], ["teclado", "Teclado"], ["solo", "Solo"]];
  function renderProd() {
    const el = $("#dwProd"); if (!el) return; const r = regiaoPorId(S.regiaoSel), F = prodForm, ok = r && !r.gravando && !prodOcupado;
    if (!prodEstilosPedidos && typeof carregarEstilos === "function") { prodEstilosPedidos = true; carregarEstilos().then(() => { if (abaAtiva === "prod") renderProd(); }); }
    const caixa = (id, rot) => `<label class="bool"><input type="checkbox" data-pf="${id}" ${F[id] ? "checked" : ""}> ${rot}</label>`;
    el.innerHTML = `<div class="dw-fx-barra"><span class="dw-dica">${r ? `Gerar em cima de: <b>${esc(r.nome)}</b> (${fmt(r.dur)}). Cada instrumento vira uma faixa nova, no mesmo ponto da linha do tempo.` : "Selecione, na linha do tempo, a região (voz, violão…) sobre a qual gerar o acompanhamento."}</span></div>
      <div class="dw-vz-corpo">
        <div class="dw-vz-cartao"><h4>Estilo</h4>
          <div class="linha"><input type="text" id="dwProdDesc" value="${esc(F.descricao)}" placeholder="Descreva: ex. um funk animado com bateria forte" ${prodOcupado ? "disabled" : ""}><button class="dw-btn" id="dwProdIA" ${prodOcupado ? "disabled" : ""}>Sugerir com IA</button></div>
          <div class="linha"><select id="dwProdEstilo" ${prodOcupado ? "disabled" : ""}></select></div><div class="dw-dica" id="dwProdEstiloDesc"></div>
          <h4 style="margin-top:10px">Instrumentos</h4><div class="grade">${caixa("bateria", "Bateria")}${caixa("baixo", "Baixo")}${caixa("acordes", "Acordes")}${caixa("teclado", "Teclado")}${caixa("solo", "Solo")}${caixa("pro", "Qualidade profissional (abre espaço para a voz)")}</div></div>
        <div class="dw-vz-cartao"><h4>Harmonia e andamento</h4>
          <div class="linha"><label class="num">Os acordes <select id="dwProdModoAc"><option value="melodia" ${F.modoAcordes === "melodia" ? "selected" : ""}>seguem a sua melodia</option><option value="estilo" ${F.modoAcordes === "estilo" ? "selected" : ""}>seguem a sequência do estilo</option></select></label></div>
          <div class="radios"><label><input type="radio" name="dwProdBpm" value="projeto" ${F.bpmModo === "projeto" ? "checked" : ""}> Usar o andamento do projeto (<b>${S.bpm}</b> BPM)</label><label><input type="radio" name="dwProdBpm" value="detectar" ${F.bpmModo === "detectar" ? "checked" : ""}> Detectar na região</label><label><input type="radio" name="dwProdBpm" value="manual" ${F.bpmModo === "manual" ? "checked" : ""}> Digitar: <input type="number" id="dwProdBpmManual" min="40" max="220" value="${esc(F.bpmManual)}" placeholder="BPM"></label></div>
          <label class="bool"><input type="checkbox" data-pf="ajustar" ${F.ajustar ? "checked" : ""}> Ajustar o andamento e o tom do projeto ao que for detectado</label>
          <div class="linha"><button class="dw-btn cheio" id="dwProdGerar" ${ok ? "" : "disabled"}>Gerar faixas</button></div></div>
      </div>
      <div class="dw-vz-msg" id="dwProdMsg">${prodOcupado ? "Gerando o acompanhamento… pode levar alguns segundos (até 1 minuto em regiões longas)." : esc(prodMsg)}</div>`;
    const sel = $("#dwProdEstilo"); if (typeof preencherSelectEstilos === "function") preencherSelectEstilos(sel);
    if ([...sel.options].some((o) => o.value === F.estilo)) sel.value = F.estilo; else F.estilo = sel.value;
    const dsc = $("#dwProdEstiloDesc"); if (dsc && typeof ESTILOS_MUSICAIS !== "undefined") dsc.textContent = ESTILOS_MUSICAIS[sel.value] || "";
  }
  async function sugerirProducao() {
    const d = ($("#dwProdDesc").value || "").trim(); prodForm.descricao = d; if (!d) { prodMsg = "Descreva o que você quer primeiro."; return renderProd(); }
    prodOcupado = true; renderProd(); dica("Pensando na melhor combinação…");
    try { const fd = new FormData(); fd.append("descricao", d); const resp = await fetch(`${API_BASE}/api/producao/interpretar`, { method: "POST", body: fd }); if (!resp.ok) throw new Error("http " + resp.status); const j = await resp.json();
      if (j.estilo) prodForm.estilo = j.estilo; if ("com_baixo" in j) { prodForm.baixo = !!j.com_baixo; prodForm.bateria = !!j.com_bateria; prodForm.acordes = !!j.com_acordes; prodForm.teclado = !!j.com_teclado; prodForm.solo = !!j.com_solo; prodForm.pro = !!j.qualidade_pro; }
      prodMsg = `Sugestão da IA aplicada (${prodForm.estilo}). Revise e clique em “Gerar faixas”.`; }
    catch (e) { prodMsg = "Não consegui falar com a IA agora. Escolha o estilo e os instrumentos à mão."; }
    finally { prodOcupado = false; renderProd(); dica(prodMsg); }
  }
  async function gerarProducao() {
    const r = regiaoPorId(S.regiaoSel), F = prodForm; if (!r || r.gravando) { prodMsg = "Selecione uma região primeiro."; return renderProd(); }
    if (prodOcupado) return; if (!(F.baixo || F.bateria || F.acordes || F.teclado || F.solo)) { prodMsg = "Escolha ao menos um instrumento para gerar."; return renderProd(); }
    let bpmEnviar = 0; if (F.bpmModo === "projeto") bpmEnviar = S.bpm; else if (F.bpmModo === "manual") { bpmEnviar = +F.bpmManual; if (!(bpmEnviar >= 40 && bpmEnviar <= 220)) { prodMsg = "Digite um andamento entre 40 e 220 BPM, ou escolha outra opção."; return renderProd(); } }
    prodOcupado = true; prodMsg = ""; renderProd();
    try {
      dica("Preparando o áudio da região…"); const full = await renderizarRegiao(r, false), maxN = Math.round(120 * full.sampleRate), n = Math.min(full.length, maxN), enviado = ctx.createBuffer(full.numberOfChannels, n, full.sampleRate);
      for (let c = 0; c < full.numberOfChannels; c++) enviado.copyToChannel(full.getChannelData(c).subarray(0, n), c);
      const fd = new FormData(); fd.append("arquivo", new File([audioBufferParaWavBlob(enviado)], "regiao.wav", { type: "audio/wav" })); fd.append("estilo", F.estilo); fd.append("acordes_modo", F.modoAcordes);
      [["baixo", "com_baixo"], ["bateria", "com_bateria"], ["acordes", "com_acordes"], ["teclado", "com_teclado"], ["solo", "com_solo"], ["pro", "qualidade_pro"]].forEach(([k, nome]) => fd.append(nome, F[k] ? "true" : "false")); if (bpmEnviar) fd.append("bpm_manual", String(bpmEnviar));
      dica("Gerando o acompanhamento no servidor… pode levar alguns segundos."); let resp;
      try { resp = await fetch(`${API_BASE}/api/producao/camadas`, { method: "POST", body: fd }); } catch (e) { throw new Error("Não consegui falar com o servidor. Confira a conexão e tente de novo."); }
      if (!resp.ok) { let det = ""; try { det = (await resp.json()).detail || ""; } catch (e) { /* sem corpo */ } throw new Error(resp.status === 503 ? "O servidor está ocupado com outra tarefa pesada. Tente de novo em instantes." : (det || `O servidor respondeu com erro (${resp.status}).`)); }
      const cab = (k) => decodeURIComponent(resp.headers.get(k) || ""), bpm = parseFloat(cab("X-BPM")) || 0, tom = cab("X-Tom"), modo = cab("X-Modo"), acordes = cab("X-Acordes"), aviso = cab("X-Aviso"), avisoEstilo = cab("X-Aviso-Estilo"), estiloUsado = cab("X-Estilo") || F.estilo;
      const mapa = await lerZip(await resp.arrayBuffer()), antes = foto(), criadas = [];
      for (const [chave, rotulo] of PROD_CAMADAS) {
        const dados = mapa.get(chave + ".wav"); if (!dados) continue; const buf = await decodificar(dados.slice().buffer);
        const f = novaFaixa(`${rotulo} (${estiloUsado})`, undefined, { vol: 0.8 }), id = guardarAudio(buf, new Blob([dados], { type: "audio/wav" })); novaRegiao(f, id, rotulo, r.ini, 0, Math.min(buf.duration, r.dur)); criadas.push(rotulo);
      }
      if (!criadas.length) throw new Error("O servidor não devolveu nenhum instrumento.");
      if (F.ajustar && bpm) { S.bpm = Math.round(bpm); $("#dwBpm").value = S.bpm; if (tom) { S.tom = `${tom}${modo ? " " + modo : ""}`; $("#dwTom").textContent = S.tom; } }
      empilhar(antes); renderTudo(); atualizarNos();
      prodMsg = `Criei ${criadas.length} faixa${criadas.length === 1 ? "" : "s"}: ${criadas.join(", ")}. Detectado: ${bpm ? bpm.toFixed(0) + " BPM" : "andamento do projeto"}${tom ? " · Tom: " + tom + (modo ? " " + modo : "") : ""}${acordes ? " · Acordes: " + acordes : ""}.${full.length > maxN ? " A região passa de 2 minutos: o servidor usou só os 2 primeiros." : ""}${aviso ? " " + aviso : ""}${avisoEstilo ? " " + avisoEstilo : ""} Ctrl+Z desfaz tudo de uma vez.`;
    } catch (e) { prodMsg = (e && e.message) || "Não consegui gerar o acompanhamento."; }
    finally { prodOcupado = false; renderProd(); dica(prodMsg); }
  }
  function ligarEventosProd() {
    const el = $("#dwProd");
    el.addEventListener("input", (e) => { if (e.target.id === "dwProdDesc") prodForm.descricao = e.target.value; else if (e.target.id === "dwProdBpmManual") { prodForm.bpmManual = e.target.value; prodForm.bpmModo = "manual"; const rd = el.querySelector('input[name="dwProdBpm"][value="manual"]'); if (rd) rd.checked = true; } });
    el.addEventListener("change", (e) => { const t = e.target;
      if (t.dataset.pf) prodForm[t.dataset.pf] = t.checked; else if (t.id === "dwProdEstilo") { prodForm.estilo = t.value; const dsc = $("#dwProdEstiloDesc"); if (dsc && typeof ESTILOS_MUSICAIS !== "undefined") dsc.textContent = ESTILOS_MUSICAIS[t.value] || ""; }
      else if (t.id === "dwProdModoAc") prodForm.modoAcordes = t.value; else if (t.name === "dwProdBpm") prodForm.bpmModo = t.value; });
    el.addEventListener("click", (e) => { if (e.target.id === "dwProdGerar") gerarProducao(); else if (e.target.id === "dwProdIA") sugerirProducao(); });
  }

  // ══ SINCRONIA FINA DA REGIÃO ═══
  function moverRegiaoMs(r, ms) {
    const d = ms / 1000; let consumiu = 0;
    mudar(() => { let novo = r.ini + d; if (novo < 0) { const c = -novo; if (c < r.dur - 0.05) { r.off += c; if (r.alt) r.alt.off += c; r.dur -= c; consumiu = c; } novo = 0; } r.ini = Math.round(novo * 1000) / 1000; });
    dica(`Região em ${r.ini.toFixed(3)} s (${ms > 0 ? "+" : ""}${ms} ms)${consumiu ? ` — passou do começo do projeto, então cortei ${(consumiu * 1000).toFixed(0)} ms do início do áudio` : ""}.`);
  }
  function acaoSinc(r, a) {
    if (a === "aplicar") { const v = +($("#dwSincMs") || { value: 0 }).value || 0; if (v) moverRegiaoMs(r, v); }
    else if (a === "cursor") { mudar(() => { r.ini = Math.round(S.tAtual * 1000) / 1000; }); dica(`Região alinhada ao cursor (${r.ini.toFixed(3)} s).`); }
    else if (a === "loop") definirLoop(r.ini, r.ini + r.dur, true);
    else if (a === "loopoff") { S.loop.on = false; desenharLoop(); dica("Loop desligado."); }
    else if (a === "batida") { mudar(() => { r.ini = Math.round((Math.round(r.ini / beatDur()) * beatDur()) * 1000) / 1000; }); dica(`Região encaixada na batida mais próxima (${r.ini.toFixed(3)} s).`); }
    else moverRegiaoMs(r, +a);
  }

  // ══ CALIBRAR O ATRASO DO EQUIPAMENTO ═══
  // Toca cliques e procura cada um na gravação (correlação com o formato do clique). Devolve o atraso de cada um e se a medida é confiável.
  function medirAtrasoDeCliques(x, sr, tempos) {
    const L = Math.round(0.012 * sr), tpl = new Float32Array(L); for (let i = 0; i < L; i++) tpl[i] = Math.sin((2 * Math.PI * 2500 * i) / sr) * (0.5 - 0.5 * Math.cos((2 * Math.PI * (i + 0.5)) / L));
    const atrasos = [];
    for (const te of tempos) {
      const ini = Math.max(0, Math.floor((te - 0.03) * sr)), fim = Math.min(x.length - L, Math.floor((te + 0.5) * sr)); if (fim <= ini) continue;   // procura até 500 ms depois (os cliques estão a 600 ms um do outro)
      const c = new Float32Array(fim - ini); let melhor = 0, soma = 0;
      for (let k = ini; k < fim; k++) { let v = 0; for (let i = 0; i < L; i++) v += x[k + i] * tpl[i]; v = Math.abs(v); c[k - ini] = v; soma += v; if (v > melhor) melhor = v; }
      if (melhor < 6 * (soma / c.length) || melhor < 1e-4) continue;   // sem um pico claro: este clique não foi ouvido direito
      let k = 0; while (c[k] < 0.6 * melhor) k++;                      // a PRIMEIRA chegada forte (num ambiente com eco, um reflexo pode ser mais forte que o som direto)...
      let topo = k; for (let j = k; j < Math.min(c.length, k + (L >> 1)); j++) if (c[j] > c[topo]) topo = j;   // ...e o ponto mais alto dela
      atrasos.push((ini + topo) / sr - te);
    }
    const o = atrasos.slice().sort((a, b) => a - b), mediana = o.length ? o[o.length >> 1] : null, desvio = o.length ? o[o.length - 1] - o[0] : null;
    return { atrasos, mediana, desvio, ok: o.length >= 4 && desvio < 0.02 };
  }
  async function calibrarAtraso() {
    const res = $("#dwCalRes"), btn = $("#dwCalIniciar"); if (S.gravando || S.contando) { res.textContent = "Pare a gravação antes de calibrar."; return; }
    if (!garantirAudio()) { res.textContent = "Este navegador não toca áudio aqui."; return; } if (S.tocando) pausar();
    let stream; try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }); } catch (e) { res.textContent = "Não consegui usar o microfone. Libere o acesso ao microfone neste site e tente de novo."; return; }
    btn.disabled = true; res.textContent = "Tocando 6 cliques e ouvindo… fique em silêncio."; const tempos = [0.9, 1.5, 2.1, 2.7, 3.3, 3.9], partes = [];
    try {
      const tipo = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t)), rec = new MediaRecorder(stream, tipo ? { mimeType: tipo } : undefined);
      rec.ondataavailable = (ev) => { if (ev.data.size) partes.push(ev.data); }; rec.start(); const t0 = ctx.currentTime;   // a gravação e o toque começam juntos, como numa gravação de verdade
      tempos.forEach((t) => { const o = ctx.createOscillator(), g = ctx.createGain(), q = t0 + t; o.frequency.value = 2500; g.gain.setValueAtTime(0.0001, q); g.gain.linearRampToValueAtTime(0.9, q + 0.0015); g.gain.exponentialRampToValueAtTime(0.0001, q + 0.012); o.connect(g); g.connect(ctx.destination); o.start(q); o.stop(q + 0.02); });
      await new Promise((ok) => setTimeout(ok, (tempos[tempos.length - 1] + 1.1) * 1000));
      const fim = new Promise((ok) => { rec.onstop = ok; }); rec.stop(); await fim; stream.getTracks().forEach((tr) => tr.stop());
      const buf = await decodificar(await new Blob(partes).arrayBuffer()), x = new Float32Array(buf.length); for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < x.length; i++) x[i] += d[i] / buf.numberOfChannels; }
      const m = medirAtrasoDeCliques(x, buf.sampleRate, tempos);
      if (m.ok) { const ms = Math.max(0, Math.min(500, Math.round(m.mediana * 1000))); S.latencia = ms; $("#dwLat").value = ms; try { localStorage.setItem("oh-dw-lat", ms); } catch (e) { /* sem armazenamento */ } res.innerHTML = `<b>Atraso medido: ${ms} ms</b> (os 6 cliques variaram só ${(m.desvio * 1000).toFixed(1)} ms). Já coloquei no campo “Atraso”: as próximas gravações nascem alinhadas com a música.`; dica(`Atraso do equipamento: ${ms} ms, já aplicado nas próximas gravações.`); }
      else res.textContent = `Não consegui medir com segurança (ouvi ${m.atrasos.length} de 6 cliques${m.desvio != null ? `, variando ${(m.desvio * 1000).toFixed(0)} ms` : ""}). Aproxime o microfone do fone ou da caixa de som, suba o volume, fique em silêncio e tente de novo.`;
    } catch (e) { res.textContent = "A calibração falhou: " + ((e && e.message) || "erro inesperado") + "."; try { stream.getTracks().forEach((tr) => tr.stop()); } catch (e2) { /* já parou */ } }
    finally { btn.disabled = false; }
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
    try { S.metro = localStorage.getItem("oh-dw-metro") || "off"; S.contagem = +(localStorage.getItem("oh-dw-contagem") ?? 1); S.latencia = +(localStorage.getItem("oh-dw-lat") || 0); S.monitor = localStorage.getItem("oh-dw-monitor") === "fone" ? "fone" : "caixa"; } catch (e) { /* sem armazenamento */ }
    $("#dwMetro").value = S.metro; $("#dwMetroBtn").classList.toggle("on", S.metro !== "off"); $("#dwContagem").value = String(S.contagem); $("#dwLat").value = S.latencia; $("#dwMonitor").value = S.monitor;
    usarFerramenta("sel"); ajustarModoInicial(); renderTudo();
  }
  window.EstudioDaw = {
    aoAbrir,
    _teste: {
      pilhaN: () => pilha.length,
      sm: { listar: () => amostras.map((a) => ({ id: a.id, nome: a.nome, dur: a.dur, canais: a.canais })), carregar: carregarAmostras, criar: criarAmostra, importar: importarAmostra, inserir: inserirAmostra, tocar: tocarAmostra, excluir: excluirAmostra, renomear: renomearAmostra, renderizarRegiao, taxa: smTaxa, semisDaTecla, sel: () => smSel }, bufs, renderVoz, aplicarEdicaoVoz, interpretarLocal, renderProd, gerarProducao, zip: { criar: criarZip, ler: lerZip, crc: crc32 }, mp3: audioBufferParaMp3Blob, exportarProjetoArquivo, abrirProjetoArquivo, definirLoop, alternarLoop, desenharLoop, exportarAgora, cadeiaDe: (id) => { const n = nos.get(id); return n && n.cadeia ? { assinatura: n.cadeia.assinatura, itens: [...n.cadeia.itens.keys()], reducao: [...n.cadeia.itens.values()].map((i) => i.reducao) } : null; }, fxOk: () => fxOk, renderFx, moverRegiaoMs, medirAtrasoDeCliques, acaoSinc,
      afin: () => afin, aplicarAfinacao, prepararAfinacao, limparRegiao, modoSep, salvarProjeto, listarProjetos, abrirProjeto, S, bufs, picos, foto, desfazer, refazer, renderizarMixagem, importarAudio, aplicarSeparacao, garantirAudio,
      fontes: () => fontes.length, cliques: () => cliquesTotal, cliqueLog: () => cliqueLog.slice(),
      ganhoDe: (id) => { const n = nos.get(id); return n ? n.gain.gain.value : null; },
      nivelDe: (id) => { const n = nos.get(id); return n ? nivel(n.an) : null; },
      metas: () => ({ ctxEstado: ctx && ctx.state, sr: ctx && ctx.sampleRate }),
    },
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar); else iniciar();
})();
