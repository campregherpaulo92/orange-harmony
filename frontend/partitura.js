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
    const abc = $("partituraAbc").value.trim();
    const papel = $("partituraPapel");
    visualAtual = null;
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
      status("Partitura pronta. Ouça antes de enviar para a geração.", "ok");
      aplicarMelodia();
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
    if (!abcElem || abcElem.el_type !== "note" || abcElem.startChar === undefined) return;
    const texto = $("partituraAbc").value;
    const token = texto.slice(abcElem.startChar, abcElem.endChar);
    if (!token || /[\[\]]/.test(token)) {
      status("Essa parte é um acorde ou um grupo de notas. Escolha uma nota simples.", "erro");
      return;
    }
    selecao = { inicio: abcElem.startChar, fim: abcElem.endChar, token };
    mostrarBarraNota();
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
    selecao = null;
    renderizar();
    mostrarBarraNota();
  }

  function desfazerEdicao() {
    if (!historico.length) { status("Nada para desfazer.", "info"); return; }
    $("partituraAbc").value = historico.pop();
    gravarStorage(K_ATUAL, $("partituraAbc").value.trim());
    selecao = null;
    renderizar();
    mostrarBarraNota();
    status("Última mudança desfeita.", "ok");
  }

  function mostrarBarraNota() {
    const barra = $("partituraNotaBarra");
    if (!barra) return;
    barra.hidden = !selecao;
    if (selecao) $("partituraNotaInfo").textContent = `Nota selecionada: ${selecao.token}`;
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
    montarTimbres();
    prepararControle();
    area.addEventListener("input", () => {
      areaEditada = true;
      selecao = null;
      mostrarBarraNota();
      clearTimeout(timer);
      timer = setTimeout(renderizar, 400);
    });
    $("partituraSubir").addEventListener("click", () => moverNota(1));
    $("partituraDescer").addEventListener("click", () => moverNota(-1));
    $("partituraDesfazer").addEventListener("click", desfazerEdicao);
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
