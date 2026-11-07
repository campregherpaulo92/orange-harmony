// ══════════════════════════════════════════════════════════════════════════
// estudioAfinacao.js — afinação de voz no navegador (e no Node, para testes).
//
//  detectarAltura():  mede a altura (Hz) da voz a cada 10 ms → uma LINHA contínua (com vibrato, passagens, tudo).
//  corrigirAltura():  muda a altura ao longo do tempo seguindo uma curva de correção em "cents" (100 cents = 1 semitom),
//                     com PSOLA (cada ciclo da voz é reaproveitado numa nova cadência). Funciona bem para voz sozinha
//                     e correções de até ~3 semitons; o timbre (formantes) se mantém.
// Limites honestos: só vale para UMA voz por vez (não afina acorde nem música), e correções grandes soam artificiais.
// Onde a voz não é "afinada" (consoantes, respiro, silêncio) o áudio passa intacto.
// ══════════════════════════════════════════════════════════════════════════
(function (raiz) {
  "use strict";
  const tick = () => new Promise((ok) => setTimeout(ok, 0));
  const hzParaMidi = (f) => 69 + 12 * Math.log2(f / 440), midiParaHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const percentil = (arr, p) => { const o = Float64Array.from(arr).sort(); return o.length ? o[Math.min(o.length - 1, Math.max(0, Math.floor(p * (o.length - 1))))] : 0; };

  // passa-baixas + decimação (a detecção grossa roda a ~11 kHz: muito mais rápida)
  function decimar(x, fator) {
    if (fator <= 1) return Float32Array.from(x);
    const N = 8 * fator + 1, h = new Float64Array(N), meio = (N - 1) / 2, fc = 0.45 / fator; let soma = 0;
    for (let i = 0; i < N; i++) { const k = i - meio, sinc = k === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * k) / (Math.PI * k); h[i] = sinc * (0.5 - 0.5 * Math.cos((2 * Math.PI * (i + 0.5)) / N)); soma += h[i]; }
    for (let i = 0; i < N; i++) h[i] /= soma;
    const m = Math.floor(x.length / fator), y = new Float32Array(m);
    for (let j = 0; j < m; j++) { const c = j * fator; let s = 0; for (let i = 0; i < N; i++) { const idx = c + i - meio; if (idx >= 0 && idx < x.length) s += h[i] * x[idx]; } y[j] = s; }
    return y;
  }

  // Devolve { hop, t0, n, f0 (Hz; 0 = sem altura), voz (0/1), conf }. O quadro q está no instante t0 + q·hop (segundos).
  async function detectarAltura(x, sr, opc, progresso) {
    opc = opc || {}; progresso = progresso || function () {};
    x = altoPassa(x, sr, 55);   // rumble, DC e batidas no microfone (abaixo de ~55 Hz) enganam o método de medir a altura: saem antes
    const fmin = opc.fmin || 70, fmax = opc.fmax || 1000, limiar = opc.limiar || 0.15;
    const fator = Math.max(1, Math.round(sr / 11025)), srd = sr / fator, xd = decimar(x, fator);
    const W = Math.round(0.025 * srd), tauMax = Math.round(srd / fmin), tauMin = Math.max(2, Math.floor(srd / fmax));
    const hopS = Math.round(0.010 * srd), hop = (hopS * fator) / sr, t0 = ((W + tauMax) / 2) / srd;
    const nq = Math.max(0, Math.floor((xd.length - (W + tauMax)) / hopS) + 1);
    const f0 = new Float32Array(nq), conf = new Float32Array(nq), voz = new Uint8Array(nq), rmsQ = new Float32Array(nq);
    for (let q = 0; q < nq; q++) { const ini = q * hopS; let s = 0; for (let j = 0; j < W + tauMax; j++) { const v = xd[ini + j]; s += v * v; } rmsQ[q] = Math.sqrt(s / (W + tauMax)); }
    const porta = 0.03 * percentil(rmsQ, 0.95);
    const d = new Float64Array(tauMax + 1), dn = new Float64Array(tauMax + 1);
    // 1) candidatos de altura de cada quadro: os mínimos locais da diferença normalizada (YIN), sem decidir ainda
    const K = 5, NV = K, NS = K + 1, OCT = 0.03, custoNV = opc.custoNaoVozeado || 0.3;
    const candTf = new Float32Array(nq * K), candCusto = new Float32Array(nq * K), candN = new Uint8Array(nq);
    for (let q = 0; q < nq; q++) {
      if (q % 200 === 0) { progresso((q / nq) * 0.8); await tick(); }
      if (rmsQ[q] < porta || rmsQ[q] < 1e-5) continue;
      const ini = q * hopS;
      for (let tau = 1; tau <= tauMax; tau++) { let s = 0; for (let j = 0; j < W; j++) { const df = xd[ini + j] - xd[ini + j + tau]; s += df * df; } d[tau] = s; }
      dn[0] = 1; let corre = 0; for (let tau = 1; tau <= tauMax; tau++) { corre += d[tau]; dn[tau] = corre > 0 ? (d[tau] * tau) / corre : 1; }
      const lista = [];
      for (let t = tauMin; t < tauMax; t++) if (dn[t] < 0.5 && dn[t] <= dn[t - 1] && dn[t] < dn[t + 1]) lista.push(t);
      // sub-harmônico: se existe um período à METADE (ou a um terço) quase tão bom quanto o longo, o longo é o ciclo "dobrado" de uma voz áspera: perde
      const dobrado = (t) => { for (const u of lista) if (u < t && dn[u] <= dn[t] + 0.1 && (Math.abs(t / u - 2) < 0.16 || Math.abs(t / u - 3) < 0.24)) return 0.35; return 0; };
      const custo = (t) => dn[t] + OCT * Math.log2(t / tauMin) + dobrado(t);   // + leve preferência pelo período mais curto (evita "cair uma oitava")
      lista.sort((p1, p2) => custo(p1) - custo(p2));
      const n = Math.min(K, lista.length); candN[q] = n;
      for (let k = 0; k < n; k++) {
        const t = lista[k]; let tf = t; const a1 = dn[t - 1], b1 = dn[t], c1 = dn[t + 1], den = a1 - 2 * b1 + c1; if (Math.abs(den) > 1e-12) tf = t + (0.5 * (a1 - c1)) / den;
        candTf[q * K + k] = tf; candCusto[q * K + k] = custo(t);
      }
    }
    // 2) o MELHOR CAMINHO no tempo todo (Viterbi): cada quadro é "voz" num dos candidatos ou "sem altura".
    //    Saltos de altura custam caro (uma oitava custa mais que simplesmente largar o trecho), então o erro de oitava vira pausa, nunca um espeto,
    //    e quadros fracos entre dois quadros bons são aproveitados em vez de virarem buraco.
    const TROCA = 0.2, volta = new Uint8Array(nq * NS);
    let ant = new Float64Array(NS).fill(Infinity), cur = new Float64Array(NS); ant[NV] = 0;
    const passo = (tp, tc) => { const dd = Math.abs(12 * Math.log2(tp / tc)); return 0.03 * dd + 0.02 * dd * dd; };
    for (let q = 0; q < nq; q++) {
      const n = candN[q], np = q > 0 ? candN[q - 1] : 0;
      for (let s = 0; s < NS; s++) cur[s] = Infinity;
      // sem altura
      { let melhor = Infinity, de = NV; for (let j = 0; j <= NV; j++) { if (!isFinite(ant[j])) continue; const c = ant[j] + (j === NV ? 0 : TROCA); if (c < melhor) { melhor = c; de = j; } } cur[NV] = melhor + (n ? custoNV : 0); volta[q * NS + NV] = de; }
      for (let k = 0; k < n; k++) {
        const tc = candTf[q * K + k]; let melhor = Infinity, de = NV;
        for (let j = 0; j <= NV; j++) { if (!isFinite(ant[j])) continue; const c = ant[j] + (j === NV ? TROCA : j < np ? passo(candTf[(q - 1) * K + j], tc) : Infinity); if (c < melhor) { melhor = c; de = j; } }
        cur[k] = melhor + candCusto[q * K + k]; volta[q * NS + k] = de;
      }
      const t = ant; ant = cur; cur = t;
    }
    let estado = NV, melhorFim = Infinity; for (let s = 0; s <= NV; s++) if (ant[s] < melhorFim) { melhorFim = ant[s]; estado = s; }
    const escolha = new Int8Array(nq); for (let q = nq - 1; q >= 0; q--) { escolha[q] = estado === NV ? -1 : estado; estado = volta[q * NS + estado]; }
    // 3) refinamento na taxa original, só nos quadros escolhidos
    for (let q = 0; q < nq; q++) {
      if (q % 300 === 0) { progresso(0.8 + 0.2 * (q / nq)); await tick(); }
      if (escolha[q] < 0) continue;
      const tf = candTf[q * K + escolha[q]], ini = q * hopS, tauR = Math.round(tf);
      // refinamento na taxa original: janela SIMÉTRICA em torno do instante do quadro (alinha a linha com o áudio),
      // comparando com o ciclo seguinte em atrasos INTEIROS e interpolando o pico (precisão bem abaixo de 1 amostra)
      let per = tf * fator; const c0 = Math.round(((ini + (W + tauMax) / 2)) * fator), Wf = Math.max(128, Math.min(2048, Math.round(2.5 * per)));
      const corr = (L) => { let sab = 0, saa = 0, sbb = 0; const ia = c0 - (L >> 1) - (Wf >> 1), ib = ia + L; if (ia < 0 || ib + Wf >= x.length) return null; for (let j = 0; j < Wf; j++) { const a = x[ia + j], b = x[ib + j]; sab += a * b; saa += a * a; sbb += b * b; } return sab / Math.sqrt(saa * sbb + 1e-20); };
      const L0 = Math.round(per), rs = []; let ik = -1, bv = -2;
      for (let k = -(fator + 1); k <= fator + 1; k++) { const r = corr(L0 + k); rs.push(r); if (r !== null && r > bv) { bv = r; ik = rs.length - 1; } }
      if (bv > 0 && ik > 0 && ik < rs.length - 1 && rs[ik - 1] !== null && rs[ik + 1] !== null) {
        const a = rs[ik - 1], b = rs[ik], c = rs[ik + 1], den = a - 2 * b + c; per = L0 + (ik - (fator + 1)) + (Math.abs(den) > 1e-12 ? (0.5 * (a - c)) / den : 0);
      } else if (bv > 0) per = L0 + (ik - (fator + 1));
      f0[q] = sr / per; conf[q] = 1 - Math.min(1, candCusto[q * K + escolha[q]]); voz[q] = 1; void tauR;
    }
    // limpeza: mediana de 5 quadros (em semitons), remove trechos curtos e saltos de oitava isolados
    const st = new Float64Array(nq); for (let q = 0; q < nq; q++) st[q] = voz[q] ? hzParaMidi(f0[q]) : 0;
    const med = new Float64Array(nq);
    for (let q = 0; q < nq; q++) { if (!voz[q]) continue; const v = []; for (let k = -2; k <= 2; k++) { const i = q + k; if (i >= 0 && i < nq && voz[i]) v.push(st[i]); } v.sort((a, b) => a - b); med[q] = v[v.length >> 1]; }
    for (let q = 0; q < nq; q++) if (voz[q]) f0[q] = midiParaHz(med[q]);
    // trechos curtos (menos de 60 ms) ou curtos e pouco confiáveis (menos de 250 ms com periodicidade fraca) são ruído (respiração, estalo), não voz
    for (let q = 0; q < nq;) { if (!voz[q]) { q++; continue; } let q1 = q, somaConf = 0; while (q1 < nq && voz[q1]) { somaConf += conf[q1]; q1++; } const len = q1 - q; if (len < 6 || (len < 25 && somaConf / len < 0.5)) for (let k = q; k < q1; k++) { voz[k] = 0; f0[k] = 0; } q = q1; }
    progresso(1);
    return { hop, t0, n: nq, f0, voz, conf, sr };
  }

  // Passa-altas de fase zero (4ª ordem, ida e volta): separa o que está abaixo de ~55 Hz (rumble, DC, batida no microfone), que NÃO é voz
  function altoPassa(x, sr, fc) {
    const n = x.length, pad = Math.min(Math.round(0.15 * sr), n - 1), e = new Float32Array(n + 2 * pad);
    for (let i = 0; i < pad; i++) { e[pad - 1 - i] = 2 * x[0] - x[Math.min(n - 1, i + 1)]; e[pad + n + i] = 2 * x[n - 1] - x[Math.max(0, n - 2 - i)]; }   // reflexão ímpar: sem solavanco nas pontas
    e.set(x, pad);
    for (const Q of [0.5412, 1.3066]) {
      const w0 = (2 * Math.PI * fc) / sr, cs = Math.cos(w0), al = Math.sin(w0) / (2 * Q), a0 = 1 + al, b0 = (1 + cs) / 2 / a0, b1 = -(1 + cs) / a0, a1 = (-2 * cs) / a0, a2 = (1 - al) / a0;
      for (let passe = 0; passe < 2; passe++) {
        let x1 = 0, x2 = 0, y1 = 0, y2 = 0; const m = e.length;
        if (passe === 0) for (let i = 0; i < m; i++) { const v = b0 * e[i] + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = e[i]; y2 = y1; y1 = v; e[i] = v; }
        else for (let i = m - 1; i >= 0; i--) { const v = b0 * e[i] + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = e[i]; y2 = y1; y1 = v; e[i] = v; }
      }
    }
    return e.slice(pad, pad + n);
  }

  // Aplica a curva de correção (cents por quadro, mesmo tamanho de det.f0) com PSOLA. Devolve um novo Float32Array.
  // Cuidados que evitam o "rosnado": (1) só a parte acima de ~55 Hz passa pelo PSOLA (o rumble volta intacto, sem ser repetido em pedaços);
  // (2) cada ciclo é marcado por SEMELHANÇA DE FORMA com o ciclo anterior, e não pelo maior pico (que alterna quando o ciclo tem dois picos parecidos).
  function corrigirAltura(x, sr, det, cents) {
    const n = x.length, y = Float32Array.from(x), nq = det.n, hf = altoPassa(x, sr, 55);
    const interp = (arr, t, voz) => { let p = (t - det.t0) / det.hop; p = Math.max(0, Math.min(nq - 1, p)); const i = Math.floor(p), j = Math.min(nq - 1, i + 1), fr = p - i; let a = arr[i], b = arr[j]; if (voz) { if (!a) a = b; if (!b) b = a; } return a * (1 - fr) + b * fr; };
    const f0em = (t) => interp(det.f0, t, true), cem = (t) => interp(cents, t, false);
    const F = Math.round(0.015 * sr);
    for (let q = 0; q < nq;) {
      if (!det.voz[q]) { q++; continue; }
      const q0 = q; while (q < nq && det.voz[q]) q++; const q1 = q - 1;
      let mexe = false; for (let k = q0; k <= q1; k++) if (Math.abs(cents[k]) > 0.5) { mexe = true; break; }
      if (!mexe) continue;
      const s0 = Math.max(0, Math.round((det.t0 + q0 * det.hop - det.hop / 2) * sr)), s1 = Math.min(n, Math.round((det.t0 + q1 * det.hop + det.hop / 2) * sr));
      if (s1 - s0 < 4 * F) continue;
      // marcas de análise: a 1ª no maior pico; as seguintes onde o ciclo seguinte mais se PARECE com o atual
      const A = []; { const P0 = sr / f0em(s0 / sr), fimBusca = Math.min(s1 - 1, Math.round(s0 + 1.2 * P0)); let b0 = s0, bv = -Infinity; for (let i = s0; i <= fimBusca; i++) if (hf[i] > bv) { bv = hf[i]; b0 = i; } A.push(b0); }
      for (;;) {
        const m = A[A.length - 1], P = sr / f0em(m / sr), prox = m + P; if (prox >= s1 - 2) break;
        const W = Math.max(8, Math.round(P)), meio = W >> 1, lo = Math.round(prox - 0.25 * P), hi = Math.round(prox + 0.25 * P), ia = m - meio; if (ia < 0) break;
        let melhor = Math.round(prox), bv = -2, ea = 0; for (let j = 0; j < W; j++) ea += hf[ia + j] * hf[ia + j];
        for (let c = lo; c <= hi; c++) { const ib = c - meio; if (ib < 0 || ib + W >= n) continue; let sab = 0, eb = 0; for (let j = 0; j < W; j++) { const bb = hf[ib + j]; sab += hf[ia + j] * bb; eb += bb * bb; } const r = sab / Math.sqrt(ea * eb + 1e-20); if (r > bv) { bv = r; melhor = c; } }
        if (melhor <= m + 0.5 * P) melhor = Math.round(m + P);
        A.push(melhor);
      }
      if (A.length < 3) continue;
      // marcas de síntese: um ciclo por período NOVO (período original ÷ fator de correção)
      const Sm = []; let ts = A[0];
      while (ts < s1) { Sm.push(ts); ts += sr / (f0em(ts / sr) * Math.pow(2, cem(ts / sr) / 1200)); }
      const acc = new Float32Array(s1 - s0), peso = new Float32Array(s1 - s0); let j = 0;
      for (const t of Sm) {
        while (j + 1 < A.length && Math.abs(A[j + 1] - t) < Math.abs(A[j] - t)) j++;
        const Pa = sr / f0em(A[j] / sr), L = Math.round(2 * Pa), meio = L >> 1;
        for (let i = 0; i < L; i++) {
          const dst = Math.round(t) - meio + i - s0, src = A[j] - meio + i; if (dst < 0 || dst >= s1 - s0 || src < 0 || src >= n) continue;
          const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * (i + 0.5)) / L); acc[dst] += hf[src] * w; peso[dst] += w;
        }
      }
      for (let i = s0; i < s1; i++) {
        const p = peso[i - s0], novo = p > 1e-3 ? acc[i - s0] / p + (x[i] - hf[i]) : x[i], fi = Math.min(1, (i - s0) / F, (s1 - 1 - i) / F), cob = Math.min(1, p);   // + parte grave original (rumble) devolvida intacta
        y[i] = x[i] * (1 - fi * cob) + novo * fi * cob;
      }
    }
    return y;
  }

  const api = { detectarAltura, corrigirAltura, altoPassa, hzParaMidi, midiParaHz };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  raiz.EstudioAfinacao = api;
})(typeof window !== "undefined" ? window : globalThis);
