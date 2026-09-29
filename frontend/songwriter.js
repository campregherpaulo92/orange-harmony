// ══════════════════════════════════════════════════════════════
// songwriter.js — Letra (Gemini) + referência sonora (Gemini ouve o áudio) +
// prompt musical rico (Gemini) + geração de música completa (YuE2/Hugging Face)
// ══════════════════════════════════════════════════════════════

function montarSelectEstiloSongwriter() {
  const select = document.getElementById("songwriterEstilo");
  if (!select || typeof ESTILOS_MUSICAIS === "undefined") return;
  select.innerHTML = Object.keys(ESTILOS_MUSICAIS).map((nome) => `<option value="${nome}">${nome}</option>`).join("");
}

function inicializarSongwriter() {
  const btnGerarLetra = document.getElementById("btnGerarLetra");
  if (!btnGerarLetra) return;

  montarSelectEstiloSongwriter();

  let blobGravadoReferencia = null;
  let descricaoReferenciaAtual = null;
  const arquivoRefInput = document.getElementById("songwriterArquivo");
  const nomeArquivoRefEl = document.getElementById("songwriterNomeArquivo");
  const gravadorRefContainer = document.getElementById("songwriterGravador");
  if (gravadorRefContainer) {
    criarGravador(gravadorRefContainer, {
      onGravado: (blob) => { blobGravadoReferencia = blob; descricaoReferenciaAtual = null; },
      onExcluido: () => { blobGravadoReferencia = null; descricaoReferenciaAtual = null; },
    });
  }
  if (arquivoRefInput) {
    arquivoRefInput.addEventListener("change", () => {
      if (arquivoRefInput.files[0]) {
        blobGravadoReferencia = null;
        descricaoReferenciaAtual = null;
        nomeArquivoRefEl.textContent = `Selecionado: ${arquivoRefInput.files[0].name}`;
      }
    });
  }

  const temaInput = document.getElementById("songwriterTema");
  const estiloSelect = document.getElementById("songwriterEstilo");
  const usarContextoCheckbox = document.getElementById("songwriterUsarContexto");
  const statusLetra = document.getElementById("songwriterStatusLetra");
  const letraCard = document.getElementById("songwriterLetraCard");
  const letraTexto = document.getElementById("songwriterLetraTexto");
  const btnSalvarComposicao = document.getElementById("btnSalvarComoComposicao");
  const btnGerarPrompt = document.getElementById("btnGerarPromptMusical");
  const statusPrompt = document.getElementById("songwriterStatusPrompt");
  const promptCard = document.getElementById("songwriterPromptCard");
  const promptTexto = document.getElementById("songwriterPromptTexto");
  const btnCopiarPrompt = document.getElementById("btnCopiarPrompt");
  const btnGerarMusica = document.getElementById("btnGerarMusica");
  const statusMusica = document.getElementById("songwriterStatusMusica");
  const musicaResultado = document.getElementById("songwriterMusicaResultado");

  function arquivoReferenciaAtual() {
    return arquivoRefInput.files[0] || (blobGravadoReferencia
      ? arquivoDeGravacao(blobGravadoReferencia, "referencia")
      : null);
  }

  btnGerarLetra.addEventListener("click", async () => {
    const tema = (temaInput.value || "").trim();
    if (!tema) {
      statusLetra.textContent = "Escreva o tema da música primeiro.";
      return;
    }
    btnGerarLetra.disabled = true;
    statusLetra.textContent = "Escrevendo a letra…";
    promptCard.hidden = true;

    const form = new FormData();
    form.append("tema", tema);
    form.append("estilo", estiloSelect.value);

    try {
      const resp = await fetch(`${API_BASE}/api/songwriter/letra`, { method: "POST", body: form });
      if (!resp.ok) {
        const erro = await resp.json();
        statusLetra.textContent = erro.detail || "Não foi possível gerar a letra.";
        return;
      }
      const dados = await resp.json();
      letraTexto.value = dados.letra;
      letraCard.hidden = false;
      statusLetra.textContent = "";
    } catch (err) {
      statusLetra.textContent = `Erro: ${err.message}`;
    } finally {
      btnGerarLetra.disabled = false;
    }
  });

  btnSalvarComposicao.addEventListener("click", async () => {
    const form = new FormData();
    form.append("titulo", (temaInput.value || "Minha música").trim());
    form.append("tom", "");
    form.append("letra", letraTexto.value);
    try {
      const resp = await fetch(`${API_BASE}/api/composicoes`, { method: "POST", body: form });
      if (!resp.ok) {
        const erro = await resp.json();
        statusPrompt.textContent = `Não foi possível salvar: ${erro.detail || resp.statusText}`;
        return;
      }
      statusPrompt.textContent = "✅ Salva em Composições!";
    } catch (err) {
      statusPrompt.textContent = `Erro ao salvar: ${err.message}`;
    }
  });

  btnGerarPrompt.addEventListener("click", async () => {
    if (!letraTexto.value.trim()) {
      statusPrompt.textContent = "Gere ou escreva uma letra primeiro.";
      return;
    }
    btnGerarPrompt.disabled = true;
    promptCard.hidden = true;

    // 1) Se tiver referência sonora e ainda não foi analisada, analisa agora (Gemini ouve o áudio)
    const arquivoRef = arquivoReferenciaAtual();
    if (arquivoRef && !descricaoReferenciaAtual) {
      statusPrompt.textContent = "🎧 Ouvindo sua referência sonora…";
      const formRef = new FormData();
      formRef.append("arquivo", arquivoRef);
      try {
        const respRef = await fetch(`${API_BASE}/api/songwriter/referencia`, { method: "POST", body: formRef });
        if (respRef.ok) {
          const dadosRef = await respRef.json();
          descricaoReferenciaAtual = dadosRef.descricao;
        }
      } catch (err) {
        // segue sem a referência se der erro — não trava o resto do fluxo
      }
    }

    // 2) Opcionalmente injeta o tom da última análise no tema
    let temaFinal = (temaInput.value || "").trim();
    if (usarContextoCheckbox && usarContextoCheckbox.checked) {
      try {
        const respHist = await fetch(`${API_BASE}/api/historico`);
        const dadosHist = await respHist.json();
        const ultimaAnalise = (dadosHist.historico || [])[0];
        if (ultimaAnalise && ultimaAnalise.tom_ref) {
          temaFinal += ` (tom de referência da última análise: ${ultimaAnalise.tom_ref})`;
        }
      } catch (err) {
        // segue sem o contexto se não der pra buscar
      }
    }

    statusPrompt.textContent = "Montando o prompt musical…";
    const form = new FormData();
    form.append("letra", letraTexto.value);
    form.append("estilo", estiloSelect.value);
    if (temaFinal) form.append("tema", temaFinal);
    if (descricaoReferenciaAtual) form.append("descricao_referencia", descricaoReferenciaAtual);

    try {
      const resp = await fetch(`${API_BASE}/api/songwriter/prompt-musical`, { method: "POST", body: form });
      if (!resp.ok) {
        const erro = await resp.json();
        statusPrompt.textContent = erro.detail || "Não foi possível gerar o prompt.";
        return;
      }
      const dados = await resp.json();
      promptTexto.value = dados.prompt;
      promptCard.hidden = false;
      statusPrompt.textContent = descricaoReferenciaAtual
        ? `🎧 Referência interpretada como: ${descricaoReferenciaAtual}`
        : "";
    } catch (err) {
      statusPrompt.textContent = `Erro: ${err.message}`;
    } finally {
      btnGerarPrompt.disabled = false;
    }
  });

  btnCopiarPrompt.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(promptTexto.value);
      statusMusica.textContent = "Prompt copiado!";
    } catch (err) {
      statusMusica.textContent = "Não foi possível copiar automaticamente — selecione o texto manualmente.";
    }
  });

  btnGerarMusica.addEventListener("click", async () => {
    if (!letraTexto.value.trim()) {
      statusMusica.textContent = "Gere a letra primeiro (ela faz parte da composição).";
      return;
    }
    btnGerarMusica.disabled = true;
    statusMusica.textContent = "Gerando música via Hugging Face (YuE2)… pode levar alguns minutos.";
    musicaResultado.hidden = true;

    const form = new FormData();
    form.append("prompt_musical", promptTexto.value);
    form.append("letra", letraTexto.value);

    try {
      const resp = await fetch(`${API_BASE}/api/songwriter/musica`, { method: "POST", body: form });
      if (!resp.ok) {
        const erro = await resp.json();
        statusMusica.textContent = erro.detail || "Não foi possível gerar a música.";
        return;
      }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      criarPlayer(musicaResultado, { src: url, nomeArquivo: "songwriter.wav" });
      musicaResultado.hidden = false;
      statusMusica.textContent = "";
    } catch (err) {
      statusMusica.textContent = `Erro: ${err.message}`;
    } finally {
      btnGerarMusica.disabled = false;
    }
  });
}
