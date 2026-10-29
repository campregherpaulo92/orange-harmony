// ══════════════════════════════════════════════════════════════
// fichaAvaliacao.js — Ficha profissional da avaliação vocal.
// Lê a avaliação já salva (/api/avaliacao/perfil) e o Histórico (/api/historico),
// monta a ficha num "papel" e imprime/salva em PDF pelo navegador.
// Sem IA nesta etapa: os pontos de estudo entram depois, via Gemini.
// ══════════════════════════════════════════════════════════════
(function () {
  const NOMES_BASE = { C: 0, "C#": 1, D: 2, "D#": 3, E: 4, F: 5, "F#": 6, G: 7, "G#": 8, A: 9, "A#": 10, B: 11 };
  const NOME_CHAVE = "oh-ficha-nome";

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "—").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function midi(nota) {
    const m = /^([A-G]#?)(-?\d+)$/.exec(String(nota || "").trim());
    if (!m) return null;
    return (parseInt(m[2], 10) + 1) * 12 + NOMES_BASE[m[1]];
  }

  // Teclado em SVG: teclas brancas de C2 a C5, faixa do aluno destacada
  function teclado(grave, aguda) {
    const mg = midi(grave), ma = midi(aguda);
    const inicio = 36, fim = 72;                  // C2 a C5
    const brancas = [];
    for (let m = inicio; m <= fim; m++) if ([0, 2, 4, 5, 7, 9, 11].includes(m % 12)) brancas.push(m);
    const w = 18, h = 64;
    const largura = brancas.length * w;
    const partes = brancas.map((m, i) => {
      const dentro = mg !== null && ma !== null && m >= mg && m <= ma;
      return `<rect x="${i * w}" y="0" width="${w}" height="${h}" fill="${dentro ? "#f97316" : "#ffffff"}" stroke="#d4d4d4"/>`;
    }).join("");
    return `<svg viewBox="0 0 ${largura} ${h}" class="ficha-teclado" role="img" aria-label="Faixa de extensão">${partes}</svg>`;
  }

  // Resume o histórico: quantas análises, média de afinação, tendência mais comum
  function resumir(historico) {
    const itens = (historico || []).filter((a) => (a.metodo ?? 1) >= 2);
    if (!itens.length) return null;
    const media = (vals) => vals.reduce((s, v) => s + v, 0) / vals.length;
    const pct = media(itens.map((a) => a.pct_afinado || 0));
    const desvio = media(itens.map((a) => a.desvio_medio_cents || 0));
    const cont = {};
    itens.forEach((a) => { const t = a.tendencia || "—"; cont[t] = (cont[t] || 0) + 1; });
    const tendencia = Object.entries(cont).sort((a, b) => b[1] - a[1])[0][0];
    return { total: itens.length, pct: Math.round(pct), desvio: desvio.toFixed(1), tendencia };
  }

  function montarPapel(perfil, resumo) {
    const nomeSalvo = localStorage.getItem(NOME_CHAVE) || "";
    const data = new Date().toLocaleDateString("pt-BR");
    const linhaTendencia = resumo
      ? `<tr><td>Análises consideradas</td><td>${resumo.total}</td><td>Análises novas (método atual)</td></tr>
         <tr><td>Desvio médio (cents)</td><td>${resumo.desvio}</td><td>Quanto a voz sai da nota</td></tr>
         <tr><td>Notas afinadas, em média</td><td>${resumo.pct}%</td><td>Do tempo no tom</td></tr>
         <tr><td>Tendência mais comum</td><td>${esc(resumo.tendencia)}</td><td>Aguda, grave ou neutra</td></tr>`
      : `<tr><td colspan="3" class="ficha-vazio">Ainda não há análises novas no histórico. Faça uma análise na aba Estudo para ver as tendências aqui.</td></tr>`;

    return `
      <div id="fichaPapel" class="ficha-papel">
        <div class="ficha-cabecalho">
          <img src="laranjinha.png" alt="" class="ficha-logo">
          <div>
            <div class="ficha-marca">Orange Harmony</div>
            <div class="ficha-titulo">Ficha de avaliação vocal</div>
          </div>
        </div>

        <div class="ficha-secao">Identificação</div>
        <div class="ficha-campos">
          <div><span>Nome do aluno</span><b>${esc(nomeSalvo) || "—"}</b></div>
          <div><span>Data da ficha</span><b>${data}</b></div>
          <div><span>Tipo de voz</span><b>${esc(perfil.voz_tipo)}</b></div>
          <div><span>Classificação</span><b>${esc(perfil.classificacao)}</b></div>
        </div>

        <div class="ficha-secao">Extensão vocal</div>
        <div class="ficha-campos">
          <div><span>Nota mais grave</span><b>${esc(perfil.nota_grave)}</b></div>
          <div><span>Nota mais aguda</span><b>${esc(perfil.nota_aguda)}</b></div>
          <div><span>Extensão</span><b>${esc(perfil.extensao_semitons)} semitons</b></div>
          <div><span>Tessitura (nota central)</span><b>${esc(perfil.tessitura)}</b></div>
        </div>
        ${teclado(perfil.nota_grave, perfil.nota_aguda)}

        <div class="ficha-secao">Tendências</div>
        <table class="ficha-tabela">
          <thead><tr><th>Indicador</th><th>Resultado</th><th>Leitura</th></tr></thead>
          <tbody>${linhaTendencia}</tbody>
        </table>

        <div class="ficha-rodape">
          Ficha gerada automaticamente pelo Orange Harmony com base nas gravações do aluno.
          É uma estimativa para acompanhamento e não substitui a avaliação de um professor de canto.
          Exercícios feitos na avaliação: ${perfil.exercicios_feitos ?? "—"}.
        </div>
      </div>`;
  }

  async function carregar() {
    const bloco = $("fichaAvaliacaoBloco");
    if (!bloco) return;
    const [rp, rh] = await Promise.all([
      fetch(`${API_BASE}/api/avaliacao/perfil`).then((r) => r.json()).catch(() => ({})),
      fetch(`${API_BASE}/api/historico`).then((r) => r.json()).catch(() => ({ historico: [] })),
    ]);
    const perfil = rp && rp.nota_grave ? rp : null;
    const saida = $("fichaSaida");
    if (!perfil) {
      saida.innerHTML = `<p class="oh-hint">Faça sua avaliação vocal acima para gerar a ficha aqui.</p>`;
      return;
    }
    saida.innerHTML = montarPapel(perfil, resumir(rh.historico || []));
    const campoNome = $("fichaNome");
    if (campoNome && !campoNome.dataset.pronto) {
      campoNome.value = localStorage.getItem(NOME_CHAVE) || "";
      campoNome.addEventListener("input", () => {
        localStorage.setItem(NOME_CHAVE, campoNome.value.trim());
        const alvo = document.querySelector("#fichaPapel .ficha-campos div b");
        if (alvo) alvo.textContent = campoNome.value.trim() || "—";
      });
      campoNome.dataset.pronto = "1";
    }
  }

  function iniciar() {
    const bloco = $("fichaAvaliacaoBloco");
    if (!bloco) return;
    $("fichaImprimir").addEventListener("click", () => window.print());
    carregar();
    // recarrega a ficha sempre que uma nova avaliação for gerada
    const res = $("avaliacaoResultado");
    if (res) new MutationObserver(() => carregar()).observe(res, { childList: true });
  }

  window.FichaAvaliacao = { carregar };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar);
  else iniciar();
})();
