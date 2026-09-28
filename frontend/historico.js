// ══════════════════════════════════════════════════════════════
// historico.js — Tabela de evolução + gráfico + renomear/excluir análises
// ══════════════════════════════════════════════════════════════

function formatarDataCurta(isoString) {
  if (!isoString) return "—";
  const d = new Date(isoString);
  if (isNaN(d)) return isoString;
  return d.toLocaleDateString("pt-BR");
}

function desenharGraficoEvolucao(itens) {
  const canvas = document.getElementById("historicoGrafico");
  if (!canvas) return;

  // Mesma proteção da curva de pitch: se o canvas estiver com largura zero
  // (página ainda escondida no momento do desenho), espera o próximo frame.
  if (canvas.clientWidth === 0) {
    requestAnimationFrame(() => desenharGraficoEvolucao(itens));
    return;
  }

  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.height;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);

  if (!itens || itens.length < 2) {
    ctx.fillStyle = "#888";
    ctx.font = "13px Nunito";
    ctx.fillText("Precisa de pelo menos 2 análises para desenhar a evolução.", 12, h / 2);
    return;
  }

  const ordenado = [...itens].reverse(); // mais antigas primeiro, pro gráfico ler da esquerda pra direita
  const pcts = ordenado.map((a) => a.pct_afinado || 0);
  const margem = 30;
  const minY = 0, maxY = 100;
  const escalaX = (i) => margem + (i / (ordenado.length - 1)) * (w - margem * 2);
  const escalaY = (v) => h - margem - ((v - minY) / (maxY - minY)) * (h - margem * 2);

  ctx.strokeStyle = "#22c55e";
  ctx.lineWidth = 2;
  ctx.beginPath();
  pcts.forEach((v, i) => {
    const x = escalaX(i), y = escalaY(v);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    ctx.fillStyle = "#22c55e";
    ctx.fillRect(x - 2, y - 2, 4, 4);
  });
  ctx.stroke();

  ctx.fillStyle = "#999";
  ctx.font = "10px Inter";
  ctx.fillText("% afinado ao longo do tempo", margem, 14);
}

async function carregarHistorico() {
  const tbody = document.getElementById("historicoTabelaCorpo");
  const painelDetalhe = document.getElementById("historicoDetalhe");
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="7">Carregando…</td></tr>`;

  try {
    const resp = await fetch(`${API_BASE}/api/historico`);
    const dados = await resp.json();
    const itens = dados.historico || [];

    if (itens.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7">Nenhuma análise salva ainda.</td></tr>`;
      if (painelDetalhe) painelDetalhe.innerHTML = "";
      desenharGraficoEvolucao([]);
      return;
    }

    tbody.innerHTML = itens.map((a) => `
      <tr data-id="${a.id}" class="oh-historico-linha">
        <td>${a.nome || formatarDataCurta(a.data)}</td>
        <td>${formatarDataCurta(a.data)}</td>
        <td>${a.nota_predominante || "—"}</td>
        <td>${(a.desvio_medio_cents ?? 0).toFixed ? a.desvio_medio_cents.toFixed(1) : a.desvio_medio_cents}</td>
        <td>${a.tendencia || "—"}</td>
        <td>${a.pct_afinado ?? 0}%</td>
        <td>
          <button class="oh-btn-icone" data-detalhe="${a.id}">👁️</button>
          <button class="oh-btn-icone oh-btn-excluir" data-excluir-hist="${a.id}">🗑️</button>
        </td>
      </tr>
    `).join("");

    desenharGraficoEvolucao(itens);

    tbody.querySelectorAll("[data-detalhe]").forEach((btn) => {
      btn.addEventListener("click", () => {
        mostrarDetalheHistorico(itens.find((i) => i.id === btn.dataset.detalhe));
        const filtroSelect = document.getElementById("historicoFiltroSelect");
        if (filtroSelect) filtroSelect.value = btn.dataset.detalhe;
      });
    });
    tbody.querySelectorAll("[data-excluir-hist]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        try {
          await fetch(`${API_BASE}/api/historico/${btn.dataset.excluirHist}`, { method: "DELETE" });
          carregarHistorico();
        } catch (e) {
          btn.disabled = false;
        }
      });
    });

    // Seletor de análise: filtra qual relatório o "Relatório Detalhado" mostra
    const filtroSelect = document.getElementById("historicoFiltroSelect");
    if (filtroSelect) {
      filtroSelect.innerHTML = itens.map((a) =>
        `<option value="${a.id}">${a.nome || formatarDataCurta(a.data)}</option>`
      ).join("");
      filtroSelect.value = itens[0].id;
      filtroSelect.onchange = () => {
        mostrarDetalheHistorico(itens.find((i) => i.id === filtroSelect.value));
      };
    }

    // mostra a mais recente por padrão
    mostrarDetalheHistorico(itens[0]);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7">Não foi possível carregar: ${err.message}</td></tr>`;
  }
}

function mostrarDetalheHistorico(analise) {
  const painel = document.getElementById("historicoDetalhe");
  if (!painel || !analise) return;
  painel.innerHTML = metricaHTML("Análise", analise.nome || "—", formatarDataCurta(analise.data))
    + metricaHTML("Nota predominante", analise.nota_predominante || "—", "nota mais cantada")
    + metricaHTML("Desvio médio", `${(analise.desvio_medio_cents ?? 0)} cents`, "quanto sai do tom")
    + metricaHTML("Tendência", analise.tendencia || "—", "aguda / grave / neutra")
    + metricaHTML("Afinado (±50c)", `${analise.pct_afinado ?? 0}%`, "das notas no tom")
    + metricaHTML("Frases", analise.num_frases ?? 0, `média ${analise.sustentacao_media ?? 0}s`)
    + metricaHTML("Pausas", analise.num_pausas ?? 0, "respirações detectadas")
    + metricaHTML("Tom ref.", analise.tom_ref || "—", "referência usada");

  const devolutivaCard = document.getElementById("historicoDevolutiva");
  if (devolutivaCard) {
    if (analise.devolutiva) {
      devolutivaCard.hidden = false;
      devolutivaCard.querySelector(".oh-devolutiva-texto").textContent = analise.devolutiva;
    } else {
      devolutivaCard.hidden = true;
    }
  }
}

function inicializarHistorico() {
  const tbody = document.getElementById("historicoTabelaCorpo");
  if (!tbody) return;
  carregarHistorico();
}
