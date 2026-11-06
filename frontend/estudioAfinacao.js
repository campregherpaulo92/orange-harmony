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
    const fmin = opc.fmin || 70, fmax = opc.fmax || 1000, limiar = opc.limiar || 0.15;
    const fator = Math.max(1, Math.round(sr / 11025)), srd = sr / fator, xd = decimar(x, fator);
    const W = Math.round(0.025 * srd), tauMax = Math.round(srd / fmin), tauMin = Math.max(2, Math.floor(srd / fmax));
    const hopS = Math.round(0.010 * srd), hop = (hopS * fator) / sr, t0 = ((W + tauMax) / 2) / srd;
    const nq = Math.max(0, Math.floor((xd.length - (W + tauMax)) / hopS) + 1);
    const f0 = new Float32Array(nq), conf = new Float32Array(nq), voz = new Uint8Array(nq), rmsQ = new Float32Array(nq);
    for (let q = 0; q < nq; q++) { const ini = q * hopS; let s = 0; for (let j = 0; j < W + tauMax; j++) { const v = xd[ini + j]; s += v * v; } rmsQ[q] = Math.sqrt(s / (W + tauMax)); }
    const porta = 0.03 * percentil(rmsQ, 0.95);
    const d = new Float64Array(tauMax + 1), dn = new Float64Array(tauMax + 1);
    for (let q = 0; q < nq; q++) {
      if (q % 200 === 0) { progresso(q / nq); await tick(); }
      if (rmsQ[q] < porta || rmsQ[q] < 1e-5) continue;
      const ini = q * hopS;
      for (let tau = 1; tau <= tauMax; tau++) { let s = 0; for (let j = 0; j < W; j++) { const df = xd[ini + j] - xd[ini + j + tau]; s += df * df; } d[tau] = s; }
      dn[0] = 1; let corre = 0; for (let tau = 1; tau <= tauMax; tau++) { corre += d[tau]; dn[tau] = corre > 0 ? (d[tau] * tau) / corre : 1; }
      let tau = -1;
      for (let t = tauMin; t < tauMax; t++) { if (dn[t] < limiar) { while (t + 1 < tauMax && dn[t + 1] < dn[t]) t++; tau = t; break; } }
      if (tau < 0) { let mn = 1e9, ti = -1; for (let t = tauMin; t < tauMax; t++) if (dn[t] < mn) { mn = dn[t]; ti = t; } if (mn < 0.3) tau = ti; }
      if (tau < 0) continue;
      let tf = tau; if (tau > 1 && tau < tauMax) { const a = dn[tau - 1], b = dn[tau], c = dn[tau + 1], den = a - 2 * b + c; if (Math.abs(den) > 1e-12) tf = tau + (0.5 * (a - c)) / den; }
      // refinamento na taxa original: janela SIMÉTRICA em torno do instante do quadro (alinha a linha com o áudio)
      // refinamento na taxa original: janela SIMÉTRICA em torno do instante do quadro (alinha a linha com o áudio),
      // comparando com o ciclo seguinte em atrasos INTEIROS e interpolando o pico (precisão bem abaixo de 1 amostra)
      let per = tf * fator; const c0 = Math.round(((ini + (W + tauMax) / 2)) * fator), Wf = Math.max(128, Math.min(2048, Math.round(2.5 * per)));
      const corr = (L) => { let sab = 0, saa = 0, sbb = 0; const ia = c0 - (L >> 1) - (Wf >> 1), ib = ia + L; if (ia < 0 || ib + Wf >= x.length) return null; for (let j = 0; j < Wf; j++) { const a = x[ia + j], b = x[ib + j]; sab += a * b; saa += a * a; sbb += b * b; } return sab / Math.sqrt(saa * sbb + 1e-20); };
      const L0 = Math.round(per), rs = []; let ik = -1, bv = -2;
      for (let k = -(fator + 1); k <= fator + 1; k++) { const r = corr(L0 + k); rs.push(r); if (r !== null && r > bv) { bv = r; ik = rs.length - 1; } }
      if (bv > 0 && ik > 0 && ik < rs.length - 1 && rs[ik - 1] !== null && rs[ik + 1] !== null) {
        const a = rs[ik - 1], b = rs[ik], c = rs[ik + 1], den = a - 2 * b + c; per = L0 + (ik - (fator + 1)) + (Math.abs(den) > 1e-12 ? (0.5 * (a - c)) / den : 0);
      } else if (bv > 0) per = L0 + (ik - (fator + 1));
      f0[q] = sr / per; conf[q] = 1 - dn[tau]; voz[q] = 1;
    }
    // limpeza: mediana de 5 quadros (em semitons), remove trechos curtos e saltos de oitava isolados
    const st = new Float64Array(nq); for (let q = 0; q < nq; q++) st[q] = voz[q] ? hzParaMidi(f0[q]) : 0;
    const med = new Float64Array(nq);
    for (let q = 0; q < nq; q++) { if (!voz[q]) continue; const v = []; for (let k = -2; k <= 2; k++) { const i = q + k; if (i >= 0 && i < nq && voz[i]) v.push(st[i]); } v.sort((a, b) => a - b); med[q] = v[v.length >> 1]; }
    for (let q = 0; q < nq; q++) if (voz[q]) f0[q] = midiParaHz(med[q]);
    for (let q = 0; q < nq;) { if (!voz[q]) { q++; continue; } let q1 = q; while (q1 < nq && voz[q1]) q1++; if (q1 - q < 4) for (let k = q; k < q1; k++) { voz[k] = 0; f0[k] = 0; } q = q1; }
    progresso(1);
    return { hop, t0, n: nq, f0, voz, conf, sr };
  }

  // Aplica a curva de correção (cents por quadro, mesmo tamanho de det.f0) com PSOLA. Devolve um novo Float32Array.
  function corrigirAltura(x, sr, det, cents) {
    const n = x.length, y = Float32Array.from(x), nq = det.n;
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
      // marcas de análise: um pico por ciclo da voz original
      const A = []; let m = s0 + Math.round(sr / f0em(s0 / sr) / 2);
      while (m < s1) {
        const P = sr / f0em(m / sr), a = Math.max(0, Math.round(m - 0.35 * P)), b = Math.min(n - 1, Math.round(m + 0.35 * P));
        let best = a, bv = -Infinity; for (let i = a; i <= b; i++) if (x[i] > bv) { bv = x[i]; best = i; }
        if (A.length && best <= A[A.length - 1] + 0.5 * P) best = Math.round(A[A.length - 1] + P);
        A.push(best); m = best + P;
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
          const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * (i + 0.5)) / L); acc[dst] += x[src] * w; peso[dst] += w;
        }
      }
      for (let i = s0; i < s1; i++) {
        const p = peso[i - s0], novo = p > 1e-3 ? acc[i - s0] / p : x[i], fi = Math.min(1, (i - s0) / F, (s1 - 1 - i) / F), cob = Math.min(1, p);
        y[i] = x[i] * (1 - fi * cob) + novo * fi * cob;
      }
    }
    return y;
  }

  const api = { detectarAltura, corrigirAltura, hzParaMidi, midiParaHz };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  raiz.EstudioAfinacao = api;
})(typeof window !== "undefined" ? window : globalThis);
