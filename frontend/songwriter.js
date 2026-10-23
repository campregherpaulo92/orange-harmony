// ══════════════════════════════════════════════════════════════
// songwriter.js — Letra (Gemini) + referência sonora (Gemini ouve o áudio) +
// prompt musical rico (Gemini) + geração de música completa (YuE2/Hugging Face)
// ══════════════════════════════════════════════════════════════

function montarSelectEstiloSongwriter() {
  const select = document.getElementById("songwriterEstilo");
  if (!select || typeof ESTILOS_MUSICAIS === "undefined") return;
  preencherSelectEstilos(select);                    // mesma lista agrupada da Produção (vem de /api/estilos)
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
      const abcDaMusica = partituraDoCabecalho(resp);
      if (abcDaMusica) {
        mostrarBlocoCover(abcDaMusica,
          "Esta é a melodia da música que você acabou de gerar. Para trocar só a letra: edite o campo \"Letra\" e clique em \"Gerar versão com banda\" (a melodia é mantida). Se a partitura trouxer linhas começando com \"w:\" (a letra antiga escrita dentro dela), apague essas linhas antes.",
          letraTexto.value);
      }
    } catch (err) {
      statusMusica.textContent = `Erro: ${err.message}`;
    } finally {
      btnGerarMusica.disabled = false;
    }
  });

  // ── Cover: criar a partir da minha gravação, ou trocar só a letra mantendo a melodia ──
  const coverBloco = document.getElementById("songwriterCoverBloco");
  const abcTexto = document.getElementById("songwriterAbcTexto");
  const coverDica = document.getElementById("songwriterCoverDica");
  const coverModeloBox = document.getElementById("songwriterCoverModeloBox");
  const letraModeloEl = document.getElementById("songwriterLetraModelo");
  const coverEstilo = document.getElementById("songwriterCoverEstilo");
  const coverQualidade = document.getElementById("songwriterCoverQualidade");
  const coverIdioma = document.getElementById("songwriterCoverIdioma");
  const statusCover = document.getElementById("songwriterStatusCover");
  const coverResultado = document.getElementById("songwriterCoverResultado");
  const btnExtrairMelodia = document.getElementById("btnExtrairMelodia");
  const btnGerarCover = document.getElementById("btnGerarCover");
  let letraDaMelodia = "";    // a letra para a qual a melodia foi feita (reconhecida na gravação, ou usada ao gerar a música)

  function contarVersos(texto) {
    return (texto || "").split("\n").map((l) => l.trim())
      .filter((l) => l && !/^\[.*\]$/.test(l) && !l.startsWith("#")).length;
  }

  function partituraDoCabecalho(resp) {
    const b64 = resp.headers.get("X-Partitura-ABC");
    if (!b64) return null;
    try {
      return new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
    } catch (e) {
      return null;
    }
  }

  function mostrarBlocoCover(abc, dica, letraModelo) {
    if (!coverBloco) return;
    abcTexto.value = abc;
    coverDica.textContent = dica || "";
    letraDaMelodia = letraModelo || "";
    letraModeloEl.value = letraDaMelodia;
    coverModeloBox.hidden = !letraDaMelodia.trim();
    if (!coverEstilo.value.trim() && promptTexto.value.trim()) coverEstilo.value = promptTexto.value;
    coverBloco.hidden = false;
  }

  function avisoDeMetrica(letra) {
    const modelo = contarVersos(letraDaMelodia);
    const nova = contarVersos(letra);
    if (!modelo || !nova) return "";
    if (Math.abs(nova - modelo) / modelo > 0.3) {
      return `⚠️ A sua letra tem ${nova} versos e a melodia foi feita para cerca de ${modelo}; pode encaixar mal.`;
    }
    return "";
  }

  if (btnExtrairMelodia) {
    btnExtrairMelodia.addEventListener("click", async () => {
      const arquivo = arquivoReferenciaAtual();
      if (!arquivo) {
        statusCover.textContent = "Suba ou grave o áudio de referência primeiro (cartão acima).";
        return;
      }
      btnExtrairMelodia.disabled = true;
      statusCover.textContent = "🎧 Ouvindo a gravação e extraindo a melodia… pode levar alguns minutos.";
      const form = new FormData();
      form.append("arquivo", arquivo);
      form.append("idioma", coverIdioma.value);
      try {
        const resp = await fetch(`${API_BASE}/api/songwriter/analisar-gravacao`, { method: "POST", body: form });
        if (!resp.ok) {
          const erro = await resp.json().catch(() => ({}));
          statusCover.textContent = erro.detail || "Não foi possível extrair a melodia.";
          return;
        }
        const dados = await resp.json();
        mostrarBlocoCover(dados.abc,
          "Melodia extraída da sua gravação. Confira e, se quiser, corrija. Depois escreva ou cole a SUA letra no campo \"Letra\" logo abaixo.",
          dados.letra || "");
        letraCard.hidden = false;
        if (!letraTexto.value.trim() && dados.letra) letraTexto.value = dados.letra;
        const resumo = (dados.resumo || "").replace(/\s+/g, " ").trim().slice(0, 180);
        statusCover.textContent = "✅ Melodia extraída." + (resumo ? " " + resumo : "");
      } catch (err) {
        statusCover.textContent = `Erro: ${err.message}`;
      } finally {
        btnExtrairMelodia.disabled = false;
      }
    });
  }

  if (btnGerarCover) {
    btnGerarCover.addEventListener("click", async () => {
      const abc = abcTexto.value.trim();
      const letra = letraTexto.value.trim();
      if (!abc) {
        statusCover.textContent = "Falta a melodia: extraia da gravação, ou gere uma música primeiro.";
        return;
      }
      if (!letra) {
        letraCard.hidden = false;
        statusCover.textContent = "Escreva ou cole a letra no campo \"Letra\" (cartão logo abaixo).";
        return;
      }
      const aviso = avisoDeMetrica(letra);
      btnGerarCover.disabled = true;
      coverResultado.hidden = true;
      statusCover.textContent = (aviso ? aviso + " " : "") + "🎛️ Gerando a versão com banda… pode levar alguns minutos.";
      const form = new FormData();
      form.append("estilo", coverEstilo.value.trim() || promptTexto.value.trim());
      form.append("letra", letra);
      form.append("abc", abc);
      form.append("qualidade", coverQualidade.value);
      form.append("seed", "831001");
      try {
        const resp = await fetch(`${API_BASE}/api/songwriter/cover`, { method: "POST", body: form });
        if (!resp.ok) {
          const erro = await resp.json().catch(() => ({}));
          statusCover.textContent = erro.detail || "Não foi possível gerar a versão.";
          return;
        }
        const blob = await resp.blob();
        criarPlayer(coverResultado, { src: URL.createObjectURL(blob), nomeArquivo: "cover.wav" });
        coverResultado.hidden = false;
        statusCover.textContent = aviso;
      } catch (err) {
        statusCover.textContent = `Erro: ${err.message}`;
      } finally {
        btnGerarCover.disabled = false;
      }
    });
  }
}
