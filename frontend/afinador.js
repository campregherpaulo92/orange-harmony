// ══════════════════════════════════════════════════════════════
// afinador.js — Afinador em tempo real, 100% no navegador
// Porta a detecção de pitch por autocorrelação que já usávamos em Python
// (_detectar_pitch_autocorr) para JavaScript puro, sem round-trip pro
// servidor e sem precisar de streamlit-webrtc.
// Depende de NOMES_NOTAS e freqDeNota(), já declarados em app.js.
// ══════════════════════════════════════════════════════════════

const AFINACOES = {
  "Padrão (EADGBE)": ["E2", "A2", "D3", "G3", "B3", "E4"],
  "Drop D (DADGBE)": ["D2", "A2", "D3", "G3", "B3", "E4"],
  "Drop C (CGCFAD)": ["C2", "G2", "C3", "F3", "A3", "D4"],
  "Drop B (BEADF#B)": ["B1", "E2", "A2", "D3", "F#3", "B3"],
  "Meio tom abaixo (Eb)": ["Eb2", "Ab2", "Db3", "Gb3", "Bb3", "Eb4"],
  "Open G (DGDGBD)": ["D2", "G2", "D3", "G3", "B3", "D4"],
  "DADGAD": ["D2", "A2", "D3", "G3", "A3", "D4"],
  "Open D (DADF#AD)": ["D2", "A2", "D3", "F#3", "A3", "D4"],
  "Open C (CGCGCE)": ["C2", "G2", "C3", "G3", "C4", "E4"],
  "Padrão 7 cordas (BEADGBE)": ["B1", "E2", "A2", "D3", "G3", "B3", "E4"],
  "Ukulele (GCEA)": ["G4", "C4", "E4", "A4"],
};

const DESCRICOES_AFINACOES = {
  "Padrão (EADGBE)": "Afinação clássica do violão — a base de tudo.",
  "Drop D (DADGBE)": "6ª corda desce para D. Poderosa para riffs e acordes com pestana grave. Muito usada em rock e metal.",
  "Drop C (CGCFAD)": "Versão mais grave do Drop D. Tom pesado, comum em metal moderno.",
  "Drop B (BEADF#B)": "Ainda mais grave que o Drop C. Metal extremo e sonoridade densa.",
  "Meio tom abaixo (Eb)": "Todas as cordas meio tom abaixo. Tom mais encorpado, clássico do rock (Guns, Van Halen).",
  "Open G (DGDGBD)": "Acorde de G solto. Perfeita para blues, slide e violão de dedo.",
  "DADGAD": "Afinação modal, dedilhados abertos e sonoridade celta/folk. Ótima para violão solo.",
  "Open D (DADF#AD)": "Acorde de D solto. Muito usada em folk, blues e slide.",
  "Open C (CGCGCE)": "Acorde de C solto. Rica para fingerstyle e composições com cordas soltas.",
  "Padrão 7 cordas (BEADGBE)": "Violão/guitarra de 7 cordas — adiciona o grave B1 na 7ª corda.",
  "Ukulele (GCEA)": "Afinação padrão do ukulele (soprano/concert).",
};

const FLAT_PARA_SHARP = { "Eb": "D#", "Ab": "G#", "Db": "C#", "Gb": "A#", "Bb": "A#" };

let afinadorAtivo = false;
let afinadorStream = null;
let afinadorAudioCtx = null;
let afinadorAnalyser = null;
let afinadorRAF = null;

let historicoFreq = [];
let notaEstavel = "";
let contadorEstavel = 0;
let notaExibidaAtual = "";
let centsSuavizado = 0;
let contadorSemSinal = 0;

// ── Detecção de pitch por autocorrelação no domínio do tempo ──
// (equivalente direto do algoritmo em Python, sem precisar de FFT/lib externa)
function detectarPitchAutocorr(amostras, sr) {
  const n = amostras.length;
  if (n < 256) return null;

  let media = 0;
  for (let i = 0; i < n; i++) media += amostras[i];
  media /= n;

  const x = new Float32Array(n);
  let energia = 0;
  for (let i = 0; i < n; i++) {
    x[i] = amostras[i] - media;
    energia += x[i] * x[i];
  }
  if (energia < 1e-6) return null;

  const lagMin = Math.max(2, Math.floor(sr / 1000));
  const lagMax = Math.min(Math.floor(n / 2), Math.floor(sr / 55));
  if (lagMax <= lagMin) return null;

  const corrArr = new Float32Array(lagMax + 2);
  let melhorLag = -1;
  let melhorCorr = -Infinity;

  for (let lag = lagMin; lag < lagMax; lag++) {
    let soma = 0;
    for (let i = 0; i < n - lag; i++) soma += x[i] * x[i + lag];
    const corrNorm = soma / (energia + 1e-10);
    corrArr[lag] = corrNorm;
    if (corrNorm > melhorCorr) {
      melhorCorr = corrNorm;
      melhorLag = lag;
    }
  }
  if (melhorLag < 0 || melhorCorr < 0.3) return null;

  // Interpolação parabólica pra refinar a posição exata do pico.
  // (Nota: testes mostraram que uma etapa de "correção de oitava" — tentando
  // favorecer múltiplos maiores do lag — na verdade PIORA a detecção nesse
  // método de autocorrelação no domínio do tempo: para sinais periódicos limpos
  // como uma corda de violão bem afinada, a correlação decai devagar nos
  // múltiplos do período verdadeiro, e essa correção acabava "escorregando"
  // para uma oitava abaixo da nota real. O pico bruto já é preciso o
  // suficiente — confirmado com testes sintéticos em todas as cordas padrão.)
  let picoFinal = melhorLag;
  if (melhorLag - 1 >= lagMin && melhorLag + 1 < lagMax) {
    const y0 = corrArr[melhorLag - 1];
    const y1 = corrArr[melhorLag];
    const y2 = corrArr[melhorLag + 1];
    const denom = y0 - 2 * y1 + y2;
    if (Math.abs(denom) > 1e-12) picoFinal += (0.5 * (y0 - y2)) / denom;
  }

  if (picoFinal <= 0) return null;
  const freq = sr / picoFinal;
  if (freq >= 55 && freq <= 1000) return freq;
  return null;
}

function freqParaNotaCents(freq, calibracao) {
  const midi = 69 + 12 * Math.log2(freq / calibracao);
  const midiArred = Math.round(midi);
  const nome = NOMES_NOTAS[((midiArred % 12) + 12) % 12];
  const oitava = Math.floor(midiArred / 12) - 1;
  const nota = `${nome}${oitava}`;
  const cents = 1200 * Math.log2(freq / (calibracao * Math.pow(2, (midiArred - 69) / 12)));
  return { nota, cents };
}

function normalizarNota(nota) {
  const nome = nota.slice(0, -1);
  const oitava = nota.slice(-1);
  return (FLAT_PARA_SHARP[nome] || nome) + oitava;
}

function julgarAfinacao(freq, calibracao, afinacaoNome, notaDetectada) {
  const notasAfinacao = AFINACOES[afinacaoNome] || AFINACOES["Padrão (EADGBE)"];
  const notasNorm = new Set(notasAfinacao.map(normalizarNota));
  if (notasNorm.has(notaDetectada)) {
    return { alvo: notaDetectada, cents: 0, naAfinacao: true };
  }
  let melhor = null;
  notasNorm.forEach((notaAlvo) => {
    const fAlvo = freqDeNota(notaAlvo, calibracao);
    const cents = 1200 * Math.log2(freq / fAlvo);
    if (melhor === null || Math.abs(cents) < Math.abs(melhor.cents)) {
      melhor = { alvo: notaAlvo, cents };
    }
  });
  if (melhor === null) return { alvo: notaDetectada, cents: 0, naAfinacao: true };
  return { alvo: melhor.alvo, cents: melhor.cents, naAfinacao: false };
}

function calibracaoAfinador() {
  const marcado = document.querySelector('input[name="afinadorCalib"]:checked');
  return marcado ? parseFloat(marcado.value) : 440;
}

// ── Monta as marcas fixas do mostrador (-50/-25/0/+25/+50), uma vez só ──
function montarMarcasGauge() {
  const grupo = document.getElementById("afinadorMarcasSvg");
  if (!grupo) return;
  const marcas = [[-50, "-50"], [-25, "-25"], [0, "0"], [25, "+25"], [50, "+50"]];
  let svg = "";
  marcas.forEach(([v, rotulo]) => {
    const a = (v / 50) * 90;
    const rad = (a * Math.PI) / 180;
    const x1 = 110 + 74 * Math.sin(rad), y1 = 110 - 74 * Math.cos(rad);
    const x2 = 110 + 84 * Math.sin(rad), y2 = 110 - 84 * Math.cos(rad);
    const lx = 110 + 96 * Math.sin(rad), ly = 110 - 96 * Math.cos(rad);
    svg += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#555" stroke-width="2"/>`;
    svg += `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" fill="#888" font-size="10" font-family="Inter">${rotulo}</text>`;
  });
  grupo.innerHTML = svg;
}

// ── Monta a fileira de notas cromáticas (A, A#, B, C...), uma vez só ──
function montarNotasCromaticas() {
  const container = document.getElementById("afinadorNotasCromaticas");
  if (!container) return;
  container.innerHTML = NOMES_NOTAS.map((n) => `<span class="oh-nota-crom" data-nota="${n}">${n}</span>`).join("");
}

function atualizarVisualAfinador(nota, cents, freq, alvoAfinacao, naAfinacao, afinacaoNome) {
  const centsClamp = Math.max(-50, Math.min(50, cents));
  const angulo = (centsClamp / 50) * 90;
  let cor, status;
  if (Math.abs(centsClamp) <= 10) { cor = "#22c55e"; status = "AFINADO"; }
  else if (Math.abs(centsClamp) <= 25) { cor = "#eab308"; status = "PRÓXIMO"; }
  else { cor = "#ef4444"; status = "DESAFINADO"; }

  document.getElementById("afinadorNotaGrande").textContent = nota;
  document.getElementById("afinadorFreq").textContent = `${freq.toFixed(2)} Hz`;

  const agulha = document.getElementById("afinadorAgulhaGrupo");
  agulha.setAttribute("transform", `rotate(${angulo.toFixed(1)} 110 110)`);
  document.getElementById("afinadorAgulhaLinha").setAttribute("stroke", cor);
  document.getElementById("afinadorAgulhaBase").setAttribute("fill", cor);

  const statusEl = document.getElementById("afinadorStatus");
  statusEl.textContent = status;
  statusEl.style.color = cor;

  const nomeBase = nota.slice(0, -1);
  document.querySelectorAll(".oh-nota-crom").forEach((el) => {
    el.classList.toggle("oh-nota-crom-ativa", el.dataset.nota === nomeBase);
  });

  const aviso = document.getElementById("afinadorAviso");
  if (!naAfinacao) {
    aviso.hidden = false;
    aviso.textContent = `🎯 Fora da afinação «${afinacaoNome}» — alvo mais próximo: ${alvoAfinacao}`;
  } else {
    aviso.hidden = true;
  }
}

function loopAfinador() {
  if (!afinadorAtivo) return;
  afinadorRAF = requestAnimationFrame(loopAfinador);

  const buffer = new Float32Array(afinadorAnalyser.fftSize);
  afinadorAnalyser.getFloatTimeDomainData(buffer);
  const sr = afinadorAudioCtx.sampleRate;

  const freq = detectarPitchAutocorr(buffer, sr);
  if (freq === null) {
    contadorSemSinal++;
    return;
  }
  contadorSemSinal = 0;

  historicoFreq.push(freq);
  if (historicoFreq.length > 12) historicoFreq.shift();
  const ordenado = [...historicoFreq].sort((a, b) => a - b);
  const freqSuave = ordenado[Math.floor(ordenado.length / 2)];

  const calib = calibracaoAfinador();
  const { nota, cents } = freqParaNotaCents(freqSuave, calib);

  // A AGULHA e os cents são atualizados em TODO frame, suavizados por um
  // filtro simples — dá a sensação de "ponteiro vivo" acompanhando o som,
  // em vez de só "saltar" quando a nota se estabiliza.
  centsSuavizado = 0.35 * cents + 0.65 * centsSuavizado;

  // Já o NOME grande da nota (e o destaque na fileira cromática) só troca
  // depois de alguns frames seguidos com a mesma nota — evita ficar
  // piscando entre notas vizinhas por causa de ruído momentâneo.
  if (nota === notaEstavel) {
    contadorEstavel++;
  } else {
    notaEstavel = nota;
    contadorEstavel = 0;
  }
  if (contadorEstavel >= 2 || !notaExibidaAtual) {
    notaExibidaAtual = nota;
  }

  const afinacaoNome = document.getElementById("afinacaoSelect").value;
  const julgamento = julgarAfinacao(freqSuave, calib, afinacaoNome, notaExibidaAtual);
  atualizarVisualAfinador(notaExibidaAtual, centsSuavizado, freqSuave, julgamento.alvo, julgamento.naAfinacao, afinacaoNome);
}

async function iniciarAfinador() {
  const erroEl = document.getElementById("afinadorErro");
  try {
    afinadorStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    erroEl.textContent = "Sem permissão de microfone.";
    return;
  }

  afinadorAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const fonte = afinadorAudioCtx.createMediaStreamSource(afinadorStream);
  afinadorAnalyser = afinadorAudioCtx.createAnalyser();
  afinadorAnalyser.fftSize = 4096;
  fonte.connect(afinadorAnalyser);

  historicoFreq = [];
  notaEstavel = "";
  contadorEstavel = 0;
  notaExibidaAtual = "";
  centsSuavizado = 0;
  contadorSemSinal = 0;

  afinadorAtivo = true;
  document.getElementById("afinadorVisual").hidden = false;
  document.getElementById("btnAfinadorToggle").textContent = "⏸ Parar";
  erroEl.textContent = "";
  loopAfinador();
}

function pararAfinador() {
  afinadorAtivo = false;
  if (afinadorRAF) cancelAnimationFrame(afinadorRAF);
  if (afinadorStream) afinadorStream.getTracks().forEach((t) => t.stop());
  if (afinadorAudioCtx) afinadorAudioCtx.close();
  document.getElementById("btnAfinadorToggle").textContent = "🎙️ Iniciar";
}

function atualizarDescricaoAfinacao() {
  const select = document.getElementById("afinacaoSelect");
  const desc = document.getElementById("afinacaoDescricao");
  if (!select || !desc) return;
  desc.textContent = DESCRICOES_AFINACOES[select.value] || "";
}

function montarSelectAfinacoes() {
  const select = document.getElementById("afinacaoSelect");
  if (!select) return;
  Object.keys(AFINACOES).forEach((nome) => {
    const opt = document.createElement("option");
    opt.value = nome;
    opt.textContent = nome;
    select.appendChild(opt);
  });
  atualizarDescricaoAfinacao();
}

function inicializarAfinador() {
  const select = document.getElementById("afinacaoSelect");
  const btn = document.getElementById("btnAfinadorToggle");
  if (!select || !btn) return;

  montarSelectAfinacoes();
  montarMarcasGauge();
  montarNotasCromaticas();
  select.addEventListener("change", atualizarDescricaoAfinacao);

  btn.addEventListener("click", () => {
    if (!afinadorAtivo) iniciarAfinador(); else pararAfinador();
  });
}
