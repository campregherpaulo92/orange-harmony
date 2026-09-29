// ══════════════════════════════════════════════════════════════
// edicao.js — Edição Vocal Inteligente: efeitos manuais (checkboxes) ou
// comando em texto livre interpretado por IA (Gemini + fallback por
// palavras-chave), ambos aplicando os mesmos efeitos de DSP reais.
// ══════════════════════════════════════════════════════════════

const ROTULOS_ACOES = {
  reducao_ruido: "redução de ruído",
  normalizacao: "normalização de volume",
  eq_presenca: "EQ de presença",
  compressao: "compressão suave",
  reducao_sibilancia: "redução de sibilância",
  reverb_leve: "reverb leve",
};

function traduzirAcoesEdicao(headerBruto) {
  if (!headerBruto) return "";
  return headerBruto.split(",").map((codigo) => {
    const c = codigo.trim();
    if (c.startsWith("ajuste_tom:")) {
      const valor = c.split(":")[1];
      return `ajuste de tom (${valor} semitons)`;
    }
    return ROTULOS_ACOES[c] || c;
  }).join(", ");
}

function inicializarEdicaoVocal() {
  const inputArquivo = document.getElementById("edicaoArquivo");
  const btnAplicar = document.getElementById("btnAplicarEdicao");
  const statusEl = document.getElementById("edicaoStatus");
  const resultadoEl = document.getElementById("edicaoResultado");
  const nomeArquivoEl = document.getElementById("edicaoNomeArquivo");

  if (!btnAplicar) return;

  let blobGravado = null;
  const gravadorContainer = document.getElementById("edicaoGravador");
  if (gravadorContainer) {
    criarGravador(gravadorContainer, {
      onGravado: (blob) => { blobGravado = blob; },
      onExcluido: () => { blobGravado = null; },
    });
  }

  inputArquivo.addEventListener("change", () => {
    if (inputArquivo.files[0]) {
      blobGravado = null;
      nomeArquivoEl.textContent = `Selecionado: ${inputArquivo.files[0].name}`;
    }
  });

  btnAplicar.addEventListener("click", async () => {
    const arquivo = inputArquivo.files[0] || (blobGravado
      ? arquivoDeGravacao(blobGravado, "gravacao")
      : null);
    if (!arquivo) {
      statusEl.textContent = "Envie ou grave um áudio para editar.";
      return;
    }

    btnAplicar.disabled = true;
    statusEl.textContent = "Aplicando edição…";
    resultadoEl.hidden = true;

    const form = new FormData();
    form.append("arquivo", arquivo);
    form.append("reduzir_ruido", document.getElementById("edicaoReduzirRuido").checked ? "true" : "false");
    form.append("normalizar", document.getElementById("edicaoNormalizar").checked ? "true" : "false");
    form.append("ajustar_tom", document.getElementById("edicaoAjustarTom").value || "0");
    form.append("eq_presenca", document.getElementById("edicaoEqPresenca").checked ? "true" : "false");
    form.append("compressao", document.getElementById("edicaoCompressao").checked ? "true" : "false");
    form.append("remover_sibilancia", document.getElementById("edicaoRemoverSibilancia").checked ? "true" : "false");
    form.append("reverb_leve", document.getElementById("edicaoReverbLeve").checked ? "true" : "false");

    try {
      const resp = await fetch(`${API_BASE}/api/edicao`, { method: "POST", body: form });
      if (!resp.ok) {
        const erro = await resp.json();
        statusEl.textContent = `Não foi possível editar: ${erro.detail || resp.statusText}`;
        return;
      }
      const acoesBruto = resp.headers.get("X-Acoes");
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);

      document.getElementById("edicaoAcoesTexto").textContent = `Edição aplicada: ${traduzirAcoesEdicao(acoesBruto)}.${textoAvisoDuracao(resp.headers.get("X-Aviso"))}`;
      criarPlayer(document.getElementById("edicaoPlayerContainer"), { src: url, nomeArquivo: "editado.wav" });

      resultadoEl.hidden = false;
      statusEl.textContent = "";
    } catch (err) {
      statusEl.textContent = `Erro ao aplicar edição: ${mensagemDeErroDeRede(err)}`;
    } finally {
      btnAplicar.disabled = false;
    }
  });

  const btnComandoIA = document.getElementById("btnAplicarComandoIA");
  const comandoInput = document.getElementById("edicaoComandoIA");
  if (btnComandoIA) {
    btnComandoIA.addEventListener("click", async () => {
      const arquivo = inputArquivo.files[0] || (blobGravado
        ? arquivoDeGravacao(blobGravado, "gravacao")
        : null);
      const comando = (comandoInput.value || "").trim();
      if (!arquivo) {
        statusEl.textContent = "Envie ou grave um áudio para editar.";
        return;
      }
      if (!comando) {
        statusEl.textContent = "Descreva o que você quer primeiro.";
        return;
      }

      btnComandoIA.disabled = true;
      statusEl.textContent = "A IA está interpretando seu pedido…";
      resultadoEl.hidden = true;

      const form = new FormData();
      form.append("arquivo", arquivo);
      form.append("comando", comando);

      try {
        const resp = await fetch(`${API_BASE}/api/edicao/comando`, { method: "POST", body: form });
        if (!resp.ok) {
          const erro = await resp.json();
          statusEl.textContent = `Não foi possível editar: ${erro.detail || resp.statusText}`;
          return;
        }
        const acoesBruto = resp.headers.get("X-Acoes");
        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);

        document.getElementById("edicaoAcoesTexto").textContent = `Edição aplicada: ${traduzirAcoesEdicao(acoesBruto)}.${textoAvisoDuracao(resp.headers.get("X-Aviso"))}`;
        criarPlayer(document.getElementById("edicaoPlayerContainer"), { src: url, nomeArquivo: "editado.wav" });

        resultadoEl.hidden = false;
        statusEl.textContent = "";
      } catch (err) {
        statusEl.textContent = `Erro ao aplicar edição: ${mensagemDeErroDeRede(err)}`;
      } finally {
        btnComandoIA.disabled = false;
      }
    });
  }
}
