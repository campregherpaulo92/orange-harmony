// ══════════════════════════════════════════════════════════════
// news.js — Aba "Orange News" (menu: Newsletter): jornal do app.
// A edição escrita vem pronta e é instantânea; a enquete e as notícias de fora (abas: rock, Brasil, mundo, shows, lançamentos,
// produção e suas bandas) chegam depois (podem demorar ou falhar — o jornal continua inteiro sem elas).
// ══════════════════════════════════════════════════════════════

let jornalCarregado = false;

function jEl(tag, classe, texto) {
  const e = document.createElement(tag);
  if (classe) e.className = classe;
  if (texto !== undefined) e.textContent = texto;
  return e;
}

// Botão "Experimente no app →": abre a aba (ou o painel) do recurso citado
function botaoExperimente(recurso) {
  if (!recurso) return null;
  const rotulos = {
    avaliacao: "a Avaliação", estudo: "o Estudo", afinador: "o Afinador", acordes: "os Acordes", biblioteca: "a Biblioteca",
    historico: "o Histórico", composicoes: "as Composições", conversor: "o Conversor", producao: "a Produção",
    edicao: "a Edição Vocal", songwriter: "o Songwriter", estudio: "o Orange Studio",
  };
  const b = jEl("button", "oh-jornal-botao", `Experimente no app: abrir ${rotulos[recurso] || recurso} →`);
  b.type = "button";
  b.addEventListener("click", () => {
    const alvo = recurso === "estudio" ? document.getElementById("fabEstudio") : document.querySelector(`.oh-nav-item[data-page="${recurso}"]`);
    if (alvo) alvo.click();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  return b;
}

function artigo(item, classe) {
  const a = jEl("article", classe);
  a.appendChild(jEl("span", "oh-jornal-secao", item.rotulo));
  a.appendChild(jEl("h3", "oh-jornal-manchete-menor", item.titulo));
  a.appendChild(jEl("p", "oh-jornal-texto", item.texto));
  const b = botaoExperimente(item.recurso);
  if (b) a.appendChild(b);
  return a;
}

function caixaLevada(l) {
  const caixa = jEl("section", "oh-jornal-levada");
  caixa.appendChild(jEl("span", "oh-jornal-secao", "Levada do dia"));
  caixa.appendChild(jEl("h3", "oh-jornal-manchete-menor", l.nome));
  const grade = jEl("div", "oh-levada-grade");
  grade.style.gridTemplateColumns = `repeat(${l.contagem.length}, minmax(0, 1fr))`;
  l.contagem.forEach((c) => grade.appendChild(jEl("div", "oh-levada-tempo", c)));
  l.golpes.forEach((g) => grade.appendChild(jEl("div", "oh-levada-golpe" + (g ? " oh-levada-golpe-ativo" : ""), g)));
  caixa.appendChild(grade);
  caixa.appendChild(jEl("p", "oh-jornal-texto", l.dica));
  caixa.appendChild(jEl("p", "oh-jornal-legenda", "↓ = para baixo · ↑ = para cima · espaço em branco = a mão passa sem tocar · \"baixo\" = só a nota grave do acorde"));
  const b = botaoExperimente(l.recurso);
  if (b) caixa.appendChild(b);
  return caixa;
}

function renderizarEdicao(e) {
  document.getElementById("jornalEdicao").textContent = `Edição nº ${e.edicao_numero}`;
  document.getElementById("jornalData").textContent = e.data_extenso;
  const corpo = document.getElementById("jornalCorpo");
  corpo.replaceChildren();

  const m = jEl("article", "oh-jornal-manchete");
  m.appendChild(jEl("span", "oh-jornal-secao", `Editoria do dia · ${e.editoria}`));
  m.appendChild(jEl("h2", "oh-jornal-manchete-titulo", e.manchete.titulo));
  m.appendChild(jEl("p", "oh-jornal-manchete-texto", e.manchete.texto));
  const bm = botaoExperimente(e.manchete.recurso);
  if (bm) m.appendChild(bm);
  corpo.appendChild(m);

  const colunas = jEl("div", "oh-jornal-colunas");
  e.secoes.forEach((s) => colunas.appendChild(artigo(s, "oh-jornal-artigo")));
  corpo.appendChild(colunas);
  corpo.appendChild(caixaLevada(e.levada));

  const enquete = jEl("section", "oh-enquete");
  enquete.id = "jornalEnquete";
  enquete.appendChild(jEl("p", "oh-jornal-carregando", "Carregando a enquete…"));
  corpo.appendChild(enquete);

  const bloco = jEl("section", "oh-jornal-fora");
  bloco.id = "jornalFora";
  const cab = jEl("div", "oh-jornal-fora-cab");
  cab.appendChild(jEl("h3", "oh-jornal-fora-titulo", "Lá fora: o mundo da música"));
  const atualizar = jEl("button", "oh-jornal-botao oh-jornal-botao-mini", "↻ Atualizar");
  atualizar.type = "button";
  atualizar.addEventListener("click", () => carregarNoticias(true));
  cab.appendChild(atualizar);
  bloco.appendChild(cab);
  const abas = jEl("div", "oh-jornal-abas");
  abas.id = "jornalAbas";
  bloco.appendChild(abas);
  bloco.appendChild(montarPainelBandas());
  bloco.appendChild(jEl("div", "oh-jornal-fora-lista", ""));
  corpo.appendChild(bloco);
  corpo.appendChild(jEl("p", "oh-jornal-rodape",
    "As dicas, curiosidades e marcos do rock são escritos pela equipe do Orange Harmony. As notícias vêm de buscas no Google Notícias " +
    "(que reúne vários veículos brasileiros e internacionais) e de sites de produção musical, com título e resumo em português feitos " +
    "automaticamente por IA a partir do texto original, que pode errar. Confira sempre na matéria. As enquetes são só do Orange Harmony."));
}

// ───────────── notícias de fora: abas por seção + suas bandas ─────────────
const ABAS_NOTICIAS = [
  { id: "tudo", rotulo: "Tudo", filtro: () => true },
  { id: "rock", rotulo: "🎸 Rock", filtro: (n) => n.rock },
  { id: "brasil", rotulo: "Brasil", filtro: (n) => n.regiao === "br" && n.categoria !== "producao" },
  { id: "mundo", rotulo: "Mundo", filtro: (n) => n.regiao === "mundo" && n.categoria !== "producao" },
  { id: "shows", rotulo: "Shows", filtro: (n) => n.categoria === "shows" },
  { id: "lancamentos", rotulo: "Lançamentos", filtro: (n) => n.categoria === "lancamentos" },
  { id: "producao", rotulo: "Produção", filtro: (n) => n.categoria === "producao" },
  { id: "bandas", rotulo: "⭐ Suas bandas", filtro: null },
];
let noticiasDados = null;
let abaNoticias = "tudo";
const MAX_BANDAS_TELA = 8;

function bandasSalvas() {
  try {
    const lista = JSON.parse(localStorage.getItem("oh_bandas") || "[]");
    return Array.isArray(lista) ? lista.filter((b) => typeof b === "string").slice(0, MAX_BANDAS_TELA) : [];
  } catch (err) {
    return [];
  }
}

function salvarBandas(lista) {
  try { localStorage.setItem("oh_bandas", JSON.stringify(lista.slice(0, MAX_BANDAS_TELA))); } catch (err) { /* navegador sem armazenamento */ }
}

function idCliente() {
  try {
    let id = localStorage.getItem("oh_cliente");
    if (!id) {
      id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
        : Array.from({ length: 24 }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]).join("");
      localStorage.setItem("oh_cliente", id);
    }
    return id;
  } catch (err) {
    return "anonimo-" + Math.random().toString(36).slice(2, 12);
  }
}

function montarPainelBandas() {
  const painel = jEl("div", "oh-bandas");
  painel.id = "jornalBandas";
  painel.hidden = true;
  painel.appendChild(jEl("p", "oh-jornal-legenda", "Cadastre as bandas e artistas que você acompanha (até 8). Eu busco as notícias mais recentes de cada uma. Fica salvo só neste navegador."));
  const form = jEl("div", "oh-bandas-form");
  const campo = jEl("input", "oh-bandas-input");
  campo.type = "text";
  campo.id = "jornalBandaCampo";
  campo.placeholder = "Ex.: Metallica, Legião Urbana, Sepultura";
  campo.maxLength = 120;
  const botao = jEl("button", "oh-jornal-botao", "Seguir");
  botao.type = "button";
  const seguir = () => {
    const novas = campo.value.split(",").map((x) => x.trim()).filter((x) => x.length >= 2);
    if (!novas.length) return;
    const atuais = bandasSalvas();
    novas.forEach((n) => { if (!atuais.some((a) => a.toLowerCase() === n.toLowerCase())) atuais.push(n.slice(0, 40)); });
    salvarBandas(atuais);
    campo.value = "";
    desenharChipsBandas();
    carregarNoticias(false);
  };
  botao.addEventListener("click", seguir);
  campo.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); seguir(); } });
  form.appendChild(campo);
  form.appendChild(botao);
  painel.appendChild(form);
  const chips = jEl("div", "oh-bandas-chips");
  chips.id = "jornalBandasChips";
  painel.appendChild(chips);
  setTimeout(desenharChipsBandas, 0);
  return painel;
}

function desenharChipsBandas() {
  const chips = document.getElementById("jornalBandasChips");
  if (!chips) return;
  chips.replaceChildren();
  bandasSalvas().forEach((nome) => {
    const chip = jEl("span", "oh-banda-chip", nome);
    const x = jEl("button", "", "×");
    x.type = "button";
    x.title = `Deixar de seguir ${nome}`;
    x.setAttribute("aria-label", `Deixar de seguir ${nome}`);
    x.addEventListener("click", () => {
      salvarBandas(bandasSalvas().filter((b) => b !== nome));
      desenharChipsBandas();
      carregarNoticias(false);
    });
    chip.appendChild(x);
    chips.appendChild(chip);
  });
}

function itensDaAba(id) {
  if (!noticiasDados) return [];
  if (id === "bandas") return noticiasDados.suas_bandas || [];
  const aba = ABAS_NOTICIAS.find((a) => a.id === id) || ABAS_NOTICIAS[0];
  return (noticiasDados.itens || []).filter(aba.filtro);
}

function desenharAbas() {
  const barra = document.getElementById("jornalAbas");
  if (!barra) return;
  barra.replaceChildren();
  ABAS_NOTICIAS.forEach((aba) => {
    const n = itensDaAba(aba.id).length;
    const b = jEl("button", "oh-jornal-aba" + (aba.id === abaNoticias ? " oh-jornal-aba-ativa" : ""), `${aba.rotulo}${n ? ` (${n})` : ""}`);
    b.type = "button";
    b.dataset.aba = aba.id;
    b.addEventListener("click", () => { abaNoticias = aba.id; renderizarNoticias(noticiasDados); });
    barra.appendChild(b);
  });
}

function cartaoNoticia(n) {
  const a = jEl("article", "oh-jornal-noticia");
  const meta = jEl("span", "oh-jornal-secao", [n.banda ? `⭐ ${n.banda}` : n.rotulo, n.fonte, n.quando].filter(Boolean).join(" · "));
  if (n.rock && !n.banda) meta.appendChild(jEl("span", "oh-jornal-selo", "ROCK"));
  a.appendChild(meta);
  a.appendChild(jEl("h4", "oh-jornal-noticia-titulo", n.titulo));
  if (n.resumo) a.appendChild(jEl("p", "oh-jornal-texto", n.resumo));
  if (!n.traduzido) a.appendChild(jEl("p", "oh-jornal-legenda", "Texto no idioma original (sem tradução automática)."));
  const link = jEl("a", "oh-jornal-link", `Ler a matéria em ${n.fonte} ↗`);
  link.href = n.link;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  a.appendChild(link);
  return a;
}

function renderizarNoticias(d) {
  const lista = document.querySelector("#jornalFora .oh-jornal-fora-lista");
  if (!lista) return;
  noticiasDados = d;
  lista.replaceChildren();
  desenharAbas();
  const painel = document.getElementById("jornalBandas");
  if (painel) painel.hidden = abaNoticias !== "bandas";
  if (!d || !d.itens || !d.itens.length) {
    lista.appendChild(jEl("p", "oh-jornal-vazio", "As notícias de fora não carregaram agora. As seções acima continuam valendo — tente atualizar daqui a pouco."));
    if (abaNoticias !== "bandas") return;
  }
  if (d && d.fontes && d.fontes.total && d.fontes.ok / d.fontes.total < 0.6) {
    lista.appendChild(jEl("p", "oh-jornal-vazio", `Só ${d.fontes.ok} de ${d.fontes.total} fontes de notícias responderam agora. Toque em ↻ Atualizar daqui a alguns minutos.`));
  }
  if (d && d.status === "cache_antigo") lista.appendChild(jEl("p", "oh-jornal-vazio", "Mostrando a última seleção salva (não consegui atualizar agora)."));
  const itens = itensDaAba(abaNoticias);
  if (!itens.length) {
    const msg = abaNoticias === "bandas"
      ? (bandasSalvas().length ? "Nenhuma notícia recente das bandas que você segue (últimos 14 dias)." : "Você ainda não segue nenhuma banda. Digite os nomes acima e toque em Seguir.")
      : "Nada nesta seção agora. Tente outra aba ou atualize daqui a pouco.";
    lista.appendChild(jEl("p", "oh-jornal-vazio", msg));
    return;
  }
  itens.forEach((n) => lista.appendChild(cartaoNoticia(n)));
}

async function carregarNoticias(atualizar = false) {
  const lista = document.querySelector("#jornalFora .oh-jornal-fora-lista");
  if (!lista) return;
  lista.replaceChildren(jEl("p", "oh-jornal-carregando", "Buscando notícias… (a primeira busca do dia pode levar alguns segundos)"));
  const parametros = new URLSearchParams();
  if (atualizar) parametros.set("atualizar", "true");
  const bandas = bandasSalvas();
  if (bandas.length) parametros.set("bandas", bandas.join(","));
  try {
    const resp = await fetch(`${API_BASE}/api/news/noticias${parametros.toString() ? "?" + parametros.toString() : ""}`);
    renderizarNoticias(await resp.json());
  } catch (err) {
    renderizarNoticias(null);
  }
}

// ───────────── enquete do dia ─────────────
function renderizarEnquete(e) {
  const caixa = document.getElementById("jornalEnquete");
  if (!caixa) return;
  caixa.replaceChildren();
  caixa.appendChild(jEl("span", "oh-jornal-secao", "Enquete do dia"));
  caixa.appendChild(jEl("h3", "oh-jornal-manchete-menor", e.pergunta));
  const votou = e.votou !== null && e.votou !== undefined;
  e.opcoes.forEach((o, i) => {
    if (!votou) {
      const b = jEl("button", "oh-enquete-opcao", o.texto);
      b.type = "button";
      b.addEventListener("click", () => votarNaEnquete(e, i));
      caixa.appendChild(b);
      return;
    }
    const pct = e.total ? Math.round((100 * o.votos) / e.total) : 0;
    const linha = jEl("div", "oh-enquete-linha" + (i === e.votou ? " oh-enquete-minha" : ""));
    const barra = jEl("div", "oh-enquete-barra");
    barra.style.width = `${pct}%`;
    linha.appendChild(barra);
    const texto = jEl("div", "oh-enquete-texto");
    texto.appendChild(jEl("span", "", (i === e.votou ? "✓ " : "") + o.texto));
    texto.appendChild(jEl("span", "", `${pct}% · ${o.votos} ${o.votos === 1 ? "voto" : "votos"}`));
    linha.appendChild(texto);
    caixa.appendChild(linha);
  });
  caixa.appendChild(jEl("p", "oh-jornal-legenda", votou ? `${e.total} ${e.total === 1 ? "voto" : "votos"} até agora. Uma nova enquete sai amanhã.` : "Escolha uma opção para votar e ver o resultado."));
}

async function votarNaEnquete(e, indice) {
  const form = new FormData();
  form.append("id", e.id);
  form.append("opcao", String(indice));
  form.append("cliente", idCliente());
  try {
    const resp = await fetch(`${API_BASE}/api/news/enquete/votar`, { method: "POST", body: form });
    if (!resp.ok) throw new Error("falha ao votar");
    renderizarEnquete(await resp.json());
  } catch (err) {
    const caixa = document.getElementById("jornalEnquete");
    if (caixa) caixa.appendChild(jEl("p", "oh-jornal-vazio", "Não consegui registrar o voto agora. Tente de novo em instantes."));
  }
}

async function carregarEnquete() {
  const caixa = document.getElementById("jornalEnquete");
  if (!caixa) return;
  try {
    const resp = await fetch(`${API_BASE}/api/news/enquete?cliente=${encodeURIComponent(idCliente())}`);
    if (!resp.ok) throw new Error("sem enquete");
    renderizarEnquete(await resp.json());
  } catch (err) {
    caixa.replaceChildren(jEl("p", "oh-jornal-vazio", "A enquete de hoje não carregou agora."));
  }
}

async function carregarJornal() {
  if (jornalCarregado) return;
  jornalCarregado = true;
  try {
    const resp = await fetch(`${API_BASE}/api/news/edicao`);
    renderizarEdicao(await resp.json());
    carregarEnquete();
    carregarNoticias(false);
  } catch (err) {
    jornalCarregado = false;
    document.getElementById("jornalCorpo").replaceChildren(
      jEl("p", "oh-jornal-vazio", `Não consegui abrir a edição de hoje: ${mensagemDeErroDeRede(err)}`));
  }
}

function inicializarJornal() {
  const botao = document.querySelector('.oh-nav-item[data-page="news"]');
  if (botao) botao.addEventListener("click", carregarJornal);       // só carrega na primeira vez que a aba é aberta
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", inicializarJornal);
else inicializarJornal();
