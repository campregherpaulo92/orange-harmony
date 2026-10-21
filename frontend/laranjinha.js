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
  pararDitadoLaranjinha(true);                       // se estava ditando, encerra sem deixar texto atrasado voltar para a caixa

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
    bolhaCarregando.textContent = dados.resposta || dados.detail || "Não recebi resposta. Tente de novo.";
  } catch (err) {
    bolhaCarregando.textContent = `Erro: ${mensagemDeErroDeRede(err)}`;
  }
  mensagens.scrollTop = mensagens.scrollHeight;
}

// ── Ditado por voz (botão do microfone) ─────────────────────────────────────────────
// Usa o reconhecimento de fala do próprio navegador: não passa pelo nosso servidor e não gasta cota do Gemini.
// O que você fala vira texto na caixa; dá para corrigir antes de enviar. (O áudio é processado pelo serviço de voz do
// navegador: Google no Chrome, Apple no Safari.)
const ditadoLaranjinha = { rec: null, ativo: false, base: "", descartar: false, programatico: false, timerAviso: null };
const MENSAGENS_DITADO = {
  "not-allowed": "O navegador bloqueou o microfone. Permita o acesso ao microfone para este site e tente de novo.",
  "service-not-allowed": "O ditado por voz está desligado neste aparelho. No iPhone: Ajustes › Geral › Teclado › Ativar Ditado.",
  "audio-capture": "Não encontrei um microfone neste aparelho.",
  "network": "Sem conexão com o serviço de voz do navegador. Tente de novo.",
  "no-speech": "Não ouvi nada. Tente de novo, mais perto do microfone.",
  "language-not-supported": "O ditado em português não está disponível neste navegador.",
};

// tela de toque (celular/tablet sem mouse): não há tecla Shift, e focar a caixa abriria o teclado na cara da pessoa
function ehTelaDeToque() {
  return !!(window.matchMedia && window.matchMedia("(hover: none) and (pointer: coarse)").matches);
}

function avisoDeVozLaranjinha(texto) {
  const el = document.getElementById("laranjinhaVozAviso");
  if (!el) return;
  clearTimeout(ditadoLaranjinha.timerAviso);
  if (!texto) { el.hidden = true; return; }
  el.textContent = texto;
  el.hidden = false;
  ditadoLaranjinha.timerAviso = setTimeout(() => { el.hidden = true; }, 8000);
}

function atualizarBotaoMicLaranjinha(ativo) {
  const btn = document.getElementById("btnMicLaranjinha");
  if (!btn) return;
  btn.classList.toggle("gravando", ativo);
  btn.setAttribute("aria-pressed", ativo ? "true" : "false");
  btn.title = ativo ? "Parar o ditado" : "Falar para escrever (ditado por voz)";
}

// descartar = true: encerra na hora e ignora o que ainda estava a caminho (usado ao enviar/fechar)
function pararDitadoLaranjinha(descartar = false) {
  const d = ditadoLaranjinha;
  if (!d.rec || !d.ativo) return;
  d.descartar = descartar;
  try { descartar ? d.rec.abort() : d.rec.stop(); } catch (e) { /* já encerrou */ }
}

function inicializarDitadoLaranjinha(input) {
  const btn = document.getElementById("btnMicLaranjinha");
  if (!btn) return;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    btn.disabled = true;
    btn.title = "Este navegador não tem ditado por voz. No celular, use o microfone do teclado.";
    return;
  }
  const d = ditadoLaranjinha;

  btn.addEventListener("click", () => {
    if (d.ativo) { pararDitadoLaranjinha(false); return; }          // 2º toque: para e mantém o texto
    const rec = new SR();
    rec.lang = "pt-BR";
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    d.descartar = false;
    d.base = input.value && !/\s$/.test(input.value) ? input.value + " " : input.value;   // o ditado continua de onde o texto está

    rec.onstart = () => { d.ativo = true; atualizarBotaoMicLaranjinha(true); avisoDeVozLaranjinha(null); };
    rec.onresult = (ev) => {
      if (d.descartar || d.rec !== rec) return;                      // ditado encerrado/descartado: ignora fala atrasada
      let fala = "";
      for (let i = 0; i < ev.results.length; i++) {
        const trecho = ev.results[i][0].transcript;
        fala = !fala ? trecho.replace(/^\s+/, "") : (/\s$/.test(fala) || /^\s/.test(trecho) ? fala + trecho : fala + " " + trecho);
      }
      input.value = d.base + fala;
      d.programatico = true;
      input.dispatchEvent(new Event("input"));                      // a caixa cresce conforme o texto
      d.programatico = false;
    };
    rec.onerror = (ev) => {
      if (ev.error === "aborted") return;
      avisoDeVozLaranjinha(MENSAGENS_DITADO[ev.error] || `Não consegui usar o microfone (${ev.error}).`);
    };
    rec.onend = () => {
      d.ativo = false; d.rec = null; d.descartar = false;
      atualizarBotaoMicLaranjinha(false);
      if (!ehTelaDeToque()) input.focus();
      try { input.setSelectionRange(input.value.length, input.value.length); } catch (e) { /* ok */ }
    };
    d.rec = rec;
    try {
      rec.start();
      d.ativo = true;
      atualizarBotaoMicLaranjinha(true);
      if (!ehTelaDeToque()) input.focus();                           // o foco volta para a caixa: Enter envia, digitar continua funcionando
    } catch (e) {
      d.rec = null; d.ativo = false;
      avisoDeVozLaranjinha("Não consegui iniciar o microfone. Tente de novo.");
    }
  });

  // se a pessoa começa a digitar enquanto o ditado está ligado, o ditado para (senão ele sobrescreveria o que foi digitado)
  input.addEventListener("input", () => {
    if (!d.programatico && d.ativo) pararDitadoLaranjinha(false);
  });
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
    if (painel.hidden) pararDitadoLaranjinha(true);
    if (!painel.hidden) {
      input.focus();
      if (!jaCarregou) {
        jaCarregou = true;
        await carregarListaChats();
      }
    }
  });
  btnFechar.addEventListener("click", () => { pararDitadoLaranjinha(true); painel.hidden = true; });
  btnEnviar.addEventListener("click", enviarMensagemLaranjinha);

  // Quebra de linha e envio:
  //  • computador: Enter envia · Shift+Enter quebra a linha · Ctrl/Cmd+Enter também envia
  //  • celular (tela de toque, sem tecla Shift): Enter quebra a linha e o botão ➤ envia
  const ehToque = ehTelaDeToque();
  input.enterKeyHint = ehToque ? "enter" : "send";
  input.placeholder = ehToque ? "Escreva sua mensagem..." : "Escreva sua mensagem... (Shift+Enter quebra a linha)";
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.isComposing) return;                  // não envia no meio de uma composição de acento
    const enviar = e.ctrlKey || e.metaKey || (!e.shiftKey && !ehToque);
    if (enviar) {
      e.preventDefault();
      enviarMensagemLaranjinha();
    }
  });
  inicializarDitadoLaranjinha(input);
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
