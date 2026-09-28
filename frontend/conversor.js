// ══════════════════════════════════════════════════════════════
// conversor.js — Conversão de áudio para múltiplos formatos
// ══════════════════════════════════════════════════════════════

const FORMATOS_CONVERSOR = ["WAV", "MP3", "FLAC", "OGG", "M4A"];

function inicializarConversor() {
  const inputArquivo = document.getElementById("conversorArquivo");
  const nomeEl = document.getElementById("conversorNomeArquivo");
  const btnConverter = document.getElementById("btnConverter");
  const resultadosEl = document.getElementById("conversorResultados");
  const statusEl = document.getElementById("conversorStatus");

  if (!inputArquivo || !btnConverter) return;

  inputArquivo.addEventListener("change", () => {
    const f = inputArquivo.files[0];
    nomeEl.textContent = f ? `Selecionado: ${f.name}` : "";
  });

  btnConverter.addEventListener("click", async () => {
    const arquivo = inputArquivo.files[0];
    if (!arquivo) {
      statusEl.textContent = "Envie um áudio para converter.";
      return;
    }
    const formatosMarcados = FORMATOS_CONVERSOR.filter(
      (f) => document.getElementById(`conversorFmt${f}`)?.checked
    );
    if (formatosMarcados.length === 0) {
      statusEl.textContent = "Escolha ao menos um formato de destino.";
      return;
    }

    btnConverter.disabled = true;
    statusEl.textContent = "Convertendo…";
    resultadosEl.innerHTML = "";

    for (const formato of formatosMarcados) {
      const form = new FormData();
      form.append("arquivo", arquivo);
      form.append("formato", formato);
      try {
        const resp = await fetch(`${API_BASE}/api/converter`, { method: "POST", body: form });
        if (!resp.ok) {
          const erro = await resp.json();
          resultadosEl.innerHTML += `<p class="oh-em-construcao">❌ ${formato}: ${erro.detail || resp.statusText}</p>`;
          continue;
        }
        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);
        const extensao = formato.toLowerCase();

        const item = document.createElement("div");
        item.className = "oh-conversor-item";
        item.innerHTML = `<strong>${formato}</strong><div class="oh-conversor-player"></div>`;
        resultadosEl.appendChild(item);
        criarPlayer(item.querySelector(".oh-conversor-player"), { src: url, nomeArquivo: `convertido.${extensao}` });
      } catch (err) {
        resultadosEl.innerHTML += `<p class="oh-em-construcao">❌ ${formato}: ${err.message}</p>`;
      }
    }

    statusEl.textContent = "";
    btnConverter.disabled = false;
  });
}
