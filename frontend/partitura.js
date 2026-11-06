// ══════════════════════════════════════════════════════════════════════════
// partitura.js — Aba Partitura (ABC Studio)
//
// Como usar na tela:
//   • Clique numa nota: ela fica VERMELHA (selecionada).
//   • Clique numa linha ou espaço da pauta: a nota selecionada vai para lá
//     (a nota ajustada fica AZUL).
//   • Clicar numa nota já TOCA a música a partir dela (opção "Tocar ao clicar").
//   • Botão de play flutuante: pausa/continua a partir da nota ou do trecho
//     selecionado. A barra de cima (do abcjs) continua tocando a música inteira.
//   • "Selecionar trecho" (ou Shift + clique numa segunda nota): marca um trecho
//     em VERDE, e o play toca só aquele pedaço.
//   • Delete: a nota vira pausa (mantém o ritmo); Delete numa pausa a remove;
//     Shift+Delete remove de vez. Ctrl+C copia, Ctrl+V cola no lugar da seleção,
//     Ctrl+Z desfaz.
//
// Tudo roda no navegador (abcjs). Sem IA, sem servidor e sem gastar cota.
// ══════════════════════════════════════════════════════════════════════════
(function () {
  const K_ATUAL = "oh-partitura-atual";
  const K_ORIGINAL = "oh-partitura-original";
  const K_ULTIMA = "oh-partitura-ultima";     // última extraída: reaproveitar sem gastar IA
  const K_TIMBRE = "oh-partitura-timbre";
  const K_AUTO = "oh-partitura-auto";         // "0" desliga o "Tocar ao clicar"
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
  let tempoProprio = null;         // tempos das notas calculados sem carregar o áudio (para a linha do tempo)

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
  let refazerPilha = [];           // para o "Refazer"
  let retomar = false;             // true: o próximo play continua de onde pausou
  let fimTrechoMs = null;          // quando tocar um trecho: onde parar
  let areaEditada = false;
  let ultimaRolagemUsuario = 0;
  let ultimoFim = 0;
  let marcados = [];               // notas em destaque durante o play
  let timerDigitando = null;
  let botaoEstado = "";
  let autoTocar = true;            // clicar numa nota já toca a partir dela
  let geracaoSom = 0;              // sobe a cada partitura nova: descarta trabalho de som antigo
  let carregandoAtual = null;      // carregamento do áudio em andamento
  let filaSom = Promise.resolve(); // pedidos de "tocar" são atendidos um de cada vez
  let areaTransferencia = null;    // copiar/colar: { texto, qtd }
  let emTransicao = 0;             // >0 enquanto o app mesmo pausa/pula/toca: a detecção de 'pausou por fora' não vale
  let toqueEmNotaAte = 0;          // celular: o toque numa nota gera um 'clique' extra logo depois; ele deve ser ignorado

  // ── armazenamento ────────────────────────────────────────────────────────
  function lerStorage(chave) { try { return localStorage.getItem(chave) || ""; } catch (e) { return ""; } }
  function gravarStorage(chave, valor) { try { localStorage.setItem(chave, valor); } catch (e) { /* sem armazenamento */ } }

  function avisar(tipo) {
    try { document.dispatchEvent(new CustomEvent("oh-partitura-estado", { detail: { tipo } })); } catch (e) { /* sem eventos */ }
  }

  function status(texto, tipo) {
    const el = $("partituraStatus");
    if (!el) return;
    el.textContent = texto;
    el.dataset.tipo = tipo || "info";
  }

  // ══ 1. LÓGICA DA NOTA (pura, testável) ═══════════════════════════════════

  // Onde termina o que vem ANTES da nota: cifra "Am", !decoração!, {enfeite}, (3 tercina...
  function fimDoPrefixo(token) {
    let i = 0;
    for (;;) {
      const c = token[i];
      if (c === '"' || c === "!" || c === "+") {
        const f = token.indexOf(c, i + 1);
        if (f < 0) return -1;
        i = f + 1;
      } else if (c === "{") {
        const f = token.indexOf("}", i + 1);
        if (f < 0) return -1;
        i = f + 1;
      } else if (c === "(") {
        const m = /^\(\d+(?::\d+){0,2}/.exec(token.slice(i));
        if (!m) return -1;
        i += m[0].length;
      } else if (c === " " || c === "\t" || c === "\n" || c === "\r") {
        i += 1;                                  // espaço antes da nota (vem junto do texto dela depois de uma barra)
      } else if (c && ".~HLMOPSTuv".indexOf(c) >= 0) {
        i += 1;
      } else break;
    }
    return i;
  }

  // Separa o texto de uma nota ABC em: prefixo, acidente, letra, marcas de oitava e o resto
  function separarNota(token) {
    const i = fimDoPrefixo(token);
    if (i < 0) return null;
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

  // Pausa com a mesma duração da nota ("c'4-" -> "z4"). Acorde [CEG]4 também vira pausa.
  // Mantém só marcadores de tercina "(3", para não bagunçar o ritmo.
  function tokenParaPausa(token) {
    const i = fimDoPrefixo(token);
    if (i < 0) return null;
    const tercina = (token.slice(0, i).match(/\(\d+(?::\d+){0,2}/g) || []).join("");
    let resto = token.slice(i), dur = "";
    if (resto[0] === "[") {
      const f = resto.indexOf("]");
      if (f < 0) return null;
      dur = /^\d*(?:\/\d*)*/.exec(resto.slice(f + 1))[0];
      if (!dur) { const m = /^\[(?:\^\^|\^|__|_|=)?[A-Ga-g][,']*(\d*(?:\/\d*)*)/.exec(resto); dur = m ? m[1] : ""; }
    } else {
      const m = /^(?:\^\^|\^|__|_|=)?[A-Ga-g][,']*([\s\S]*)$/.exec(resto);
      if (!m) return null;
      dur = /^\d*(?:\/\d*)*/.exec(m[1])[0];
    }
    const espaco = (token.match(/\s*$/) || [""])[0];     // o espaço depois da nota continua separando da próxima
    const margem = (token.match(/^\s*/) || [""])[0];     // o espaço antes da nota também continua no lugar
    return margem + tercina + "z" + dur + espaco;
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
    visual = null; notas = []; porInicio = new Map(); ordemPorInicio = new Map(); tempoProprio = null;
    limparDestaque();
    if (!abc.trim()) {
      alvo.innerHTML = `<p class="oh-hint" style="color:#555">Nenhuma partitura carregada. Gere a melodia na aba Songwriter, ou cole um texto ABC em "Editar texto ABC".</p>`;
      status("Aguardando partitura.", "info");
      prepararSom();
      atualizarBotaoPlay(true);
      avisar("texto");
      return false;
    }
    try {
      alvo.innerHTML = "";
      const tunes = window.ABCJS.renderAbc(alvo, abc, { responsive: "resize", add_classes: true, clickListener: aoClicarAbcjs, selectTypes: ["note", "bar"] });
      if (!tunes || !tunes.length || !tunes[0].lines || !tunes[0].lines.length) throw new Error("Nenhuma música encontrada no texto.");
      visual = tunes[0];
      if (!lerStorage(K_ORIGINAL)) gravarStorage(K_ORIGINAL, abc);
    } catch (erro) {
      alvo.innerHTML = "";
      status("Não consegui ler esse texto ABC. Confira as linhas X:, M:, L:, K: e as notas. " + (erro.message || ""), "erro");
      validarSelecao();
      prepararSom();
      atualizarBotaoPlay(true);
      avisar("texto");
      return false;
    }
    mapearNotas();
    validarSelecao();
    pintar();
    prepararSom();
    atualizarBotaoPlay(true);
    avisar("texto");
    return true;
  }

  // Lista as notas desenhadas e a ordem delas no tempo (para o trecho)
  function mapearNotas() {
    const sels = (visual.engraver && visual.engraver.selectables) || [];
    sels.forEach((s) => {
      const e = s.absEl && s.absEl.abcelem;
      if (!e || (e.el_type !== "note" && e.el_type !== "bar") || e.startChar == null) return;
      const n = { inicio: e.startChar, fim: e.endChar, rest: !!e.rest, bar: e.el_type === "bar", svg: s.svgEl };
      notas.push(n);
      porInicio.set(n.inicio, n);
    });
    // selectTypes deixa notas e barras focáveis (tabindex); no celular focar desloca a tela e o toque seguinte erra.
    sels.forEach((x) => { try { x.svgEl.removeAttribute("tabindex"); } catch (e) { /* sem svg */ } });
    criarAreasDeClique();
    try {
      const t = new window.ABCJS.TimingCallbacks(visual, {});
      tempoProprio = t;
      (t.noteTimings || []).forEach((ev, idx) => {
        if (ev.type !== "event") return;
        (ev.startCharArray || [ev.startChar]).forEach((sc) => { if (sc != null && !ordemPorInicio.has(sc)) ordemPorInicio.set(sc, idx); });
      });
    } catch (e) { /* sem ordem: o trecho cai para a ordem de desenho */ }
  }

  // Nota de cabeça vazada (mínima, semibreve) não recebe clique no miolo: o clique atravessa
  // para a linha da pauta. Cada nota ganha uma área de clique invisível, do tamanho exato da cabeça.
  function criarAreasDeClique() {
    notas.forEach((n) => {
      const cab = n.svg.querySelector(".abcjs-notehead") || n.svg.querySelector("path");
      if (!cab || !cab.getBBox || !cab.parentNode) return;
      let bb;
      try { bb = cab.getBBox(); } catch (e) { return; }
      if (!bb.width || !bb.height) return;
      const larg = n.bar ? Math.max(bb.width, 8) : bb.width;
      const r = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      r.setAttribute("x", n.bar ? bb.x + bb.width / 2 - larg / 2 : bb.x); r.setAttribute("y", bb.y);
      r.setAttribute("width", larg); r.setAttribute("height", bb.height);
      r.setAttribute("class", "oh-area-clique");
      cab.parentNode.appendChild(r);
    });
  }

  function limitesDoTrecho() {
    if (!trecho) return null;
    const a = ordemPorInicio.get(trecho.de), b = ordemPorInicio.get(trecho.ate);
    if (a == null || b == null) return null;
    return { a: Math.min(a, b), b: Math.max(a, b) };
  }

  // Voz (pauta) de uma nota: o abcjs marca cada nota com a classe abcjs-v<N>
  function vozDe(n) {
    const m = /abcjs-v(\d+)/.exec(n.svg.getAttribute("class") || "");
    return m ? m[1] : "0";
  }

  // Notas do trecho verde: só as da mesma voz da primeira nota marcada
  function notasDoTrecho() {
    const lim = limitesDoTrecho();
    const ini = trecho && porInicio.get(trecho.de);
    if (!lim || !ini) return [];
    const v = vozDe(ini);
    return notas
      .filter((n) => { const o = ordemPorInicio.get(n.inicio); return o != null && o >= lim.a && o <= lim.b && vozDe(n) === v; })
      .sort((a, b) => a.inicio - b.inicio);
  }

  // Sobre o que agem Copiar, Colar e Excluir: o trecho verde; senão, a nota vermelha
  function notasDoAlvo() {
    if (trecho) { const t = notasDoTrecho(); if (t.length) return t; }
    if (selecao != null) { const n = porInicio.get(selecao); return n ? [n] : []; }
    return [];
  }

  // Depois de redesenhar, esquece seleções que não existem mais
  function validarSelecao() {
    if (selecao != null && !porInicio.has(selecao)) selecao = null;
    if (trecho && (!porInicio.has(trecho.de) || !porInicio.has(trecho.ate))) trecho = null;
    editadas = new Set([...editadas].filter((o) => porInicio.has(o)));
  }

  // Vermelho = selecionada · Verde = trecho · Azul = ajustada
  function pintar() {
    const noTrecho = new Set(notasDoTrecho().map((n) => n.inicio));
    notas.forEach((n) => {
      n.svg.classList.toggle("oh-nota-sel", selecao === n.inicio);
      n.svg.classList.toggle("oh-nota-trecho", noTrecho.has(n.inicio));
      n.svg.classList.toggle("oh-nota-editada", editadas.has(n.inicio));
    });
    avisar("selecao");
    const bt = $("partituraTrecho");
    if (bt) {
      bt.classList.toggle("oh-ativo", modoTrecho);
      bt.textContent = modoTrecho ? "Clique na última nota do trecho" : "Selecionar trecho";
    }
    const temAlvo = notasDoAlvo().length > 0;
    [["partituraCopiar", temAlvo], ["partituraRecortar", temAlvo], ["partituraExcluir", temAlvo], ["partituraColar", temAlvo && !!areaTransferencia]].forEach(([id, ativo]) => {
      const b = $(id);
      if (b) b.disabled = !ativo;
    });
  }

  function limparDestaque() {
    marcados.forEach((el) => el.classList.remove("abcjs-highlight"));
    marcados = [];
  }

  // ══ 3. CLIQUES E EDIÇÃO ══════════════════════════════════════════════════

  // O abcjs também avisa quando o clique foi PERTO de uma nota. Só vale o clique
  // em cima dela; o resto é clique na pauta (tratado em aoClicarPauta).
  function aoClicarAbcjs(abcElem, tuneNumber, classes, analysis, drag, mouseEvent) {
    try {
      const alvo = mouseEvent && mouseEvent.target;
      if (!alvo || !alvo.closest || !alvo.closest("[data-index]")) return;
      if (!abcElem || (abcElem.el_type !== "note" && abcElem.el_type !== "bar") || abcElem.startChar == null) return;
      cliqueNaNota(abcElem.startChar, !!mouseEvent.shiftKey);
    } catch (erro) {
      status("Não consegui selecionar essa nota: " + (erro.message || erro), "erro");
    }
  }

  async function cliqueNaNota(inicio, shift) {
    const nota = porInicio.get(inicio);
    if (!nota) return;
    // segunda nota de um trecho
    if ((modoTrecho || shift) && selecao != null && selecao !== inicio) {
      const primeira = porInicio.get(selecao);
      if (nota.bar || (primeira && primeira.bar)) { status("Para marcar um trecho, use notas (não barras de compasso).", "erro"); return; }
      trecho = { de: selecao, ate: inicio };
      modoTrecho = false; fimTrechoMs = null; retomar = false;
      pintar();
      status("Trecho marcado em verde.", "ok");
      if (autoTocar) iniciar(); else { await pausarAudio(); moverBarra(); }
      return;
    }
    selecao = inicio; trecho = null; fimTrechoMs = null; retomar = false;
    pintar();
    if (modoTrecho) { await pausarAudio(); status("Agora clique na última nota do trecho.", "info"); return; }
    const token = $("partituraAbc").value.slice(nota.inicio, nota.fim);
    status(nota.bar
      ? "Barra de compasso selecionada. Delete remove; Ctrl+Z desfaz."
      : nota.rest
      ? "Pausa selecionada."
      : `Nota ${nomeDaNota(token)} selecionada. Clique numa linha ou espaço da pauta para mudar a altura.`, "info");
    if (autoTocar) iniciar(); else { await pausarAudio(); moverBarra(); }
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
    if (nota.bar) { status("Barras de compasso não têm altura. Selecione uma nota.", "info"); return; }
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
    aplicarNovoToken(nota, token, novo);
  }

  // Escreve a nota nova e, quando existe o planejador, confere se as OUTRAS notas continuam soando iguais
  // (um sustenido vale até o fim da medida e poderia mudar notas vizinhas sem ninguém perceber).
  function aplicarNovoToken(nota, token, novo) {
    let trocas = [{ inicio: nota.inicio, fim: nota.fim, novo }], aviso = "";
    if (window.PartituraEdicao) {
      const plano = window.PartituraEdicao.planejar($("partituraAbc").value, [{ inicio: nota.inicio, novoRaw: novo }]);
      if (plano.ok && plano.trocas.length) {
        trocas = plano.trocas;
        if (plano.efeitos.length) aviso = " Também " + plano.efeitos.map((x) => x.texto).join("; ") + ".";
      }
    }
    aplicarRegioes(trocas);
    status(`Nota ${nomeDaNota(token)} → ${nomeDaNota(novo)}.` + aviso + (autoTocar ? "" : " Aperte o play para ouvir a partir dela."), "ok");
    if (autoTocar) iniciar();
  }

  // Shift + seta: sobe ou desce uma linha/espaço da pauta (como o clique na pauta)
  function moverPasso(d) {
    const nota = selecao != null ? porInicio.get(selecao) : null;
    if (!nota || nota.bar || nota.rest) return false;
    const token = $("partituraAbc").value.slice(nota.inicio, nota.fim);
    if (!separarNota(token)) { status("Esse trecho é um acorde ou um grupo de notas. Selecione uma nota simples.", "erro"); return false; }
    const novo = moverToken(token, d);
    if (!novo) { status("Essa nota não pode ir tão longe.", "erro"); return false; }
    aplicarNovoToken(nota, token, novo);
    return true;
  }

  // Seta: sobe ou desce MEIO TOM. O sustenido/bemol é escolhido pela tonalidade e as outras notas são conferidas.
  function moverSemitom(d) {
    const nota = selecao != null ? porInicio.get(selecao) : null;
    if (!nota) { status("Clique numa nota antes.", "info"); return false; }
    if (nota.bar || nota.rest) { status(nota.bar ? "Barras de compasso não têm altura. Selecione uma nota." : "Pausas não têm altura. Selecione uma nota.", "info"); return false; }
    if (!window.PartituraEdicao || !window.PartituraModelo) { status("O módulo de edição por semitom não carregou.", "erro"); return false; }
    const abc = $("partituraAbc").value;
    const M = window.PartituraModelo.construir(abc);
    const ev = M && M.porInicio.get(selecao);
    if (!ev || ev.tipo !== "nota" || ev.midi == null) { status("Selecione uma nota.", "info"); return false; }
    const plano = window.PartituraEdicao.planejar(abc, [{ inicio: selecao, midiAlvo: ev.midi + d }]);
    if (!plano.ok) { status(plano.erro, "erro"); return false; }
    aplicarRegioes(plano.trocas);
    const it = plano.itens[0];
    status(`Nota ${it.antes.nome} → ${it.depois.nome} (${d > 0 ? "subiu" : "desceu"} ${Math.abs(d)} semitom).` + (plano.efeitos.length ? " Também " + plano.efeitos.map((x) => x.texto).join("; ") + "." : "") + (autoTocar ? "" : " Aperte o play para ouvir a partir dela."), "ok");
    if (autoTocar) iniciar();
    return true;
  }

  // Troca pedaços do texto ABC de uma vez só (uma entrada no Desfazer).
  // Cuida de deslocar as posições das notas azuis, da seleção e do trecho.
  function aplicarRegioes(lista, opcoes) {
    opcoes = opcoes || {};
    const area = $("partituraAbc");
    const texto = area.value;
    const regs = lista.map((r) => ({ ...r })).sort((a, b) => a.inicio - b.inicio);
    for (let i = 1; i < regs.length; i++) if (regs[i].inicio < regs[i - 1].fim) return false;
    historico.push({ texto, editadas: [...editadas], selecao, trecho: trecho ? { ...trecho } : null });
    if (historico.length > 50) historico.shift();
    refazerPilha = [];                              // uma mudança nova apaga o que dava para refazer

    let novoTexto = "", cursor = 0;
    regs.forEach((r) => {
      novoTexto += texto.slice(cursor, r.inicio);
      r.novoInicio = novoTexto.length;
      novoTexto += r.novo;
      r.novoFim = novoTexto.length;
      cursor = r.fim;
    });
    novoTexto += texto.slice(cursor);

    const regiaoDe = (off) => regs.find((r) => off >= r.inicio && off < r.fim);
    const mapear = (off) => off + regs.reduce((d, r) => (r.fim <= off ? d + r.novo.length - (r.fim - r.inicio) : d), 0);
    const mapearPonta = (off) => { const r = regiaoDe(off); return r ? (r.novo ? r.novoInicio : null) : mapear(off); };

    const novasEditadas = new Set([...editadas].filter((o) => !regiaoDe(o)).map(mapear));
    const novaSelecao = selecao == null ? null : mapearPonta(selecao);
    let novoTrecho = null;
    if (trecho) { const de = mapearPonta(trecho.de), ate = mapearPonta(trecho.ate); if (de != null && ate != null) novoTrecho = { de, ate }; }

    area.value = novoTexto;
    editadas = novasEditadas; selecao = novaSelecao; trecho = novoTrecho;
    gravarStorage(K_ATUAL, novoTexto);
    areaEditada = false; retomar = false; fimTrechoMs = null; modoTrecho = false;
    renderizar();
    if (opcoes.marcar !== false) regs.forEach((r) => notas.forEach((n) => { if (!n.bar && n.inicio >= r.novoInicio && n.fim <= r.novoFim) editadas.add(n.inicio); }));
    if (opcoes.depois) opcoes.depois(regs);
    pintar();
    return true;
  }

  function refazer() {
    const h = refazerPilha.pop();
    if (!h) { status("Nada para refazer.", "info"); return; }
    historico.push({ texto: $("partituraAbc").value, editadas: [...editadas], selecao, trecho: trecho ? { ...trecho } : null });
    $("partituraAbc").value = h.texto;
    editadas = new Set(h.editadas); selecao = h.selecao; trecho = h.trecho;
    gravarStorage(K_ATUAL, h.texto);
    retomar = false; fimTrechoMs = null; modoTrecho = false;
    renderizar();
    status("Mudança refeita.", "ok");
  }

  function desfazer() {
    const h = historico.pop();
    if (!h) { status("Nada para desfazer.", "info"); return; }
    refazerPilha.push({ texto: $("partituraAbc").value, editadas: [...editadas], selecao, trecho: trecho ? { ...trecho } : null });
    $("partituraAbc").value = h.texto;
    editadas = new Set(h.editadas); selecao = h.selecao; trecho = h.trecho;
    gravarStorage(K_ATUAL, h.texto);
    retomar = false; fimTrechoMs = null; modoTrecho = false;
    renderizar();
    status("Última mudança desfeita.", "ok");
  }

  // Delete: a nota vira pausa (o ritmo continua igual). Delete numa pausa remove a pausa.
  // Shift+Delete remove de vez. Vale para a nota vermelha ou para o trecho verde.
  function excluir(deVez) {
    const alvo = notasDoAlvo();
    if (!alvo.length) { status("Selecione uma nota ou um trecho antes de excluir.", "info"); return; }
    const texto = $("partituraAbc").value;
    const temNota = alvo.some((n) => !n.rest);
    const lista = [];
    alvo.forEach((n) => {
      const tk = texto.slice(n.inicio, n.fim);
      if (n.bar || deVez || (n.rest && !temNota)) {
        lista.push({ inicio: n.inicio, fim: texto[n.fim] === " " ? n.fim + 1 : n.fim, novo: "" });
      } else if (!n.rest) {
        const p = tokenParaPausa(tk);
        if (p) lista.push({ inicio: n.inicio, fim: n.fim, novo: p });
      }
    });
    if (!lista.length) { status("Não há o que excluir aqui.", "info"); return; }
    const removendo = lista.every((r) => r.novo === "");
    const qtd = alvo.length, rotulo = qtd === 1 ? "item" : "itens";
    aplicarRegioes(lista, { marcar: !removendo });
    status(removendo
      ? (alvo.every((n) => n.bar) ? "Barra de compasso removida. Ctrl+Z desfaz." : `${qtd} ${rotulo} removido${qtd === 1 ? "" : "s"}.`)
      : `${qtd} ${rotulo} viraram pausa (o ritmo continua). Delete de novo remove a pausa; Shift+Delete remove de vez.`, "ok");
    if (autoTocar && selecao != null) iniciar();
  }

  // Ctrl+C: guarda o texto ABC da nota ou do trecho
  function copiar() {
    const alvo = notasDoAlvo();
    if (!alvo.length) { status("Selecione uma nota ou um trecho antes de copiar.", "info"); return false; }
    if (alvo.some((n) => n.bar)) { status("Barras de compasso não são copiadas. Selecione notas.", "info"); return false; }
    const texto = $("partituraAbc").value;
    const pedaco = texto.slice(alvo[0].inicio, alvo[alvo.length - 1].fim);
    if (alvo.length > 1 && /\n\s*[A-Za-z]:/.test(pedaco)) {
      status("Esse trecho passa por uma linha de letra ou de outra voz. Selecione um trecho dentro da mesma linha de música.", "erro");
      return false;
    }
    areaTransferencia = { texto: pedaco.replace(/\s+$/, ""), qtd: alvo.length };
    try { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(pedaco).catch(() => {}); } catch (e) { /* sem permissão */ }
    pintar();
    status(`Copiado: ${alvo.length} ${alvo.length === 1 ? "item" : "itens"}. Selecione onde colar e aperte Ctrl+V (ou "Colar").`, "ok");
    return true;
  }

  // Ctrl+V: troca a nota ou o trecho selecionado pelo que foi copiado
  // Ctrl+X: copia e remove (de vez) a nota ou o trecho
  function recortar() {
    const qtd = notasDoAlvo().length;
    if (!copiar()) return;
    excluir(true);
    status(`Recortado: ${qtd} ${qtd === 1 ? "item" : "itens"}. Selecione onde colar e aperte Ctrl+V.`, "ok");
  }

  function colar() {
    if (!areaTransferencia) { status("Nada copiado ainda. Selecione uma nota ou um trecho e aperte Copiar.", "info"); return; }
    const alvo = notasDoAlvo();
    if (!alvo.length) { status("Selecione a nota ou o trecho que será substituído.", "info"); return; }
    const texto = $("partituraAbc").value;
    const regiao = texto.slice(alvo[0].inicio, alvo[alvo.length - 1].fim);
    const novo = areaTransferencia.texto + ((regiao.match(/\s*$/) || [""])[0]);   // mantém o espaço que separava da nota seguinte
    const qtd = alvo.length;
    const ok = aplicarRegioes([{ inicio: alvo[0].inicio, fim: alvo[alvo.length - 1].fim, novo }], {
      depois: (regs) => {
        const r = regs[0];
        const novas = notas.filter((n) => !n.bar && n.inicio >= r.novoInicio && n.fim <= r.novoFim).sort((a, b) => a.inicio - b.inicio);
        selecao = novas.length ? novas[0].inicio : null;
        trecho = novas.length >= 2 ? { de: novas[0].inicio, ate: novas[novas.length - 1].inicio } : null;
      },
    });
    if (!ok) return;
    status(`Colado no lugar de ${qtd} ${qtd === 1 ? "item" : "itens"}. Desfazer volta o que estava antes.`, "ok");
    if (autoTocar && selecao != null) iniciar();
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
  // Cuidados com o abcjs, todos confirmados em teste:
  //  (1) controle.play() é um INTERRUPTOR (toca/pausa);
  //  (2) trocar a partitura NÃO recarrega o áudio sozinho: o som continuaria a
  //      versão antiga. Por isso prepararSom() descarta o áudio a cada mudança;
  //  (3) pular de posição ENQUANTO toca desregula o relógio do áudio (a pausa
  //      seguinte guarda uma posição errada). Por isso: pausa, pula e toca.

  function tocando() { return !!(controle && controle.isStarted); }
  function timbreAtual() { const n = parseInt(lerStorage(K_TIMBRE), 10); return TIMBRES.some((t) => t.n === n) ? n : 0; }

  // Descarta o áudio antigo e prepara a partitura nova (o áudio só é montado no play)
  // Leva a barra de tempo (a de cima) até o começo da nota ou do trecho selecionado, sem tocar nada.
  function moverBarra() {
    if (!controle || !controle.control || !tempoProprio || tocando()) return;
    const total = tempoProprio.lastMoment || 0;
    const alvo = total ? alvoDeInicio(tempoProprio) : null;
    if (!alvo) return;
    try { controle.control.setProgress(Math.min(1, alvo.ms / total), total); } catch (e) { /* barra ainda não existe */ }
  }

  function prepararSom() {
    geracaoSom++;
    const g = geracaoSom;
    if (!controle) return;
    const refazer = () => {
      if (g !== geracaoSom) return;               // veio outra mudança depois desta
      try { controle.destroy(); } catch (e) { /* ainda sem áudio criado */ }
      controle.isLoaded = false; controle.isLoading = false; controle.isStarted = false;
      botaoEstado = "parado"; retomar = false;   // descartar o áudio NÃO é pausa do usuário: o próximo play vai para a nota
      if (visual) { try { controle.setTune(visual, false, { program: timbreAtual(), chordsOff: false }); } catch (e) { /* tenta de novo no play */ } }
      moverBarra();                               // descartar o áudio zera a barra: devolve ela para a seleção
    };
    if (carregandoAtual) carregandoAtual.then(refazer, refazer); else refazer();
  }

  // Monta o áudio da partitura atual (uma vez por partitura). false = a partitura mudou no meio.
  async function garantirAudio(token) {
    if (!controle || !visual) return false;
    while (carregandoAtual) {
      try { await carregandoAtual; } catch (e) { /* o erro é tratado por quem iniciou */ }
      if (token !== geracaoSom) return false;
    }
    if (token !== geracaoSom) return false;
    if (controle.isLoaded) return true;
    status("Carregando o som…", "info");
    const p = controle.go();
    carregandoAtual = p;
    try { await p; } finally { if (carregandoAtual === p) carregandoAtual = null; }
    return token === geracaoSom && controle.isLoaded;
  }

  async function pausarAudio() {
    emTransicao++;
    try {
      if (controle && controle.isStarted) { try { await controle.play(); } catch (e) { /* já parado */ } }
    } finally { emTransicao--; }
    atualizarBotaoPlay(true);
  }

  // Evento (tempo) de uma nota, no relógio do próprio áudio
  function eventoDaNota(inicio, timer) {
    const t = timer || (controle && controle.timer);
    const evs = t && t.noteTimings;
    if (!evs) return null;
    for (let i = 0; i < evs.length; i++) {
      const e = evs[i];
      if (e.type !== "event") continue;
      if (e.startChar === inicio || (e.startCharArray && e.startCharArray.indexOf(inicio) >= 0)) return { i, e, evs };
    }
    const idx = ordemPorInicio.get(inicio);                       // plano B: pela ordem no tempo
    if (idx != null && evs[idx] && evs[idx].type === "event") return { i: idx, e: evs[idx], evs };
    return null;
  }

  // Posição de início (e fim, se for trecho) em milissegundos
  function notaDepoisDaBarra(b) {
    const v = vozDe(b);
    return notas.filter((n) => !n.bar && n.inicio > b.inicio && vozDe(n) === v).sort((x, y) => x.inicio - y.inicio)[0] || null;
  }

  function alvoDeInicio(timer) {
    if (trecho) {
      const a = eventoDaNota(trecho.de, timer), b = eventoDaNota(trecho.ate, timer);
      if (a && b) {
        const primeiro = a.i <= b.i ? a : b, ultimo = a.i <= b.i ? b : a;
        const prox = ultimo.evs[ultimo.i + 1];
        return { ms: primeiro.e.milliseconds, paradaMs: prox ? prox.milliseconds : null };
      }
      return null;
    }
    if (selecao != null) {
      let n = porInicio.get(selecao);
      if (n && n.bar) n = notaDepoisDaBarra(n);
      const a = n ? eventoDaNota(n.inicio, timer) : null;
      return a ? { ms: a.e.milliseconds, paradaMs: null } : null;
    }
    return null;
  }

  // Muda a posição do áudio e do cursor ao mesmo tempo (mesma unidade: segundos).
  // SÓ com o áudio parado.
  function irPara(ms) {
    const t = controle.timer;
    controle.seek(ms / 1000, "seconds");
    controle.setProgress(t && t.lastMoment ? Math.min(1, ms / t.lastMoment) : 0, t ? t.lastMoment : 0);
  }

  function mmss(ms) { const s = Math.round(ms / 1000); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); }

  function descricaoDaSelecao() {
    if (trecho) return "o trecho selecionado";
    const n = selecao != null ? porInicio.get(selecao) : null;
    if (!n) return "";
    return n.bar ? "a barra de compasso" : n.rest ? "a pausa selecionada" : "a nota " + nomeDaNota($("partituraAbc").value.slice(n.inicio, n.fim));
  }

  // Pedidos de "tocar" entram numa fila: cliques rápidos não se atropelam
  function iniciar(opcoes) {
    filaSom = filaSom.then(() => iniciarInterno(opcoes)).catch(() => {});
    return filaSom;
  }

  async function iniciarInterno(opcoes) {
    if (!visual || !controle) { status("Carregue uma partitura primeiro.", "erro"); return; }
    const token = geracaoSom;
    emTransicao++;
    try {
      if (!(await garantirAudio(token))) return;
      if (retomar) {                                     // pausou antes: continua de onde parou
        retomar = false;
        if (!controle.isStarted) await controle.play();
        atualizarBotaoPlay(true);
        return;
      }
      fimTrechoMs = null;
      const temAlvo = trecho != null || selecao != null;
      const alvo = temAlvo ? alvoDeInicio() : null;
      if (temAlvo && !alvo) { status("Não consegui localizar essa nota no tempo da música. Clique nela de novo.", "erro"); return; }
      if (!alvo && controle.isStarted) return;           // sem seleção e já tocando: nada a fazer
      if (controle.isStarted) await controle.play();     // pausa antes de pular de posição
      if (alvo) { irPara(alvo.ms); fimTrechoMs = opcoes && opcoes.inteira ? null : alvo.paradaMs; }
      if (!controle.isStarted) await controle.play();
      status(trecho && !(opcoes && opcoes.inteira)
        ? `Tocando o trecho selecionado (a partir de ${mmss(alvo.ms)}).`
        : alvo ? `Tocando a partir d${descricaoDaSelecao()} (${mmss(alvo.ms)}).` : "Tocando a música.", "ok");
    } catch (erro) {
      if (token !== geracaoSom) return;                  // a partitura mudou no meio: já foi refeito
      status("Não consegui tocar. Os timbres vêm de fora do app, confira a conexão. " + (erro && erro.message ? erro.message : ""), "erro");
    } finally { emTransicao--; }
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
    // A barra de cima toca a música inteira. Com algo selecionado, o play dela parte da seleção e vai até o fim;
    // pausar ou mexer na barra faz o play flutuante continuar dali.
    transporte.addEventListener("click", (ev) => {
      const play = ev.target && ev.target.closest ? ev.target.closest(".abcjs-midi-start") : null;
      if (play && !tocando() && !retomar && (selecao != null || trecho)) {
        ev.stopImmediatePropagation(); ev.preventDefault();
        iniciar({ inteira: true });
        return;
      }
      fimTrechoMs = null;
      setTimeout(() => { if (controle) retomar = !controle.isStarted; }, 150);
    }, true);
  }

  // Botão de play flutuante: mostra play ou pausa conforme o estado do áudio
  function atualizarBotaoPlay(forcar) {
    const b = $("partituraFlutuante");
    if (!b) return;
    const t = tocando();
    // pausou por fora (barra do abcjs): o próximo play continua de onde parou
    if (!forcar && !emTransicao && botaoEstado === "tocando" && !t && Date.now() - ultimoFim > 1000) retomar = true;
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
    if (!lerStorage(K_ORIGINAL)) gravarStorage(K_ORIGINAL, ultima);   // a original só é trocada por uma nova extração do Songwriter
    areaEditada = false;
    limparEstado();
    renderizar();
    status("Última partitura carregada, sem gastar IA.", "ok");
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

  // Atalhos de teclado (só com a aba aberta e fora de campos de texto)
  function aoTeclar(ev) {
    const pagina = $(PAGINA);
    if (!pagina || !pagina.classList.contains("oh-page-ativa")) return;
    const el = ev.target;
    if (el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)) return;
    const meta = ev.ctrlKey || ev.metaKey;
    const tecla = (ev.key || "").toLowerCase();
    if (!meta && (ev.key === "Delete" || ev.key === "Backspace")) {
      if (notasDoAlvo().length) ev.preventDefault();
      excluir(ev.shiftKey);
    } else if (meta && tecla === "c") {
      const sel = window.getSelection ? window.getSelection() : null;
      const papel = $("partituraPapel");
      if (sel && String(sel).length && !(papel && papel.contains(sel.anchorNode))) return;   // texto de fora da partitura: o navegador copia
      ev.preventDefault(); copiar();
    } else if (meta && tecla === "x") {
      const sel = window.getSelection ? window.getSelection() : null;
      const papel = $("partituraPapel");
      if (sel && String(sel).length && !(papel && papel.contains(sel.anchorNode))) return;
      ev.preventDefault(); recortar();
    } else if (meta && tecla === "v") {
      ev.preventDefault(); colar();
    } else if (meta && tecla === "z" && !ev.shiftKey) {
      ev.preventDefault(); desfazer();
    } else if (meta && (tecla === "y" || (tecla === "z" && ev.shiftKey))) {
      ev.preventDefault(); refazer();
    } else if (!meta && !ev.altKey && (ev.key === "ArrowUp" || ev.key === "ArrowDown") && selecao != null) {
      const n = porInicio.get(selecao);
      if (n && !n.bar && !n.rest) {                                  // só rouba a seta quando há uma nota selecionada
        ev.preventDefault();
        const d = ev.key === "ArrowUp" ? 1 : -1;
        if (ev.shiftKey) moverPasso(d); else moverSemitom(d);
      }
    }
  }

  function desbloquearAudio() {
    try {
      const c = window.ABCJS.synth.activeAudioContext();
      if (c && c.state === "suspended") c.resume();
    } catch (e) { /* sem Web Audio */ }
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
    } catch (e) { /* sem armazenamento */ }
    const botaoUltima = $("partituraCarregarUltima");
    if (botaoUltima) {
      botaoUltima.hidden = !lerStorage(K_ULTIMA);
      botaoUltima.addEventListener("click", carregarUltima);
    }

    autoTocar = lerStorage(K_AUTO) !== "0";
    const caixaAuto = $("partituraAuto");
    if (caixaAuto) {
      caixaAuto.checked = autoTocar;
      caixaAuto.addEventListener("change", () => { autoTocar = caixaAuto.checked; gravarStorage(K_AUTO, autoTocar ? "1" : "0"); });
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
    $("partituraRefazer").addEventListener("click", refazer);
    $("partituraCopiar").addEventListener("click", copiar);
    $("partituraRecortar").addEventListener("click", recortar);
    $("partituraColar").addEventListener("click", colar);
    $("partituraExcluir").addEventListener("click", () => excluir(false));
    document.addEventListener("keydown", aoTeclar);
    $("partituraSalvar").addEventListener("click", salvar);
    $("partituraRestaurar").addEventListener("click", restaurarOriginal);
    $("partituraSongwriter").addEventListener("click", usarNoSongwriter);
    $("partituraFlutuante").addEventListener("click", alternarPlay);

    // iPhone/Safari só libera o som dentro de um toque: destrava já no primeiro toque na aba
    ["partituraPapel", "partituraFlutuante", "partituraTransporte"].forEach((id) => {
      const el = $(id);
      if (el) el.addEventListener("pointerdown", desbloquearAudio, { capture: true, passive: true });
    });
    // a barra de cima (abcjs) toca a música inteira: solta o "parar no fim do trecho"
    $("partituraTransporte").addEventListener("pointerdown", () => { fimTrechoMs = null; }, { capture: true, passive: true });

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
  // ── Interface para o assistente musical (partituraAssistente.js) ───────────
  // Ele lê e age pelo editor: não existe uma segunda cópia da partitura em lugar nenhum.
  function rolarPara(inicio) {
    const n = porInicio.get(inicio), papel = $("partituraPapel");
    if (!n || !papel) return;
    const r = n.svg.getBoundingClientRect(), p = papel.getBoundingClientRect();
    if (r.top < p.top + 30 || r.bottom > p.bottom - 30) papel.scrollTop += (r.top - p.top) - p.height / 3;
    if (r.left < p.left + 30 || r.right > p.right - 30) papel.scrollLeft += (r.left - p.left) - p.width / 3;
  }
  function selecionarNota(inicio, opcoes) {
    if (!porInicio.has(inicio)) return false;
    selecao = inicio; trecho = null; modoTrecho = false; fimTrechoMs = null; retomar = false;
    pintar();
    rolarPara(inicio);
    if (opcoes && opcoes.tocar) iniciar();
    return true;
  }
  function destacarAnalise(inicios) {
    const set = new Set(inicios || []);
    notas.forEach((n) => n.svg.classList.toggle("oh-nota-analise", set.has(n.inicio)));
    if (inicios && inicios.length) rolarPara(inicios[0]);
  }
  const api = {
    abcAtual: () => $("partituraAbc").value,
    abcOriginal: () => lerStorage(K_ORIGINAL),
    definirOriginal: (abc) => { gravarStorage(K_ORIGINAL, abc); avisar("original"); },
    selecao: () => ({ inicio: selecao, trecho: trecho ? { ...trecho } : null }),
    tocando: () => tocando(),
    selecionarNota, destacarAnalise, rolarPara,
    tocarSelecao: () => iniciar(),
    aplicarTrocas: (trocas) => aplicarRegioes(trocas),
    desfazer, refazer, moverSemitom, moverPasso,
    pausar: () => pausarAudio(),
    timbre: () => timbreAtual(),
    podeDesfazer: () => historico.length, podeRefazer: () => refazerPilha.length,
    // exercício guiado: 'alvo' (roxo) = ainda não mexeu · 'errada' (rosa) = mexeu e não é o alvo · 'certa' (turquesa) = no alvo
    marcarExercicio: (mapa) => notas.forEach((n) => {
      const e = mapa && mapa[n.inicio];
      n.svg.classList.toggle("oh-nota-alvo", e === "alvo");
      n.svg.classList.toggle("oh-nota-errada", e === "errada");
      n.svg.classList.toggle("oh-nota-certa", e === "certa");
    }),
  };

  window.Partitura = {
    api,
    _teste: {
      separarNota, moverToken, nomeDaNota, tokenParaPausa,
      estado: () => ({ selecao, trecho, modoTrecho, editadas: [...editadas], historico: historico.length, retomar, fimTrechoMs, notas: notas.length, tocando: tocando(), auto: autoTocar, copiado: areaTransferencia ? { ...areaTransferencia } : null }),
      controle: () => controle,
      renderizar,
    },
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciarAba);
  else iniciarAba();
})();
