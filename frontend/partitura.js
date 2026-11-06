// ══════════════════════════════════════════════════════════════════════════
// partitura.js — Aba Partitura (ABC Studio)
//
// Como usar na tela:
//   • Clique numa nota: ela fica VERMELHA (selecionada).
//   • Clique numa linha ou espaço da pauta: a nota selecionada vai para lá
//     (a nota ajustada fica AZUL).
//   • Botão de play flutuante: toca a partir da nota selecionada (ou o trecho).
//   • "Selecionar trecho" (ou Shift + clique numa segunda nota): marca um trecho
//     em VERDE, e o play toca só aquele pedaço.
//
// Tudo roda no navegador (abcjs). Sem IA, sem servidor e sem gastar cota.
// ══════════════════════════════════════════════════════════════════════════
(function () {
  const K_ATUAL = "oh-partitura-atual";
  const K_ORIGINAL = "oh-partitura-original";
  const K_ULTIMA = "oh-partitura-ultima";     // última extraída: reaproveitar sem gastar IA
  const K_TIMBRE = "oh-partitura-timbre";
  const PAGINA = "page-partitura";

  const TIMBRES = [
    { n: 0, nome: "Piano" },
    { n: 24, nome: "Violão de nylon" },
    { n: 25, nome: "Violão de aço" },
    { n: 40, nome: "Violino" },
    { n: 48, nome: "Cordas" },
    { n: 73, nome: "Flauta" },
  ];

  const $ = (id) => document.getElementById(id);
  const LETRAS = "CDEFGAB";

  // ── estado ───────────────────────────────────────────────────────────────
  let visual = null;               // partitura desenhada (abcjs)
  let controle = null;             // SynthController do abcjs (play, pausa, seek)
  let notas = [];                  // notas da partitura: { inicio, fim, rest, svg }
  let porInicio = new Map();       // posição no texto -> nota
  let ordemPorInicio = new Map();  // posição no texto -> ordem no tempo
  let selecao = null;              // posição (no texto ABC) da nota vermelha
  let trecho = null;               // { de, ate }: trecho verde
  let modoTrecho = false;          // esperando a nota final do trecho
  let editadas = new Set();        // notas ajustadas (azul)
  let historico = [];              // para o "Desfazer"
  let retomar = false;             // true: o próximo play continua de onde pausou
  let fimTrechoMs = null;          // quando tocar um trecho: onde parar
  let areaEditada = false;
  let ultimaRolagemUsuario = 0;
  let ultimoFim = 0;
  let marcados = [];               // notas em destaque durante o play
  let timerDigitando = null;
  let botaoEstado = "";
  let toqueEmNotaAte = 0;          // celular: o toque numa nota gera um 'clique' extra logo depois; ele deve ser ignorado

  // ── armazenamento ────────────────────────────────────────────────────────
  function lerStorage(chave) { try { return localStorage.getItem(chave) || ""; } catch (e) { return ""; } }
  function gravarStorage(chave, valor) { try { localStorage.setItem(chave, valor); } catch (e) { /* sem armazenamento */ } }

  function status(texto, tipo) {
    const el = $("partituraStatus");
    if (!el) return;
    el.textContent = texto;
    el.dataset.tipo = tipo || "info";
  }

  // ══ 1. LÓGICA DA NOTA (pura, testável) ═══════════════════════════════════

  // Separa o texto de uma nota ABC em: prefixo (acorde de cifra, decoração),
  // acidente, letra, marcas de oitava e o resto (duração, ligadura...).
  function separarNota(token) {
    let i = 0;
    for (;;) {
      const c = token[i];
      if (c === '"' || c === "!" || c === "+") {
        const f = token.indexOf(c, i + 1);
        if (f < 0) return null;
        i = f + 1;
      } else if (c === "{") {
        const f = token.indexOf("}", i + 1);
        if (f < 0) return null;
        i = f + 1;
      } else if (c === "(") {
        const m = /^\(\d+(?::\d+){0,2}/.exec(token.slice(i));
        if (!m) return null;
        i += m[0].length;
      } else if (c && ".~HLMOPSTuv".indexOf(c) >= 0) {
        i += 1;
      } else break;
    }
    const m = /^(\^\^|\^|__|_|=)?([A-Ga-g])([,']*)([\s\S]*)$/.exec(token.slice(i));
    if (!m) return null;
    return { prefixo: token.slice(0, i), acidente: m[1] || "", letra: m[2], marcas: m[3], resto: m[4] };
  }

  function oitavaDe(p) {
    let o = p.letra === p.letra.toUpperCase() ? 4 : 5;
    for (const ch of p.marcas) o += ch === "'" ? 1 : -1;
    return o;
  }

  // Move a nota 'passos' linhas/espaços da pauta (positivo = para cima).
  // O acidente é retirado: a nota passa a seguir a armadura da tonalidade.
  function moverToken(token, passos) {
    const p = separarNota(token);
    if (!p) return null;
    const abs = oitavaDe(p) * 7 + LETRAS.indexOf(p.letra.toUpperCase()) + passos;
    const oitava = Math.floor(abs / 7);
    if (oitava < 2 || oitava > 7) return null;
    const letra = LETRAS[((abs % 7) + 7) % 7];
    const nova = oitava >= 5 ? letra.toLowerCase() + "'".repeat(oitava - 5) : letra + ",".repeat(4 - oitava);
    return p.prefixo + nova + p.resto;
  }

  // Nome legível: "d'4" -> "D5"
  function nomeDaNota(token) {
    const p = separarNota(token);
    if (!p) return token;
    const acid = p.acidente.indexOf("^") >= 0 ? "#" : p.acidente.indexOf("_") >= 0 ? "b" : "";
    return p.letra.toUpperCase() + acid + oitavaDe(p);
  }

  // ══ 2. DESENHO, SELEÇÃO E CORES ══════════════════════════════════════════

  function limparEstado() {
    selecao = null; trecho = null; modoTrecho = false; fimTrechoMs = null;
    editadas = new Set(); historico = []; retomar = false;
  }

  function renderizar() {
    const area = $("partituraAbc");
    const alvo = $("partituraSvg");
    const abc = area.value;                       // sem trim: as posições do abcjs precisam bater com o texto
    visual = null; notas = []; porInicio = new Map(); ordemPorInicio = new Map();
    limparDestaque();
    if (!abc.trim()) {
      alvo.innerHTML = `<p class="oh-hint" style="color:#555">Nenhuma partitura carregada. Gere a melodia na aba Songwriter, ou cole um texto ABC em "Editar texto ABC".</p>`;
      status("Aguardando partitura.", "info");
      prepararSom();
      atualizarBotaoPlay(true);
      return false;
    }
    try {
      alvo.innerHTML = "";
      const tunes = window.ABCJS.renderAbc(alvo, abc, { responsive: "resize", add_classes: true, clickListener: aoClicarAbcjs });
      if (!tunes || !tunes.length || !tunes[0].lines || !tunes[0].lines.length) throw new Error("Nenhuma música encontrada no texto.");
      visual = tunes[0];
    } catch (erro) {
      alvo.innerHTML = "";
      status("Não consegui ler esse texto ABC. Confira as linhas X:, M:, L:, K: e as notas. " + (erro.message || ""), "erro");
      prepararSom();
      atualizarBotaoPlay(true);
      return false;
    }
    mapearNotas();
    pintar();
    prepararSom();
    atualizarBotaoPlay(true);
    return true;
  }

  // Lista as notas desenhadas e a ordem delas no tempo (para o trecho)
  function mapearNotas() {
    const sels = (visual.engraver && visual.engraver.selectables) || [];
    sels.forEach((s) => {
      const e = s.absEl && s.absEl.abcelem;
      if (!e || e.el_type !== "note" || e.startChar == null) return;
      const n = { inicio: e.startChar, fim: e.endChar, rest: !!e.rest, svg: s.svgEl };
      notas.push(n);
      porInicio.set(n.inicio, n);
    });
    try {
      const t = new window.ABCJS.TimingCallbacks(visual, {});
      (t.noteTimings || []).forEach((ev, idx) => {
        if (ev.type !== "event") return;
        (ev.startCharArray || [ev.startChar]).forEach((sc) => { if (sc != null && !ordemPorInicio.has(sc)) ordemPorInicio.set(sc, idx); });
      });
    } catch (e) { /* sem ordem: o trecho cai para a ordem de desenho */ }
  }

  function limitesDoTrecho() {
    if (!trecho) return null;
    const a = ordemPorInicio.get(trecho.de), b = ordemPorInicio.get(trecho.ate);
    if (a == null || b == null) return null;
    return { a: Math.min(a, b), b: Math.max(a, b) };
  }

  // Vermelho = selecionada · Verde = trecho · Azul = ajustada
  function pintar() {
    const lim = limitesDoTrecho();
    notas.forEach((n) => {
      const ord = ordemPorInicio.get(n.inicio);
      n.svg.classList.toggle("oh-nota-sel", selecao === n.inicio);
      n.svg.classList.toggle("oh-nota-trecho", !!lim && ord != null && ord >= lim.a && ord <= lim.b);
      n.svg.classList.toggle("oh-nota-editada", editadas.has(n.inicio));
    });
    const bt = $("partituraTrecho");
    if (bt) {
      bt.classList.toggle("oh-ativo", modoTrecho);
      bt.textContent = modoTrecho ? "Clique na última nota do trecho" : "Selecionar trecho";
    }
  }

  function limparDestaque() {
    marcados.forEach((el) => el.classList.remove("abcjs-highlight"));
    marcados = [];
  }

  // ══ 3. CLIQUES ═══════════════════════════════════════════════════════════

  // O abcjs também avisa quando o clique foi PERTO de uma nota. Só vale o clique
  // em cima dela; o resto é clique na pauta (tratado em aoClicarPauta).
  function aoClicarAbcjs(abcElem, tuneNumber, classes, analysis, drag, mouseEvent) {
    try {
      const alvo = mouseEvent && mouseEvent.target;
      if (!alvo || !alvo.closest || !alvo.closest("[data-index]")) return;
      if (!abcElem || abcElem.el_type !== "note" || abcElem.startChar == null) return;
      cliqueNaNota(abcElem.startChar, !!mouseEvent.shiftKey);
    } catch (erro) {
      status("Não consegui selecionar essa nota: " + (erro.message || erro), "erro");
    }
  }

  async function cliqueNaNota(inicio, shift) {
    const nota = porInicio.get(inicio);
    if (!nota) return;
    await pausarAudio();
    // segunda nota de um trecho
    if ((modoTrecho || shift) && selecao != null && selecao !== inicio) {
      trecho = { de: selecao, ate: inicio };
      modoTrecho = false; fimTrechoMs = null; retomar = false;
      pintar();
      status("Trecho marcado em verde. Aperte o play para ouvir só esse pedaço.", "ok");
      return;
    }
    selecao = inicio; trecho = null; fimTrechoMs = null; retomar = false;
    pintar();
    if (modoTrecho) { status("Agora clique na última nota do trecho.", "info"); return; }
    const token = $("partituraAbc").value.slice(nota.inicio, nota.fim);
    status(nota.rest
      ? "Pausa selecionada. O play toca a partir daqui."
      : `Nota ${nomeDaNota(token)} selecionada. Clique numa linha ou espaço da pauta para mudar a altura, ou aperte o play.`, "info");
  }

  // Altura (em pixels) de um passo da pauta: metade da distância entre duas linhas
  function passoDaPauta(grupo) {
    const ys = [...grupo.querySelectorAll("path")].map((p) => { const r = p.getBoundingClientRect(); return r.top + r.height / 2; }).sort((a, b) => a - b);
    if (ys.length < 2) return 0;
    return (ys[ys.length - 1] - ys[0]) / (2 * (ys.length - 1));
  }

  // A pauta (as 5 linhas) onde está a nota: mesma linha de partitura e mais próxima
  function pautaDaNota(nota, yNota) {
    const m = /abcjs-l(\d+)/.exec(nota.svg.getAttribute("class") || "");
    const raiz = nota.svg.ownerSVGElement || document;
    const cand = [...raiz.querySelectorAll(m ? `.abcjs-staff.abcjs-l${m[1]}` : ".abcjs-staff")];
    let melhor = null, dist = Infinity;
    cand.forEach((g) => { const r = g.getBoundingClientRect(); const d = Math.abs(r.top + r.height / 2 - yNota); if (d < dist) { dist = d; melhor = g; } });
    return melhor;
  }

  // Clique na pauta (fora de qualquer nota): a nota vermelha vai para essa linha/espaço
  function aoClicarPauta(ev) {
    if (Date.now() < toqueEmNotaAte) return;                               // sobra do toque numa nota (celular)
    if (ev.target.closest && ev.target.closest("[data-index]")) return;   // foi numa nota
    if (selecao == null || !visual) return;
    const nota = porInicio.get(selecao);
    if (!nota || !nota.svg.isConnected) return;
    if (nota.rest) { status("Pausas não têm altura. Selecione uma nota.", "info"); return; }
    const texto = $("partituraAbc").value;
    const token = texto.slice(nota.inicio, nota.fim);
    if (!separarNota(token)) { status("Esse trecho é um acorde ou um grupo de notas. Selecione uma nota simples.", "erro"); return; }

    const cabeca = nota.svg.querySelector(".abcjs-notehead") || nota.svg;
    const rc = cabeca.getBoundingClientRect();
    const yNota = rc.top + rc.height / 2;
    const pauta = pautaDaNota(nota, yNota);
    if (!pauta) return;
    const passo = passoDaPauta(pauta);
    if (!passo) return;
    const pr = pauta.getBoundingClientRect();
    if (ev.clientX < pr.left - 6 || ev.clientX > pr.right + 6) return;                 // fora da pauta
    if (ev.clientY < pr.top - 8 * passo || ev.clientY > pr.bottom + 8 * passo) return; // longe demais
    const delta = Math.round((yNota - ev.clientY) / passo);
    if (delta === 0) return;
    const novo = moverToken(token, delta);
    if (!novo) { status("Essa nota não pode ir tão longe.", "erro"); return; }
    aplicarEdicao(nota, token, novo);
  }

  // Troca o texto da nota, atualiza as posições das outras notas e redesenha
  function aplicarEdicao(nota, token, novo) {
    const area = $("partituraAbc");
    historico.push({ texto: area.value, editadas: [...editadas], selecao, trecho: trecho ? { ...trecho } : null });
    if (historico.length > 50) historico.shift();
    const dif = novo.length - token.length;
    const mover = (p) => (p > nota.inicio ? p + dif : p);
    area.value = area.value.slice(0, nota.inicio) + novo + area.value.slice(nota.fim);
    editadas = new Set([...editadas].map(mover));
    editadas.add(nota.inicio);
    if (trecho) trecho = { de: mover(trecho.de), ate: mover(trecho.ate) };
    gravarStorage(K_ATUAL, area.value);
    areaEditada = false; retomar = false; fimTrechoMs = null;
    renderizar();
    status(`Nota ${nomeDaNota(token)} → ${nomeDaNota(novo)}. Aperte o play para ouvir a partir dela.`, "ok");
  }

  function desfazer() {
    const h = historico.pop();
    if (!h) { status("Nada para desfazer.", "info"); return; }
    $("partituraAbc").value = h.texto;
    editadas = new Set(h.editadas); selecao = h.selecao; trecho = h.trecho;
    gravarStorage(K_ATUAL, h.texto);
    retomar = false; fimTrechoMs = null;
    const resto = historico;
    renderizar();
    historico = resto;
    status("Última mudança desfeita.", "ok");
  }

  function limparSelecao() {
    selecao = null; trecho = null; modoTrecho = false; fimTrechoMs = null; retomar = false;
    pintar();
    status("Seleção limpa. O play toca a música inteira.", "info");
  }

  function alternarModoTrecho() {
    modoTrecho = !modoTrecho;
    pintar();
    if (!modoTrecho) { status("Seleção de trecho cancelada.", "info"); return; }
    status(selecao != null
      ? "Clique na última nota do trecho."
      : "Clique na primeira nota do trecho e depois na última.", "info");
  }

  // ══ 4. SOM (play, pausa, seek, trecho) ═══════════════════════════════════
  // Atenção ao abcjs: (1) controle.play() é um INTERRUPTOR (toca/pausa);
  // (2) trocar a partitura NÃO recarrega o áudio sozinho: o som continuaria a
  // versão antiga. Por isso prepararSom() descarta o áudio a cada mudança.

  function tocando() { return !!(controle && controle.isStarted); }
  function timbreAtual() { const n = parseInt(lerStorage(K_TIMBRE), 10); return TIMBRES.some((t) => t.n === n) ? n : 0; }

  function prepararSom() {
    if (!controle) return;
    try { controle.destroy(); } catch (e) { /* ainda sem áudio criado */ }
    controle.isLoaded = false; controle.isLoading = false; controle.isStarted = false;
    if (visual) { try { controle.setTune(visual, false, { program: timbreAtual(), chordsOff: false }); } catch (e) { /* tenta de novo no play */ } }
  }

  async function garantirAudio() {
    if (!controle || !visual) return false;
    if (!controle.isLoaded) {
      status("Carregando o som…", "info");
      await controle.go();
    }
    return true;
  }

  async function pausarAudio() {
    if (controle && controle.isStarted) { try { await controle.play(); } catch (e) { /* já parado */ } }
    atualizarBotaoPlay(true);
  }

  // Evento (tempo) de uma nota, no relógio do próprio áudio
  function eventoDaNota(inicio) {
    const t = controle && controle.timer;
    const evs = t && t.noteTimings;
    if (!evs) return null;
    for (let i = 0; i < evs.length; i++) {
      const e = evs[i];
      if (e.type !== "event") continue;
      if (e.startChar === inicio || (e.startCharArray && e.startCharArray.indexOf(inicio) >= 0)) return { i, e, evs };
    }
    return null;
  }

  // Posição de início (e fim, se for trecho) em milissegundos
  function alvoDeInicio() {
    if (trecho) {
      const a = eventoDaNota(trecho.de), b = eventoDaNota(trecho.ate);
      if (a && b) {
        const primeiro = a.i <= b.i ? a : b, ultimo = a.i <= b.i ? b : a;
        const prox = ultimo.evs[ultimo.i + 1];
        return { ms: primeiro.e.milliseconds, paradaMs: prox ? prox.milliseconds : null };
      }
    }
    if (selecao != null) {
      const a = eventoDaNota(selecao);
      if (a) return { ms: a.e.milliseconds, paradaMs: null };
    }
    return null;
  }

  // Muda a posição do áudio e do cursor ao mesmo tempo (mesma unidade: segundos)
  function irPara(ms) {
    const t = controle.timer;
    controle.seek(ms / 1000, "seconds");
    controle.setProgress(t && t.lastMoment ? Math.min(1, ms / t.lastMoment) : 0, t ? t.lastMoment : 0);
  }

  async function iniciar() {
    if (!visual || !controle) { status("Carregue uma partitura primeiro.", "erro"); return; }
    try {
      if (!(await garantirAudio())) return;
      if (!retomar) {
        const alvo = alvoDeInicio();
        if (alvo) { irPara(alvo.ms); fimTrechoMs = alvo.paradaMs; }
        else fimTrechoMs = null;
      }
      retomar = false;
      if (!controle.isStarted) await controle.play();
      status(trecho ? "Tocando o trecho selecionado." : selecao != null ? "Tocando a partir da nota selecionada." : "Tocando a música.", "ok");
    } catch (erro) {
      status("Não consegui tocar. Os timbres vêm de fora do app, confira a conexão. " + (erro && erro.message ? erro.message : ""), "erro");
    }
    atualizarBotaoPlay(true);
  }

  async function alternarPlay() {
    if (tocando()) { await pausarAudio(); retomar = true; return; }
    await iniciar();
  }

  async function terminarTrecho() {
    fimTrechoMs = null;
    await pausarAudio();
    retomar = false;
    limparDestaque();
    status("Trecho terminado. Aperte o play para ouvir de novo.", "ok");
  }

  // Acompanha a nota que está tocando dentro da caixa de rolagem (sem puxar a página)
  function seguirNota(ev) {
    const papel = $("partituraPapel");
    if (!papel || Date.now() - ultimaRolagemUsuario < 4000) return;
    const el = ev.elements && ev.elements[0] && ev.elements[0][0];
    if (!el || !el.getBoundingClientRect) return;
    const r = el.getBoundingClientRect(), p = papel.getBoundingClientRect(), margem = 40;
    if (r.top < p.top + margem || r.bottom > p.bottom - margem) papel.scrollTop += (r.top - p.top) - p.height / 3;
    if (r.left < p.left + margem || r.right > p.right - margem) papel.scrollLeft += (r.left - p.left) - p.width / 3;
  }

  const cursor = {
    onStart() { limparDestaque(); },
    onFinished() { limparDestaque(); fimTrechoMs = null; retomar = false; ultimoFim = Date.now(); atualizarBotaoPlay(true); },
    onEvent(ev) {
      limparDestaque();
      (ev.elements || []).forEach((grupo) => (grupo || []).forEach((el) => { el.classList.add("abcjs-highlight"); marcados.push(el); }));
      seguirNota(ev);
      if (fimTrechoMs != null && ev.milliseconds >= fimTrechoMs) terminarTrecho();
    },
  };

  function prepararControle() {
    const transporte = $("partituraTransporte");
    if (!transporte || !window.ABCJS || !window.ABCJS.synth) return;
    controle = new window.ABCJS.synth.SynthController();
    controle.load(transporte, cursor, { displayPlay: true, displayRestart: true, displayProgress: true, displayWarp: true, displayLoop: false, displayClock: false });
  }

  // Botão de play flutuante: mostra play ou pausa conforme o estado do áudio
  function atualizarBotaoPlay(forcar) {
    const b = $("partituraFlutuante");
    if (!b) return;
    const t = tocando();
    // pausou por fora (barra do abcjs): o próximo play continua de onde parou
    if (botaoEstado === "tocando" && !t && Date.now() - ultimoFim > 1000) retomar = true;
    const estado = (visual ? "ativo" : "oculto") + ":" + (t ? "tocando" : "parado");
    b.hidden = !visual;
    if (!forcar && estado.split(":")[1] === botaoEstado && b.dataset.estado === estado) return;
    botaoEstado = t ? "tocando" : "parado";
    b.dataset.estado = estado;
    b.innerHTML = window.ICONE ? window.ICONE(t ? "pausa" : "play") : (t ? "⏸" : "▶");
    b.setAttribute("aria-label", t ? "Pausar" : "Tocar");
    b.classList.toggle("oh-tocando", t);
  }

  // ══ 5. SALVAR, RESTAURAR, ENVIAR ═════════════════════════════════════════

  function salvar() {
    const abc = $("partituraAbc").value;
    gravarStorage(K_ATUAL, abc);
    gravarStorage(K_ULTIMA, abc);
    areaEditada = false;
    status("Correção salva neste aparelho.", "ok");
  }

  function restaurarOriginal() {
    const original = lerStorage(K_ORIGINAL);
    if (!original) { status("Não há partitura original guardada.", "erro"); return; }
    $("partituraAbc").value = original;
    gravarStorage(K_ATUAL, original);
    areaEditada = false;
    limparEstado();
    renderizar();
    status("Partitura original restaurada.", "ok");
  }

  function carregarUltima() {
    const ultima = lerStorage(K_ULTIMA);
    if (!ultima) { status("Não há partitura anterior guardada.", "erro"); return; }
    $("partituraAbc").value = ultima;
    gravarStorage(K_ATUAL, ultima);
    gravarStorage(K_ORIGINAL, ultima);
    areaEditada = false;
    limparEstado();
    renderizar();
    status("Última partitura extraída carregada, sem gastar IA.", "ok");
  }

  function usarNoSongwriter() {
    const abc = $("partituraAbc").value.trim();
    if (!abc) { status("Não há partitura para enviar.", "erro"); return; }
    gravarStorage(K_ATUAL, abc);
    areaEditada = false;
    document.dispatchEvent(new CustomEvent("oh-partitura-para-songwriter", { detail: abc }));
    const botao = document.querySelector('[data-page="songwriter"]');
    if (botao) botao.click();
  }

  // Ao abrir a aba, carrega a partitura mais recente sem apagar uma edição em andamento
  function carregarSeNecessario() {
    const salvo = lerStorage(K_ATUAL);
    const area = $("partituraAbc");
    if (!area) return;
    if (!areaEditada && salvo && area.value !== salvo) {
      area.value = salvo;
      limparEstado();
      renderizar();
    } else if (!area.value && !salvo) {
      renderizar();
    }
  }

  // ══ 6. INÍCIO ════════════════════════════════════════════════════════════

  function montarTimbres() {
    const sel = $("partituraTimbre");
    if (!sel || sel.dataset.pronto) return;
    sel.innerHTML = TIMBRES.map((t) => `<option value="${t.n}">${t.nome}</option>`).join("");
    sel.value = String(timbreAtual());
    sel.addEventListener("change", async () => {
      gravarStorage(K_TIMBRE, sel.value);
      await pausarAudio();
      prepararSom();
    });
    sel.dataset.pronto = "1";
  }

  function iniciarAba() {
    const area = $("partituraAbc");
    if (!area) return;

    // Ao abrir ou atualizar a página, a partitura começa vazia, como o Songwriter.
    // A última extraída fica guardada para reaproveitar sem gastar IA.
    try {
      const atual = localStorage.getItem(K_ATUAL);
      if (atual) localStorage.setItem(K_ULTIMA, atual);
      localStorage.removeItem(K_ATUAL);
      localStorage.removeItem(K_ORIGINAL);
    } catch (e) { /* sem armazenamento */ }
    const botaoUltima = $("partituraCarregarUltima");
    if (botaoUltima) {
      botaoUltima.hidden = !lerStorage(K_ULTIMA);
      botaoUltima.addEventListener("click", carregarUltima);
    }

    montarTimbres();
    prepararControle();

    area.addEventListener("input", () => {            // digitou no texto ABC: as posições mudam
      areaEditada = true;
      limparEstado();
      clearTimeout(timerDigitando);
      timerDigitando = setTimeout(renderizar, 400);
    });

    $("partituraSvg").addEventListener("click", aoClicarPauta);
    $("partituraSvg").addEventListener("touchend", (ev) => {
      toqueEmNotaAte = ev.target.closest && ev.target.closest("[data-index]") ? Date.now() + 800 : 0;
    }, { passive: true, capture: true });
    $("partituraTrecho").addEventListener("click", alternarModoTrecho);
    $("partituraLimpar").addEventListener("click", limparSelecao);
    $("partituraDesfazer").addEventListener("click", desfazer);
    $("partituraSalvar").addEventListener("click", salvar);
    $("partituraRestaurar").addEventListener("click", restaurarOriginal);
    $("partituraSongwriter").addEventListener("click", usarNoSongwriter);
    $("partituraFlutuante").addEventListener("click", alternarPlay);

    const papel = $("partituraPapel");
    ["wheel", "touchmove", "pointerdown", "keydown"].forEach((ev) => papel.addEventListener(ev, () => { ultimaRolagemUsuario = Date.now(); }, { passive: true }));

    const pagina = $(PAGINA);
    if (pagina) {
      new MutationObserver(() => {
        if (pagina.classList.contains("oh-page-ativa")) carregarSeNecessario();
        else pausarAudio();
      }).observe(pagina, { attributes: true, attributeFilter: ["class"] });
    }
    setInterval(() => atualizarBotaoPlay(false), 300);
    carregarSeNecessario();
    atualizarBotaoPlay(true);
  }

  // Pequena porta para os testes automáticos (não é usada pelo app)
  window.Partitura = {
    _teste: {
      separarNota, moverToken, nomeDaNota,
      estado: () => ({ selecao, trecho, modoTrecho, editadas: [...editadas], historico: historico.length, retomar, fimTrechoMs, notas: notas.length, tocando: tocando() }),
      controle: () => controle,
      renderizar,
    },
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciarAba);
  else iniciarAba();
})();
