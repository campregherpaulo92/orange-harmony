// ══════════════════════════════════════════════════════════════════════════
// estudioDsp.js — processamento de áudio do Orange Studio que roda no navegador (e no Node, para testes).
//
// limparRuido(): redução de ruído por "porta espectral", no mesmo princípio da ferramenta que o app já usa
// no servidor (noisereduce em modo estacionário), mas trabalhando com o áudio ORIGINAL (estéreo, qualidade cheia):
//   1. mede o ruído nos trechos mais quietos da própria gravação (pausas, respiros, silêncio da sala);
//   2. em cada instante e frequência, vê se o som passa de "ruído + folga": se sim é voz, se não é ruído;
//   3. suaviza essa decisão no tempo e na frequência (evita o "ruído musical", aquele chiado de passarinho);
//   4. atenua só o que é ruído, na intensidade escolhida; a voz passa intacta.
// Limite honesto: precisa de pausas (trechos só com ruído) para medir o ruído. Sem pausas, NÃO mexe no áudio.
// Não tira ruído que muda de som (voz de outras pessoas, música ao fundo): é para chiado, ventilador, "sala".
// ══════════════════════════════════════════════════════════════════════════
(function (raiz) {
  "use strict";
  const NFFT = 2048, HOP = 512, NB = NFFT / 2 + 1, NORM = 1.5;      // soma das janelas de Hann ao quadrado, com 75% de sobreposição
  const JANELA = new Float64Array(NFFT);
  for (let i = 0; i < NFFT; i++) JANELA[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / NFFT);

  // ── FFT (radix-2) ──
  const REV = new Uint32Array(NFFT), COS = new Float64Array(NFFT / 2), SEN = new Float64Array(NFFT / 2);
  (function () {
    const bits = Math.log2(NFFT) | 0;
    for (let i = 0; i < NFFT; i++) { let r = 0; for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b); REV[i] = r; }
    for (let k = 0; k < NFFT / 2; k++) { COS[k] = Math.cos((2 * Math.PI * k) / NFFT); SEN[k] = Math.sin((2 * Math.PI * k) / NFFT); }
  })();
  function fft(re, im, inverso) {
    for (let i = 0; i < NFFT; i++) { const j = REV[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
    for (let tam = 2; tam <= NFFT; tam <<= 1) {
      const meio = tam >> 1, passo = NFFT / tam;
      for (let ini = 0; ini < NFFT; ini += tam) {
        for (let k = 0, t = 0; k < meio; k++, t += passo) {
          const wr = COS[t], wi = inverso ? SEN[t] : -SEN[t], a = ini + k, b = a + meio;
          const tr = re[b] * wr - im[b] * wi, ti = re[b] * wi + im[b] * wr;
          re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        }
      }
    }
    if (inverso) for (let i = 0; i < NFFT; i++) { re[i] /= NFFT; im[i] /= NFFT; }
  }

  // Janela deslizante ao longo da frequência (porFreq) ou do tempo. dilatar: 255 se houver qualquer 255 na janela; senão, média.
  function janela1D(src, dst, F, NB, raio, porFreq, dilatar) {
    const nA = porFreq ? F : NB, nB = porFreq ? NB : F, passoA = porFreq ? NB : 1, passoB = porFreq ? 1 : NB;
    for (let a = 0; a < nA; a++) {
      const base = a * passoA; let soma = 0, cont = 0;
      for (let k = 0; k <= raio && k < nB; k++) { soma += src[base + k * passoB]; cont++; }
      for (let k = 0; k < nB; k++) {
        dst[base + k * passoB] = dilatar ? (soma > 0 ? 255 : 0) : Math.round(soma / cont);
        const sai = k - raio, entra = k + raio + 1;
        if (sai >= 0) { soma -= src[base + sai * passoB]; cont--; } if (entra < nB) { soma += src[base + entra * passoB]; cont++; }
      }
    }
  }

  const tick = () => new Promise((ok) => setTimeout(ok, 0));
  const percentil = (arr, p) => { const o = Float64Array.from(arr).sort(); return o[Math.min(o.length - 1, Math.max(0, Math.floor(p * (o.length - 1))))]; };

  // canais: array de Float32Array (todos do mesmo tamanho). Devolve { canais } ou { aviso } (e então não mexeu em nada) ou { cancelado }.
  // opc.intensidade: 0..1 (quanto o ruído é atenuado: 0,6 leve · 0,8 média · 0,95 forte). opc.cortarGraves: tira o ronco < 80 Hz (padrão: sim).
  async function limparRuido(canais, sr, opc, progresso, cancelado) {
    opc = opc || {}; progresso = progresso || function () {}; cancelado = cancelado || function () { return false; };
    const prop = Math.min(1, Math.max(0, opc.intensidade == null ? 0.8 : opc.intensidade)), nStd = opc.nStd == null ? 3.0 : opc.nStd;
    const n = canais[0].length, nc = canais.length;
    if (n < sr) return { aviso: "curto" };                         // menos de 1 s: não dá para medir o ruído

    const pad = NFFT, L = n + 2 * pad, F = Math.floor((L - NFFT) / HOP) + 1;
    const xs = canais.map((c) => { const x = new Float32Array(L); x.set(c, pad); return x; });
    const hp = new Float64Array(NB);                              // corte de graves (< 80 Hz) feito na FFT: tira o ronco sem deslocar a fase da voz
    for (let b = 0; b < NB; b++) { const x = ((b * sr) / NFFT) / 80, x4 = x * x * x * x; hp[b] = opc.cortarGraves === false ? 1 : Math.sqrt(x4 / (1 + x4)); }
    let mono = new Float32Array(L);
    for (let c = 0; c < nc; c++) for (let i = 0; i < L; i++) mono[i] += xs[c][i] / nc;

    // 1. onde está o ruído? energia de cada janela; as 10% mais quietas viram a amostra de ruído
    const reais = [], en = [];
    for (let f = 0; f < F; f++) {
      const ini = f * HOP, centro = ini + NFFT / 2;
      if (centro < pad || centro >= pad + n) continue;
      let s = 0; for (let i = 0; i < NFFT; i++) { const v = mono[ini + i]; s += v * v; }
      reais.push(f); en.push(Math.sqrt(s / NFFT));
    }
    const forte = percentil(en, 0.9);
    if (forte < 1e-5) return { aviso: "silencio" };
    const ordem = reais.map((f, k) => k).sort((a, b) => en[a] - en[b]), q = Math.max(10, Math.round(0.1 * reais.length)), quietos = ordem.slice(0, Math.min(q, ordem.length));
    const quieta = quietos.reduce((s, k) => s + en[k], 0) / quietos.length;
    if (quieta > 0.2 * forte) return { aviso: "sem_pausas", contraste: quieta / forte };    // nada parecido com "só ruído": medir daria errado

    const re = new Float64Array(NFFT), im = new Float64Array(NFFT);
    const espectroMono = (f) => { const ini = f * HOP; for (let i = 0; i < NFFT; i++) { re[i] = mono[ini + i] * JANELA[i]; im[i] = 0; } fft(re, im, false); };
    const mu = new Float64Array(NB), sd = new Float64Array(NB), lim = new Float64Array(NB);
    for (const k of quietos) { espectroMono(reais[k]); for (let b = 0; b < NB; b++) mu[b] += Math.hypot(re[b], im[b]); }
    for (let b = 0; b < NB; b++) mu[b] /= quietos.length;
    for (const k of quietos) { espectroMono(reais[k]); for (let b = 0; b < NB; b++) { const d = Math.hypot(re[b], im[b]) - mu[b]; sd[b] += d * d; } }
    for (let b = 0; b < NB; b++) lim[b] = mu[b] + nStd * Math.sqrt(sd[b] / quietos.length) + 1e-9;

    // 2. em cada janela e frequência: passou do limite do ruído? (1 = é som, 0 = é ruído)
    const P = Object.assign({ pers: 2, df: 1, dt: 3, sf: 1, st: 1 }, opc.ajuste || {});
    const mascara = new Uint8Array(F * NB);
    for (let f = 0; f < F; f++) {
      espectroMono(f); const o = f * NB; for (let b = 0; b < NB; b++) mascara[o + b] = Math.hypot(re[b], im[b]) > lim[b] ? 255 : 0;
      if (f % 64 === 0) { progresso(0.3 * f / F); await tick(); if (cancelado()) return { cancelado: true }; }
    }
    mono = null;

    // 3. limpa a decisão. Som de verdade (voz) PERSISTE por mais de uma janela; um "pico" isolado é só o acaso do chiado.
    //    Depois a região de som é ALARGADA (dilatação), nunca "feita média": média achata as linhas finas da voz.
    const tmp = new Uint8Array(F * NB);
    if (P.pers > 0) {
      for (let f = 0; f < F; f++) { const o = f * NB, a2 = f - P.pers >= 0 ? (f - P.pers) * NB : -1, b2 = f + P.pers < F ? (f + P.pers) * NB : -1;
        for (let b = 0; b < NB; b++) tmp[o + b] = mascara[o + b] && ((a2 >= 0 && mascara[a2 + b]) || (b2 >= 0 && mascara[b2 + b])) ? 255 : 0; }
      mascara.set(tmp);
    }
    janela1D(mascara, tmp, F, NB, P.df, true, true); janela1D(tmp, mascara, F, NB, P.dt, false, true);          // dilata: frequência, depois tempo
    janela1D(mascara, tmp, F, NB, P.sf, true, false); janela1D(tmp, mascara, F, NB, P.st, false, false);        // bordas suaves (média curta)
    progresso(0.35); await tick();

    // 4. aplica: ruído é atenuado em `prop`; o que é som passa inteiro
    const saidas = [];
    for (let c = 0; c < nc; c++) {
      const y = new Float32Array(L), x = xs[c];
      for (let f = 0; f < F; f++) {
        const ini = f * HOP, o = f * NB;
        for (let i = 0; i < NFFT; i++) { re[i] = x[ini + i] * JANELA[i]; im[i] = 0; }
        fft(re, im, false);
        for (let b = 0; b < NB; b++) {
          const g = (1 - prop * (1 - mascara[o + b] / 255)) * hp[b];
          re[b] *= g; im[b] *= g;
          if (b > 0 && b < NB - 1) { re[NFFT - b] *= g; im[NFFT - b] *= g; }
        }
        fft(re, im, true);
        for (let i = 0; i < NFFT; i++) y[ini + i] += (re[i] * JANELA[i]) / NORM;
        if (f % 64 === 0) { progresso(0.35 + 0.65 * (c + f / F) / nc); await tick(); if (cancelado()) return { cancelado: true }; }
      }
      const saida = new Float32Array(n);
      for (let i = 0; i < n; i++) { const v = y[pad + i]; saida[i] = v > 1 ? 1 : v < -1 ? -1 : v; }
      saidas.push(saida);
    }
    progresso(1);
    return { canais: saidas, aviso: null, contraste: quieta / forte };
  }

  const api = { limparRuido, _fft: fft, NFFT, HOP };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  raiz.EstudioDsp = api;
})(typeof window !== "undefined" ? window : globalThis);
