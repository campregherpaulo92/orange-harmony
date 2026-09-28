// ══════════════════════════════════════════════════════════════
// app.js — Orange Harmony (shell com navegação + Análise Vocal)
// ══════════════════════════════════════════════════════════════

const API_BASE = "";
const NOMES_NOTAS = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];

// ── Navegação entre páginas (sem recarregar) ──
function inicializarNavegacao() {
  const botoes = document.querySelectorAll(".oh-nav-item");
  const paginas = document.querySelectorAll(".oh-page");

  botoes.forEach((botao) => {
    botao.addEventListener("click", () => {
      const alvo = botao.dataset.page;

      botoes.forEach((b) => b.classList.remove("oh-nav-active"));
      botao.classList.add("oh-nav-active");

      paginas.forEach((p) => p.classList.remove("oh-page-ativa"));
      const paginaAlvo = document.getElementById(`page-${alvo}`);
      if (paginaAlvo) paginaAlvo.classList.add("oh-page-ativa");

      if (alvo === "gravador") carregarListaGravacoes();
      if (alvo === "historico") carregarHistorico();
      if (alvo === "composicoes") carregarListaComposicoes();
    });
  });
}

// ── Tom de referência: popula o select de notas ──
function montarNotasReferencia() {
  const select = document.getElementById("notaRef");
  if (!select) return;
  for (let oitava = 2; oitava <= 5; oitava++) {
    for (const nome of NOMES_NOTAS) {
      const opt = document.createElement("option");
      opt.value = `${nome}${oitava}`;
      opt.textContent = `${nome}${oitava}`;
      if (opt.value === "C4") opt.selected = true;
      select.appendChild(opt);
    }
  }
}

// ── Gerar e tocar tom/escala de referência (síntese simples no navegador) ──
function freqDeNota(nota, calibracao) {
  const nome = nota.slice(0, -1);
  const oitava = parseInt(nota.slice(-1), 10);
  const midi = 12 * (oitava + 1) + NOMES_NOTAS.indexOf(nome);
  return calibracao * Math.pow(2, (midi - 69) / 12);
}

function tocarTom(freq, duracao = 1.2) {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const master = ctx.createGain();
  master.gain.value = 0.32;

  const agora = ctx.currentTime;

  // Reverb sutil (convolução com uma resposta ao impulso curta sintetizada
  // na hora) — dá "ar" e espaço à nota, tirando o efeito seco de antes.
  const convolver = ctx.createConvolver();
  const duracaoIR = 1.4;
  const bufferIR = ctx.createBuffer(2, Math.floor(ctx.sampleRate * duracaoIR), ctx.sampleRate);
  for (let canal = 0; canal < 2; canal++) {
    const dados = bufferIR.getChannelData(canal);
    for (let i = 0; i < dados.length; i++) {
      dados[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / dados.length, 2.5);
    }
  }
  convolver.buffer = bufferIR;

  const molhado = ctx.createGain();
  molhado.gain.value = 0.16; // sutil — dá espaço sem "afogar" a afinação
  master.connect(ctx.destination);
  master.connect(convolver).connect(molhado).connect(ctx.destination);

  // Vibrato sutil (LFO modulando a frequência de cada harmônico) — tira o
  // efeito "robótico" de uma nota perfeitamente estática, dando mais
  // musicalidade, como um instrumento/voz de verdade sustentando a nota.
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 5.2;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = freq * 0.006;
  lfo.connect(lfoGain);
  lfo.start(agora);
  lfo.stop(agora + duracao + 0.6);

  // Harmônicos com leve inarmonicidade (as cordas de piano de verdade têm um
  // pouquinho de rigidez, então os parciais ficam levemente mais agudos que
  // múltiplos exatos — isso é o que dá o "brilho" característico do piano,
  // em vez do tom liso e "quadrado" de uma onda senoidal pura).
  const harmonicos = [
    { mult: 1.000, ganho: 1.00, decaimento: duracao * 0.95 },
    { mult: 2.001, ganho: 0.55, decaimento: duracao * 0.75 },
    { mult: 3.005, ganho: 0.30, decaimento: duracao * 0.60 },
    { mult: 4.012, ganho: 0.18, decaimento: duracao * 0.46 },
    { mult: 5.022, ganho: 0.10, decaimento: duracao * 0.35 },
    { mult: 6.038, ganho: 0.06, decaimento: duracao * 0.26 },
  ];

  harmonicos.forEach((h) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq * h.mult;
    lfoGain.connect(osc.frequency); // aplica o mesmo vibrato em todos os harmônicos
    gain.gain.setValueAtTime(0.0001, agora);
    gain.gain.exponentialRampToValueAtTime(Math.max(h.ganho, 0.001), agora + 0.006); // ataque rápido, tipo martelada
    gain.gain.exponentialRampToValueAtTime(0.0001, agora + h.decaimento);
    osc.connect(gain).connect(master);
    osc.start(agora);
    osc.stop(agora + h.decaimento + 0.05);
  });

  // Transiente curto de "martelada" (ruído filtrado nos primeiros ~20ms) —
  // completa a textura percussiva do ataque de um piano de verdade.
  const tamanhoBuffer = Math.floor(ctx.sampleRate * 0.02);
  const buffer = ctx.createBuffer(1, tamanhoBuffer, ctx.sampleRate);
  const dados = buffer.getChannelData(0);
  for (let i = 0; i < tamanhoBuffer; i++) dados[i] = (Math.random() * 2 - 1) * (1 - i / tamanhoBuffer);
  const ruido = ctx.createBufferSource();
  ruido.buffer = buffer;
  const filtroRuido = ctx.createBiquadFilter();
  filtroRuido.type = "bandpass";
  filtroRuido.frequency.value = freq * 2;
  filtroRuido.Q.value = 0.7;
  const ganhoRuido = ctx.createGain();
  ganhoRuido.gain.value = 0.15;
  ruido.connect(filtroRuido).connect(ganhoRuido).connect(master);
  ruido.start(agora);
}

function calibracaoAtual() {
  const marcado = document.querySelector('input[name="calib"]:checked');
  return marcado ? parseFloat(marcado.value) : 440;
}

function inicializarTomReferencia() {
  const btnNota = document.getElementById("btnTocarNota");
  const btnEscala = document.getElementById("btnTocarEscala");
  if (!btnNota || !btnEscala) return;

  btnNota.addEventListener("click", () => {
    const nota = document.getElementById("notaRef").value;
    tocarTom(freqDeNota(nota, calibracaoAtual()));
  });

  btnEscala.addEventListener("click", () => {
    const notaBase = document.getElementById("notaRef").value;
    const nomeBase = notaBase.slice(0, -1);
    const oitavaBase = parseInt(notaBase.slice(-1), 10);
    const midiBase = 12 * (oitavaBase + 1) + NOMES_NOTAS.indexOf(nomeBase);
    const escalaMaior = [0, 2, 4, 5, 7, 9, 11, 12];
    const calib = calibracaoAtual();
    let atraso = 0;
    escalaMaior.forEach((intervalo) => {
      const midi = midiBase + intervalo;
      const freq = calib * Math.pow(2, (midi - 69) / 12);
      setTimeout(() => tocarTom(freq, 0.5), atraso);
      atraso += 550;
    });
  });
}

// ── Gráfico simples de curva de pitch (canvas puro) ──
function desenharCurvaPitch(pontos) {
  const canvas = document.getElementById("curvaPitch");
  if (!canvas) return;

  // Se o canvas estiver com largura zero (ex.: dentro de uma seção ainda
  // escondida no momento do desenho), espera o próximo frame e tenta de
  // novo — evita o bug de "desenhar" num canvas de largura 0 e nunca
  // mais redesenhar depois que a seção aparece.
  if (canvas.clientWidth === 0) {
    requestAnimationFrame(() => desenharCurvaPitch(pontos));
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

  if (!pontos || pontos.length === 0) {
    ctx.fillStyle = "#888";
    ctx.font = "13px Nunito";
    ctx.fillText("Sem sinal de pitch detectado.", 12, h / 2);
    return;
  }

  const hzValores = pontos.map((p) => p.hz);
  const minHz = Math.min(...hzValores) * 0.95;
  const maxHz = Math.max(...hzValores) * 1.05;
  const minT = pontos[0].t;
  const maxT = pontos[pontos.length - 1].t || 1;

  const margem = 10;
  const escalaX = (t) => margem + ((t - minT) / (maxT - minT || 1)) * (w - margem * 2);
  const escalaY = (hz) => h - margem - ((hz - minHz) / (maxHz - minHz || 1)) * (h - margem * 2);

  ctx.strokeStyle = "#f97316";
  ctx.lineWidth = 2;
  ctx.beginPath();
  pontos.forEach((p, i) => {
    const x = escalaX(p.t);
    const y = escalaY(p.hz);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

function metricaHTML(rotulo, valor, sub) {
  return `<div class="oh-metric">
    <div class="oh-metric-label">${rotulo}</div>
    <div class="oh-metric-value">${valor}</div>
    <div class="oh-metric-sub">${sub}</div>
  </div>`;
}

// ── Análise Vocal (upload ou gravação) ──
function inicializarAnaliseVocal() {
  const inputArquivo = document.getElementById("arquivoAudio");
  const btnAnalisar = document.getElementById("btnAnalisar");
  const statusMsg = document.getElementById("statusMsg");
  const resultadosSection = document.getElementById("resultados");
  const metricasEl = document.getElementById("metricas");
  const vibratoCard = document.getElementById("vibratoCard");
  const tabelaVibrato = document.getElementById("tabelaVibrato");

  if (!btnAnalisar) return;

  // Blob gravado na hora (se o usuário usar o botão de gravar em vez de subir arquivo)
  let blobGravado = null;

  const containerGravador = document.getElementById("gravadorEstudo");
  if (containerGravador) {
    criarGravador(containerGravador, {
      onGravado: (blob) => { blobGravado = blob; },
      onExcluido: () => { blobGravado = null; },
    });
  }

  inputArquivo.addEventListener("change", () => {
    if (inputArquivo.files[0]) {
      blobGravado = null; // upload manual tem prioridade
      const nomeEl = document.getElementById("estudoNomeArquivo");
      if (nomeEl) nomeEl.textContent = `Selecionado: ${inputArquivo.files[0].name}`;
    }
  });

  btnAnalisar.addEventListener("click", async () => {
    const arquivo = inputArquivo.files[0] || (blobGravado
      ? new File([blobGravado], "gravacao.webm", { type: "audio/webm" })
      : null);

    if (!arquivo) {
      statusMsg.textContent = "Envie um áudio ou grave sua voz primeiro.";
      return;
    }

    btnAnalisar.disabled = true;
    statusMsg.textContent = "Analisando…";
    resultadosSection.hidden = true;

    const form = new FormData();
    form.append("arquivo", arquivo);
    form.append("modo", document.getElementById("modo").value);
    form.append("calibracao", calibracaoAtual());
    form.append("nota_ref", document.getElementById("notaRef").value);
    const baseDevolutivaMarcada = document.querySelector('input[name="baseDevolutiva"]:checked');
    form.append("base_devolutiva", baseDevolutivaMarcada ? baseDevolutivaMarcada.value : "detectada");

    try {
      const resp = await fetch(`${API_BASE}/api/analyze`, { method: "POST", body: form });
      const dados = await resp.json();

      if (dados.erro) {
        statusMsg.textContent = dados.erro;
        btnAnalisar.disabled = false;
        return;
      }

      metricasEl.innerHTML = "";
      if (dados.modo === "cover") {
        const c = dados.resultado;
        metricasEl.innerHTML = [
          metricaHTML("Tom detectado", c.tom, "tonalidade geral"),
          metricaHTML("BPM", c.bpm.toFixed(1), "andamento"),
          metricaHTML("Notas na escala", `${c.pct_na_escala.toFixed(1)}%`, "casando com o tom"),
          metricaHTML("Duração", `${c.duracao_s}s`, "áudio analisado"),
        ].join("");
        vibratoCard.hidden = true;
      } else {
        const r = dados.resultado;
        metricasEl.innerHTML = [
          metricaHTML("Nota predominante", r.nota_predominante, "nota mais cantada"),
          metricaHTML("Desvio médio", `${r.desvio_medio_cents.toFixed(1)} cents`, "quanto sai do tom"),
          metricaHTML("Tendência", r.tendencia, `${r.desvio_sinal_cents.toFixed(1)} cents`),
          metricaHTML("Afinado (±50c)", `${r.pct_afinado.toFixed(1)}%`, "das notas no tom"),
          metricaHTML("Frases", r.num_frases, `média ${r.sustentacao_media.toFixed(2)}s`),
          metricaHTML("Pausas", r.num_pausas, `média ${r.pausa_media.toFixed(2)}s`),
        ].join("");

        if (dados.vibratos && dados.vibratos.length > 0) {
          vibratoCard.hidden = false;
          tabelaVibrato.innerHTML = `
            <tr><th>Nota</th><th>Taxa (Hz)</th><th>Extensão (cents)</th><th>Classificação</th><th>Dur. (s)</th></tr>
            ${dados.vibratos.map((v) => `
              <tr>
                <td>${v.nota}</td>
                <td>${v.taxa_hz.toFixed(2)}</td>
                <td>${v.extensao_cents.toFixed(1)}</td>
                <td>${v.classificacao}</td>
                <td>${v.duracao_s}</td>
              </tr>`).join("")}
          `;
        } else {
          vibratoCard.hidden = true;
        }
      }

      const devolutivaCard = document.getElementById("devolutivaCard");
      const devolutivaTexto = document.getElementById("devolutivaTexto");
      if (dados.modo !== "cover") {
        // A devolutiva vem numa chamada SEPARADA (mais lenta, chama o Gemini) —
        // assim o resultado numérico acima já aparece rápido, sem esperar ela.
        devolutivaCard.hidden = false;
        devolutivaTexto.textContent = "Gerando devolutiva do professor…";
        const formDevolutiva = new FormData();
        formDevolutiva.append("resultado", JSON.stringify(dados.resultado));
        formDevolutiva.append("nota_ref", document.getElementById("notaRef").value);
        formDevolutiva.append("base_devolutiva", baseDevolutivaMarcada ? baseDevolutivaMarcada.value : "detectada");
        if (dados.sequencia_notas) formDevolutiva.append("sequencia_notas", JSON.stringify(dados.sequencia_notas));
        if (dados.historico_id) formDevolutiva.append("historico_id", dados.historico_id);

        fetch(`${API_BASE}/api/analyze/devolutiva`, { method: "POST", body: formDevolutiva })
          .then((r) => r.json())
          .then((d) => {
            if (d.devolutiva) {
              devolutivaTexto.textContent = d.devolutiva;
            } else {
              devolutivaTexto.textContent = `[!] Professor IA indisponível: ${d.erro || "erro desconhecido"}`;
            }
          })
          .catch((err) => {
            devolutivaTexto.textContent = `[!] Não foi possível carregar a devolutiva: ${err.message}`;
          });
      } else {
        devolutivaCard.hidden = true;
      }

      resultadosSection.hidden = false;
      desenharCurvaPitch(dados.curva_pitch);
      statusMsg.textContent = "";
    } catch (err) {
      statusMsg.textContent = `Erro ao conectar com a API: ${err.message}`;
    } finally {
      btnAnalisar.disabled = false;
    }
  });
}

// ── Página Gravador: gravar, salvar no Storage, listar/tocar/baixar/excluir ──
function formatarData(isoString) {
  if (!isoString) return "—";
  const d = new Date(isoString);
  if (isNaN(d)) return isoString;
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatarTamanho(bytes) {
  if (!bytes) return "—";
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

async function carregarListaGravacoes() {
  const lista = document.getElementById("listaGravacoes");
  if (!lista) return;
  lista.innerHTML = `<p class="oh-em-construcao">Carregando…</p>`;

  try {
    const resp = await fetch(`${API_BASE}/api/gravacoes`);
    const dados = await resp.json();
    const itens = dados.gravacoes || [];

    if (itens.length === 0) {
      lista.innerHTML = `<p class="oh-em-construcao">Nenhuma gravação salva ainda. Grave e clique em "Salvar gravação" acima.</p>`;
      return;
    }

    lista.innerHTML = itens.map((g) => `
      <div class="oh-gravacao-item" data-id="${g.id}">
        <div class="oh-gravacao-info">
          <span class="oh-gravacao-nome" data-nome-de="${g.id}">${g.nome}</span>
          <span class="oh-gravacao-meta">${formatarData(g.data)} · ${formatarTamanho(g.tamanho_bytes)}</span>
        </div>
        <div class="oh-gravacao-player" data-player="${g.id}"></div>
        <div class="oh-gravacao-acoes">
          <button class="oh-btn-icone" data-renomear="${g.id}" title="Renomear">✏️</button>
          <a class="oh-btn-icone" href="${API_BASE}/api/gravacoes/${g.id}" download="${g.nome}" title="Baixar">⬇️</a>
          <button class="oh-btn-icone oh-btn-excluir" data-excluir="${g.id}" title="Excluir">🗑️</button>
        </div>
      </div>
    `).join("");

    itens.forEach((g) => {
      const alvo = lista.querySelector(`[data-player="${g.id}"]`);
      if (alvo) criarPlayer(alvo, { src: `${API_BASE}/api/gravacoes/${g.id}`, nomeArquivo: `${g.nome}.webm` });
    });

    lista.querySelectorAll("[data-renomear]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.renomear;
        const nomeAtualEl = lista.querySelector(`[data-nome-de="${id}"]`);
        const novoNome = prompt("Novo nome da gravação:", nomeAtualEl ? nomeAtualEl.textContent : "");
        if (!novoNome || !novoNome.trim()) return;
        btn.disabled = true;
        try {
          const form = new FormData();
          form.append("novo_nome", novoNome.trim());
          await fetch(`${API_BASE}/api/gravacoes/${id}`, { method: "PUT", body: form });
          carregarListaGravacoes();
        } catch (e) {
          btn.disabled = false;
        }
      });
    });

    lista.querySelectorAll("[data-excluir]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.excluir;
        btn.disabled = true;
        try {
          await fetch(`${API_BASE}/api/gravacoes/${id}`, { method: "DELETE" });
          carregarListaGravacoes();
        } catch (e) {
          btn.disabled = false;
        }
      });
    });
  } catch (err) {
    lista.innerHTML = `<p class="oh-em-construcao">Não foi possível carregar as gravações: ${err.message}</p>`;
  }
}

function inicializarGravador() {
  const containerGravador = document.getElementById("gravadorPagina");
  const btnSalvar = document.getElementById("btnSalvarGravacao");
  const nomeInput = document.getElementById("gravadorNomeInput");
  const statusEl = document.getElementById("gravadorStatus");
  const arquivoInput = document.getElementById("gravadorArquivo");
  const nomeArquivoEl = document.getElementById("gravadorNomeArquivo");
  if (!containerGravador || !btnSalvar) return;

  let blobAtual = null;

  criarGravador(containerGravador, {
    onGravado: (blob) => {
      blobAtual = blob;
      btnSalvar.disabled = false;
      statusEl.textContent = "";
    },
    onExcluido: () => {
      blobAtual = null;
      if (!arquivoInput.files[0]) btnSalvar.disabled = true;
    },
  });

  if (arquivoInput) {
    arquivoInput.addEventListener("change", () => {
      if (arquivoInput.files[0]) {
        nomeArquivoEl.textContent = `Selecionado: ${arquivoInput.files[0].name}`;
        btnSalvar.disabled = false;
        statusEl.textContent = "";
      }
    });
  }

  btnSalvar.addEventListener("click", async () => {
    const arquivoParaSalvar = arquivoInput?.files[0] || blobAtual;
    if (!arquivoParaSalvar) {
      statusEl.textContent = "Grave ou suba um áudio primeiro.";
      return;
    }
    const nome = (nomeInput.value || "").trim() || `Gravação ${new Date().toLocaleString("pt-BR")}`;

    btnSalvar.disabled = true;
    statusEl.textContent = "Salvando na nuvem…";

    const form = new FormData();
    form.append("nome", nome);
    const arquivoFinal = arquivoInput?.files[0]
      ? arquivoInput.files[0]
      : new File([blobAtual], "gravacao.webm", { type: "audio/webm" });
    form.append("arquivo", arquivoFinal);

    try {
      const resp = await fetch(`${API_BASE}/api/gravacoes`, { method: "POST", body: form });
      if (!resp.ok) {
        const erro = await resp.json();
        statusEl.textContent = `Não foi possível salvar: ${erro.detail || resp.statusText}`;
        btnSalvar.disabled = false;
        return;
      }
      statusEl.textContent = "✅ Gravação salva!";
      nomeInput.value = "";
      blobAtual = null;
      carregarListaGravacoes();
    } catch (err) {
      statusEl.textContent = `Erro ao salvar: ${err.message}`;
      btnSalvar.disabled = false;
    }
  });

  carregarListaGravacoes();
}

// ── Página Estúdio/Produção: agora tratada de verdade por producao.js
// (a função antiga de placeholder foi removida — ela concorria com o
// gravador real e causava dois inicializadores no mesmo elemento).

// ── Botões flutuantes: arrastar para qualquer canto + abrir ao clicar ──
function tornarArrastavel(botao, chaveStorage) {
  if (!botao) return;

  // Restaura a posição salva (se o usuário já arrastou antes)
  const salvo = localStorage.getItem(chaveStorage);
  if (salvo) {
    try {
      const pos = JSON.parse(salvo);
      botao.style.left = `${pos.left}px`;
      botao.style.top = `${pos.top}px`;
      botao.style.right = "auto";
      botao.style.bottom = "auto";
    } catch (e) {}
  }

  let arrastando = false;
  let moveu = false;
  let inicioX = 0;
  let inicioY = 0;
  let origemLeft = 0;
  let origemTop = 0;

  botao.addEventListener("pointerdown", (e) => {
    arrastando = true;
    moveu = false;
    const rect = botao.getBoundingClientRect();
    origemLeft = rect.left;
    origemTop = rect.top;
    inicioX = e.clientX;
    inicioY = e.clientY;
    botao.setPointerCapture(e.pointerId);
    botao.classList.add("oh-fab-arrastando");
  });

  botao.addEventListener("pointermove", (e) => {
    if (!arrastando) return;
    const dx = e.clientX - inicioX;
    const dy = e.clientY - inicioY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moveu = true;
    if (!moveu) return;

    let novoLeft = origemLeft + dx;
    let novoTop = origemTop + dy;
    const maxLeft = window.innerWidth - botao.offsetWidth - 4;
    const maxTop = window.innerHeight - botao.offsetHeight - 4;
    novoLeft = Math.max(4, Math.min(novoLeft, maxLeft));
    novoTop = Math.max(4, Math.min(novoTop, maxTop));

    botao.style.left = `${novoLeft}px`;
    botao.style.top = `${novoTop}px`;
    botao.style.right = "auto";
    botao.style.bottom = "auto";
  });

  function finalizarArraste(e) {
    if (!arrastando) return;
    arrastando = false;
    botao.classList.remove("oh-fab-arrastando");
    if (moveu) {
      const rect = botao.getBoundingClientRect();
      localStorage.setItem(chaveStorage, JSON.stringify({ left: rect.left, top: rect.top }));
      // Impede que o "soltar" depois de arrastar dispare o clique de abrir
      const bloquearClique = (ce) => { ce.stopPropagation(); ce.preventDefault(); };
      botao.addEventListener("click", bloquearClique, { capture: true, once: true });
    }
  }

  botao.addEventListener("pointerup", finalizarArraste);
  botao.addEventListener("pointercancel", finalizarArraste);
}

// ── Botões flutuantes (arrastáveis + abrir, por enquanto só um "em construção") ──
function inicializarFabs() {
  const fabLaranjinha = document.getElementById("fabLaranjinha");
  const fabEstudio = document.getElementById("fabEstudio");

  tornarArrastavel(fabLaranjinha, "oh_fab_pos_laranjinha");
  tornarArrastavel(fabEstudio, "oh_fab_pos_estudio");
  // Abrir os painéis é tratado em laranjinha.js e estudio.js —
  // aqui só cuidamos do arrastar, pra não duplicar o clique de abrir.
}

// ── Sidebar ajustável: redimensionar arrastando + ocultar/mostrar, com estado salvo ──
function inicializarSidebarAjustavel() {
  const sidebar = document.getElementById("sidebarPrincipal");
  const handle = document.getElementById("sidebarResize");
  const btnToggle = document.getElementById("btnToggleSidebar");
  if (!sidebar || !handle || !btnToggle) return;

  const larguraSalva = localStorage.getItem("oh_sidebar_largura");
  if (larguraSalva) sidebar.style.width = `${larguraSalva}px`;
  if (localStorage.getItem("oh_sidebar_colapsada") === "1") {
    sidebar.classList.add("oh-sidebar-colapsada");
  }

  btnToggle.addEventListener("click", () => {
    sidebar.classList.toggle("oh-sidebar-colapsada");
    localStorage.setItem("oh_sidebar_colapsada", sidebar.classList.contains("oh-sidebar-colapsada") ? "1" : "0");
  });

  let arrastando = false;
  handle.addEventListener("pointerdown", (e) => {
    arrastando = true;
    handle.classList.add("oh-resize-ativo");
    handle.setPointerCapture(e.pointerId);
  });
  handle.addEventListener("pointermove", (e) => {
    if (!arrastando) return;
    const novaLargura = Math.min(480, Math.max(160, e.clientX));
    sidebar.style.width = `${novaLargura}px`;
  });
  function pararArraste() {
    if (!arrastando) return;
    arrastando = false;
    handle.classList.remove("oh-resize-ativo");
    localStorage.setItem("oh_sidebar_largura", parseInt(sidebar.style.width, 10));
  }
  handle.addEventListener("pointerup", pararArraste);
  handle.addEventListener("pointercancel", pararArraste);
}

document.addEventListener("DOMContentLoaded", () => {
  inicializarNavegacao();
  montarNotasReferencia();
  inicializarSidebarAjustavel();
  inicializarTomReferencia();
  inicializarAnaliseVocal();
  inicializarGravador();
  inicializarFabs();
  inicializarAfinador();
  inicializarHistorico();
  inicializarComposicoes();
  inicializarConversor();
  inicializarProducao();
  inicializarEdicaoVocal();
  inicializarAvaliacao();
  inicializarLaranjinha();
  inicializarEstudio();
  inicializarSongwriter();
});
