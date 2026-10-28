// ══════════════════════════════════════════════════════════════
// biblioteca_picker.js — "📚 Escolher da biblioteca"
// Ao lado de cada campo de envio de áudio (Avaliação, Produtor, Edição Vocal, Songwriter, Conversor e Orange Studio) aparece um botão
// que abre as gravações salvas na aba 🎙️ Biblioteca. A escolhida é colocada no campo como se a pessoa tivesse selecionado o arquivo
// do aparelho (preenche o campo e dispara o evento "change"), então cada ferramenta funciona exatamente como já funcionava.
// ══════════════════════════════════════════════════════════════
(function () {
  "use strict";

  // Campos de envio que ganham o botão. (Fica de fora o da própria aba Biblioteca, que SALVA arquivos nela.)
  const CAMPOS_COM_BIBLIOTECA = ["arquivoAudio", "producaoArquivo", "edicaoArquivo", "songwriterArquivo", "conversorArquivo", "studioArquivo"];
  const EXTENSAO_POR_TIPO = {
    "audio/webm": "webm", "video/webm": "webm", "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/m4a": "m4a", "audio/aac": "aac",
    "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/wave": "wav", "audio/ogg": "ogg",
    "application/ogg": "ogg", "audio/flac": "flac", "audio/x-flac": "flac",
  };

  const base = () => (typeof API_BASE === "string" ? API_BASE : "");
  let janela = null;          // a janela é criada na primeira vez e reaproveitada
  let campoAtual = null;      // o campo de arquivo que está recebendo a escolha
  let botaoAtual = null;      // o botão que abriu a janela (o foco volta para ele ao fechar)
  let gravacoes = [];
  let audioAberto = null;
  let disparandoMudanca = false;   // verdadeiro só enquanto ESTE componente dispara o 'change' (para não confundir com a escolha da pessoa)

  function el(tag, classe, texto) {
    const e = document.createElement(tag);
    if (classe) e.className = classe;
    if (texto !== undefined) e.textContent = texto;
    return e;
  }

  const semAcento = (t) => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const nomeSeguro = (nome) => (String(nome || "gravacao").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "gravacao");

  function tamanhoLegivel(bytes) {
    const n = Number(bytes) || 0;
    if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
    if (n >= 1024) return `${Math.round(n / 1024)} KB`;
    return n ? `${n} B` : "";
  }

  function dataLegivel(valor) {
    if (!valor) return "";
    const d = new Date(valor);
    return Number.isNaN(d.getTime()) ? String(valor) : d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  }

  // ───────────── janela ─────────────
  function montarJanela() {
    const fundo = el("div", "oh-bib-fundo");
    fundo.hidden = true;
    const caixa = el("div", "oh-bib-janela");
    caixa.setAttribute("role", "dialog");
    caixa.setAttribute("aria-modal", "true");
    caixa.setAttribute("aria-labelledby", "bibTitulo");

    const cab = el("div", "oh-bib-cab");
    const titulo = el("h3", "oh-bib-titulo", "📚 Escolher da biblioteca");
    titulo.id = "bibTitulo";
    const fechar = el("button", "oh-bib-fechar", "✕");
    fechar.type = "button";
    fechar.setAttribute("aria-label", "Fechar");
    fechar.addEventListener("click", fecharJanela);
    cab.appendChild(titulo);
    cab.appendChild(fechar);

    const busca = el("input", "oh-bib-busca");
    busca.type = "search";
    busca.placeholder = "Buscar pelo nome…";
    busca.setAttribute("aria-label", "Buscar gravação pelo nome");
    busca.addEventListener("input", desenharLista);

    const lista = el("div", "oh-bib-lista");
    const status = el("p", "oh-bib-status");
    status.setAttribute("aria-live", "polite");

    caixa.appendChild(cab);
    caixa.appendChild(busca);
    caixa.appendChild(lista);
    caixa.appendChild(status);
    fundo.appendChild(caixa);
    fundo.addEventListener("mousedown", (ev) => { if (ev.target === fundo) fecharJanela(); });
    document.body.appendChild(fundo);

    document.addEventListener("keydown", (ev) => {
      if (fundo.hidden) return;
      if (ev.key === "Escape") { ev.preventDefault(); fecharJanela(); return; }
      if (ev.key === "Tab") {                              // o foco fica dentro da janela
        const focaveis = [...caixa.querySelectorAll("button:not([disabled]), input")].filter((x) => x.offsetParent !== null);
        if (!focaveis.length) return;
        const primeiro = focaveis[0], ultimo = focaveis[focaveis.length - 1];
        if (ev.shiftKey && document.activeElement === primeiro) { ev.preventDefault(); ultimo.focus(); }
        else if (!ev.shiftKey && document.activeElement === ultimo) { ev.preventDefault(); primeiro.focus(); }
      }
    });
    return { fundo, caixa, busca, lista, status };
  }

  function dizer(texto) { if (janela) janela.status.textContent = texto || ""; }

  function pararAudio() {
    if (audioAberto) { try { audioAberto.pause(); } catch (e) { /* já parado */ } audioAberto = null; }
  }

  function fecharJanela() {
    if (!janela || janela.fundo.hidden) return;
    pararAudio();
    janela.fundo.hidden = true;
    document.body.classList.remove("oh-bib-aberta");
    if (botaoAtual && document.contains(botaoAtual)) botaoAtual.focus();
  }

  function irParaBiblioteca() {
    fecharJanela();
    const aba = document.querySelector('.oh-nav-item[data-page="gravador"]');
    if (aba) aba.click();
  }

  function desenharLista() {
    if (!janela) return;
    const { lista, busca } = janela;
    pararAudio();
    lista.replaceChildren();
    const termo = semAcento(busca.value).trim();
    const visiveis = gravacoes.filter((g) => !termo || semAcento(g.nome).includes(termo));
    if (!gravacoes.length) {
      const vazio = el("div", "oh-bib-vazio");
      vazio.appendChild(el("p", "", "Sua biblioteca está vazia. Grave ou suba um áudio na aba 🎙️ Biblioteca e ele aparece aqui."));
      const ir = el("button", "oh-bib-botao", "Abrir a Biblioteca");
      ir.type = "button";
      ir.addEventListener("click", irParaBiblioteca);
      vazio.appendChild(ir);
      lista.appendChild(vazio);
      dizer("");
      return;
    }
    if (!visiveis.length) { dizer("Nenhuma gravação com esse nome."); return; }
    dizer(`${visiveis.length} ${visiveis.length === 1 ? "gravação" : "gravações"}${termo ? " encontradas" : ""}.`);
    visiveis.forEach((g) => lista.appendChild(linhaDaGravacao(g)));
  }

  function linhaDaGravacao(g) {
    const linha = el("div", "oh-bib-item");
    const info = el("div", "oh-bib-info");
    info.appendChild(el("strong", "oh-bib-nome", g.nome || "Gravação"));
    info.appendChild(el("span", "oh-bib-meta", [dataLegivel(g.data), tamanhoLegivel(g.tamanho_bytes)].filter(Boolean).join(" · ")));
    const acoes = el("div", "oh-bib-acoes");
    const ouvir = el("button", "oh-bib-botao oh-bib-botao-sec", "▶ Ouvir");
    ouvir.type = "button";
    ouvir.setAttribute("aria-label", `Ouvir ${g.nome || "gravação"}`);
    const usar = el("button", "oh-bib-botao", "Usar");
    usar.type = "button";
    usar.setAttribute("aria-label", `Usar ${g.nome || "gravação"}`);
    usar.addEventListener("click", () => usarGravacao(g, usar));
    ouvir.addEventListener("click", () => alternarAudio(g, linha, ouvir));
    acoes.appendChild(ouvir);
    acoes.appendChild(usar);
    linha.appendChild(info);
    linha.appendChild(acoes);
    return linha;
  }

  function alternarAudio(g, linha, botao) {
    const existente = linha.querySelector("audio");
    pararAudio();
    janela.lista.querySelectorAll("audio").forEach((a) => a.remove());
    janela.lista.querySelectorAll(".oh-bib-item .oh-bib-botao-sec").forEach((b) => { b.textContent = "▶ Ouvir"; });
    if (existente) return;                                  // segundo toque fecha o player
    const player = document.createElement("audio");
    player.controls = true;
    player.preload = "none";
    player.className = "oh-bib-player";
    player.src = `${base()}/api/gravacoes/${encodeURIComponent(g.id)}`;
    linha.appendChild(player);
    botao.textContent = "⏹ Fechar";
    audioAberto = player;
    player.play().catch(() => { /* o navegador pode exigir um toque no player */ });
  }

  async function carregarLista() {
    dizer("Carregando suas gravações…");
    janela.lista.replaceChildren();
    try {
      const resp = await fetch(`${base()}/api/gravacoes`);
      if (!resp.ok) throw new Error("lista indisponível");
      const dados = await resp.json();
      gravacoes = Array.isArray(dados.gravacoes) ? dados.gravacoes : [];
      desenharLista();
    } catch (err) {
      gravacoes = [];
      const erro = el("div", "oh-bib-vazio");
      erro.appendChild(el("p", "", "Não consegui carregar a biblioteca agora."));
      const de_novo = el("button", "oh-bib-botao", "Tentar de novo");
      de_novo.type = "button";
      de_novo.addEventListener("click", carregarLista);
      erro.appendChild(de_novo);
      janela.lista.appendChild(erro);
      dizer("");
    }
  }

  // ───────────── usar a gravação escolhida ─────────────
  async function usarGravacao(g, botao) {
    const rotulo = botao.textContent;
    botao.disabled = true;
    botao.textContent = "Carregando…";
    dizer(`Carregando “${g.nome || "gravação"}”…`);
    try {
      const resp = await fetch(`${base()}/api/gravacoes/${encodeURIComponent(g.id)}`);
      if (!resp.ok) throw new Error("download falhou");
      const blob = await resp.blob();
      if (!blob.size) throw new Error("arquivo vazio");
      const tipo = (resp.headers.get("content-type") || blob.type || "").split(";")[0].trim().toLowerCase();
      const ext = EXTENSAO_POR_TIPO[tipo] || "webm";
      let nome = nomeSeguro(g.nome);
      if (!nome.toLowerCase().endsWith(`.${ext}`)) nome = `${nome}.${ext}`;
      const arquivo = new File([blob], nome, { type: tipo || "audio/webm" });
      const lote = new DataTransfer();
      lote.items.add(arquivo);
      campoAtual.files = lote.files;
      disparandoMudanca = true;
      try { campoAtual.dispatchEvent(new Event("change", { bubbles: true })); }   // a ferramenta reage como a uma escolha normal
      finally { disparandoMudanca = false; }
      anotar(campoAtual, g.nome || nome);
      fecharJanela();
    } catch (err) {
      botao.disabled = false;
      botao.textContent = rotulo;
      dizer("Não consegui carregar este áudio agora. Tente de novo em instantes.");
    }
  }

  function anotar(campo, nome) {
    const nota = campo.closest("label")?.nextElementSibling?.querySelector(".oh-bib-nota");
    if (nota) nota.textContent = `✓ Da biblioteca: ${nome}`;
  }

  function abrir(campo, botao) {
    if (!janela) janela = montarJanela();
    campoAtual = campo;
    botaoAtual = botao;
    janela.busca.value = "";
    janela.fundo.hidden = false;
    document.body.classList.add("oh-bib-aberta");
    carregarLista();
    janela.busca.focus();
  }

  // ───────────── botões ao lado dos campos de envio ─────────────
  function instalar() {
    CAMPOS_COM_BIBLIOTECA.forEach((id) => {
      const campo = document.getElementById(id);
      const rotuloCampo = campo && campo.closest("label");
      if (!campo || !rotuloCampo || rotuloCampo.nextElementSibling?.classList.contains("oh-bib-linha")) return;
      const linha = el("div", "oh-bib-linha");
      const botao = el("button", "oh-bib-abrir", "📚 Escolher da biblioteca");
      botao.type = "button";
      botao.addEventListener("click", () => abrir(campo, botao));
      const nota = el("span", "oh-bib-nota");
      linha.appendChild(botao);
      linha.appendChild(nota);
      rotuloCampo.insertAdjacentElement("afterend", linha);
      campo.addEventListener("change", () => { if (!disparandoMudanca) nota.textContent = ""; });   // escolheu outro arquivo do aparelho: a nota sai
    });
  }

  window.escolherDaBiblioteca = abrir;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", instalar);
  else instalar();
})();
