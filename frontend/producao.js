// ══════════════════════════════════════════════════════════════
// producao.js — catálogo de estilos musicais (usado pelo Songwriter e pela ferramenta Produtor do Orange Studio).
// A geração em si mora no Orange Studio (aba Produtor); a antiga página de Produção saiu do menu lateral.
// ══════════════════════════════════════════════════════════════

// Lista de RESERVA (se o servidor não responder). A lista completa e atual vem de /api/estilos (catálogo único em ritmos.py).
let GRUPOS_ESTILOS = null;
let ESTILOS_MUSICAIS = {
  "Pop": "Leve e dançante — acordes a cada compasso, clima pop radiofônico.",
  "Rock": "Energético — acordes firmes e bateria marcada nos tempos 2 e 4.",
  "Balada": "Calmo e emotivo — acordes longos e suaves, clima intimista.",
  "Sertanejo": "Violão marcado — acordes abertos e andamento médio.",
  "Funk": "Ritmado — acordes curtos e groove constante.",
  "MPB": "Melódico e sofisticado — acordes abertos e clima brasileiro.",
  "Gospel": "Emocional e edificante — acordes longos e clima de adoração.",
  "Reggae": "Descontraído — batida no contratempo e acordes abertos.",
  "Blues": "Clima de bar — progressão de blues e swing leve.",
  "Jazz": "Sofisticado — acordes com tensão (7ª) e andamento médio.",
  "Forró": "Animado — baião/xote com acordes marcados.",
  "Eletrônica": "Dançante — acordes curtos e groove constante de club.",
};

// Preenche um <select> com o catálogo (em grupos: Samba e Pagode, Pop e Rock...) — usado pela Produção e pelo Songwriter
function preencherSelectEstilos(select) {
  if (!select) return;
  const anterior = select.value;
  select.replaceChildren();
  const novaOpcao = (nome) => { const o = document.createElement("option"); o.value = nome; o.textContent = nome; return o; };
  if (GRUPOS_ESTILOS) {
    GRUPOS_ESTILOS.forEach((g) => {
      const grupo = document.createElement("optgroup");
      grupo.label = g.grupo;
      g.estilos.forEach((e) => grupo.appendChild(novaOpcao(e.nome)));
      select.appendChild(grupo);
    });
  } else {
    Object.keys(ESTILOS_MUSICAIS).forEach((nome) => select.appendChild(novaOpcao(nome)));
  }
  select.value = anterior && ESTILOS_MUSICAIS[anterior] !== undefined ? anterior : (ESTILOS_MUSICAIS["Pop"] !== undefined ? "Pop" : select.options[0].value);
}

// Busca o catálogo no servidor e refaz as listas (Produção e Songwriter). Se falhar, a lista de reserva continua valendo.
async function carregarEstilos() {
  try {
    const dados = await (await fetch(`${API_BASE}/api/estilos`)).json();
    if (!dados.grupos || !dados.grupos.length) return;
    GRUPOS_ESTILOS = dados.grupos;
    ESTILOS_MUSICAIS = {};
    dados.grupos.forEach((g) => g.estilos.forEach((e) => { ESTILOS_MUSICAIS[e.nome] = e.descricao; }));
    if (typeof montarSelectEstiloSongwriter === "function") montarSelectEstiloSongwriter();
  } catch (err) { /* sem servidor: fica a lista básica */ }
}

// Chamado na abertura do app: carrega o catálogo completo de estilos do servidor (Songwriter e Produtor do Estúdio).
function inicializarProducao() {
  carregarEstilos();
}
