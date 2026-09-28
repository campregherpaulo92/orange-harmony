// ══════════════════════════════════════════════════════════════
// composicoes.js — Editor de letras com cifras, prévia colorida, CRUD
// ══════════════════════════════════════════════════════════════

function renderizarComposicaoHTML(letra) {
  const escapado = letra
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const comCifras = escapado.replace(
    /\[([A-G](#|b)?[a-z0-9/]*)\]/g,
    '<span class="oh-chord">[$1]</span>'
  );
  const linhas = comCifras.split("\n").map((linha) => {
    const t = linha.trim();
    if (t.startsWith("#")) {
      return `<div class="oh-secao-titulo">${t.replace(/^#+\s*/, "")}</div>`;
    }
    if (t === "") return `<div style="height:10px;"></div>`;
    return `<div class="oh-letra-linha">${linha}</div>`;
  });
  return `<div class="oh-composicao-preview">${linhas.join("")}</div>`;
}

async function carregarListaComposicoes() {
  const select = document.getElementById("composicoesSelect");
  if (!select) return;
  try {
    const resp = await fetch(`${API_BASE}/api/composicoes`);
    const dados = await resp.json();
    const itens = dados.composicoes || [];
    select.innerHTML = itens.length === 0
      ? `<option value="">Nenhuma composição salva ainda</option>`
      : itens.map((c) => `<option value="${c.id}">${c.titulo} — v${c.versao}</option>`).join("");
  } catch (err) {
    select.innerHTML = `<option value="">Erro ao carregar</option>`;
  }
}

function inicializarComposicoes() {
  const tituloInput = document.getElementById("composicaoTitulo");
  const tomInput = document.getElementById("composicaoTom");
  const letraInput = document.getElementById("composicaoLetra");
  const btnPreview = document.getElementById("btnPreviewComposicao");
  const btnSalvar = document.getElementById("btnSalvarComposicao");
  const previewEl = document.getElementById("composicaoPreview");
  const statusEl = document.getElementById("composicaoStatus");
  const select = document.getElementById("composicoesSelect");
  const btnCarregar = document.getElementById("btnCarregarComposicao");
  const btnExcluir = document.getElementById("btnExcluirComposicao");

  if (!tituloInput || !btnSalvar) return;

  btnPreview.addEventListener("click", () => {
    if (!letraInput.value.trim()) {
      previewEl.innerHTML = `<p class="oh-em-construcao">Digite a letra para ver a prévia.</p>`;
      return;
    }
    previewEl.innerHTML = renderizarComposicaoHTML(letraInput.value);
  });

  btnSalvar.addEventListener("click", async () => {
    if (!tituloInput.value.trim() || !letraInput.value.trim()) {
      statusEl.textContent = "Preencha o título e a letra antes de salvar.";
      return;
    }
    btnSalvar.disabled = true;
    statusEl.textContent = "Salvando…";

    const form = new FormData();
    form.append("titulo", tituloInput.value.trim());
    form.append("tom", tomInput.value.trim());
    form.append("letra", letraInput.value);

    try {
      const resp = await fetch(`${API_BASE}/api/composicoes`, { method: "POST", body: form });
      if (!resp.ok) {
        const erro = await resp.json();
        statusEl.textContent = `Não foi possível salvar: ${erro.detail || resp.statusText}`;
      } else {
        statusEl.textContent = "✅ Composição salva!";
        carregarListaComposicoes();
      }
    } catch (err) {
      statusEl.textContent = `Erro ao salvar: ${err.message}`;
    } finally {
      btnSalvar.disabled = false;
    }
  });

  btnCarregar.addEventListener("click", async () => {
    const id = select.value;
    if (!id) return;
    try {
      const resp = await fetch(`${API_BASE}/api/composicoes/${id}`);
      if (!resp.ok) throw new Error("não encontrada");
      const dados = await resp.json();
      tituloInput.value = dados.titulo || "";
      tomInput.value = dados.tom || "";
      letraInput.value = dados.letra || "";
      previewEl.innerHTML = renderizarComposicaoHTML(letraInput.value);
      statusEl.textContent = "Composição carregada.";
    } catch (err) {
      statusEl.textContent = "Não foi possível carregar essa composição.";
    }
  });

  btnExcluir.addEventListener("click", async () => {
    const id = select.value;
    if (!id) return;
    if (!confirm("Excluir esta composição? Essa ação não pode ser desfeita.")) return;
    btnExcluir.disabled = true;
    try {
      await fetch(`${API_BASE}/api/composicoes/${id}`, { method: "DELETE" });
      tituloInput.value = "";
      tomInput.value = "";
      letraInput.value = "";
      previewEl.innerHTML = "";
      statusEl.textContent = "Composição excluída.";
      carregarListaComposicoes();
    } finally {
      btnExcluir.disabled = false;
    }
  });

  carregarListaComposicoes();
}
