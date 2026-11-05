// ══════════════════════════════════════════════════════════════
// partitura.js — Aba Partitura (ABC Studio).
// Mostra a notação ABC vinda do Songwriter, reproduz a melodia no navegador
// (abcjs), destaca a nota que está tocando e deixa ajustar o texto ABC.
// Sem IA, sem gerar nada no servidor e sem gastar cota.
// ══════════════════════════════════════════════════════════════
(function () {
  const K_ATUAL = "oh-partitura-atual";
  const K_ORIGINAL = "oh-partitura-original";
  const K_TIMBRE = "oh-partitura-timbre";
  const PAGINA = "page-partitura";

  // Timbres (programas MIDI padrão): o usuário escolhe, e a notação segue igual
  const TIMBRES = [
    { n: 0, nome: "Piano" },
    { n: 24, nome: "Violão de nylon" },
    { n: 25, nome: "Violão de aço" },
    { n: 40, nome: "Violino" },
    { n: 48, nome: "Cordas" },
    { n: 73, nome: "Flauta" },
  ];

  const $ = (id) => document.getElementById(id);
  let visualAtual = null;
  let controle = null;      // SynthController (play, pausa, reinício, velocidade e progresso)
  let areaEditada = false;
  let timer = null;
  let selecao = null;          // nota clicada: { inicio, fim, token }
  let marcadosSel = [];        // elementos SVG da nota selecionada
  let tempo = null;            // tempo de cada nota (TimingCallbacks), para voltar/avançar
  let reproduzindo = false;
  const historico = [];        // versões anteriores do texto ABC (para "Desfazer")
  const LETRAS = "CDEFGAB";

  function lerStorage(chave) { try { return localStorage.getItem(chave) || ""; } catch (e) { return ""; } }
  function gravarStorage(chave, valor) { try { localStorage.setItem(chave, valor); } catch (e) { /* sem armazenamento */ } }

  function status(texto, tipo) {
    const el = $("partituraStatus");
    if (!el) return;
    el.textContent = texto;
    el.dataset.tipo = tipo || "info";
  }

  // Destaque da nota que está tocando (cursor do abcjs)
  let marcados = [];
  const cursor = {
    onStart() { limparDestaque(); },
    onFinished() { limparDestaque(); status("Melodia terminada.", "ok"); },
    onEvent(evento) {
      limparDestaque();
      (evento.elements || []).forEach((grupo) => (grupo || []).forEach((el) => {
        el.classList.add("abcjs-highlight");
        marcados.push(el);
      }));
    },
  };
  function limparDestaque() {
    marcados.forEach((el) => el.classList.remove("abcjs-highlight"));
    marcados = [];
  }

  function timbreAtual() {
    const n = parseInt(lerStorage(K_TIMBRE), 10);
    return TIMBRES.some((t) => t.n === n) ? n : 0;
  }

  function montarTimbres() {
    const sel = $("partituraTimbre");
    if (!sel || sel.dataset.pronto) return;
    sel.innerHTML = TIMBRES.map((t) => `<option value="${t.n}">${t.nome}</option>`).join("");
    sel.value = String(timbreAtual());
    sel.addEventListener("change", () => {
      gravarStorage(K_TIMBRE, sel.value);
      if (visualAtual && controle) aplicarMelodia();
    });
    sel.dataset.pronto = "1";
  }

  // Desenha a partitura e prepara o controle de reprodução
  function renderizar() {
    soltarCaixa();
    const abc = $("partituraAbc").value.trim();
    const papel = $("partituraSvg");
    visualAtual = null;
    tempo = null;
    limparDestaque();
    if (controle) { try { controle.pause(); } catch (e) { /* já parado */ } }
    if (!abc) {
      papel.innerHTML = `<p class="oh-hint">Nenhuma partitura carregada. Gere a melodia na aba Songwriter, ou cole um texto ABC aqui.</p>`;
      status("Aguardando partitura.", "info");
      return false;
    }
    try {
      papel.innerHTML = "";
      const tunes = window.ABCJS.renderAbc(papel, abc, { responsive: "resize", add_classes: true, clickListener: aoClicarNota });
      if (!tunes || !tunes.length) throw new Error("Nenhuma música encontrada no texto.");
      visualAtual = tunes[0];
      try { tempo = new window.ABCJS.TimingCallbacks(visualAtual, {}); } catch (e) { tempo = null; }
      status("Partitura pronta. Ouça antes de enviar para a geração.", "ok");
      aplicarMelodia();
      reaplicarSelecao();
      return true;
    } catch (erro) {
      papel.innerHTML = "";
      status("Não consegui ler esse texto ABC. Confira as linhas X:, M:, L:, K: e as notas. " + (erro.message || ""), "erro");
      return false;
    }
  }

  // Passa a melodia para o controle de reprodução, com o timbre escolhido
  async function aplicarMelodia() {
    if (!visualAtual || !controle) return;
    try {
      await controle.setTune(visualAtual, false, { program: timbreAtual(), chordsOff: false });
    } catch (erro) {
      status("Não consegui preparar o som desta partitura. Verifique a conexão, porque os timbres vêm de fora do app.", "erro");
    }
  }

  function prepararControle() {
    const transporte = $("partituraTransporte");
    if (!transporte || !window.ABCJS || !window.ABCJS.synth) return;
    controle = new window.ABCJS.synth.SynthController();
    controle.load(transporte, cursor, {
      displayPlay: true,
      displayRestart: true,
      displayProgress: true,
      displayWarp: true,      // velocidade da reprodução
      displayLoop: false,
      displayClock: false,
    });
  }

  // ── Edição por nota: clicar, depois subir ou descer uma linha/espaço da pauta ──
  function aoClicarNota(abcElem) {
    try { selecionarNota(abcElem); }
    catch (erro) { status("Não consegui selecionar essa nota: " + (erro.message || erro), "erro"); }
  }

  function selecionarNota(abcElem) {
    if (!abcElem || abcElem.el_type !== "note" || abcElem.startChar === undefined) return;
    const texto = $("partituraAbc").value;
    const token = texto.slice(abcElem.startChar, abcElem.endChar);
    if (!token || /[\[\]]/.test(token)) {
      status("Essa parte é um acorde ou um grupo de notas. Escolha uma nota simples.", "erro");
      return;
    }
    selecao = { inicio: abcElem.startChar, fim: abcElem.endChar, token };
    if (controle) { try { controle.pause(); } catch (e) { /* já parado */ } }
    const { eventos, total } = posicaoDaNota();
    const i = indiceDaSelecao(eventos);
    if (i >= 0 && total) irParaMs(eventos[i].milliseconds, total);
    marcarSelecao(abcElem.elemset || []);
    posicionarCaixa(abcElem.elemset || []);
    mostrarCaixa();
  }

  // Destaca a nota selecionada em vermelho (sem perder a marcação ao redesenhar)
  function marcarSelecao(elementos) {
    marcadosSel.forEach((el) => el.classList.remove("oh-nota-selecionada"));
    marcadosSel = [];
    (elementos || []).forEach((el) => { if (el && el.classList) { el.classList.add("oh-nota-selecionada"); marcadosSel.push(el); } });
  }

  // Ao redesenhar, procura de novo a nota selecionada pelo início dela no texto ABC
  function reaplicarSelecao() {
    if (!selecao || !visualAtual) return;
    let achado = null;
    (visualAtual.lines || []).forEach((linha) => (linha.staff || []).forEach((pauta) => (pauta.voices || []).forEach((voz) => (voz || []).forEach((el) => {
      if (!achado && el && el.startChar === selecao.inicio && el.elemset) achado = el.elemset;
    }))));
    if (achado) { marcarSelecao(achado); posicionarCaixa(achado); mostrarCaixa(); }
    else { selecao = null; mostrarCaixa(); }
  }

  // Caixinha flutuante colada na nota, para não precisar rolar até embaixo da partitura
  const NS_SVG = "http://www.w3.org/2000/svg";
  const NS_HTML = "http://www.w3.org/1999/xhtml";

  // Devolve a caixinha para o papel (casa dela) e retira o suporte que a segurava dentro do desenho
  function soltarCaixa() {
    const caixa = $("partituraCaixa");
    const papel = $("partituraPapel");
    if (!caixa || !papel) return;
    const suporte = caixa._suporte;
    if (suporte && suporte.parentNode) suporte.parentNode.removeChild(suporte);
    caixa._suporte = null;
    if (caixa.parentElement !== papel) papel.appendChild(caixa);
    caixa.style.position = "";
    caixa.style.left = "";
    caixa.style.top = "";
  }

  // Coloca a caixinha DENTRO do desenho da partitura, logo abaixo da nota.
  // Ela passa a ser parte do próprio desenho: rola, redimensiona e acompanha a nota
  // sem depender de cálculo de tela.
  function posicionarCaixa(elementos) {
    const caixa = $("partituraCaixa");
    if (!caixa || !elementos || !elementos.length) return;
    soltarCaixa();

    // Escolhe o elemento da nota que tem área (a cabeça), e não a haste
    let base = null, area = -1, caixaBB = null;
    elementos.forEach((el) => {
      if (!el || typeof el.getBBox !== "function") return;
      let bb;
      try { bb = el.getBBox(); } catch (e) { return; }
      const a = (bb.width || 0) * (bb.height || 0);
      if (a > area) { area = a; base = el; caixaBB = bb; }
    });
    if (!base || !caixaBB) return;

    const pai = base.parentNode;
    if (!pai || !pai.appendChild) return;

    // Suporte: um foreignObject no mesmo sistema de coordenadas da nota
    const suporte = document.createElementNS(NS_SVG, "foreignObject");
    const x = caixaBB.x + caixaBB.width + 6;     // à direita da nota
    const y = caixaBB.y + caixaBB.height + 6;    // um pouco abaixo dela
    suporte.setAttribute("x", String(x));
    suporte.setAttribute("y", String(y));
    suporte.setAttribute("width", "240");
    suporte.setAttribute("height", "140");
    suporte.setAttribute("class", "oh-caixa-suporte");

    const corpo = document.createElementNS(NS_HTML, "div");
    corpo.setAttribute("xmlns", NS_HTML);
    corpo.style.width = "100%";
    corpo.style.height = "100%";
    suporte.appendChild(corpo);
    pai.appendChild(suporte);

    caixa.style.position = "relative";
    caixa.style.left = "0";
    caixa.style.top = "0";
    corpo.appendChild(caixa);
    caixa._suporte = suporte;
    caixa.dataset.posicionada = "1";
  }

  function mostrarCaixa() {
    const caixa = $("partituraCaixa");
    if (!caixa) return;
    caixa.hidden = !selecao;
    if (selecao) {
      $("partituraCaixaNota").textContent = `Nota: ${selecao.token}`;
      status(`Nota selecionada: ${selecao.token}.`, "info");
    }
  }

  // Interpreta uma nota ABC: acidente, letra, oitavas (' ou ,) e duração
  function lerNota(token) {
    const m = /^(\^{1,2}|_{1,2}|=)?([A-Ga-g])([,']*)(.*)$/.exec(token);
    if (!m) return null;
    const letra = m[2];
    const maiuscula = letra === letra.toUpperCase();
    let oitava = maiuscula ? 4 : 5;
    for (const marca of m[3]) oitava += marca === "'" ? 1 : -1;
    return { letra: letra.toUpperCase(), oitava, resto: m[4] };
  }

  // Monta de volta a nota com a nova posição (letra e oitava) e a duração original
  function montarNota(passo, resto, letraNova, oitavaNova) {
    let marcas = "";
    let letra = letraNova;
    if (oitavaNova >= 5) { letra = letraNova.toLowerCase(); marcas = "'".repeat(oitavaNova - 5); }
    else { marcas = ",".repeat(4 - oitavaNova); }
    return letra + marcas + resto;
  }

  function moverNota(direcao) {
    if (!selecao) return;
    const nota = lerNota(selecao.token);
    if (!nota) { status("Não consegui entender essa nota para mover.", "erro"); return; }
    // Um passo da pauta = a próxima letra da escala (linha ou espaço vizinho)
    const absoluto = nota.oitava * 7 + LETRAS.indexOf(nota.letra) + direcao;
    const oitavaNova = Math.floor(absoluto / 7);
    const letraNova = LETRAS[((absoluto % 7) + 7) % 7];
    const novoToken = montarNota(0, nota.resto, letraNova, oitavaNova);
    const area = $("partituraAbc");
    historico.push(area.value);
    if (historico.length > 30) historico.shift();
    area.value = area.value.slice(0, selecao.inicio) + novoToken + area.value.slice(selecao.fim);
    gravarStorage(K_ATUAL, area.value.trim());
    areaEditada = false;
    status(`Nota trocada: ${selecao.token} → ${novoToken}. Ouça de novo.`, "ok");
    selecao = { inicio: selecao.inicio, fim: selecao.inicio + novoToken.length, token: novoToken };
    renderizar();
    reaplicarSelecao();
  }

  function desfazerEdicao() {
    if (!historico.length) { status("Nada para desfazer.", "info"); return; }
    $("partituraAbc").value = historico.pop();
    gravarStorage(K_ATUAL, $("partituraAbc").value.trim());
    selecao = null;
    renderizar();
    marcarSelecao([]);
    mostrarCaixa();
    status("Última mudança desfeita.", "ok");
  }

  // Posição de uma nota na música, em milissegundos, e o total da música
  function posicaoDaNota(indice) {
    const eventos = (tempo && tempo.noteTimings) || [];
    const total = eventos.length ? eventos[eventos.length - 1].milliseconds : 0;
    return { eventos, total, indice };
  }

  // Muda a posição real do áudio (seek). setProgress só mexe na barra visual.
  function irParaMs(ms, total) {
    if (!controle || !total) return;
    const fracao = Math.min(1, Math.max(0, ms / total));
    if (typeof controle.seek === "function") controle.seek(fracao);
    else controle.setProgress(fracao, total);
  }

  function indiceDaSelecao(eventos) {
    return eventos.findIndex((e) => e.startChar === selecao.inicio);
  }

  // Começa a música a partir da nota selecionada
  function tocarDaqui() {
    if (!controle) { status("O player ainda não está pronto.", "erro"); return; }
    try {
      // sem nota selecionada: toca a música inteira
      if (!selecao || !tempo) {
        Promise.resolve(controle.play && controle.play()).catch(() => {});
        reproduzindo = true;
        status("Tocando a música completa.", "ok");
        return;
      }
      const { eventos, total } = posicaoDaNota();
      const i = indiceDaSelecao(eventos);
      if (i < 0 || !total) { status("Não consegui localizar essa nota no tempo da música.", "erro"); return; }
      const ms = eventos[i].milliseconds;
      // o áudio precisa estar iniciado para aceitar o salto: toca e, em seguida, pula para a nota
      Promise.resolve(controle.play && controle.play()).then(() => {
        irParaMs(ms, total);
        setTimeout(() => irParaMs(ms, total), 300);
      });
      reproduzindo = true;
      status(`Tocando a partir de ${selecao.token}.`, "ok");
    } catch (erro) {
      status("Não consegui começar a partir dessa nota. " + (erro.message || ""), "erro");
    }
  }

  // Pausa a música sem perder a posição
  function pausar() {
    if (controle) { try { controle.pause(); } catch (e) { /* já parado */ } }
    reproduzindo = false;
  }

  // Vai para a nota anterior ou a próxima, a partir da nota selecionada
  function irParaVizinha(direcao) {
    if (!selecao || !controle || !tempo) { status("Selecione uma nota primeiro.", "erro"); return; }
    const { eventos, total } = posicaoDaNota();
    const i = indiceDaSelecao(eventos);
    const j = i + direcao;
    if (i < 0 || j < 0 || j >= eventos.length) { status("Não há mais notas nessa direção.", "info"); return; }
    const alvo = eventos[j];
    // ao trocar de nota, também seleciona a nova para a caixinha acompanhar
    if (alvo.elements && alvo.elements.length) {
      // mantém a seleção só pelo tempo: a caixinha continua na nota atual
    }
    irParaMs(alvo.milliseconds, total);
    if (reproduzindo) controle.play();
    status(`Posição: ${direcao > 0 ? "próxima" : "anterior"} nota.`, "ok");
  }

  function salvar() {
    gravarStorage(K_ATUAL, $("partituraAbc").value.trim());
    areaEditada = false;
    status("Correção salva neste aparelho.", "ok");
  }

  function restaurarOriginal() {
    const original = lerStorage(K_ORIGINAL);
    if (!original) { status("Não há partitura original guardada.", "erro"); return; }
    $("partituraAbc").value = original;
    gravarStorage(K_ATUAL, original);
    areaEditada = false;
    renderizar();
    status("Partitura original restaurada.", "ok");
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

  // Carrega a partitura mais recente quando a aba é aberta, sem apagar uma edição em andamento
  function carregarSeNecessario() {
    const salvo = lerStorage(K_ATUAL);
    const area = $("partituraAbc");
    if (!area) return;
    if (!areaEditada && salvo && area.value !== salvo) {
      area.value = salvo;
      renderizar();
    } else if (!area.value && !salvo) {
      renderizar();
    }
  }

  function iniciar() {
    const area = $("partituraAbc");
    if (!area) return;
    // Ao abrir ou atualizar a página, a partitura começa vazia, como o Songwriter.
    // Ela só volta a aparecer quando o Songwriter gerar uma nova nesta mesma sessão.
    try { localStorage.removeItem(K_ATUAL); localStorage.removeItem(K_ORIGINAL); } catch (e) { /* sem armazenamento */ }
    window.addEventListener("resize", () => { if (selecao) reaplicarSelecao(); });
    // A caixinha vai para o fim do corpo da página: assim nenhum contêiner com
    // transformação ou sobreposição a esconde, e ela fica fixa na tela.
    const caixa = $("partituraCaixa");
    const papel = $("partituraPapel");
    if (caixa && papel && caixa.parentElement !== papel) papel.appendChild(caixa);
    montarTimbres();
    prepararControle();
    area.addEventListener("input", () => {
      areaEditada = true;
      selecao = null;
      marcarSelecao([]);
      soltarCaixa();
      mostrarCaixa();
      clearTimeout(timer);
      timer = setTimeout(renderizar, 400);
    });
    $("partituraSubir").addEventListener("click", () => moverNota(1));
    $("partituraDescer").addEventListener("click", () => moverNota(-1));
    $("partituraDesfazer").addEventListener("click", desfazerEdicao);
    $("partituraTocarDaqui").addEventListener("click", tocarDaqui);
    const caixaEl = $("partituraCaixa");
    if (caixaEl) ["click", "pointerdown", "mousedown", "touchstart"].forEach((ev) => caixaEl.addEventListener(ev, (e) => e.stopPropagation()));
    $("partituraPausar").addEventListener("click", pausar);
    $("partituraVoltar").addEventListener("click", () => irParaVizinha(-1));
    $("partituraAvancar").addEventListener("click", () => irParaVizinha(1));
    $("partituraCaixaFechar").addEventListener("click", () => { selecao = null; marcarSelecao([]); soltarCaixa(); mostrarCaixa(); });
    $("partituraSalvar").addEventListener("click", salvar);
    $("partituraRestaurar").addEventListener("click", restaurarOriginal);
    $("partituraSongwriter").addEventListener("click", usarNoSongwriter);

    const pagina = $(PAGINA);
    if (pagina) {
      new MutationObserver(() => {
        if (pagina.classList.contains("oh-page-ativa")) carregarSeNecessario();
        else if (controle) { try { controle.pause(); } catch (e) { /* já parado */ } limparDestaque(); }
      }).observe(pagina, { attributes: true, attributeFilter: ["class"] });
    }
    carregarSeNecessario();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar);
  else iniciar();
})();
