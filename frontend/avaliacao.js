// ══════════════════════════════════════════════════════════════
// avaliacao.js — Avaliação Vocal Inicial (perfil vocal do usuário)
// ══════════════════════════════════════════════════════════════

const EXERCICIOS_AVALIACAO = ["grave", "aguda", "confortavel", "glissando", "frase"];

function vozTipoAtual() {
  const marcado = document.querySelector('input[name="avaliacaoVozTipo"]:checked');
  return marcado ? marcado.value : "Masculina";
}

async function carregarPerfilExistente() {
  try {
    const resp = await fetch(`${API_BASE}/api/avaliacao/perfil`);
    const dados = await resp.json();
    const aviso = document.getElementById("avaliacaoPerfilExistente");
    if (aviso && dados && dados.classificacao) {
      aviso.hidden = false;
    }
  } catch (err) {
    // silencioso — não é crítico não conseguir checar se já existe perfil
  }
}

function inicializarAvaliacao() {
  const btnGerar = document.getElementById("btnGerarAvaliacao");
  const statusEl = document.getElementById("avaliacaoStatus");
  const resultadoEl = document.getElementById("avaliacaoResultado");
  if (!btnGerar) return;

  const resultadosExercicios = {};

  function atualizarBotaoGerar() {
    const quantos = Object.keys(resultadosExercicios).length;
    btnGerar.disabled = quantos < 3;
    btnGerar.textContent = quantos < 3
      ? `📊 Gerar minha avaliação (${quantos}/3 mínimo)`
      : `📊 Gerar minha avaliação (${quantos}/5)`;
  }

  EXERCICIOS_AVALIACAO.forEach((chave) => {
    const container = document.querySelector(`[data-exercicio="${chave}"]`);
    const statusExercicio = document.querySelector(`[data-status-exercicio="${chave}"]`);
    if (!container) return;

    criarGravador(container, {
      onGravado: async (blob) => {
        statusExercicio.textContent = "Analisando…";
        const form = new FormData();
        form.append("arquivo", arquivoDeGravacao(blob, "exercicio"));
        try {
          const resp = await fetch(`${API_BASE}/api/avaliacao/exercicio`, { method: "POST", body: form });
          if (!resp.ok) {
            const erro = await resp.json();
            statusExercicio.textContent = `⚠️ ${erro.detail || "Não detectei voz. Tente de novo."}`;
            delete resultadosExercicios[chave];
            atualizarBotaoGerar();
            return;
          }
          const resultado = await resp.json();
          resultadosExercicios[chave] = resultado;
          statusExercicio.textContent = "✅ Capturado!";
          atualizarBotaoGerar();
        } catch (err) {
          statusExercicio.textContent = `Erro: ${err.message}`;
        }
      },
      onExcluido: () => {
        delete resultadosExercicios[chave];
        statusExercicio.textContent = "";
        atualizarBotaoGerar();
      },
    });
  });

  btnGerar.addEventListener("click", async () => {
    const lista = Object.values(resultadosExercicios);
    if (lista.length < 3) {
      statusEl.textContent = "Grave pelo menos 3 exercícios antes de gerar a avaliação.";
      return;
    }

    btnGerar.disabled = true;
    statusEl.textContent = "Gerando avaliação…";

    const form = new FormData();
    form.append("voz_tipo", vozTipoAtual());
    form.append("resultados", JSON.stringify(lista));

    try {
      const resp = await fetch(`${API_BASE}/api/avaliacao/gerar`, { method: "POST", body: form });
      if (!resp.ok) {
        const erro = await resp.json();
        statusEl.textContent = `Não foi possível gerar: ${erro.detail || resp.statusText}`;
        btnGerar.disabled = false;
        return;
      }
      const perfil = await resp.json();
      resultadoEl.innerHTML = [
        metricaHTML("Classificação", perfil.classificacao, `voz ${perfil.voz_tipo.toLowerCase()}`),
        metricaHTML("Extensão", `${perfil.nota_grave} → ${perfil.nota_aguda}`, `${perfil.extensao_semitons} semitons`),
        metricaHTML("Tessitura confortável", perfil.tessitura, "onde sua voz mora"),
        metricaHTML("Exercícios", `${perfil.exercicios_feitos}/5`, "capturados nesta avaliação"),
      ].join("");
      statusEl.textContent = "✅ Perfil salvo! O professor já vai usar esses dados nas próximas análises.";
    } catch (err) {
      statusEl.textContent = `Erro ao gerar avaliação: ${err.message}`;
    } finally {
      btnGerar.disabled = false;
    }
  });

  atualizarBotaoGerar();
  carregarPerfilExistente();
}
