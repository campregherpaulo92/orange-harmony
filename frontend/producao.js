// ══════════════════════════════════════════════════════════════
// producao.js — Estúdio de Produção: gera baixo, bateria e acordes
// ══════════════════════════════════════════════════════════════

const ESTILOS_MUSICAIS = {
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

function montarSelectEstilos() {
  const select = document.getElementById("producaoEstiloSelect");
  if (!select) return;
  Object.keys(ESTILOS_MUSICAIS).forEach((nome) => {
    const opt = document.createElement("option");
    opt.value = nome;
    opt.textContent = nome;
    select.appendChild(opt);
  });
  atualizarDescricaoEstilo();
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
      ? new File([blobGravado], "gravacao.webm", { type: "audio/webm" })
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
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);

      document.getElementById("producaoInfo").textContent = `Detectado: ${bpm} BPM · Tom: ${tom} · Estilo: ${select.value}`;
      criarPlayer(document.getElementById("producaoPlayerContainer"), { src: url, nomeArquivo: "producao_orange_harmony.wav" });

      resultadoEl.hidden = false;
      statusEl.textContent = "";
    } catch (err) {
      statusEl.textContent = `Erro ao gerar produção: ${err.message}`;
    } finally {
      btnGerar.disabled = false;
    }
  });
}
