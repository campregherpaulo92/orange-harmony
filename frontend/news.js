// ══════════════════════════════════════════════════════════════
// news.js — Aba "Orange News" (menu: Newsletter): jornal do app.
// A edição escrita vem pronta e é instantânea; as notícias de fora chegam depois
// (podem demorar ou falhar — o jornal continua inteiro sem elas).
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

  const bloco = jEl("section", "oh-jornal-fora");
  bloco.id = "jornalFora";
  const cab = jEl("div", "oh-jornal-fora-cab");
  cab.appendChild(jEl("h3", "oh-jornal-fora-titulo", "Lá fora: notícias que importam para quem faz música"));
  const atualizar = jEl("button", "oh-jornal-botao oh-jornal-botao-mini", "↻ Atualizar");
  atualizar.type = "button";
  atualizar.addEventListener("click", () => carregarNoticias(true));
  cab.appendChild(atualizar);
  bloco.appendChild(cab);
  bloco.appendChild(jEl("div", "oh-jornal-fora-lista", ""));
  corpo.appendChild(bloco);
  corpo.appendChild(jEl("p", "oh-jornal-rodape",
    "As dicas e curiosidades são escritas pela equipe do Orange Harmony. As notícias vêm de sites externos, com resumo automático feito por IA a partir do texto original — confira sempre na fonte."));
}

function renderizarNoticias(d) {
  const lista = document.querySelector("#jornalFora .oh-jornal-fora-lista");
  if (!lista) return;
  lista.replaceChildren();
  if (!d || !d.itens || !d.itens.length) {
    lista.appendChild(jEl("p", "oh-jornal-vazio", "As notícias de fora não carregaram agora. As seções acima continuam valendo — tente atualizar daqui a alguns minutos."));
    return;
  }
  if (d.status === "cache_antigo") lista.appendChild(jEl("p", "oh-jornal-vazio", "Mostrando a última seleção salva (não consegui atualizar agora)."));
  d.itens.forEach((n) => {
    const a = jEl("article", "oh-jornal-noticia");
    const meta = [n.fonte, n.quando].filter(Boolean).join(" · ");
    a.appendChild(jEl("span", "oh-jornal-secao", meta));
    a.appendChild(jEl("h4", "oh-jornal-noticia-titulo", n.titulo));
    if (n.resumo) a.appendChild(jEl("p", "oh-jornal-texto", n.resumo));
    if (!n.traduzido) a.appendChild(jEl("p", "oh-jornal-legenda", "Texto no idioma original (sem resumo automático)."));
    const link = jEl("a", "oh-jornal-link", `Ler a matéria em ${n.fonte} ↗`);
    link.href = n.link;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    a.appendChild(link);
    lista.appendChild(a);
  });
}

async function carregarNoticias(atualizar = false) {
  const lista = document.querySelector("#jornalFora .oh-jornal-fora-lista");
  if (!lista) return;
  lista.replaceChildren(jEl("p", "oh-jornal-carregando", "Buscando notícias…"));
  try {
    const resp = await fetch(`${API_BASE}/api/news/noticias${atualizar ? "?atualizar=true" : ""}`);
    renderizarNoticias(await resp.json());
  } catch (err) {
    renderizarNoticias(null);
  }
}

async function carregarJornal() {
  if (jornalCarregado) return;
  jornalCarregado = true;
  try {
    const resp = await fetch(`${API_BASE}/api/news/edicao`);
    renderizarEdicao(await resp.json());
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
