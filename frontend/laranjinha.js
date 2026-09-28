// ══════════════════════════════════════════════════════════════
// laranjinha.js — Chat da Laranjinha: múltiplas conversas nomeadas
// (persistidas no servidor), com memória cruzada entre elas.
// ══════════════════════════════════════════════════════════════

let laranjinhaChatAtualId = null;

function adicionarMensagemChat(container, texto, papel) {
  const bolha = document.createElement("div");
  bolha.className = `oh-chat-bolha oh-chat-${papel}`;
  bolha.textContent = texto;
  container.appendChild(bolha);
  container.scrollTop = container.scrollHeight;
  return bolha;
}

async function carregarListaChats(selecionarId) {
  const select = document.getElementById("laranjinhaChatSelect");
  if (!select) return;
  try {
    const resp = await fetch(`${API_BASE}/api/laranjinha/chats`);
    const dados = await resp.json();
    const listaChats = dados.chats || [];

    if (listaChats.length === 0) {
      // Sem Firebase configurado, ou primeira vez — cria uma conversa padrão
      const criado = await criarNovoChat("Conversa 1", false);
      return criado;
    }

    select.innerHTML = listaChats.map((c) => `<option value="${c.id}">${c.nome}</option>`).join("");
    const alvo = selecionarId && listaChats.some((c) => c.id === selecionarId)
      ? selecionarId
      : listaChats[0].id;
    select.value = alvo;
    laranjinhaChatAtualId = alvo;
    await carregarMensagensDoChat(alvo);
  } catch (err) {
    // sem Firebase/erro de rede — segue em modo "sem memória persistida"
    laranjinhaChatAtualId = null;
  }
}

async function carregarMensagensDoChat(chatId) {
  const mensagensEl = document.getElementById("laranjinhaMensagens");
  if (!mensagensEl) return;
  try {
    const resp = await fetch(`${API_BASE}/api/laranjinha/chats/${chatId}/mensagens`);
    const dados = await resp.json();
    const msgs = dados.mensagens || [];
    if (msgs.length === 0) {
      mensagensEl.innerHTML = `<div class="oh-chat-boasvindas">Oi! Eu sou a Laranjinha 🍊 Posso ouvir suas gravações, avaliar seu canto, gerar produções, aplicar edição vocal, salvar composições, renomear ou excluir gravações — é só pedir! Eu também lembro de tudo que você já me contou em outras conversas.</div>`;
      return;
    }
    mensagensEl.innerHTML = "";
    msgs.forEach((m) => {
      const papel = m.role === "user" ? "usuario" : "assistente";
      adicionarMensagemChat(mensagensEl, m.content, papel);
    });
  } catch (err) {
    mensagensEl.innerHTML = `<div class="oh-chat-boasvindas">Não foi possível carregar essa conversa: ${err.message}</div>`;
  }
}

async function criarNovoChat(nomeSugerido, recarregar = true) {
  const form = new FormData();
  form.append("nome", nomeSugerido || `Conversa ${new Date().toLocaleDateString("pt-BR")}`);
  try {
    const resp = await fetch(`${API_BASE}/api/laranjinha/chats`, { method: "POST", body: form });
    if (!resp.ok) return null;
    const dados = await resp.json();
    if (recarregar) await carregarListaChats(dados.id);
    return dados.id;
  } catch (err) {
    return null;
  }
}

async function enviarMensagemLaranjinha() {
  const input = document.getElementById("laranjinhaInput");
  const mensagens = document.getElementById("laranjinhaMensagens");
  const texto = (input.value || "").trim();
  if (!texto) return;

  input.value = "";
  input.style.height = "auto";
  adicionarMensagemChat(mensagens, texto, "usuario");

  const bolhaCarregando = adicionarMensagemChat(mensagens, "Pensando…", "assistente");

  const form = new FormData();
  form.append("mensagem", texto);
  if (laranjinhaChatAtualId) form.append("chat_id", laranjinhaChatAtualId);

  try {
    const resp = await fetch(`${API_BASE}/api/laranjinha/mensagem`, { method: "POST", body: form });
    const dados = await resp.json();
    bolhaCarregando.textContent = dados.resposta;
  } catch (err) {
    bolhaCarregando.textContent = `Erro ao conectar: ${err.message}`;
  }
  mensagens.scrollTop = mensagens.scrollHeight;
}

function inicializarLaranjinha() {
  const painel = document.getElementById("laranjinhaPainel");
  const btnFechar = document.getElementById("btnFecharLaranjinha");
  const btnEnviar = document.getElementById("btnEnviarLaranjinha");
  const input = document.getElementById("laranjinhaInput");
  const fab = document.getElementById("fabLaranjinha");
  const select = document.getElementById("laranjinhaChatSelect");
  const btnNovo = document.getElementById("btnNovoChat");
  const btnRenomear = document.getElementById("btnRenomearChat");
  const btnExcluir = document.getElementById("btnExcluirChat");
  if (!painel || !fab) return;

  let jaCarregou = false;

  fab.addEventListener("click", async () => {
    painel.hidden = !painel.hidden;
    if (!painel.hidden) {
      input.focus();
      if (!jaCarregou) {
        jaCarregou = true;
        await carregarListaChats();
      }
    }
  });
  btnFechar.addEventListener("click", () => { painel.hidden = true; });
  btnEnviar.addEventListener("click", enviarMensagemLaranjinha);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      enviarMensagemLaranjinha();
    }
  });
  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 96)}px`;
  });

  select.addEventListener("change", () => {
    laranjinhaChatAtualId = select.value;
    carregarMensagensDoChat(select.value);
  });

  btnNovo.addEventListener("click", async () => {
    const nome = prompt("Nome da nova conversa:", `Conversa ${new Date().toLocaleDateString("pt-BR")}`);
    if (nome === null) return;
    await criarNovoChat(nome);
  });

  btnRenomear.addEventListener("click", async () => {
    if (!laranjinhaChatAtualId) return;
    const nomeAtual = select.options[select.selectedIndex]?.textContent || "";
    const novoNome = prompt("Novo nome da conversa:", nomeAtual);
    if (!novoNome || !novoNome.trim()) return;
    const form = new FormData();
    form.append("novo_nome", novoNome.trim());
    await fetch(`${API_BASE}/api/laranjinha/chats/${laranjinhaChatAtualId}`, { method: "PUT", body: form });
    await carregarListaChats(laranjinhaChatAtualId);
  });

  btnExcluir.addEventListener("click", async () => {
    if (!laranjinhaChatAtualId) return;
    if (!confirm("Excluir esta conversa e todo o histórico dela? Essa ação não pode ser desfeita.")) return;
    await fetch(`${API_BASE}/api/laranjinha/chats/${laranjinhaChatAtualId}`, { method: "DELETE" });
    laranjinhaChatAtualId = null;
    await carregarListaChats();
  });

  inicializarRedimensionamentoLaranjinha();
}

// ── Arrastar a alça do lado esquerdo do painel pra redimensionar a largura,
// com o valor salvo no localStorage pra persistir entre sessões ──
function inicializarRedimensionamentoLaranjinha() {
  const painel = document.getElementById("laranjinhaPainel");
  const handle = document.getElementById("laranjinhaResize");
  if (!painel || !handle) return;

  const larguraSalva = localStorage.getItem("oh_laranjinha_largura");
  if (larguraSalva) painel.style.width = `${larguraSalva}px`;

  let arrastando = false;
  handle.addEventListener("pointerdown", (e) => {
    arrastando = true;
    handle.classList.add("oh-resize-ativo");
    handle.setPointerCapture(e.pointerId);
  });
  handle.addEventListener("pointermove", (e) => {
    if (!arrastando) return;
    // o painel é ancorado pela direita (right: 24px fixo), então a largura
    // é a distância entre o mouse e a borda direita da tela
    const novaLargura = Math.min(window.innerWidth - 40, Math.max(320, window.innerWidth - e.clientX - 24));
    painel.style.width = `${novaLargura}px`;
  });
  function pararArraste() {
    if (!arrastando) return;
    arrastando = false;
    handle.classList.remove("oh-resize-ativo");
    localStorage.setItem("oh_laranjinha_largura", parseInt(painel.style.width, 10));
  }
  handle.addEventListener("pointerup", pararArraste);
  handle.addEventListener("pointercancel", pararArraste);
}
