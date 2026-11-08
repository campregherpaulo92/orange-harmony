// ambientes.js — Orange Harmony: a Home e os 5 ambientes (Academy, Create, Studio, Library, Explore).
// As páginas das ferramentas continuam sendo as MESMAS de antes (nada foi movido, copiado ou reescrito): aqui mora só a NAVEGAÇÃO.
// Para acrescentar uma ferramenta no futuro basta uma linha em AMBIENTES; a Home, a página do ambiente, o menu e a barra de navegação se montam sozinhos.
(function () {
  "use strict";

  // Cada item aponta para algo que JÁ EXISTE:  pagina = uma página do app ·  studio = uma aba/ação do Orange Studio ·  atalho = a mesma ferramenta, citada em outro ambiente.
  const AMBIENTES = [
    { id: "academy", nome: "ORANGE ACADEMY", curto: "Orange Academy", icone: "livros", cor: "#f97316",
      resumo: "Estude e desenvolva sua voz.", descricao: "Avalie a sua voz, estude afinação e evolua com treinos, jogos e acompanhamento.",
      grupos: [
        { titulo: "Avaliar", itens: [
          { id: "avaliacao", nome: "Avaliação Vocal", icone: "prancheta", pagina: "avaliacao", desc: "Cinco exercícios que geram o seu perfil vocal.", tags: ["classificação vocal", "extensão", "tessitura", "nota confortável"] },
        ] },
        { titulo: "Estudar", itens: [
          { id: "estudo", nome: "Estudo Vocal Inteligente", icone: "livros", pagina: "estudo", desc: "Grave ou envie sua voz e veja afinação, desvios e vibrato nota a nota.", tags: ["afinação", "desvio em cents", "vibrato", "treino de escalas"] },
          { id: "afinador", nome: "Afinador", icone: "diapasao", pagina: "afinador", desc: "Afine voz e instrumentos em tempo real.", tags: ["11 afinações", "440 / 442 Hz"] },
        ] },
        { titulo: "Praticar", itens: [
          { id: "singergame", nome: "Singergame", icone: "gamepad", pagina: "singergame", desc: "Jogos de afinação com a voz, incluindo vocalises.", tags: ["modo livre", "modo escala", "vocalise"] },
        ] },
        { titulo: "Acompanhar", itens: [
          { id: "historico", nome: "Histórico e evolução", icone: "chart", pagina: "historico", desc: "Acompanhe as análises salvas, a evolução e o relatório detalhado.", tags: ["evolução", "devolutiva do professor", "relatório"] },
        ] },
      ] },
    { id: "create", nome: "ORANGE CREATE", curto: "Orange Create", icone: "partitura", cor: "#fb7185",
      resumo: "Componha e crie músicas.", descricao: "Componha letras, melodias e acordes, e crie músicas com a ajuda da IA.",
      grupos: [
        { titulo: "Criar com IA", itens: [
          { id: "songwriter", nome: "Songwriter IA", icone: "robo", pagina: "songwriter", desc: "Letra, música completa e criação a partir da sua gravação ou de um áudio de referência.", tags: ["letra", "música completa", "melodia da sua gravação", "áudio de referência"] },
        ] },
        { titulo: "Escrever e arranjar", itens: [
          { id: "composicoes", nome: "Composições", icone: "lapis", pagina: "composicoes", desc: "Letras com cifras e seções, com versões.", tags: ["letras", "cifras", "versões"] },
          { id: "partitura", nome: "Partitura", icone: "partitura", pagina: "partitura", desc: "Edite a melodia, veja a partitura e peça ajuda ao assistente musical.", tags: ["editor de partitura", "notação ABC", "assistente musical"] },
        ] },
        { titulo: "Harmonia", itens: [
          { id: "acordes", nome: "Acordes", icone: "acorde", pagina: "acordes", desc: "Braço de violão clicável: identifique acordes e veja onde se encaixam.", tags: ["braço de violão", "identificar acorde", "tonalidades e escalas"] },
        ] },
      ] },
    { id: "studio", nome: "ORANGE STUDIO", curto: "Orange Studio", icone: "controle", cor: "#14b8a6",
      resumo: "Produza, edite e finalize suas músicas.", descricao: "O ambiente central de produção: grave, edite faixa por faixa, produza, mixe e exporte.",
      grupos: [
        { titulo: "Estúdio multifaixa", itens: [
          { id: "estudio", nome: "Orange Studio", icone: "controle", pagina: "estudio", desc: "Grave, edite, mixe e exporte em várias faixas, com as ferramentas de IA dentro dele.", tags: ["multipista", "mixer", "33 efeitos", "exportar WAV e MP3"] },
        ] },
        { titulo: "Dentro do Studio", itens: [
          { id: "studio-separar", nome: "Separar uma música", icone: "tesoura", studio: "separar", desc: "Divida uma música em voz, bateria, baixo e outros instrumentos.", tags: ["stems", "6 faixas"] },
          { id: "studio-gravar", nome: "Gravar uma voz", icone: "mic", studio: "gravar", desc: "Crie uma faixa já armada e grave com metrônomo e pré-contagem.", tags: ["microfone", "metrônomo"] },
          { id: "studio-voz", nome: "Edição vocal", icone: "brilho", studio: "voz", desc: "Peça em português ou escolha: ruído, tom, EQ, compressão, sibilância e reverb.", tags: ["IA", "ruído", "tom"] },
          { id: "studio-prod", nome: "Produtor IA", icone: "mix", studio: "prod", desc: "Gere bateria, baixo e acordes em cima da sua faixa, uma faixa por instrumento.", tags: ["270+ estilos", "faixa por instrumento"] },
          { id: "studio-afin", nome: "Afinação", icone: "diapasao", studio: "afin", desc: "Corrija a afinação da voz desenhando a linha.", tags: ["linha contínua", "corrigir tudo"] },
          { id: "studio-fx", nome: "Efeitos", icone: "raio", studio: "fx", desc: "Efeitos por faixa, com predefinições para cada instrumento.", tags: ["33 efeitos", "47 predefinições"] },
          { id: "studio-sm", nome: "Samples", icone: "piano", studio: "sm", desc: "Transforme trechos em samples e toque nas teclas.", tags: ["sampler", "teclado"] },
        ] },
        { titulo: "Ferramentas de áudio", itens: [
          { id: "conversor", nome: "Conversor de áudio", icone: "roda", pagina: "conversor", desc: "Converta arquivos entre WAV, MP3, FLAC, OGG e M4A.", tags: ["WAV", "MP3", "FLAC", "OGG", "M4A"] },
        ] },
      ] },
    { id: "library", nome: "ORANGE LIBRARY", curto: "Orange Library", icone: "pasta", cor: "#eab308",
      resumo: "Acesse seus projetos e arquivos.", descricao: "Tudo o que você gravou, produziu e salvou, num lugar só.",
      grupos: [
        { titulo: "Gravações e produções", itens: [
          { id: "gravador", nome: "Biblioteca de gravações", icone: "disco", pagina: "gravador", desc: "Suas gravações e produções salvas, com mini player e envio para as outras telas.", tags: ["gravações", "produções salvas", "mini player"] },
        ] },
        { titulo: "Projetos e samples", itens: [
          { id: "lib-projetos", nome: "Projetos do Studio", icone: "salvar", studio: "projetos", desc: "Abra os projetos salvos neste aparelho.", tags: ["projetos salvos", "arquivo .ohstudio"] },
          { id: "lib-samples", nome: "Meus samples", icone: "piano", studio: "sm", desc: "Os samples que você criou ou importou.", tags: ["neste aparelho"] },
        ] },
        { titulo: "Escritos e avaliações", itens: [
          { id: "lib-composicoes", nome: "Minhas composições", icone: "lapis", pagina: "composicoes", atalho: true, desc: "As letras e cifras que você salvou.", tags: ["letras", "cifras"] },
          { id: "lib-historico", nome: "Histórico de avaliações", icone: "chart", pagina: "historico", atalho: true, desc: "As análises salvas e o relatório detalhado.", tags: ["análises", "relatório"] },
        ] },
      ] },
    { id: "explore", nome: "ORANGE EXPLORE", curto: "Orange Explore", icone: "jornal", cor: "#60a5fa",
      resumo: "Descubra conteúdos e novidades.", descricao: "Notícias e novidades do universo musical, do canto e da tecnologia.",
      grupos: [
        { titulo: "Notícias e novidades", itens: [
          { id: "news", nome: "Orange News", icone: "jornal", pagina: "news", desc: "O jornal do app: edição do dia, enquete e notícias do mundo da música e das suas bandas.", tags: ["edição do dia", "enquete", "notícias", "suas bandas"] },
        ] },
      ] },
  ];

  const ABAS_STUDIO = ["voz", "prod", "fx", "afin", "sm"];   // as únicas ações do Studio que viram endereço (as outras não devem se repetir ao recarregar a página)
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`; };
  const icone = (n) => (window.ICONE ? window.ICONE(n) : "");
  const AMB = {}; AMBIENTES.forEach((a) => { AMB[a.id] = a; });
  const dono = {};   // página -> ambiente a que ela PERTENCE (um só; os atalhos não contam)
  const itens = []; AMBIENTES.forEach((a) => a.grupos.forEach((g) => g.itens.forEach((i) => { itens.push(Object.assign({ amb: a.id }, i)); if (i.pagina && !i.atalho) dono[i.pagina] = a.id; })));
  const itemPorId = {}; itens.forEach((i) => { itemPorId[i.id] = i; });
  const legado = (pagina) => $(`.oh-nav-item[data-page="${pagina}"]`);   // os botões antigos continuam existindo (ocultos): todo o código que os aciona segue funcionando
  let desdeControlador = false, ctxAtual = null;
  const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

  // ───────────── desenho ─────────────
  function estilo(a) { return `--amb-cor:${a.cor};--amb-rgb:${rgb(a.cor)}`; }
  function cartaoItem(a, i) {
    const marca = i.studio && i.id.indexOf("studio-") === 0 ? "no Studio" : i.atalho ? "atalho" : i.studio ? "abre o Studio" : "";
    return `<button type="button" class="amb-ferr" data-item="${i.id}" data-amb="${a.id}">
      <span class="amb-ico mini">${icone(i.icone)}</span>
      <span class="amb-ferr-corpo"><span class="amb-ferr-nome">${esc(i.nome)}${marca ? `<em class="amb-marca">${marca}</em>` : ""}<em class="amb-ultima" hidden>última usada</em></span>
        <span class="amb-ferr-desc">${esc(i.desc)}</span>
        ${i.tags && i.tags.length ? `<span class="amb-tags">${i.tags.map((t) => `<em>${esc(t)}</em>`).join("")}</span>` : ""}</span>
      <span class="amb-seta" aria-hidden="true">→</span></button>`;
  }
  function desenharHome() {
    const el = $("#page-home"); if (!el) return;
    el.innerHTML = `<div class="amb-hero"><div class="amb-slogan">Seu universo musical inteligente</div><h2 class="amb-pergunta">O que vamos fazer hoje?</h2></div>
      <div class="amb-grid">${AMBIENTES.map((a) => {
        const n = a.grupos.reduce((s, g) => s + g.itens.length, 0);
        return `<button type="button" class="amb-card" data-ir="amb:${a.id}" data-amb="${a.id}" style="${estilo(a)}" aria-label="${esc(a.nome)}: ${esc(a.resumo)}">
          <span class="amb-ico">${icone(a.icone)}</span>
          <span class="amb-nome">${esc(a.nome)}</span>
          <span class="amb-desc">${esc(a.resumo)}</span>
          <span class="amb-rodape-card"><span class="amb-meta">${plural(n, "ferramenta", "ferramentas")}</span><span class="amb-entrar">Entrar <b aria-hidden="true">→</b></span></span></button>`; }).join("")}</div>
      <p class="amb-dica">Dúvidas? A <button type="button" class="amb-linkinline" data-laranjinha>Laranjinha</button> responde em qualquer tela, pelo botão flutuante.</p>`;
  }
  function desenharAmbiente(a) {
    const el = $(`#page-amb-${a.id}`); if (!el) return;
    el.style.cssText = estilo(a);
    el.innerHTML = `<nav class="amb-trilha" aria-label="Você está em"><button type="button" class="amb-link" data-ir="home">Início</button><span class="amb-sep">›</span><b>${esc(a.curto)}</b></nav>
      <header class="amb-cab"><span class="amb-ico grande">${icone(a.icone)}</span><div class="amb-cab-texto"><h2>${esc(a.nome)}</h2><p>${esc(a.descricao)}</p></div>
        <button type="button" class="amb-btn-laranjinha" data-laranjinha title="Abrir a Laranjinha">Perguntar à Laranjinha</button></header>
      ${a.grupos.map((g) => `<section class="amb-grupo"><h3>${esc(g.titulo)}</h3><div class="amb-ferr-grid">${g.itens.map((i) => cartaoItem(a, i)).join("")}</div></section>`).join("")}
      <button type="button" class="amb-voltar" data-ir="home">← Voltar para a Home</button>`;
  }
  function desenharMenu() {
    const nav = $("#ohNavAmbientes"); if (!nav) return;
    nav.innerHTML = `<button type="button" class="oh-amb-item" data-ir="home" title="Início">${icone("laranja")}<span>Início</span></button>` +
      AMBIENTES.map((a) => `<button type="button" class="oh-amb-item" data-ir="amb:${a.id}" title="${esc(a.curto)}" style="${estilo(a)}">${icone(a.icone)}<span>${esc(a.curto)}</span></button>`).join("");
  }

  // ───────────── navegação ─────────────
  function limparTela() {
    $$(".oh-page").forEach((p) => p.classList.remove("oh-page-ativa"));
    $$(".oh-nav-item").forEach((b) => b.classList.remove("oh-nav-active"));
    document.body.classList.remove("estudio-ativo");
    const barra = $("#ambBarra"); if (barra) barra.hidden = true;
  }
  function marcarMenu(chave) {
    const alvo = chave === "home" ? "home" : "amb:" + chave;
    $$(".oh-amb-item").forEach((b) => { const ativo = b.dataset.ir === alvo; b.classList.toggle("oh-nav-active", ativo); if (ativo) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); });
  }
  function empurrar(hash, push, estado) { if (push === false) return; try { if (location.hash !== hash) history.pushState(estado || null, "", hash); } catch (e) { /* sem histórico */ } }
  // no celular o menu lateral ficaria empilhado em cima do conteúdo: recolhe sozinho (a trilha "Início › ambiente" faz o papel de voltar; o botão ☰ reabre). Não grava a preferência.
  function recolherNoCelular() { const sb = $("#sidebarPrincipal"); if (sb && window.innerWidth <= 800) sb.classList.add("oh-sidebar-colapsada"); }
  function topo() { try { window.scrollTo({ top: 0 }); } catch (e) { /* ok */ } }
  const ultimaDe = (amb) => { try { return localStorage.getItem("oh_ultima_" + amb); } catch (e) { return null; } };
  function lembrar(amb, id) { try { localStorage.setItem("oh_ultima_" + amb, id); } catch (e) { /* sem armazenamento */ } }

  function irHome(push) {
    limparTela(); $("#page-home").classList.add("oh-page-ativa"); marcarMenu("home"); document.body.dataset.tela = "home"; ctxAtual = null; empurrar("#/", push); recolherNoCelular(); topo();
  }
  function irAmbiente(id, push) {
    const a = AMB[id]; if (!a) return irHome(push);
    limparTela(); $(`#page-amb-${id}`).classList.add("oh-page-ativa"); marcarMenu(id); document.body.dataset.tela = "ambiente"; ctxAtual = id;
    const ult = ultimaDe(id); $$(".amb-ultima", $(`#page-amb-${id}`)).forEach((e) => { const card = e.closest(".amb-ferr"); e.hidden = !(card && ult && card.dataset.item === ult); });
    empurrar("#/amb/" + id, push); recolherNoCelular(); topo();
  }
  function barra(pagina, ctx) {
    const b = $("#ambBarra"); if (!b) return; const a = AMB[ctx] || AMB[dono[pagina]];
    if (!a || pagina === "estudio") { b.hidden = true; return; }   // o Studio usa a tela toda: nele o caminho de volta é o menu lateral
    const it = itens.find((x) => x.pagina === pagina && x.amb === a.id) || itens.find((x) => x.pagina === pagina);
    const irmaos = a.grupos.flatMap((g) => g.itens).filter((x) => x.pagina && !x.atalho);
    b.style.cssText = estilo(a);
    b.innerHTML = `<div class="amb-trilha"><button type="button" class="amb-link" data-ir="home">Início</button><span class="amb-sep">›</span><button type="button" class="amb-link" data-ir="amb:${a.id}">${esc(a.curto)}</button><span class="amb-sep">›</span><b>${esc(it ? it.nome : pagina)}</b></div>` +
      (irmaos.length > 1 ? `<div class="amb-irmaos" aria-label="Outras ferramentas de ${esc(a.curto)}">${irmaos.map((x) => `<button type="button" class="amb-chip${x.pagina === pagina ? " ativo" : ""}" data-item="${x.id}" data-amb="${a.id}">${esc(x.nome)}</button>`).join("")}</div>` : "");
    b.hidden = false;
  }
  function irFerramenta(pagina, push, ctx) {
    const btn = legado(pagina); if (!btn) return irHome(push);
    limparTela(); desdeControlador = true; try { btn.click(); } finally { desdeControlador = false; }
    const a = ctx && AMB[ctx] ? ctx : dono[pagina]; ctxAtual = a; marcarMenu(a); barra(pagina, a); document.body.dataset.tela = "ferramenta";
    const it = itens.find((x) => x.pagina === pagina && x.amb === a && !x.atalho); if (it) lembrar(a, it.id);
    empurrar("#/ferr/" + pagina, push, { ctx: a }); recolherNoCelular(); topo();
  }
  function executarStudio(acao) {
    const E = window.EstudioDaw; if (!E) return;
    if (ABAS_STUDIO.indexOf(acao) >= 0 && E.abrirAba) E.abrirAba(acao); else if (acao && E.acao) E.acao(acao);
  }
  function irStudio(acao, push) {
    irFerramenta("estudio", false, "studio"); executarStudio(acao);
    empurrar(ABAS_STUDIO.indexOf(acao) >= 0 ? "#/studio/" + acao : "#/ferr/estudio", push, { ctx: "studio" });
  }
  function abrirItem(it, ambDoCartao) {
    if (it.studio) return irStudio(it.studio, true);
    return irFerramenta(it.pagina, true, it.atalho ? ambDoCartao : dono[it.pagina]);
  }
  function aplicarHash() {
    const h = (location.hash || "").replace(/^#\/?/, "").split("/").filter(Boolean), ctx = history.state && history.state.ctx;
    if (h[0] === "amb" && AMB[h[1]]) return irAmbiente(h[1], false);
    if (h[0] === "ferr" && legado(h[1])) return irFerramenta(h[1], false, ctx && AMB[ctx] ? ctx : dono[h[1]]);
    if (h[0] === "studio" && ABAS_STUDIO.indexOf(h[1]) >= 0) { irFerramenta("estudio", false, "studio"); executarStudio(h[1]); return; }
    irHome(false);
  }

  function iniciar() {
    desenharMenu(); desenharHome(); AMBIENTES.forEach(desenharAmbiente);
    document.addEventListener("click", (e) => {
      const ir = e.target.closest("[data-ir]");
      if (ir) { const v = ir.dataset.ir; if (v === "home") irHome(true); else if (v.indexOf("amb:") === 0) irAmbiente(v.slice(4), true); return; }
      const card = e.target.closest("[data-item]"); if (card && itemPorId[card.dataset.item]) { abrirItem(itemPorId[card.dataset.item], card.dataset.amb); return; }
      if (e.target.closest("[data-laranjinha]")) { const f = $("#fabLaranjinha"); if (f) f.click(); }
    });
    const logo = $(".oh-sidebar-logo"); if (logo) { logo.style.cursor = "pointer"; logo.title = "Ir para o início"; logo.addEventListener("click", () => irHome(true)); }
    // quem aciona os botões antigos direto (o News, a Laranjinha…) continua funcionando e o menu, a barra e o endereço acompanham
    $$(".oh-nav-item").forEach((b) => b.addEventListener("click", () => {
      if (desdeControlador) return; const p = b.dataset.page, a = dono[p]; if (!a) return;
      ctxAtual = a; marcarMenu(a); barra(p, a); document.body.dataset.tela = "ferramenta"; empurrar("#/ferr/" + p, true, { ctx: a });
    }));
    window.addEventListener("popstate", aplicarHash);
    aplicarHash();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar); else iniciar();

  window.OrangeNav = { AMBIENTES, irHome: () => irHome(true), irAmbiente: (id) => irAmbiente(id, true), irFerramenta: (p) => irFerramenta(p, true), irStudio: (a) => irStudio(a, true), atual: () => ({ tela: document.body.dataset.tela, ambiente: ctxAtual }) };
})();
