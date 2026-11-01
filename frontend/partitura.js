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
      const tunes = window.ABCJS.renderAbc(papel, abc, { responsive: "resize", add_classes: true });
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
      clearTimeout(timer);
      timer = setTimeout(renderizar, 400);
    });
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
