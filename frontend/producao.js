// ══════════════════════════════════════════════════════════════
// producao.js — Estúdio de Produção: gera baixo, bateria e acordes
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

function montarSelectEstilos() {
  const select = document.getElementById("producaoEstiloSelect");
  if (!select) return;
  preencherSelectEstilos(select);
  atualizarDescricaoEstilo();
}

// Busca o catálogo no servidor e refaz as listas (Produção e Songwriter). Se falhar, a lista de reserva continua valendo.
async function carregarEstilos() {
  try {
    const dados = await (await fetch(`${API_BASE}/api/estilos`)).json();
    if (!dados.grupos || !dados.grupos.length) return;
    GRUPOS_ESTILOS = dados.grupos;
    ESTILOS_MUSICAIS = {};
    dados.grupos.forEach((g) => g.estilos.forEach((e) => { ESTILOS_MUSICAIS[e.nome] = e.descricao; }));
    montarSelectEstilos();
    if (typeof montarSelectEstiloSongwriter === "function") montarSelectEstiloSongwriter();
  } catch (err) { /* sem servidor: fica a lista básica */ }
}

function atualizarDescricaoEstilo() {
  const select = document.getElementById("producaoEstiloSelect");
  const desc = document.getElementById("producaoEstiloDescricao");
  if (!select || !desc) return;
  desc.textContent = ESTILOS_MUSICAIS[select.value] || "";
}

function inicializarProducao() {
  const inputArquivo = document.getElementById("producaoArquivo");
  const btnGerar = document.getElementById("btnGerarProducao");
  const statusEl = document.getElementById("producaoStatus");
  const resultadoEl = document.getElementById("producaoResultado");
  const select = document.getElementById("producaoEstiloSelect");

  if (!btnGerar) return;

  montarSelectEstilos();
  carregarEstilos();
  select.addEventListener("change", atualizarDescricaoEstilo);

  const btnInterpretar = document.getElementById("btnInterpretarProducao");
  const descricaoIAInput = document.getElementById("producaoDescricaoIA");
  const statusIA = document.getElementById("producaoStatusIA");
  if (btnInterpretar) {
    btnInterpretar.addEventListener("click", async () => {
      const descricao = (descricaoIAInput.value || "").trim();
      if (!descricao) {
        statusIA.textContent = "Descreva o que você quer primeiro.";
        return;
      }
      btnInterpretar.disabled = true;
      statusIA.textContent = "Pensando na melhor combinação…";
      const form = new FormData();
      form.append("descricao", descricao);
      try {
        const resp = await fetch(`${API_BASE}/api/producao/interpretar`, { method: "POST", body: form });
        const dados = await resp.json();
        if (dados.estilo && [...select.options].some((o) => o.value === dados.estilo)) {
          select.value = dados.estilo;
          atualizarDescricaoEstilo();
        }
        document.getElementById("producaoComBaixo").checked = !!dados.com_baixo;
        document.getElementById("producaoComBateria").checked = !!dados.com_bateria;
        document.getElementById("producaoComAcordes").checked = !!dados.com_acordes;
        document.getElementById("producaoComTeclado").checked = !!dados.com_teclado;
        document.getElementById("producaoComSolo").checked = !!dados.com_solo;
        document.getElementById("producaoQualidadePro").checked = !!dados.qualidade_pro;
        statusIA.textContent = "✅ Sugestão aplicada — revise e clique em Gerar produção.";
      } catch (err) {
        statusIA.textContent = `Erro: ${err.message}`;
      } finally {
        btnInterpretar.disabled = false;
      }
    });
  }

  let blobGravado = null;
  const containerGravador = document.getElementById("gravadorEstudio");
  if (containerGravador) {
    criarGravador(containerGravador, {
      onGravado: (blob) => { blobGravado = blob; },
    });
  }

  inputArquivo.addEventListener("change", () => {
    if (inputArquivo.files[0]) {
      blobGravado = null;
      document.getElementById("producaoNomeArquivo").textContent = `Selecionado: ${inputArquivo.files[0].name}`;
    }
  });

  btnGerar.addEventListener("click", async () => {
    const arquivo = inputArquivo.files[0] || (blobGravado
      ? arquivoDeGravacao(blobGravado, "gravacao")
      : null);

    if (!arquivo) {
      statusEl.textContent = "Suba um áudio ou grave sua música primeiro.";
      return;
    }

    btnGerar.disabled = true;
    statusEl.textContent = "Gerando produção… pode levar alguns segundos.";
    resultadoEl.hidden = true;

    const form = new FormData();
    form.append("arquivo", arquivo);
    form.append("estilo", select.value);
    form.append("acordes_modo", document.getElementById("producaoAcordes").value);
    const bpmManual = parseFloat(document.getElementById("producaoBpm").value);
    if (bpmManual >= 40 && bpmManual <= 220) form.append("bpm_manual", String(bpmManual));          // em branco = detecta sozinho
    form.append("com_baixo", document.getElementById("producaoComBaixo").checked ? "true" : "false");
    form.append("com_bateria", document.getElementById("producaoComBateria").checked ? "true" : "false");
    form.append("com_acordes", document.getElementById("producaoComAcordes").checked ? "true" : "false");
    form.append("com_teclado", document.getElementById("producaoComTeclado").checked ? "true" : "false");
    form.append("com_solo", document.getElementById("producaoComSolo").checked ? "true" : "false");
    form.append("qualidade_pro", document.getElementById("producaoQualidadePro").checked ? "true" : "false");

    try {
      const resp = await fetch(`${API_BASE}/api/producao`, { method: "POST", body: form });
      if (!resp.ok) {
        const erro = await resp.json();
        statusEl.textContent = `Não foi possível gerar: ${erro.detail || resp.statusText}`;
        return;
      }
      const bpm = resp.headers.get("X-BPM");
      const tom = resp.headers.get("X-Tom");
      const modo = resp.headers.get("X-Modo");
      const acordes = decodeURIComponent(resp.headers.get("X-Acordes") || "");
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);

      document.getElementById("producaoInfo").textContent = `Detectado: ${bpm} BPM · Tom: ${tom}${modo ? " " + modo : ""} · Estilo: ${select.value}${acordes ? " · Acordes que seguem a sua melodia: " + acordes : ""}${textoAvisoDuracao(resp.headers.get("X-Aviso"))}`;
      criarPlayer(document.getElementById("producaoPlayerContainer"), { src: url, nomeArquivo: "producao_orange_harmony.wav" });

      resultadoEl.hidden = false;
      statusEl.textContent = "";
    } catch (err) {
      statusEl.textContent = `Erro ao gerar produção: ${mensagemDeErroDeRede(err)}`;
    } finally {
      btnGerar.disabled = false;
    }
  });
}
