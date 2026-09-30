// Traduz erros de rede/servidor pra algo que faça sentido pro usuário.
// "Unexpected end of JSON" / "Failed to fetch" = o servidor demorou demais ou
// acabou de reiniciar (plano gratuito: dorme após 15 min parado e tem 512 MB).
function mensagemDeErroDeRede(err) {
  const m = (err && err.message) || String(err);
  if (/JSON|Failed to fetch|NetworkError|Load failed|network/i.test(m)) {
    return "O servidor demorou demais ou acabou de reiniciar (o plano gratuito dorme quando fica parado). Espere cerca de 1 minuto e tente de novo.";
  }
  return m;
}

// Texto do aviso de corte de duração (header X-Aviso: "cortado_120s")
function textoAvisoDuracao(aviso) {
  if (!aviso) return "";
  const seg = String(aviso).replace(/\D/g, "");
  return ` · Áudio longo: usei só os primeiros ${seg} s (limite do servidor gratuito)`;
}

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

// ── Piano sintetizado (soma de harmônicos) ─────────────────────────────────
// Modelo simples de corda de piano:
//  • parciais levemente "esticados" (inarmonicidade) — é o brilho típico do piano;
//  • 2 cordas por parcial, ligeiramente desafinadas — dá o batimento/vida da nota
//    e o decaimento em dois estágios (queda rápida + cauda longa);
//  • os agudos morrem antes dos graves, e o timbre vai escurecendo enquanto soa;
//  • martelada no ataque e um reverb de sala. Sem vibrato (piano de verdade não tem).
// Quanto a nota "vive": 1.0 = versão longa anterior; menor = nota mais curta. Ajuste fino aqui.
const PIANO_SUSTENTO = 0.66;
const PIANO_PARCIAIS = [1.0, 0.78, 0.52, 0.36, 0.26, 0.19, 0.14, 0.10, 0.075, 0.055, 0.04, 0.03, 0.02, 0.015];

// Resposta ao impulso de uma sala média (cauda ~2 s que vai escurecendo), gerada 1 vez.
function gerarReverbSala(ctx, duracaoS = 2.4) {
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * duracaoS);
  const buf = ctx.createBuffer(2, n, sr);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let y = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const alfa = 0.9 - 0.72 * Math.min(1, t / 1.3);           // cauda cada vez mais escura
      y += alfa * ((Math.random() * 2 - 1) - y);
      d[i] = t < 0.012 ? 0 : y * Math.exp(-t * 4.6);            // 12 ms de pré-atraso, queda ~1,5 s (RT60)
    }
    [[0.017, 0.55], [0.029, -0.4], [0.043, 0.3]].forEach(([tt, a]) => { d[Math.floor(sr * (tt + c * 0.003))] += a; });   // primeiras reflexões
  }
  return buf;
}

// Cadeia de saída do piano: seco + reverb → compressor suave. Devolve o nó de entrada.
function montarCadeiaPiano(ctx) {
  const entrada = ctx.createGain();
  entrada.gain.value = 0.2;      // medido: com valores maiores o ataque (e a escala, com notas sobrepostas) estourava
  const comp = ctx.createDynamicsCompressor();   // funciona como limitador: segura os picos quando várias notas soam juntas
  comp.threshold.value = -20; comp.knee.value = 10; comp.ratio.value = 8; comp.attack.value = 0.002; comp.release.value = 0.2;
  const reverb = ctx.createConvolver();
  reverb.buffer = gerarReverbSala(ctx);
  const molhado = ctx.createGain();
  molhado.gain.value = 0.3;
  entrada.connect(comp);
  entrada.connect(reverb).connect(molhado).connect(comp);
  comp.connect(ctx.destination);
  return entrada;
}

// Uma nota de piano. `quando` em segundos do relógio do ctx; `duracao` = quanto ela "vive".
function sintetizarNotaPiano(ctx, destino, freq, quando, duracao = 4, forca = 1) {
  const oitavas = Math.log2(freq / 261.63);                        // 0 = dó central
  const B = 0.00018 + 0.00016 * Math.max(0, oitavas + 1);          // inarmonicidade: sobe nos agudos
  const tau1 = PIANO_SUSTENTO * Math.min(2.6, Math.max(0.8, 1.5 * Math.pow(261.63 / freq, 0.4)));   // decaimento do fundamental
  const saida = ctx.createGain();
  const filtro = ctx.createBiquadFilter();                         // brilho que vai fechando
  filtro.type = "lowpass"; filtro.Q.value = 0.6;
  filtro.frequency.setValueAtTime(Math.min(15000, freq * 18), quando);
  filtro.frequency.setTargetAtTime(Math.max(freq * 3.4, 1100), quando + 0.02, 1.2);
  filtro.connect(saida);
  saida.connect(destino);
  saida.gain.setValueAtTime(1, quando);
  saida.gain.setValueAtTime(1, quando + duracao - 0.4);
  saida.gain.linearRampToValueAtTime(0, quando + duracao);        // sai suave, sem clique

  PIANO_PARCIAIS.forEach((amp, idx) => {
    const n = idx + 1;
    const f = n * freq * Math.sqrt(1 + B * n * n);
    if (f > 9000 || f > ctx.sampleRate * 0.45) return;
    const tau = tau1 / (1 + 0.55 * idx);                           // agudos morrem antes
    [[-0.9, 1.0, 1.0], [+1.3, 0.5, 1.7]].forEach(([cents, ganhoCorda, mult]) => {   // 2 cordas: rápida e "cauda"
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = f * Math.pow(2, cents / 1200);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, quando);
      g.gain.linearRampToValueAtTime(amp * ganhoCorda * forca, quando + 0.004);
      g.gain.setTargetAtTime(0, quando + 0.004, tau * mult);
      osc.connect(g).connect(filtro);
      osc.start(quando);
      osc.stop(quando + duracao + 0.05);
    });
  });

  // martelada: sopro curtinho de ruído filtrado no ataque
  const tam = Math.floor(ctx.sampleRate * 0.035);
  const buf = ctx.createBuffer(1, tam, ctx.sampleRate);
  const dados = buf.getChannelData(0);
  for (let i = 0; i < tam; i++) dados[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / tam, 2);
  const ruido = ctx.createBufferSource();
  ruido.buffer = buf;
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass"; bp.frequency.value = Math.min(6000, freq * 2.6); bp.Q.value = 0.8;
  const gr = ctx.createGain();
  gr.gain.value = 0.16 * forca;
  ruido.connect(bp).connect(gr).connect(saida);
  ruido.start(quando);
}

// Um contexto de áudio só (reutilizado) — antes cada nota criava um novo.
let _pianoCtx = null;
let _pianoEntrada = null;
function obterPiano() {
  if (!_pianoCtx) {
    _pianoCtx = new (window.AudioContext || window.webkitAudioContext)();
    _pianoEntrada = montarCadeiaPiano(_pianoCtx);
  }
  if (_pianoCtx.state === "suspended") _pianoCtx.resume();
  return { ctx: _pianoCtx, entrada: _pianoEntrada };
}

// Nota de referência (~3 s, com cauda natural)
function tocarTom(freq, duracao = 3) {
  const { ctx, entrada } = obterPiano();
  sintetizarNotaPiano(ctx, entrada, freq, ctx.currentTime + 0.03, duracao, 1);
}

// Escala: as notas se sobrepõem (o pedal do piano), como tocada de verdade
function tocarEscalaPiano(freqs, idaVolta = false) {
  const { ctx, entrada } = obterPiano();
  const t0 = ctx.currentTime + 0.05;
  const n = freqs.length;
  freqs.forEach((freq, i) => {
    const ultima = i === n - 1;
    const posicao = n > 1 ? i / (n - 1) : 0;
    const forca = idaVolta ? 0.9 + 0.1 * (1 - Math.abs(posicao * 2 - 1)) : 0.9 + 0.1 * posicao;
    sintetizarNotaPiano(ctx, entrada, freq, t0 + i * 0.62, ultima ? 3.4 : 1.8, forca);
  });
}

function calibracaoAtual() {
  const marcado = document.querySelector('input[name="calib"]:checked');
  return marcado ? parseFloat(marcado.value) : 440;
}

// ── Escalas para treino (as MESMAS fórmulas de backend/escalas.py; o som é gerado aqui, sem esperar o servidor) ──
const ESCALAS_TREINO = [
  { chave: "maior", nome: "maior (jônio)", formula: "1 2 3 4 5 6 7" },
  { chave: "menor", nome: "menor natural (eólio)", formula: "1 2 b3 4 5 b6 b7" },
  { chave: "menor_harmonica", nome: "menor harmônica", formula: "1 2 b3 4 5 b6 7" },
  { chave: "menor_melodica", nome: "menor melódica", formula: "1 2 b3 4 5 6 7" },
  { chave: "dorico", nome: "dórico", formula: "1 2 b3 4 5 6 b7" },
  { chave: "frigio", nome: "frígio", formula: "1 b2 b3 4 5 b6 b7" },
  { chave: "lidio", nome: "lídio", formula: "1 2 3 #4 5 6 7" },
  { chave: "mixolidio", nome: "mixolídio", formula: "1 2 3 4 5 6 b7" },
  { chave: "locrio", nome: "lócrio", formula: "1 b2 b3 4 b5 b6 b7" },
  { chave: "pentatonica_maior", nome: "pentatônica maior", formula: "1 2 3 5 6" },
  { chave: "pentatonica_menor", nome: "pentatônica menor", formula: "1 b3 4 5 b7" },
  { chave: "blues", nome: "blues", formula: "1 b3 4 b5 5 b7" },
];
const MAIOR_SEMITONS = [0, 2, 4, 5, 7, 9, 11];

function intervalosDaFormula(formula) {
  return formula.split(" ").map((tok) => {
    const alt = tok.startsWith("b") ? -1 : tok.startsWith("#") ? 1 : 0;
    return MAIOR_SEMITONS[parseInt(tok.replace(/[b#]/, ""), 10) - 1] + alt;
  });
}

// Lê os seletores: {tonica: "G#", oitava: 2, chave, nome, formula, intervalos}
function escalaAtual() {
  const nota = document.getElementById("notaRef").value;                  // ex: "G#2"
  const escala = ESCALAS_TREINO.find((e) => e.chave === document.getElementById("escalaTipo").value) || ESCALAS_TREINO[0];
  return {
    tonica: nota.slice(0, -1), oitava: parseInt(nota.slice(-1), 10), nota,
    chave: escala.chave, nome: escala.nome, formula: escala.formula, intervalos: intervalosDaFormula(escala.formula),
  };
}

function elemento(tag, classe, texto) {
  const e = document.createElement(tag);
  if (classe) e.className = classe;
  if (texto !== undefined) e.textContent = texto;
  return e;
}

let escalaInfoSeq = 0;
let escalaInfoUltima = null;
let escalaInfoTimer = null;

function montarSeletorEscalas() {
  const sel = document.getElementById("escalaTipo");
  if (!sel) return;
  ESCALAS_TREINO.forEach((e) => {
    const opt = document.createElement("option");
    opt.value = e.chave;
    opt.textContent = e.nome;
    sel.appendChild(opt);
  });
}

// Texto do botão acompanha a escolha: "Tocar G#2 lídio"
function atualizarBotaoEscala() {
  const btn = document.getElementById("btnTocarEscala");
  if (!btn) return;
  const esc = escalaAtual();
  btn.textContent = `🎵 Tocar ${esc.nota} ${esc.nome.split(" (")[0]}`;
}

function renderizarInfoEscala(d) {
  const info = document.getElementById("escalaInfo");
  escalaInfoUltima = d && !d.erro ? d : null;
  if (!escalaInfoUltima) { info.hidden = true; return; }
  info.hidden = false;
  document.getElementById("escalaNome").textContent = d.nome_pedido || d.nome;
  document.getElementById("escalaEnarmonico").textContent = d.enarmonico
    ? `${d.nome_pedido} exigiria notas com dois sustenidos, então mostramos como ${d.enarmonico} — são as mesmas notas.`
    : "";
  document.getElementById("escalaCarater").textContent = d.carater;
  const notas = document.getElementById("escalaNotas");
  notas.replaceChildren();
  d.notas.forEach((n) => {
    const chip = elemento("span", "oh-chip", `${n.letra} · ${n.grau}`);
    chip.title = `${n.solfejo} (grau ${n.grau})`;
    notas.appendChild(chip);
  });
  const bloco = document.getElementById("escalaAcordesBloco");
  const acordes = document.getElementById("escalaAcordes");
  acordes.replaceChildren();
  if (d.acordes_triades) {
    bloco.hidden = false;
    [["Tríades", d.acordes_triades], ["Com sétima", d.acordes_setimas]].forEach(([rotulo, lista]) => {
      const linha = elemento("div", "oh-acordes-linha");
      linha.appendChild(elemento("span", "oh-acordes-rotulo", rotulo));
      lista.forEach((x) => { if (x) linha.appendChild(elemento("span", "oh-chip oh-chip-tom", `${x.grau} ${x.acorde}`)); });
      acordes.appendChild(linha);
    });
  } else {
    bloco.hidden = true;
  }
  document.getElementById("escalaDesafio").textContent = `🎤 Desafio ao cantar: ${d.desafio_vocal}`;
}

async function carregarInfoEscala() {
  const esc = escalaAtual();
  const minha = ++escalaInfoSeq;
  const form = new FormData();
  form.append("tonica", esc.tonica);
  form.append("tipo", esc.chave);
  try {
    const resp = await fetch(`${API_BASE}/api/escalas/descrever`, { method: "POST", body: form });
    const dados = await resp.json();
    if (minha === escalaInfoSeq) renderizarInfoEscala(dados);
  } catch (err) {
    if (minha === escalaInfoSeq) renderizarInfoEscala(null);       // sem servidor: o botão de tocar continua funcionando
  }
}

function aoMudarEscala() {
  atualizarBotaoEscala();
  clearTimeout(escalaInfoTimer);
  escalaInfoTimer = setTimeout(carregarInfoEscala, 200);
}

// Resultado da análise NA escala: % dentro, graus cantados, notas fora e o que provavelmente aconteceu
function mostrarResultadoEscala(av) {
  const card = document.getElementById("escalaResultadoCard");
  const corpo = document.getElementById("escalaResultadoCorpo");
  corpo.replaceChildren();
  if (!av) { card.hidden = true; return; }
  card.hidden = false;
  if (av.erro) { corpo.appendChild(elemento("p", "oh-hint", av.erro)); return; }

  const titulo = av.escala_pedida && av.escala_pedida !== av.escala ? `${av.escala_pedida} (= ${av.escala})` : av.escala;
  corpo.appendChild(elemento("div", "oh-encaixe-titulo", `${titulo} — ${av.notas_da_escala}`));
  const placar = elemento("div", "oh-escala-placar");
  placar.appendChild(elemento("span", "oh-escala-pct", `${av.pct_dentro}%`));
  placar.appendChild(elemento("span", "oh-hint", `das notas dentro da escala (${av.dentro} de ${av.total_notas}) · ${av.pct_dentro_tempo}% do tempo`));
  corpo.appendChild(placar);
  const barra = elemento("div", "oh-barra");
  const preenchida = elemento("div", "oh-barra-cheia");
  preenchida.style.width = `${Math.max(2, Math.min(100, av.pct_dentro))}%`;
  barra.appendChild(preenchida);
  corpo.appendChild(barra);

  const cantados = elemento("div", "oh-chips");
  av.graus_cantados.forEach((g) => cantados.appendChild(elemento("span", "oh-chip oh-chip-ok", `${g.nota} · grau ${g.grau} ×${g.vezes}`)));
  av.graus_nao_cantados.forEach((g) => cantados.appendChild(elemento("span", "oh-chip oh-chip-falta", `faltou ${g}`)));
  corpo.appendChild(cantados);

  if (av.fora.length) {
    corpo.appendChild(elemento("div", "oh-encaixe-titulo", "⚠️ Notas fora da escala"));
    const ul = elemento("ul", "oh-lista-escalas");
    av.fora.forEach((f) => {
      const li = elemento("li");
      li.appendChild(elemento("b", "", `${f.nota} ×${f.vezes}`));
      li.appendChild(elemento("span", "oh-escala-notas", f.dica));
      ul.appendChild(li);
    });
    corpo.appendChild(ul);
  } else {
    corpo.appendChild(elemento("p", "oh-hint", "✅ Nenhuma nota fora da escala."));
  }
}

function perguntarLaranjinhaSobreEscala() {
  const esc = escalaAtual();
  const d = escalaInfoUltima;
  const nome = d ? (d.nome_pedido || d.nome) : `${esc.tonica} ${esc.nome}`;
  const notas = d ? ` (notas: ${d.notas_texto})` : "";
  const painel = document.getElementById("laranjinhaPainel");
  if (painel.hidden) document.getElementById("fabLaranjinha").click();
  const campo = document.getElementById("laranjinhaInput");
  campo.value = `Estou estudando a escala ${nome}${notas}. Me explica como ela soa, que acordes combinam com ela e me passa um exercício de canto pra treinar essa escala.`;
  campo.focus();
}

function inicializarTomReferencia() {
  const btnNota = document.getElementById("btnTocarNota");
  const btnEscala = document.getElementById("btnTocarEscala");
  if (!btnNota || !btnEscala) return;

  montarSeletorEscalas();
  atualizarBotaoEscala();
  document.getElementById("notaRef").addEventListener("change", aoMudarEscala);
  document.getElementById("escalaTipo").addEventListener("change", aoMudarEscala);
  document.getElementById("btnEscalaLaranjinha").addEventListener("click", perguntarLaranjinhaSobreEscala);
  carregarInfoEscala();

  btnNota.addEventListener("click", () => {
    const nota = document.getElementById("notaRef").value;
    tocarTom(freqDeNota(nota, calibracaoAtual()));
  });

  btnEscala.addEventListener("click", () => {
    const esc = escalaAtual();
    const midiBase = 12 * (esc.oitava + 1) + NOMES_NOTAS.indexOf(esc.tonica);
    const subida = [...esc.intervalos, 12];                                  // termina na oitava
    const idaVolta = document.getElementById("escalaIdaVolta").checked;
    const semitons = idaVolta ? [...subida, ...subida.slice(0, -1).reverse()] : subida;
    const calib = calibracaoAtual();
    tocarEscalaPiano(semitons.map((iv) => calib * Math.pow(2, (midiBase + iv - 69) / 12)), idaVolta);
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
      ? arquivoDeGravacao(blobGravado, "gravacao")
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
    const avaliarEscala = document.getElementById("avaliarNaEscala");
    if (avaliarEscala && avaliarEscala.checked && document.getElementById("modo").value !== "cover") {
      const esc = escalaAtual();
      form.append("escala_tonica", esc.tonica);
      form.append("escala_tipo", esc.chave);
    }

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

      mostrarResultadoEscala(dados.modo === "cover" ? null : dados.avaliacao_escala);

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
        if (dados.avaliacao_escala && !dados.avaliacao_escala.erro) formDevolutiva.append("escala", JSON.stringify(dados.avaliacao_escala));

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
      statusMsg.textContent = dados.aviso_duracao ? `ℹ️ ${dados.aviso_duracao}` : "";
    } catch (err) {
      statusMsg.textContent = `Erro: ${mensagemDeErroDeRede(err)}`;
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
      : arquivoDeGravacao(blobAtual, "gravacao");
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
