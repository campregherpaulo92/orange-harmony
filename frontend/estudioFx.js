// ══════════════════════════════════════════════════════════════════════════
// estudioFx.js — motor de efeitos do Orange Studio (22 efeitos).
//
// O MESMO código monta a cadeia de efeitos ao vivo (AudioContext) e na exportação (OfflineAudioContext): o que você
// ouve é o que sai no arquivo. Cada efeito é descrito num registro (nome, grupo, parâmetros com faixa e unidade),
// e a tela de efeitos é gerada a partir desse registro.
//
//   EstudioFx.novo("reverb")                      → { id, tipo, ligado, p: { ...padrões } }
//   await EstudioFx.carregarWorklet(ctx)          → prepara os efeitos que usam AudioWorklet (dinâmica, flanger, phaser...)
//   const cad = EstudioFx.criarCadeia(ctx, lista, { bpm })   → { entrada, saida, itens, atualizar(lista, amb), parar() }
// Cada efeito entrega { entrada, saida, atualizar(p, amb), parar() } (e `reducao` em dB nos de dinâmica).
// ══════════════════════════════════════════════════════════════════════════
(function (raiz) {
  "use strict";
  const lin = (d) => Math.pow(10, d / 20);

  // ── código que roda dentro do AudioWorklet (é transformado em texto e carregado por Blob) ──
  function workletMain() {
    const dB = (x) => 20 * Math.log10(x > 1e-9 ? x : 1e-9), lin = (d) => Math.pow(10, d / 20);
    const kr = (name, v, min, max) => ({ name, defaultValue: v, minValue: min, maxValue: max, automationRate: "k-rate" });

    class Compressor extends AudioWorkletProcessor {
      static get parameterDescriptors() { return [kr("limiar", -18, -80, 0), kr("razao", 3, 1, 100), kr("ataque", 0.01, 0.00001, 1), kr("liberacao", 0.12, 0.001, 5), kr("joelho", 6, 0, 48), kr("ganho", 0, -24, 48), kr("mistura", 1, 0, 1)]; }
      constructor() { super(); this.gr = 0; this.cont = 0; }
      process(inputs, outputs, p) {
        const inp = inputs[0], out = outputs[0]; if (!inp.length) return true;
        const nc = out.length, n = out[0].length, sr = sampleRate, T = p.limiar[0], R = p.razao[0], K = p.joelho[0], mk = lin(p.ganho[0]), mix = p.mistura[0];
        const ca = Math.exp(-1 / (Math.max(p.ataque[0], 1e-5) * sr)), cr = Math.exp(-1 / (Math.max(p.liberacao[0], 1e-3) * sr));
        for (let i = 0; i < n; i++) {
          let pico = 0; for (let c = 0; c < nc; c++) { const v = Math.abs((inp[c] || inp[0])[i]); if (v > pico) pico = v; }
          const nv = dB(pico); let alvo;                                   // redução desejada em dB (≤ 0), com "joelho" suave
          if (K > 0 && 2 * (nv - T) > -K && 2 * (nv - T) < K) alvo = ((1 / R - 1) * Math.pow(nv - T + K / 2, 2)) / (2 * K);
          else if (nv > T) alvo = T + (nv - T) / R - nv; else alvo = 0;
          const co = alvo < this.gr ? ca : cr; this.gr = co * this.gr + (1 - co) * alvo;
          const g = lin(this.gr) * mk;
          for (let c = 0; c < nc; c++) { const x = (inp[c] || inp[0])[i]; out[c][i] = x * (1 - mix) + x * g * mix; }
        }
        this.cont += n; if (this.cont >= sr * 0.05) { this.cont = 0; this.port.postMessage(this.gr); }
        return true;
      }
    }
    registerProcessor("oh-compressor", Compressor);

    class Limitador extends AudioWorkletProcessor {
      static get parameterDescriptors() { return [kr("teto", -1, -40, 0), kr("entrada", 0, 0, 36), kr("liberacao", 0.08, 0.005, 1)]; }
      constructor() { super(); this.gr = 0; this.cont = 0; }
      process(inputs, outputs, p) {
        const inp = inputs[0], out = outputs[0]; if (!inp.length) return true;
        const nc = out.length, n = out[0].length, sr = sampleRate, teto = p.teto[0], tl = lin(teto), gi = lin(p.entrada[0]);
        const ca = Math.exp(-1 / (0.0001 * sr)), cr = Math.exp(-1 / (Math.max(p.liberacao[0], 0.005) * sr));
        for (let i = 0; i < n; i++) {
          let pico = 0; for (let c = 0; c < nc; c++) { const v = Math.abs((inp[c] || inp[0])[i]) * gi; if (v > pico) pico = v; }
          const alvo = dB(pico) > teto ? teto - dB(pico) : 0, co = alvo < this.gr ? ca : cr; this.gr = co * this.gr + (1 - co) * alvo;
          const g = gi * lin(this.gr);
          for (let c = 0; c < nc; c++) { const y = (inp[c] || inp[0])[i] * g; out[c][i] = y > tl ? tl : y < -tl ? -tl : y; }   // proteção final: nunca passa do teto
        }
        this.cont += n; if (this.cont >= sr * 0.05) { this.cont = 0; this.port.postMessage(this.gr); }
        return true;
      }
    }
    registerProcessor("oh-limitador", Limitador);

    class Gate extends AudioWorkletProcessor {
      static get parameterDescriptors() { return [kr("limiar", -50, -90, 0), kr("ataque", 0.002, 0.0001, 0.2), kr("retencao", 0.06, 0, 1), kr("liberacao", 0.15, 0.005, 2), kr("reducao", 60, 0, 90)]; }
      constructor() { super(); this.env = 0; this.g = 1; this.hold = 0; this.cont = 0; }
      process(inputs, outputs, p) {
        const inp = inputs[0], out = outputs[0]; if (!inp.length) return true;
        const nc = out.length, n = out[0].length, sr = sampleRate, T = p.limiar[0], piso = lin(-p.reducao[0]), ret = Math.round(p.retencao[0] * sr);
        const ca = Math.exp(-1 / (Math.max(p.ataque[0], 1e-4) * sr)), cr = Math.exp(-1 / (Math.max(p.liberacao[0], 5e-3) * sr)), cd = Math.exp(-1 / (0.02 * sr));
        for (let i = 0; i < n; i++) {
          let pico = 0; for (let c = 0; c < nc; c++) { const v = Math.abs((inp[c] || inp[0])[i]); if (v > pico) pico = v; }
          this.env = pico > this.env ? pico : cd * this.env + (1 - cd) * pico;                   // seguidor de nível: sobe na hora, desce em ~20 ms
          let alvo; if (dB(this.env) > T) { this.hold = ret; alvo = 1; } else if (this.hold > 0) { this.hold--; alvo = 1; } else alvo = piso;
          const co = alvo > this.g ? ca : cr; this.g = co * this.g + (1 - co) * alvo;
          for (let c = 0; c < nc; c++) out[c][i] = (inp[c] || inp[0])[i] * this.g;
        }
        this.cont += n; if (this.cont >= sr * 0.05) { this.cont = 0; this.port.postMessage(dB(this.g)); }
        return true;
      }
    }
    registerProcessor("oh-gate", Gate);

    class DeEsser extends AudioWorkletProcessor {
      static get parameterDescriptors() { return [kr("freq", 6500, 2000, 14000), kr("q", 1.5, 0.3, 8), kr("limiar", -28, -70, 0), kr("razao", 4, 1, 20)]; }
      constructor() { super(); this.z = [[0, 0, 0, 0], [0, 0, 0, 0]]; this.env = 0; this.gr = 0; this.cont = 0; }
      process(inputs, outputs, p) {
        const inp = inputs[0], out = outputs[0]; if (!inp.length) return true;
        const nc = out.length, n = out[0].length, sr = sampleRate, f = Math.min(p.freq[0], sr * 0.45), Q = p.q[0], T = p.limiar[0], R = p.razao[0];
        const w0 = (2 * Math.PI * f) / sr, al = Math.sin(w0) / (2 * Q), a0 = 1 + al, b0 = al / a0, b2 = -al / a0, a1 = (-2 * Math.cos(w0)) / a0, a2 = (1 - al) / a0;
        const ca = Math.exp(-1 / (0.001 * sr)), cr = Math.exp(-1 / (0.04 * sr)), band = new Float32Array(nc);
        for (let i = 0; i < n; i++) {
          let pico = 0;
          for (let c = 0; c < nc; c++) { const x = (inp[c] || inp[0])[i], z = this.z[c], y = b0 * x + b2 * z[1] - a1 * z[2] - a2 * z[3]; z[1] = z[0]; z[0] = x; z[3] = z[2]; z[2] = y; band[c] = y; if (Math.abs(y) > pico) pico = Math.abs(y); }
          this.env = pico > this.env ? ca * this.env + (1 - ca) * pico : cr * this.env + (1 - cr) * pico;
          const nv = dB(this.env), alvo = nv > T ? (T - nv) * (1 - 1 / R) : 0, co = alvo < this.gr ? ca : cr; this.gr = co * this.gr + (1 - co) * alvo;
          const g = lin(this.gr);
          for (let c = 0; c < nc; c++) { const x = (inp[c] || inp[0])[i]; out[c][i] = (x - band[c]) + band[c] * g; }
        }
        this.cont += n; if (this.cont >= sr * 0.05) { this.cont = 0; this.port.postMessage(this.gr); }
        return true;
      }
    }
    registerProcessor("oh-deesser", DeEsser);

    class Bitcrusher extends AudioWorkletProcessor {
      static get parameterDescriptors() { return [kr("bits", 8, 1, 16), kr("reduz", 1, 1, 100), kr("mistura", 1, 0, 1)]; }
      constructor() { super(); this.seg = [0, 0]; this.k = 0; }
      process(inputs, outputs, p) {
        const inp = inputs[0], out = outputs[0]; if (!inp.length) return true;
        const nc = out.length, n = out[0].length, niveis = Math.pow(2, Math.max(1, Math.round(p.bits[0])) - 1), red = Math.max(1, Math.round(p.reduz[0])), mix = p.mistura[0];
        for (let i = 0; i < n; i++) {
          if (this.k === 0) for (let c = 0; c < nc; c++) this.seg[c] = Math.round((inp[c] || inp[0])[i] * niveis) / niveis;
          this.k = (this.k + 1) % red;
          for (let c = 0; c < nc; c++) out[c][i] = (inp[c] || inp[0])[i] * (1 - mix) + this.seg[c] * mix;
        }
        return true;
      }
    }
    registerProcessor("oh-bitcrusher", Bitcrusher);

    class Pitch extends AudioWorkletProcessor {   // deslocador de altura por duas "janelas" que se alternam (simples, com timbre de efeito)
      static get parameterDescriptors() { return [kr("semi1", 4, -24, 24), kr("semi2", 0, -24, 24), kr("v1", 1, 0, 1), kr("v2", 0, 0, 1), kr("janela", 0.06, 0.02, 0.2), kr("mistura", 0.5, 0, 1)]; }
      constructor() { super(); this.N = Math.round(sampleRate * 1); this.buf = [new Float32Array(this.N), new Float32Array(this.N)]; this.w = 0; this.fase = [0, 0]; }
      process(inputs, outputs, p) {
        const inp = inputs[0], out = outputs[0]; if (!inp.length) return true;
        const nc = out.length, n = out[0].length, N = this.N, W = Math.max(256, p.janela[0] * sampleRate), mix = p.mistura[0];
        const r = [Math.pow(2, p.semi1[0] / 12), Math.pow(2, p.semi2[0] / 12)], nv = [p.v1[0], p.v2[0]];
        for (let i = 0; i < n; i++) {
          for (let c = 0; c < nc; c++) this.buf[c][this.w] = (inp[c] || inp[0])[i];
          const wet = [0, 0];
          for (let k = 0; k < 2; k++) {
            if (nv[k] <= 0) continue;
            let f = this.fase[k] + (1 - r[k]) / W; f -= Math.floor(f); this.fase[k] = f;
            for (let j = 0; j < 2; j++) {
              const ph = (f + j * 0.5) % 1, d = ph * W, g = Math.sin(Math.PI * ph); let pos = this.w - d; if (pos < 0) pos += N;
              const i0 = Math.floor(pos), fr = pos - i0, i1 = (i0 + 1) % N;
              for (let c = 0; c < nc; c++) wet[c] += nv[k] * g * (this.buf[c][i0] * (1 - fr) + this.buf[c][i1] * fr);
            }
          }
          for (let c = 0; c < nc; c++) out[c][i] = (inp[c] || inp[0])[i] * (1 - mix * 0.5) + wet[c] * mix;
          this.w = (this.w + 1) % N;
        }
        return true;
      }
    }
    registerProcessor("oh-pitch", Pitch);

    class Flanger extends AudioWorkletProcessor {
      static get parameterDescriptors() { return [kr("taxa", 0.25, 0.01, 10), kr("prof", 0.002, 0, 0.01), kr("atraso", 0.0015, 0.0001, 0.012), kr("realim", 0.5, -0.95, 0.95), kr("mistura", 0.5, 0, 1)]; }
      constructor() { super(); this.N = Math.round(sampleRate * 0.05); this.buf = [new Float32Array(this.N), new Float32Array(this.N)]; this.w = 0; this.fase = 0; }
      process(inputs, outputs, p) {
        const inp = inputs[0], out = outputs[0]; if (!inp.length) return true;
        const nc = out.length, n = out[0].length, N = this.N, sr = sampleRate, inc = p.taxa[0] / sr, prof = p.prof[0] * sr, base = p.atraso[0] * sr, fb = p.realim[0], mix = p.mistura[0];
        for (let i = 0; i < n; i++) {
          for (let c = 0; c < nc; c++) {
            const lfo = Math.sin(2 * Math.PI * (this.fase + c * 0.25)), d = Math.max(1, base + prof * (0.5 + 0.5 * lfo)); let pos = this.w - d; if (pos < 0) pos += N;
            const i0 = Math.floor(pos), fr = pos - i0, i1 = (i0 + 1) % N, wet = this.buf[c][i0] * (1 - fr) + this.buf[c][i1] * fr, x = (inp[c] || inp[0])[i];
            this.buf[c][this.w] = x + fb * wet; out[c][i] = x * (1 - mix) + wet * mix;
          }
          this.fase += inc; if (this.fase >= 1) this.fase -= 1; this.w = (this.w + 1) % N;
        }
        return true;
      }
    }
    registerProcessor("oh-flanger", Flanger);

    class Phaser extends AudioWorkletProcessor {
      static get parameterDescriptors() { return [kr("taxa", 0.4, 0.01, 10), kr("prof", 1.5, 0, 3), kr("freq", 800, 100, 5000), kr("estagios", 6, 2, 12), kr("realim", 0.4, 0, 0.95), kr("mistura", 0.5, 0, 1)]; }
      constructor() { super(); this.z = [new Float32Array(12), new Float32Array(12)]; this.ult = [0, 0]; this.fase = 0; }
      process(inputs, outputs, p) {
        const inp = inputs[0], out = outputs[0]; if (!inp.length) return true;
        const nc = out.length, n = out[0].length, sr = sampleRate, inc = p.taxa[0] / sr, prof = p.prof[0], f0 = p.freq[0], est = Math.max(2, Math.min(12, Math.round(p.estagios[0]))), fb = p.realim[0], mix = p.mistura[0];
        for (let i = 0; i < n; i++) {
          for (let c = 0; c < nc; c++) {
            const lfo = Math.sin(2 * Math.PI * (this.fase + c * 0.25)), f = Math.min(sr * 0.45, f0 * Math.pow(2, prof * lfo)), t = Math.tan((Math.PI * f) / sr), a = (t - 1) / (t + 1), x = (inp[c] || inp[0])[i];
            let y = x + fb * this.ult[c];
            for (let s = 0; s < est; s++) { const z = this.z[c], o = a * y + z[s]; z[s] = y - a * o; y = o; }
            this.ult[c] = y; out[c][i] = x * (1 - mix) + y * mix;
          }
          this.fase += inc; if (this.fase >= 1) this.fase -= 1;
        }
        return true;
      }
    }
    registerProcessor("oh-phaser", Phaser);

    class Octaver extends AudioWorkletProcessor {   // oitava abaixo "analógica": acompanha o ciclo da nota e gera uma onda quadrada na metade (e num quarto) da frequência
      static get parameterDescriptors() { return [kr("o1", 1, 0, 1.5), kr("o2", 0, 0, 1.5), kr("seco", 1, 0, 1.5), kr("tom", 700, 150, 3000)]; }
      constructor() { super(); this.l1 = 0; this.l2 = 0; this.env = 0; this.s = 1; this.ff1 = 1; this.ff2 = 1; this.p1 = 0; this.p2 = 0; }
      process(inputs, outputs, p) {
        const inp = inputs[0], out = outputs[0]; if (!inp.length) return true;
        const nc = out.length, n = out[0].length, sr = sampleRate, o1 = p.o1[0], o2 = p.o2[0], seco = p.seco[0], ct = Math.exp((-2 * Math.PI * p.tom[0]) / sr), cd = Math.exp((-2 * Math.PI * 450) / sr), ca = Math.exp(-1 / (0.004 * sr)), cr = Math.exp(-1 / (0.03 * sr));
        for (let i = 0; i < n; i++) {
          let m = 0; for (let c = 0; c < nc; c++) m += (inp[c] || inp[0])[i]; m /= nc;
          this.l1 = cd * this.l1 + (1 - cd) * m; this.l2 = cd * this.l2 + (1 - cd) * this.l1; const d = this.l2, a = Math.abs(d);
          this.env = a > this.env ? ca * this.env + (1 - ca) * a : cr * this.env + (1 - cr) * a;
          const lim = 0.15 * this.env + 1e-4, novo = this.s > 0 ? (d < -lim ? -1 : 1) : (d > lim ? 1 : -1);   // gatilho com histerese: ignora ruído
          if (novo > 0 && this.s < 0) { this.ff1 = -this.ff1; if (this.ff1 > 0) this.ff2 = -this.ff2; }
          this.s = novo;
          const w = o1 * this.ff1 * this.env + o2 * this.ff2 * this.env; this.p1 = ct * this.p1 + (1 - ct) * w; this.p2 = ct * this.p2 + (1 - ct) * this.p1;   // suaviza a quadrada
          for (let c = 0; c < nc; c++) out[c][i] = (inp[c] || inp[0])[i] * seco + this.p2;
        }
        return true;
      }
    }
    registerProcessor("oh-octaver", Octaver);

    class AutoWah extends AudioWorkletProcessor {   // wah que abre com a força do toque (envelope) — filtro passa-faixa de variável de estado
      static get parameterDescriptors() { return [kr("sens", 0.6, 0, 1), kr("fmin", 350, 100, 2000), kr("fmax", 2600, 500, 5000), kr("q", 3.5, 0.7, 12), kr("ataque", 0.01, 0.001, 0.2), kr("liberacao", 0.2, 0.02, 1.5), kr("mistura", 1, 0, 1), kr("dir", 1, 0, 1)]; }
      constructor() { super(); this.env = 0; this.low = [0, 0]; this.band = [0, 0]; }
      process(inputs, outputs, p) {
        const inp = inputs[0], out = outputs[0]; if (!inp.length) return true;
        const nc = out.length, n = out[0].length, sr = sampleRate, sens = p.sens[0], fmin = p.fmin[0], fmax = Math.max(p.fmax[0], fmin * 1.2), q1 = 1 / p.q[0], mix = p.mistura[0], sobe = p.dir[0] >= 0.5;
        const ca = Math.exp(-1 / (Math.max(p.ataque[0], 1e-3) * sr)), cr = Math.exp(-1 / (Math.max(p.liberacao[0], 0.02) * sr));
        for (let i = 0; i < n; i++) {
          let pico = 0; for (let c = 0; c < nc; c++) { const v = Math.abs((inp[c] || inp[0])[i]); if (v > pico) pico = v; }
          this.env = pico > this.env ? ca * this.env + (1 - ca) * pico : cr * this.env + (1 - cr) * pico;
          let e = Math.min(1, this.env * (1 + 14 * sens) * (0.4 + sens)); if (!sobe) e = 1 - e;
          const fc = Math.min(fmin * Math.pow(fmax / fmin, e), sr * 0.16), f = 2 * Math.sin((Math.PI * fc) / sr);
          for (let c = 0; c < nc; c++) {
            const x = (inp[c] || inp[0])[i]; this.low[c] += f * this.band[c]; const alto = x - this.low[c] - q1 * this.band[c]; this.band[c] += f * alto;
            out[c][i] = x * (1 - mix) + this.band[c] * q1 * 2 * mix;
          }
        }
        return true;
      }
    }
    registerProcessor("oh-autowah", AutoWah);

    const PADROES = [[0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1], [1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 1, 0, 1, 0, 1], [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0], [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], [1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0]];
    class Ritmico extends AudioWorkletProcessor {   // gate rítmico (forma 0) e "pump" de sidechain (forma 1), presos ao andamento: o tempo do PROJETO é currentTime - origem
      static get parameterDescriptors() { return [kr("bpm", 100, 30, 300), kr("origem", 0, -100000, 100000), kr("passo", 0.5, 0.125, 4), kr("padrao", 0, 0, 5), kr("prof", 1, 0, 1), kr("suav", 0.004, 0.0003, 0.1), kr("forma", 0, 0, 1), kr("rapidez", 6, 1, 30), kr("fase", 0, 0, 15)]; }
      constructor() { super(); this.g = 1; }
      process(inputs, outputs, p) {
        const inp = inputs[0], out = outputs[0]; if (!inp.length) return true;
        const nc = out.length, n = out[0].length, sr = sampleRate, passo = (p.passo[0] * 60) / p.bpm[0], pat = PADROES[Math.max(0, Math.min(5, Math.round(p.padrao[0])))], prof = p.prof[0], forma = p.forma[0] >= 0.5, k = p.rapidez[0], fase = Math.round(p.fase[0]), cs = 1 - Math.exp(-1 / (p.suav[0] * sr));
        const t0 = currentTime - p.origem[0];
        for (let i = 0; i < n; i++) {
          const pos = (t0 + i / sr) / passo + fase, fl = Math.floor(pos), idx = ((fl % 16) + 16) % 16, fr = pos - fl;
          const alvo = forma ? (pat[idx] ? 1 - prof * Math.exp(-fr * k) : 1) : pat[idx] ? 1 : 1 - prof;
          this.g += (alvo - this.g) * cs;
          for (let c = 0; c < nc; c++) out[c][i] = (inp[c] || inp[0])[i] * this.g;
        }
        return true;
      }
    }
    registerProcessor("oh-ritmico", Ritmico);

    class Transiente extends AudioWorkletProcessor {   // realça ou suaviza o ataque e o sustento (bateria, violão, baixo)
      static get parameterDescriptors() { return [kr("ataque", 0, -1, 1), kr("sust", 0, -1, 1)]; }
      constructor() { super(); this.rapido = 0; this.lento = 0; this.gdb = 0; }
      process(inputs, outputs, p) {
        const inp = inputs[0], out = outputs[0]; if (!inp.length) return true;
        const nc = out.length, n = out[0].length, sr = sampleRate, A = p.ataque[0] * 12, S = p.sust[0] * 12;
        const fa = Math.exp(-1 / (0.0005 * sr)), fr = Math.exp(-1 / (0.008 * sr)), la = Math.exp(-1 / (0.025 * sr)), lr = Math.exp(-1 / (0.12 * sr)), cg = Math.exp(-1 / (0.001 * sr));
        for (let i = 0; i < n; i++) {
          let pico = 0; for (let c = 0; c < nc; c++) { const v = Math.abs((inp[c] || inp[0])[i]); if (v > pico) pico = v; }
          this.rapido = pico > this.rapido ? fa * this.rapido + (1 - fa) * pico : fr * this.rapido + (1 - fr) * pico; this.lento = pico > this.lento ? la * this.lento + (1 - la) * pico : lr * this.lento + (1 - lr) * pico;
          const dif = dB(this.rapido) - dB(this.lento), wa = Math.max(0, Math.min(1, dif / 6)), nivel = Math.max(0, Math.min(1, (dB(this.lento) + 60) / 20));
          const alvo = A * wa + S * (1 - wa) * nivel; this.gdb = cg * this.gdb + (1 - cg) * alvo; const g = lin(this.gdb);
          for (let c = 0; c < nc; c++) out[c][i] = (inp[c] || inp[0])[i] * g;
        }
        return true;
      }
    }
    registerProcessor("oh-transiente", Transiente);
  }

  const carregados = new WeakMap();
  function carregarWorklet(ctx) {
    if (!ctx.audioWorklet) return Promise.reject(new Error("Este navegador não tem AudioWorklet."));
    if (!carregados.has(ctx)) { const url = URL.createObjectURL(new Blob(["(" + workletMain.toString() + ")()"], { type: "application/javascript" })); carregados.set(ctx, ctx.audioWorklet.addModule(url).finally(() => URL.revokeObjectURL(url))); }
    return carregados.get(ctx);
  }

  // ── utilidades de montagem ──
  const NOTAS_SYNC = [["1/1", "Semibreve (1/1)", 4], ["1/2", "Mínima (1/2)", 2], ["1/4", "Semínima (1/4)", 1], ["1/4.", "Semínima pontuada", 1.5], ["1/4t", "Semínima tercina", 2 / 3], ["1/8", "Colcheia (1/8)", 0.5], ["1/8.", "Colcheia pontuada", 0.75], ["1/8t", "Colcheia tercina", 1 / 3], ["1/16", "Semicolcheia (1/16)", 0.25], ["1/16.", "Semicolcheia pontuada", 0.375]];
  const segDeNota = (n, bpm) => (NOTAS_SYNC.find((x) => x[0] === n) || NOTAS_SYNC[2])[2] * 60 / (bpm || 100);
  const QUANTO = 128;   // cada volta de um laço de realimentação no Web Audio ganha 128 amostras de atraso: o laço desconta isso e a entrada compensa
  const OPC_NOTAS = NOTAS_SYNC.map((x) => [x[0], x[1]]);
  const offline = (ctx) => typeof ctx.length === "number";
  const ajusta = (ctx, ap, v, suave) => { if (suave && !offline(ctx)) ap.setTargetAtTime(v, ctx.currentTime, 0.02); else ap.value = v; };
  const QBW = -3.0103;   // no Web Audio o Q do passa-baixas/passa-altas é em dB: -3,01 dB = resposta plana (Butterworth)
  const bq = (ctx, tipo) => { const f = ctx.createBiquadFilter(); f.type = tipo; return f; };
  const bw = (ctx, tipo) => { const f = bq(ctx, tipo); f.Q.value = QBW; return f; };
  const gn = (ctx, v) => { const g = ctx.createGain(); g.gain.value = v; return g; };
  const serie = (nos) => { for (let i = 0; i + 1 < nos.length; i++) nos[i].connect(nos[i + 1]); };
  const wk = (ctx, nome) => new AudioWorkletNode(ctx, nome, { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: "explicit", channelInterpretation: "speakers" });
  const wpar = (ctx, no, nome, v, s) => ajusta(ctx, no.parameters.get(nome), v, s);
  function osc(ctx, forma, hz) { const o = ctx.createOscillator(); o.type = forma; o.frequency.value = hz; o.start(); return o; }
  const FORMAS = [["sine", "Seno"], ["triangle", "Triângulo"], ["square", "Quadrada"], ["sawtooth", "Dente de serra"]];
  const para = (lista, ext) => () => { lista.forEach((o) => { try { o.stop(); } catch (e) { /* já parou */ } }); (ext || []).forEach((n) => { try { n.disconnect(); } catch (e) { /* solto */ } }); };

  // curvas de saturação
  function curvaSat(tipo) {   // todas com ganho 1 para sinais pequenos: com drive 0 o som sai quase limpo
    const n = 4096, c = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      c[i] = tipo === "tubo" ? (x >= 0 ? Math.tanh(1.3 * x) / 1.3 : Math.tanh(0.9 * x) / 0.9) : tipo === "fita" ? Math.tanh(0.8 * x) / 0.8 : tipo === "fuzz" ? Math.sign(x) * (1 - Math.exp(-3 * Math.abs(x))) / 3 : tipo === "corte" ? Math.max(-0.5, Math.min(0.5, x)) : Math.tanh(x);
    }
    return c;
  }
  const SATS = [["suave", "Suave"], ["tubo", "Válvula (assimétrica)"], ["fita", "Fita"], ["fuzz", "Fuzz"], ["corte", "Corte duro"]];

  // reverb: resposta ao impulso sintética (ruído com decaimento, reflexões iniciais e agudos que morrem antes)
  const PERFIS = {
    quarto: { nome: "Quarto pequeno", tempo: 0.4, pre: 2, queda: 1.0, refMax: 0.015, nRef: 6, subida: 0.002 },
    sala: { nome: "Sala", tempo: 0.9, pre: 8, queda: 1.2, refMax: 0.03, nRef: 8, subida: 0.004 },
    camara: { nome: "Câmara de estúdio", tempo: 1.4, pre: 12, queda: 1.6, refMax: 0.05, nRef: 10, subida: 0.006 },
    placa: { nome: "Placa (brilhante)", tempo: 1.8, pre: 0, queda: 0.5, refMax: 0, nRef: 0, subida: 0.012 },
    salao: { nome: "Salão", tempo: 2.8, pre: 22, queda: 2.2, refMax: 0.09, nRef: 14, subida: 0.02 },
    catedral: { nome: "Catedral", tempo: 5.5, pre: 40, queda: 3.0, refMax: 0.12, nRef: 18, subida: 0.03 },
    mola: { nome: "Mola (de amplificador)", tempo: 2.4, pre: 0, queda: 0.8, refMax: 0, nRef: 0, subida: 0.004 },
    gated: { nome: "Gated (anos 80)", tempo: 0.35, pre: 0, queda: 0.2, refMax: 0, nRef: 0, subida: 0.004 },
    reverso: { nome: "Reverso (cresce e corta)", tempo: 1.2, pre: 0, queda: 0.5, refMax: 0, nRef: 0, subida: 0.012 },
  };
  function prng(seed) { let a = seed; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function lpIR(d, sr, fc) { const a = 1 - Math.exp((-2 * Math.PI * fc) / sr); let y = 0; for (let i = 0; i < d.length; i++) { y += a * (d[i] - y); d[i] = y; } }
  function irMola(ctx, o) {   // mola de amplificador: uma série de "pingos" que descem de agudo para grave (dispersão da mola), a cada ~35 ms, mais uma cauda de ruído
    const sr = ctx.sampleRate, pre = Math.round((o.pre / 1000) * sr), comp = pre + Math.round(Math.min(10, o.tempo * 1.15) * sr) + Math.round(0.03 * sr), buf = ctx.createBuffer(2, comp, sr), Lg = Math.round(0.024 * sr);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c), rnd = prng(900 + c * 31), Ts = 0.034 + 0.003 * c;
      for (let k = 0; k * Ts < o.tempo * 1.1; k++) {
        const t0 = k * Ts, amp = Math.exp((-6.908 * t0) / o.tempo) * (k === 0 ? 1 : 0.92), i0 = pre + Math.round(t0 * sr);
        for (let j = 0; j < Lg && i0 + j < comp; j++) { const u = j / sr, w = 0.5 - 0.5 * Math.cos((2 * Math.PI * (j + 0.5)) / Lg); d[i0 + j] += amp * w * Math.sin(2 * Math.PI * (4200 * u - 0.5 * (3500 / 0.024) * u * u)); }
      }
      const g = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
      for (let i = pre; i < comp; i++) { const t = (i - pre) / sr; d[i] += 0.12 * g() * Math.exp((-6.908 * t) / o.tempo) * Math.min(1, t / 0.02); }
      lpIR(d, sr, Math.max(1500, Math.min(o.amort, 12000)));
    }
    return buf;
  }
  function irGated(ctx, o) {   // reverb "cortado": energia constante por `tempo` e corte seco (o som de bateria dos anos 80)
    const sr = ctx.sampleRate, pre = Math.round((o.pre / 1000) * sr), gate = Math.round(o.tempo * sr), fade = Math.round(0.006 * sr), comp = pre + gate + fade, buf = ctx.createBuffer(2, comp, sr);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c), rnd = prng(500 + c * 13), g = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
      for (let i = 0; i < gate + fade; i++) { const subida = Math.min(1, i / (0.004 * sr)), corte = i < gate ? 1 : 1 - (i - gate) / fade; d[pre + i] = g() * subida * corte * (1 - 0.35 * (i / gate)); }
      lpIR(d, sr, Math.max(1500, Math.min(o.amort, 16000)));
    }
    return buf;
  }
  function gerarIR(ctx, o) {
    if (o.tipo === "mola") return irMola(ctx, o);
    if (o.tipo === "gated") return irGated(ctx, o);
    if (o.tipo === "reverso") { const b = gerarIR(ctx, Object.assign({}, o, { tipo: "placa", pre: 0 })), fade = Math.round(0.004 * ctx.sampleRate); for (let c = 0; c < b.numberOfChannels; c++) { const d = b.getChannelData(c); d.reverse(); for (let i = 0; i < fade; i++) d[i] *= i / fade; } return b; }
    const sr = ctx.sampleRate, pf = PERFIS[o.tipo] || PERFIS.sala, pre = Math.round((o.pre / 1000) * sr), comp = pre + Math.round(Math.min(10, o.tempo * 1.15) * sr), buf = ctx.createBuffer(2, comp, sr);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c), rnd = prng(1234 + c * 77), g = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd()); let lp = 0;
      for (let i = pre; i < comp; i++) {
        const t = (i - pre) / sr, env = Math.exp((-6.908 * t) / o.tempo) * Math.min(1, t / pf.subida), fc = Math.max(300, o.amort * Math.exp((-t * pf.queda) / Math.max(0.3, o.tempo))), a = 1 - Math.exp((-2 * Math.PI * fc) / sr);
        lp += a * (g() * env - lp); d[i] = lp;
      }
      for (let k = 0; k < pf.nRef; k++) { const ti = 0.003 + rnd() * pf.refMax, pos = pre + Math.round(ti * sr); if (pos < comp) d[pos] += (rnd() < 0.5 ? -1 : 1) * 0.9 * (1 - ti / (pf.refMax + 0.01)); }
    }
    const w = o.largura, L = buf.getChannelData(0), R = buf.getChannelData(1);
    if (w < 1) for (let i = 0; i < comp; i++) { const m = (L[i] + R[i]) / 2; L[i] = m + (L[i] - m) * w; R[i] = m + (R[i] - m) * w; }
    return buf;
  }

  // ═════════ registro dos efeitos ═════════
  const N = (id, rotulo, un, min, max, padrao, extra) => Object.assign({ id, rotulo, un, min, max, padrao, tipo: "num" }, extra || {});
  const S = (id, rotulo, opcoes, padrao, extra) => Object.assign({ id, rotulo, opcoes, padrao, tipo: "sel" }, extra || {});
  const B = (id, rotulo, padrao, extra) => Object.assign({ id, rotulo, padrao, tipo: "bool" }, extra || {});
  const REG = {};

  REG.eq = {
    nome: "Equalizador", grupo: "Equalização e filtros", descr: "7 bandas: corta graves e agudos e realça ou reduz faixas de frequência.",
    params: [N("hpf", "Corte de graves", "Hz", 20, 600, 20, { log: true, grupo: "Filtros" }), N("lpf", "Corte de agudos", "Hz", 2000, 20000, 20000, { log: true }),
      N("b1f", "Frequência", "Hz", 40, 400, 100, { log: true, grupo: "Graves (prateleira)" }), N("b1g", "Ganho", "dB", -18, 18, 0, { passo: 0.5 }),
      N("b2f", "Frequência", "Hz", 100, 1000, 300, { log: true, grupo: "Médio-graves" }), N("b2g", "Ganho", "dB", -18, 18, 0, { passo: 0.5 }), N("b2q", "Largura (Q)", "", 0.3, 8, 1, { passo: 0.1 }),
      N("b3f", "Frequência", "Hz", 400, 4000, 1500, { log: true, grupo: "Médios" }), N("b3g", "Ganho", "dB", -18, 18, 0, { passo: 0.5 }), N("b3q", "Largura (Q)", "", 0.3, 8, 1, { passo: 0.1 }),
      N("b4f", "Frequência", "Hz", 1500, 12000, 5000, { log: true, grupo: "Presença" }), N("b4g", "Ganho", "dB", -18, 18, 0, { passo: 0.5 }), N("b4q", "Largura (Q)", "", 0.3, 8, 1, { passo: 0.1 }),
      N("b5f", "Frequência", "Hz", 3000, 16000, 10000, { log: true, grupo: "Brilho (prateleira)" }), N("b5g", "Ganho", "dB", -18, 18, 0, { passo: 0.5 })],
    criar(ctx, p) {
      const hpf = bw(ctx, "highpass"), b1 = bq(ctx, "lowshelf"), b2 = bq(ctx, "peaking"), b3 = bq(ctx, "peaking"), b4 = bq(ctx, "peaking"), b5 = bq(ctx, "highshelf"), lpf = bw(ctx, "lowpass");
      serie([hpf, b1, b2, b3, b4, b5, lpf]);
      const ap = (p, s) => { const a = (n, k, v) => ajusta(ctx, n[k], v, s); hpf.type = p.hpf <= 20 ? "allpass" : "highpass"; lpf.type = p.lpf >= 20000 ? "allpass" : "lowpass"; a(hpf, "frequency", Math.max(20, p.hpf)); a(lpf, "frequency", Math.min(20000, p.lpf)); a(b1, "frequency", p.b1f); a(b1, "gain", p.b1g); a(b5, "frequency", p.b5f); a(b5, "gain", p.b5g); [[b2, "b2"], [b3, "b3"], [b4, "b4"]].forEach(([n, k]) => { a(n, "frequency", p[k + "f"]); a(n, "gain", p[k + "g"]); a(n, "Q", p[k + "q"]); }); };
      ap(p, false); return { entrada: hpf, saida: lpf, atualizar: (q) => ap(q, true), parar() {} };
    },
  };

  REG.filtro = {
    nome: "Filtro / Wah", grupo: "Equalização e filtros", descr: "Passa-baixas, passa-altas, passa-faixa ou rejeita-faixa, com varredura automática (efeito wah).",
    params: [S("tipo", "Tipo", [["lowpass", "Passa-baixas"], ["highpass", "Passa-altas"], ["bandpass", "Passa-faixa"], ["notch", "Rejeita-faixa"]], "lowpass"), N("freq", "Frequência", "Hz", 40, 18000, 1000, { log: true }), N("q", "Ressonância (Q)", "", 0.3, 18, 0.71, { passo: 0.01 }),
      S("inclin", "Inclinação", [["12", "12 dB/oitava"], ["24", "24 dB/oitava"]], "12"), N("lfoTaxa", "Varredura: velocidade", "Hz", 0, 12, 0, { passo: 0.1 }), N("lfoProf", "Varredura: profundidade", "oit.", 0, 4, 1.5, { passo: 0.1 }), N("mistura", "Mistura", "%", 0, 100, 100)],
    criar(ctx, p) {
      const entrada = gn(ctx, 1), saida = gn(ctx, 1), dry = gn(ctx, 0), wet = gn(ctx, 1), f1 = bq(ctx, "lowpass"), f2 = bq(ctx, "allpass"), lfo = osc(ctx, "sine", 1), lg = gn(ctx, 0);
      entrada.connect(dry).connect(saida); entrada.connect(f1); f1.connect(f2); f2.connect(wet).connect(saida); lfo.connect(lg); lg.connect(f1.detune); lg.connect(f2.detune);
      const ap = (p, s) => { f1.type = p.tipo; f2.type = p.inclin === "24" ? p.tipo : "allpass"; const lph = p.tipo === "lowpass" || p.tipo === "highpass", k = p.q / 0.7071, dbq = (v) => 20 * Math.log10(v);   // 24 dB/oitava = filtro de 4ª ordem (Butterworth): dois estágios com Q 0,54 e 1,31
        const q1 = p.inclin === "24" ? (lph ? dbq(0.5412 * k) : p.q) : (lph ? dbq(p.q) : p.q), q2 = lph ? dbq(1.3066 * k) : p.q;
        ajusta(ctx, f1.frequency, p.freq, s); ajusta(ctx, f1.Q, q1, s); ajusta(ctx, f2.frequency, p.freq, s); ajusta(ctx, f2.Q, q2, s);
        ajusta(ctx, lfo.frequency, Math.max(0.01, p.lfoTaxa), s); ajusta(ctx, lg.gain, p.lfoTaxa > 0 ? p.lfoProf * 1200 : 0, s); ajusta(ctx, dry.gain, 1 - p.mistura / 100, s); ajusta(ctx, wet.gain, p.mistura / 100, s); };
      ap(p, false); return { entrada, saida, atualizar: (q) => ap(q, true), parar: para([lfo]) };
    },
  };

  REG.exciter = {
    nome: "Brilho harmônico", grupo: "Equalização e filtros", descr: "Acrescenta harmônicos nos agudos para a voz ficar mais clara e presente.",
    params: [N("freq", "A partir de", "Hz", 1500, 10000, 4000, { log: true }), N("drive", "Intensidade", "%", 0, 100, 40), N("mistura", "Quantidade", "%", 0, 100, 25)],
    criar(ctx, p) {
      const entrada = gn(ctx, 1), saida = gn(ctx, 1), hp = bw(ctx, "highpass"), ws = ctx.createWaveShaper(), pre = gn(ctx, 1), pos = gn(ctx, 1), wet = gn(ctx, 0), cv = new Float32Array(4096); for (let i = 0; i < 4096; i++) { const x = (i / 4095) * 2 - 1; cv[i] = Math.tanh(2 * x) / 2; } ws.curve = cv; ws.oversample = "4x";
      entrada.connect(saida); entrada.connect(hp); hp.connect(pre); pre.connect(ws); ws.connect(pos); pos.connect(wet); wet.connect(saida);
      const ap = (p, s) => { const g = 1 + p.drive / 10; ajusta(ctx, hp.frequency, p.freq, s); ajusta(ctx, pre.gain, g, s); ajusta(ctx, pos.gain, 1 / g, s); ajusta(ctx, wet.gain, p.mistura / 100, s); };
      ap(p, false); return { entrada, saida, atualizar: (q) => ap(q, true), parar() {} };
    },
  };

  REG.compressor = {
    nome: "Compressor", grupo: "Dinâmica", descr: "Nivela a voz: reduz os picos e deixa o volume mais constante. Tem mistura para compressão paralela.",
    params: [N("limiar", "Limiar", "dB", -60, 0, -18), N("razao", "Razão", ":1", 1, 20, 3, { passo: 0.1 }), N("ataque", "Ataque", "ms", 0.1, 200, 10, { log: true, passo: 0.1 }), N("liberacao", "Liberação", "ms", 10, 1000, 120, { log: true }), N("joelho", "Joelho", "dB", 0, 40, 6), N("ganho", "Ganho de compensação", "dB", 0, 24, 0, { passo: 0.5 }), N("mistura", "Mistura (paralelo)", "%", 0, 100, 100)],
    medidor: "reducao",
    criar(ctx, p) {
      const no = wk(ctx, "oh-compressor"), inst = { entrada: no, saida: no, reducao: 0, parar() {} }; no.port.onmessage = (e) => { inst.reducao = e.data; };
      const ap = (p, s) => { wpar(ctx, no, "limiar", p.limiar, s); wpar(ctx, no, "razao", p.razao, s); wpar(ctx, no, "ataque", p.ataque / 1000, s); wpar(ctx, no, "liberacao", p.liberacao / 1000, s); wpar(ctx, no, "joelho", p.joelho, s); wpar(ctx, no, "ganho", p.ganho, s); wpar(ctx, no, "mistura", p.mistura / 100, s); };
      ap(p, false); inst.atualizar = (q) => ap(q, true); return inst;
    },
  };

  REG.multibanda = {
    nome: "Compressor multibanda", grupo: "Dinâmica", descr: "Comprime graves, médios e agudos separadamente: controla os graves sem apagar o brilho.",
    params: [N("f1", "Corte graves/médios", "Hz", 80, 600, 200, { log: true, grupo: "Divisão" }), N("f2", "Corte médios/agudos", "Hz", 1000, 8000, 3500, { log: true }),
      N("l1", "Limiar", "dB", -60, 0, -22, { grupo: "Graves" }), N("r1", "Razão", ":1", 1, 20, 3, { passo: 0.1 }), N("g1", "Ganho", "dB", -12, 12, 0, { passo: 0.5 }),
      N("l2", "Limiar", "dB", -60, 0, -22, { grupo: "Médios" }), N("r2", "Razão", ":1", 1, 20, 2.5, { passo: 0.1 }), N("g2", "Ganho", "dB", -12, 12, 0, { passo: 0.5 }),
      N("l3", "Limiar", "dB", -60, 0, -24, { grupo: "Agudos" }), N("r3", "Razão", ":1", 1, 20, 2, { passo: 0.1 }), N("g3", "Ganho", "dB", -12, 12, 0, { passo: 0.5 })],
    criar(ctx, p) {
      const entrada = gn(ctx, 1), saida = gn(ctx, 1), mk = (t) => bw(ctx, t);
      const lo = [mk("lowpass"), mk("lowpass")], mi = [mk("highpass"), mk("highpass"), mk("lowpass"), mk("lowpass")], hi = [mk("highpass"), mk("highpass")], cs = [wk(ctx, "oh-compressor"), wk(ctx, "oh-compressor"), wk(ctx, "oh-compressor")];
      entrada.connect(lo[0]); serie(lo); lo[1].connect(cs[0]); entrada.connect(mi[0]); serie(mi); mi[3].connect(cs[1]); entrada.connect(hi[0]); serie(hi); hi[1].connect(cs[2]); cs.forEach((c) => c.connect(saida));
      const ap = (p, s) => { lo.forEach((f) => ajusta(ctx, f.frequency, p.f1, s)); mi[0].frequency.value = p.f1; mi[1].frequency.value = p.f1; mi[2].frequency.value = p.f2; mi[3].frequency.value = p.f2; hi.forEach((f) => { f.frequency.value = p.f2; });
        cs.forEach((c, i) => { wpar(ctx, c, "limiar", p["l" + (i + 1)], s); wpar(ctx, c, "razao", p["r" + (i + 1)], s); wpar(ctx, c, "ataque", i === 0 ? 0.02 : i === 1 ? 0.01 : 0.004, s); wpar(ctx, c, "liberacao", i === 0 ? 0.2 : 0.12, s); wpar(ctx, c, "ganho", p["g" + (i + 1)], s); }); };
      ap(p, false); return { entrada, saida, atualizar: (q) => ap(q, true), parar() {} };
    },
  };

  REG.limitador = {
    nome: "Limitador", grupo: "Dinâmica", descr: "Impede que o som passe de um teto. Bom no fim da cadeia para evitar estouro.",
    params: [N("teto", "Teto", "dB", -24, 0, -1, { passo: 0.1 }), N("entrada", "Empurrar (ganho de entrada)", "dB", 0, 24, 0, { passo: 0.5 }), N("liberacao", "Liberação", "ms", 10, 500, 80, { log: true })], medidor: "reducao",
    criar(ctx, p) {
      const no = wk(ctx, "oh-limitador"), inst = { entrada: no, saida: no, reducao: 0, parar() {} }; no.port.onmessage = (e) => { inst.reducao = e.data; };
      const ap = (p, s) => { wpar(ctx, no, "teto", p.teto, s); wpar(ctx, no, "entrada", p.entrada, s); wpar(ctx, no, "liberacao", p.liberacao / 1000, s); }; ap(p, false); inst.atualizar = (q) => ap(q, true); return inst;
    },
  };

  REG.gate = {
    nome: "Porta de ruído", grupo: "Dinâmica", descr: "Silencia o que está abaixo de um nível (chiado e respiros entre as frases).",
    params: [N("limiar", "Limiar", "dB", -90, 0, -50), N("ataque", "Ataque", "ms", 0.1, 50, 2, { log: true, passo: 0.1 }), N("retencao", "Retenção", "ms", 0, 500, 60), N("liberacao", "Liberação", "ms", 5, 1000, 150, { log: true }), N("reducao", "Redução máxima", "dB", 0, 90, 60)], medidor: "reducao",
    criar(ctx, p) {
      const no = wk(ctx, "oh-gate"), inst = { entrada: no, saida: no, reducao: 0, parar() {} }; no.port.onmessage = (e) => { inst.reducao = e.data; };
      const ap = (p, s) => { wpar(ctx, no, "limiar", p.limiar, s); wpar(ctx, no, "ataque", p.ataque / 1000, s); wpar(ctx, no, "retencao", p.retencao / 1000, s); wpar(ctx, no, "liberacao", p.liberacao / 1000, s); wpar(ctx, no, "reducao", p.reducao, s); }; ap(p, false); inst.atualizar = (q) => ap(q, true); return inst;
    },
  };

  REG.deesser = {
    nome: "De-esser", grupo: "Dinâmica", descr: "Doma os \"sss\" e \"chh\" que ficam estridentes, sem mexer no resto da voz.",
    params: [N("freq", "Frequência do chiado", "Hz", 3000, 12000, 6500, { log: true }), N("q", "Largura (Q)", "", 0.5, 6, 1.5, { passo: 0.1 }), N("limiar", "Limiar", "dB", -70, 0, -28), N("razao", "Força", ":1", 1, 20, 4, { passo: 0.1 })], medidor: "reducao",
    criar(ctx, p) {
      const no = wk(ctx, "oh-deesser"), inst = { entrada: no, saida: no, reducao: 0, parar() {} }; no.port.onmessage = (e) => { inst.reducao = e.data; };
      const ap = (p, s) => { wpar(ctx, no, "freq", p.freq, s); wpar(ctx, no, "q", p.q, s); wpar(ctx, no, "limiar", p.limiar, s); wpar(ctx, no, "razao", p.razao, s); }; ap(p, false); inst.atualizar = (q) => ap(q, true); return inst;
    },
  };

  REG.saturacao = {
    nome: "Saturação", grupo: "Cor e distorção", descr: "Aquece e engrossa o som, de um leve calor de válvula até distorção pesada.",
    params: [S("tipo", "Tipo", SATS, "suave"), N("drive", "Intensidade", "dB", 0, 40, 12), N("tom", "Tom (corta agudos)", "Hz", 1000, 20000, 12000, { log: true }), N("saida", "Nível de saída", "dB", -24, 12, -3, { passo: 0.5 }), N("mistura", "Mistura", "%", 0, 100, 100)],
    criar(ctx, p) {
      const entrada = gn(ctx, 1), saida = gn(ctx, 1), dry = gn(ctx, 0), wet = gn(ctx, 1), pre = gn(ctx, 1), ws = ctx.createWaveShaper(), tom = bw(ctx, "lowpass"), pos = gn(ctx, 1); ws.oversample = "4x";
      entrada.connect(dry).connect(saida); entrada.connect(pre); pre.connect(ws); ws.connect(tom); tom.connect(pos); pos.connect(wet).connect(saida); let tipoAtual = null;
      const ap = (p, s) => { if (p.tipo !== tipoAtual) { ws.curve = curvaSat(p.tipo); tipoAtual = p.tipo; } ajusta(ctx, pre.gain, lin(p.drive), s); ajusta(ctx, tom.frequency, p.tom, s); ajusta(ctx, pos.gain, lin(p.saida - p.drive * 0.35), s); ajusta(ctx, dry.gain, 1 - p.mistura / 100, s); ajusta(ctx, wet.gain, p.mistura / 100, s); };
      ap(p, false); return { entrada, saida, atualizar: (q) => ap(q, true), parar() {} };
    },
  };

  REG.bitcrusher = {
    nome: "Bitcrusher (lo-fi)", grupo: "Cor e distorção", descr: "Estraga o som de propósito: menos \"bits\" e menos amostras, como num videogame antigo.",
    params: [N("bits", "Resolução", "bits", 1, 16, 8, { passo: 1 }), N("reduz", "Reduzir taxa", "×", 1, 60, 1, { passo: 1 }), N("mistura", "Mistura", "%", 0, 100, 100)],
    criar(ctx, p) { const no = wk(ctx, "oh-bitcrusher"); const ap = (p, s) => { wpar(ctx, no, "bits", p.bits, s); wpar(ctx, no, "reduz", p.reduz, s); wpar(ctx, no, "mistura", p.mistura / 100, s); }; ap(p, false); return { entrada: no, saida: no, atualizar: (q) => ap(q, true), parar() {} }; },
  };

  REG.robo = {
    nome: "Robô (modulador em anel)", grupo: "Cor e distorção", descr: "Multiplica a voz por um tom: soa metálico, como robô ou alienígena.",
    params: [N("freq", "Frequência", "Hz", 20, 2000, 140, { log: true }), S("forma", "Forma da onda", FORMAS, "sine"), N("mistura", "Mistura", "%", 0, 100, 100)],
    criar(ctx, p) {
      const entrada = gn(ctx, 1), saida = gn(ctx, 1), dry = gn(ctx, 0), wet = gn(ctx, 1), anel = gn(ctx, 0), o = osc(ctx, "sine", 140);
      entrada.connect(dry).connect(saida); entrada.connect(anel); anel.connect(wet).connect(saida); o.connect(anel.gain);
      const ap = (p, s) => { o.type = p.forma; ajusta(ctx, o.frequency, p.freq, s); ajusta(ctx, dry.gain, 1 - p.mistura / 100, s); ajusta(ctx, wet.gain, p.mistura / 100, s); }; ap(p, false); return { entrada, saida, atualizar: (q) => ap(q, true), parar: para([o]) };
    },
  };

  REG.reverb = {
    nome: "Reverb", grupo: "Espaço e tempo", descr: "Dá espaço à voz: de um quarto pequeno a uma catedral. O ambiente é gerado por cálculo.",
    params: [S("tipo", "Ambiente", Object.keys(PERFIS).map((k) => [k, PERFIS[k].nome]), "sala"), N("tempo", "Duração", "s", 0.2, 8, 0.9, { passo: 0.05 }), N("pre", "Pré-atraso", "ms", 0, 250, 8), N("amort", "Brilho do ambiente", "Hz", 1500, 20000, 9000, { log: true }), N("largura", "Largura estéreo", "%", 0, 100, 100), N("graves", "Corta graves do efeito", "Hz", 20, 800, 120, { log: true }), N("mistura", "Mistura", "%", 0, 100, 20)],
    aoMudar(p, id) { if (id === "tipo") { const pf = PERFIS[p.tipo]; if (pf) { p.tempo = pf.tempo; p.pre = pf.pre; } } },
    criar(ctx, p) {
      const entrada = gn(ctx, 1), saida = gn(ctx, 1), wet = gn(ctx, 0), hp = bw(ctx, "highpass"), ca = ctx.createConvolver(), cb = ctx.createConvolver(), ga = gn(ctx, 1), gb = gn(ctx, 0); ca.normalize = true; cb.normalize = true;
      entrada.connect(saida); entrada.connect(ca); entrada.connect(cb); ca.connect(ga); cb.connect(gb); ga.connect(hp); gb.connect(hp); hp.connect(wet); wet.connect(saida);
      let sig = "", ativo = "a", timer = null;
      const novoIR = (p) => { const s = [p.tipo, p.tempo, p.pre, p.amort, p.largura].join("|"); if (s === sig) return; const primeiro = sig === ""; sig = s; const ir = gerarIR(ctx, { tipo: p.tipo, tempo: p.tempo, pre: p.pre, amort: p.amort, largura: p.largura / 100 });
        if (primeiro) { ca.buffer = ir; return; }
        const [novo, gNovo, gVelho] = ativo === "a" ? [cb, gb, ga] : [ca, ga, gb]; novo.buffer = ir; if (!offline(ctx)) { gNovo.gain.setTargetAtTime(1, ctx.currentTime, 0.04); gVelho.gain.setTargetAtTime(0, ctx.currentTime, 0.04); } else { gNovo.gain.value = 1; gVelho.gain.value = 0; } ativo = ativo === "a" ? "b" : "a"; };
      const ap = (p, s) => { ajusta(ctx, wet.gain, p.mistura / 100, s); ajusta(ctx, hp.frequency, p.graves, s); if (!s) novoIR(p); else { clearTimeout(timer); timer = setTimeout(() => novoIR(p), 120); } };
      ap(p, false); return { entrada, saida, atualizar: (q) => ap(q, true), parar() { clearTimeout(timer); } };
    },
  };

  REG.delay = {
    nome: "Delay (eco)", grupo: "Espaço e tempo", descr: "Ecos que se repetem, normais ou indo de um lado ao outro (ping-pong), podendo seguir o andamento da música.",
    params: [S("modo", "Modo", [["normal", "Normal"], ["pingpong", "Ping-pong (esquerda e direita)"]], "normal"), B("sync", "Seguir o andamento", false), S("nota", "Valor da nota", OPC_NOTAS, "1/8", { mostrarSe: "sync" }), N("tempo", "Tempo", "ms", 10, 2000, 350, { log: true, mostrarSe: "!sync" }), N("realim", "Repetições", "%", 0, 95, 35), N("amort", "Escurece os ecos", "Hz", 800, 20000, 6000, { log: true }), N("mistura", "Mistura", "%", 0, 100, 25)], usaBpm: true,
    criar(ctx, p, amb) {
      const entrada = gn(ctx, 1), saida = gn(ctx, 1), wet = gn(ctx, 0);
      entrada.connect(saida); wet.connect(saida);
      const dN = ctx.createDelay(4), fbN = gn(ctx, 0), lpN = bw(ctx, "lowpass"), sN = gn(ctx, 1), dP = ctx.createDelay(0.05); dP.delayTime.value = QUANTO / ctx.sampleRate; entrada.connect(dP); dP.connect(dN); dN.connect(sN); sN.connect(wet); dN.connect(lpN); lpN.connect(fbN); fbN.connect(dN);
      const mono = gn(ctx, 1); mono.channelCount = 1; mono.channelCountMode = "explicit"; const dL = ctx.createDelay(4), dR = ctx.createDelay(4), fb1 = gn(ctx, 0), fb2 = gn(ctx, 0), lpP = bw(ctx, "lowpass"), mg = ctx.createChannelMerger(2), sP = gn(ctx, 0);
      entrada.connect(mono); const dP2 = ctx.createDelay(0.05); dP2.delayTime.value = QUANTO / 2 / ctx.sampleRate; mono.connect(dP2); dP2.connect(dL); dL.connect(lpP); lpP.connect(fb1); fb1.connect(dR); dR.connect(fb2); fb2.connect(dL); dL.connect(mg, 0, 0); dR.connect(mg, 0, 1); mg.connect(sP); sP.connect(wet);
      const ap = (p, s, a) => { const bpm = (a || amb || {}).bpm || 100, t = Math.max(0.01, Math.min(3.99, p.sync ? segDeNota(p.nota, bpm) : p.tempo / 1000)), fb = p.realim / 100;
        ajusta(ctx, dN.delayTime, Math.max(0, t - QUANTO / ctx.sampleRate), s); [dL, dR].forEach((d) => ajusta(ctx, d.delayTime, Math.max(0, t - QUANTO / 2 / ctx.sampleRate), s)); ajusta(ctx, fbN.gain, fb, s); ajusta(ctx, fb1.gain, fb, s); ajusta(ctx, fb2.gain, fb, s); [lpN, lpP].forEach((f) => { f.type = p.amort >= 20000 ? "allpass" : "lowpass"; ajusta(ctx, f.frequency, Math.min(20000, p.amort), s); });
        ajusta(ctx, sN.gain, p.modo === "normal" ? 1 : 0, s); ajusta(ctx, sP.gain, p.modo === "pingpong" ? 1 : 0, s); ajusta(ctx, wet.gain, p.mistura / 100, s); };
      ap(p, false); return { entrada, saida, atualizar: (q, a) => ap(q, true, a), parar() {} };
    },
  };

  REG.chorus = {
    nome: "Chorus", grupo: "Modulação", descr: "Engrossa a voz com cópias levemente desafinadas e atrasadas, como um coro.",
    params: [N("vozes", "Vozes", "", 1, 4, 3, { passo: 1 }), N("taxa", "Velocidade", "Hz", 0.1, 5, 0.8, { passo: 0.05 }), N("prof", "Profundidade", "ms", 0, 15, 4, { passo: 0.1 }), N("atraso", "Atraso base", "ms", 5, 30, 14, { passo: 0.5 }), N("largura", "Largura estéreo", "%", 0, 100, 80), N("mistura", "Mistura", "%", 0, 100, 40)],
    criar(ctx, p) {
      const entrada = gn(ctx, 1), saida = gn(ctx, 1), wet = gn(ctx, 0); entrada.connect(saida); wet.connect(saida); const os = [], vs = [];
      for (let i = 0; i < 4; i++) { const d = ctx.createDelay(0.1), o = osc(ctx, "sine", 0.8 * (1 + 0.17 * i)), g = gn(ctx, 0), pn = ctx.createStereoPanner(), ng = gn(ctx, 0); o.connect(g); g.connect(d.delayTime); entrada.connect(d); d.connect(ng); ng.connect(pn); pn.connect(wet); os.push(o); vs.push({ d, o, g, pn, ng }); }
      const ap = (p, s) => { vs.forEach((v, i) => { const ativo = i < p.vozes; ajusta(ctx, v.d.delayTime, p.atraso / 1000, s); ajusta(ctx, v.o.frequency, p.taxa * (1 + 0.17 * i), s); ajusta(ctx, v.g.gain, p.prof / 1000, s); ajusta(ctx, v.ng.gain, ativo ? 1 / Math.sqrt(Math.max(1, p.vozes)) : 0, s); ajusta(ctx, v.pn.pan, p.vozes > 1 ? (-1 + (2 * i) / (p.vozes - 1)) * (p.largura / 100) : 0, s); }); ajusta(ctx, wet.gain, p.mistura / 100, s); };
      ap(p, false); return { entrada, saida, atualizar: (q) => ap(q, true), parar: para(os) };
    },
  };

  REG.flanger = {
    nome: "Flanger", grupo: "Modulação", descr: "O \"jato de avião\": um atraso curtíssimo que passeia e cria cavidades no som.",
    params: [N("taxa", "Velocidade", "Hz", 0.02, 5, 0.25, { log: true }), N("prof", "Profundidade", "ms", 0, 8, 2, { passo: 0.1 }), N("atraso", "Atraso base", "ms", 0.1, 10, 1.5, { passo: 0.1 }), N("realim", "Realimentação", "%", -95, 95, 50), N("mistura", "Mistura", "%", 0, 100, 50)],
    criar(ctx, p) { const no = wk(ctx, "oh-flanger"); const ap = (p, s) => { wpar(ctx, no, "taxa", p.taxa, s); wpar(ctx, no, "prof", p.prof / 1000, s); wpar(ctx, no, "atraso", p.atraso / 1000, s); wpar(ctx, no, "realim", p.realim / 100, s); wpar(ctx, no, "mistura", p.mistura / 100, s); }; ap(p, false); return { entrada: no, saida: no, atualizar: (q) => ap(q, true), parar() {} }; },
  };

  REG.phaser = {
    nome: "Phaser", grupo: "Modulação", descr: "Um \"redemoinho\" suave: filtros que giram e criam buracos que passeiam pelo som.",
    params: [N("taxa", "Velocidade", "Hz", 0.02, 6, 0.4, { log: true }), N("prof", "Profundidade", "oit.", 0, 3, 1.5, { passo: 0.1 }), N("freq", "Frequência central", "Hz", 100, 5000, 800, { log: true }), N("estagios", "Estágios", "", 2, 12, 6, { passo: 2 }), N("realim", "Ressonância", "%", 0, 95, 40), N("mistura", "Mistura", "%", 0, 100, 50)],
    criar(ctx, p) { const no = wk(ctx, "oh-phaser"); const ap = (p, s) => { wpar(ctx, no, "taxa", p.taxa, s); wpar(ctx, no, "prof", p.prof, s); wpar(ctx, no, "freq", p.freq, s); wpar(ctx, no, "estagios", p.estagios, s); wpar(ctx, no, "realim", p.realim / 100, s); wpar(ctx, no, "mistura", p.mistura / 100, s); }; ap(p, false); return { entrada: no, saida: no, atualizar: (q) => ap(q, true), parar() {} }; },
  };

  REG.tremolo = {
    nome: "Trêmolo", grupo: "Modulação", descr: "O volume sobe e desce no ritmo que você escolher, podendo seguir o andamento.",
    params: [N("taxa", "Velocidade", "Hz", 0.1, 20, 5, { log: true, passo: 0.1, mostrarSe: "!sync" }), B("sync", "Seguir o andamento", false), S("nota", "Valor da nota", OPC_NOTAS, "1/8", { mostrarSe: "sync" }), N("prof", "Profundidade", "%", 0, 100, 60), S("forma", "Forma", FORMAS.slice(0, 3), "sine")], usaBpm: true,
    criar(ctx, p, amb) {
      const entrada = gn(ctx, 1), saida = gn(ctx, 1), vca = gn(ctx, 1), o = osc(ctx, "sine", 5), lp = bq(ctx, "lowpass"), og = gn(ctx, 0); entrada.connect(vca); vca.connect(saida); o.connect(lp); lp.connect(og); og.connect(vca.gain);
      const ap = (p, s, a) => { const bpm = (a || amb || {}).bpm || 100, hz = p.sync ? 1 / segDeNota(p.nota, bpm) : p.taxa; o.type = p.forma; ajusta(ctx, o.frequency, hz, s); lp.frequency.value = p.forma === "square" ? 300 : 20000; ajusta(ctx, vca.gain, 1 - p.prof / 200, s); ajusta(ctx, og.gain, p.prof / 200, s); };
      ap(p, false); return { entrada, saida, atualizar: (q, a) => ap(q, true, a), parar: para([o]) };
    },
  };

  REG.vibrato = {
    nome: "Vibrato", grupo: "Modulação", descr: "A altura da voz oscila para cima e para baixo, como um vibrato de cantor.",
    params: [N("taxa", "Velocidade", "Hz", 0.5, 12, 5.5, { passo: 0.1 }), N("prof", "Profundidade", "cents", 0, 150, 30)],
    criar(ctx, p) {
      const entrada = gn(ctx, 1), saida = gn(ctx, 1), d = ctx.createDelay(0.05), o = osc(ctx, "sine", 5.5), g = gn(ctx, 0); entrada.connect(d); d.connect(saida); o.connect(g); g.connect(d.delayTime);
      const ap = (p, s) => { const prof = (Math.pow(2, p.prof / 1200) - 1) / (2 * Math.PI * p.taxa); ajusta(ctx, o.frequency, p.taxa, s); ajusta(ctx, g.gain, prof, s); ajusta(ctx, d.delayTime, prof * 1.5 + 0.0005, s); };
      ap(p, false); return { entrada, saida, atualizar: (q) => ap(q, true), parar: para([o]) };
    },
  };

  REG.autopan = {
    nome: "Auto-pan", grupo: "Modulação", descr: "O som passeia da esquerda para a direita e volta.",
    params: [N("taxa", "Velocidade", "Hz", 0.05, 12, 0.5, { log: true }), N("prof", "Profundidade", "%", 0, 100, 80), S("forma", "Forma", FORMAS.slice(0, 3), "sine")],
    criar(ctx, p) { const pn = ctx.createStereoPanner(), o = osc(ctx, "sine", 0.5), g = gn(ctx, 0); o.connect(g); g.connect(pn.pan); const ap = (p, s) => { o.type = p.forma; ajusta(ctx, o.frequency, p.taxa, s); ajusta(ctx, g.gain, p.prof / 100, s); }; ap(p, false); return { entrada: pn, saida: pn, atualizar: (q) => ap(q, true), parar: para([o]) }; },
  };

  REG.harmonizador = {
    nome: "Harmonizador (voz dupla)", grupo: "Voz e criativos", descr: "Acrescenta uma ou duas vozes mais agudas ou mais graves (uma terça, uma oitava...). Efeito criativo: soa como backing vocal sintético.",
    params: [N("semi1", "Voz 1: intervalo", "semitons", -24, 24, 4, { passo: 1, grupo: "Voz 1" }), N("v1", "Voz 1: volume", "%", 0, 100, 100), N("semi2", "Voz 2: intervalo", "semitons", -24, 24, 7, { passo: 1, grupo: "Voz 2" }), N("v2", "Voz 2: volume", "%", 0, 100, 0), N("janela", "Tamanho do trecho", "ms", 20, 200, 60, { grupo: "Geral" }), N("mistura", "Mistura", "%", 0, 100, 50)],
    criar(ctx, p) { const no = wk(ctx, "oh-pitch"); const ap = (p, s) => { wpar(ctx, no, "semi1", p.semi1, s); wpar(ctx, no, "semi2", p.semi2, s); wpar(ctx, no, "v1", p.v1 / 100, s); wpar(ctx, no, "v2", p.v2 / 100, s); wpar(ctx, no, "janela", p.janela / 1000, s); wpar(ctx, no, "mistura", p.mistura / 100, s); }; ap(p, false); return { entrada: no, saida: no, atualizar: (q) => ap(q, true), parar() {} }; },
  };

  REG.largura = {
    nome: "Largura estéreo", grupo: "Estéreo e utilidades", descr: "Abre ou fecha a imagem estéreo, e pode deixar os graves no centro.",
    params: [N("largura", "Largura", "%", 0, 200, 100), N("graves", "Graves no centro até", "Hz", 0, 400, 0)],
    criar(ctx, p) {
      const entrada = ctx.createChannelSplitter(2), M = gn(ctx, 1), Sd = gn(ctx, 1), hp = bw(ctx, "highpass"), hp2 = bw(ctx, "highpass"), gw = gn(ctx, 1), neg = gn(ctx, -1), sL = gn(ctx, 1), sR = gn(ctx, 1), mg = ctx.createChannelMerger(2);
      const a = gn(ctx, 0.5), b = gn(ctx, 0.5), c = gn(ctx, 0.5), d = gn(ctx, -0.5); entrada.connect(a, 0); entrada.connect(b, 1); entrada.connect(c, 0); entrada.connect(d, 1); a.connect(M); b.connect(M); c.connect(Sd); d.connect(Sd);
      Sd.connect(hp); hp.connect(hp2); hp2.connect(gw); M.connect(sL); gw.connect(sL); M.connect(sR); gw.connect(neg); neg.connect(sR); sL.connect(mg, 0, 0); sR.connect(mg, 0, 1);
      const ap = (p, s) => { ajusta(ctx, gw.gain, p.largura / 100, s); ajusta(ctx, hp.frequency, Math.max(1, p.graves), s); ajusta(ctx, hp2.frequency, Math.max(1, p.graves), s); }; ap(p, false); return { entrada, saida: mg, atualizar: (q) => ap(q, true), parar() {} };
    },
  };

  REG.utilitario = {
    nome: "Utilidades", grupo: "Estéreo e utilidades", descr: "Ganho, inverter a fase, juntar em mono ou trocar esquerda e direita.",
    params: [N("ganho", "Ganho", "dB", -48, 24, 0, { passo: 0.5 }), B("fase", "Inverter a fase", false), B("mono", "Juntar em mono", false), B("trocar", "Trocar esquerda e direita", false)],
    criar(ctx, p) {
      const entrada = ctx.createChannelSplitter(2), mg = ctx.createChannelMerger(2), LL = gn(ctx, 1), RL = gn(ctx, 0), LR = gn(ctx, 0), RR = gn(ctx, 1);
      entrada.connect(LL, 0); entrada.connect(RL, 1); entrada.connect(LR, 0); entrada.connect(RR, 1); LL.connect(mg, 0, 0); RL.connect(mg, 0, 0); LR.connect(mg, 0, 1); RR.connect(mg, 0, 1);
      const ap = (p, s) => { const g = lin(p.ganho) * (p.fase ? -1 : 1), m = p.mono ? 0.5 : null, t = p.trocar; const [ll, rl, lr, rr] = m !== null ? [m, m, m, m] : t ? [0, 1, 1, 0] : [1, 0, 0, 1]; ajusta(ctx, LL.gain, ll * g, s); ajusta(ctx, RL.gain, rl * g, s); ajusta(ctx, LR.gain, lr * g, s); ajusta(ctx, RR.gain, rr * g, s); };
      ap(p, false); return { entrada, saida: mg, atualizar: (q) => ap(q, true), parar() {} };
    },
  };


  // ── Guitarra, violão e baixo ──
  const curvaPedal = (tipo) => { const n = 4096, c = new Float32Array(n); for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = tipo === "overdrive" ? Math.tanh(x) : tipo === "distorcao" ? Math.max(-0.45, Math.min(0.45, x * 0.9)) / 0.9 * 0.9 : tipo === "fuzz" ? (x >= 0 ? (1 - Math.exp(-4 * x)) / 3.2 : -(1 - Math.exp(-2 * -x)) / 2.4) : Math.tanh(0.8 * x) / 0.8; } return c; };
  const MODELOS_AMP = {
    limpo: { hp: 70, g1: [1, 3], hp2: 40, g2: [1, 1.5], c1: "limpo", c2: "limpo", tom: [110, 650, 3200, 5500], post: 0.9, limpoBaixo: 0 },
    crunch: { hp: 90, g1: [2, 12], hp2: 160, g2: [1.5, 5.5], c1: "tubo", c2: "limpo", tom: [100, 750, 3000, 5000], post: 0.9, limpoBaixo: 0 },
    lead: { hp: 120, g1: [5, 30], hp2: 250, g2: [3, 11], c1: "tubo", c2: "alto", tom: [120, 900, 3500, 5200], post: 0.8, limpoBaixo: 0 },
    baixo: { hp: 30, g1: [1, 6], hp2: 35, g2: [1, 1.5], c1: "tubo", c2: "limpo", tom: [80, 500, 2500, 4500], post: 0.9, limpoBaixo: 0.8 },
  };
  const curvaAmp = (tipo) => { const n = 4096, c = new Float32Array(n); for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = tipo === "tubo" ? (x >= 0 ? Math.tanh(1.2 * x) / 1.2 : Math.tanh(0.85 * x) / 0.85) : tipo === "alto" ? Math.tanh(2.2 * x) / 2.2 * 1.4 : Math.tanh(x); } return c; };
  REG.amp = {
    nome: "Amplificador (guitarra e baixo)", grupo: "Guitarra, violão e baixo", descr: "Pré-amplificador de válvula em dois estágios com controle de tom. Use com a Caixa depois dele: sem a caixa o som fica \"chiado\".",
    params: [S("modelo", "Modelo", [["limpo", "Limpo (cristalino)"], ["crunch", "Crunch (rock clássico)"], ["lead", "Lead (alto ganho)"], ["baixo", "Baixo (valvulado)"]], "crunch"), N("ganho", "Ganho", "%", 0, 100, 45), N("graves", "Graves", "dB", -12, 12, 0, { passo: 0.5 }), N("medios", "Médios", "dB", -12, 12, 0, { passo: 0.5 }), N("agudos", "Agudos", "dB", -12, 12, 0, { passo: 0.5 }), N("presenca", "Presença", "%", 0, 100, 35), N("volume", "Volume", "dB", -24, 12, -6, { passo: 0.5 })],
    criar(ctx, p) {
      const entrada = gn(ctx, 1), hp = bw(ctx, "highpass"), g1 = gn(ctx, 1), w1 = ctx.createWaveShaper(), hp2 = bw(ctx, "highpass"), g2 = gn(ctx, 1), w2 = ctx.createWaveShaper(), gr = bq(ctx, "lowshelf"), me = bq(ctx, "peaking"), ag = bq(ctx, "highshelf"), pr = bq(ctx, "highshelf"), pot = ctx.createWaveShaper(), vol = gn(ctx, 1);
      const lpC = bw(ctx, "lowpass"), gC = gn(ctx, 0); [w1, w2, pot].forEach((w) => { w.oversample = "4x"; }); pot.curve = curvaAmp("limpo"); lpC.frequency.value = 220;
      serie([entrada, hp, g1, w1, hp2, g2, w2, gr, me, ag, pr, pot, vol]); entrada.connect(lpC); lpC.connect(gC); gC.connect(gr); me.Q.value = 0.8; let modAtual = null;
      const ap = (p, s) => { const m = MODELOS_AMP[p.modelo] || MODELOS_AMP.crunch, d = p.ganho / 100; if (p.modelo !== modAtual) { w1.curve = curvaAmp(m.c1); w2.curve = curvaAmp(m.c2); modAtual = p.modelo; }
        ajusta(ctx, hp.frequency, m.hp, s); ajusta(ctx, hp2.frequency, m.hp2, s); ajusta(ctx, g1.gain, m.g1[0] + d * (m.g1[1] - m.g1[0]), s); ajusta(ctx, g2.gain, (m.g2[0] + d * (m.g2[1] - m.g2[0])) * 0.5, s); ajusta(ctx, gC.gain, m.limpoBaixo, s);
        ajusta(ctx, gr.frequency, m.tom[0], s); ajusta(ctx, gr.gain, p.graves, s); ajusta(ctx, me.frequency, m.tom[1], s); ajusta(ctx, me.gain, p.medios, s); ajusta(ctx, ag.frequency, m.tom[2], s); ajusta(ctx, ag.gain, p.agudos, s); ajusta(ctx, pr.frequency, m.tom[3], s); ajusta(ctx, pr.gain, (p.presenca / 100) * 8 - 2, s); ajusta(ctx, vol.gain, lin(p.volume) * m.post, s); };
      ap(p, false); return { entrada, saida: vol, atualizar: (q) => ap(q, true), parar() {} };
    },
  };

  const CAIXAS = {
    "4x12": { nome: "4×12 fechada (rock)", hpf: 80, p: [[115, 4, 1.4], [380, -2.5, 1], [2600, 5, 1.1], [4300, -3, 3]], lpf: 5500 },
    "2x12": { nome: "2×12 aberta (brilhante)", hpf: 100, p: [[180, 3, 1], [1800, 4, 1], [3500, 3, 1.2], [260, -1.5, 1]], lpf: 6500 },
    "1x12": { nome: "1×12 vintage (combo)", hpf: 90, p: [[140, 3, 1.2], [1200, 3, 0.9], [3000, 2.5, 1.2], [450, -2, 1]], lpf: 5000 },
    "1x15": { nome: "1×15 de baixo", hpf: 40, p: [[90, 3.5, 1.1], [420, -3, 1], [1800, 2, 1], [3000, 1, 1]], lpf: 4800 },
    corpo: { nome: "Violão: corpo de madeira", hpf: 70, p: [[110, 3.5, 1.3], [260, -3, 1.2], [3000, 2, 1], [9500, 2.5, 0.8]], lpf: 20000 },
  };
  REG.caixa = {
    nome: "Caixa (alto-falante e microfone)", grupo: "Guitarra, violão e baixo", descr: "Simula o gabinete e o microfone: tira o \"chiado\" da distorção e dá o corpo de uma guitarra de verdade. O modelo de violão devolve o corpo da madeira ao som de captador.",
    params: [S("tipo", "Caixa", Object.keys(CAIXAS).map((k) => [k, CAIXAS[k].nome]), "4x12"), N("microfone", "Microfone: centro → borda", "%", 0, 100, 25), N("nivel", "Nível", "dB", -18, 12, 0, { passo: 0.5 }), N("mistura", "Mistura", "%", 0, 100, 100)],
    criar(ctx, p) {
      const entrada = gn(ctx, 1), saida = gn(ctx, 1), dry = gn(ctx, 0), wet = gn(ctx, 1), hp = bw(ctx, "highpass"), hp2 = bw(ctx, "highpass"), ps = [0, 1, 2, 3].map(() => bq(ctx, "peaking")), l1 = bw(ctx, "lowpass"), l2 = bw(ctx, "lowpass"), nv = gn(ctx, 1);   // o gabinete corta o grave a 24 dB/oitava
      entrada.connect(dry).connect(saida); serie([entrada, hp, hp2, ...ps, l1, l2, nv]); nv.connect(wet).connect(saida);
      const ap = (p, s) => { const c = CAIXAS[p.tipo] || CAIXAS["4x12"], m = p.microfone / 100; ajusta(ctx, hp.frequency, c.hpf, s); ajusta(ctx, hp2.frequency, c.hpf, s);
        c.p.forEach(([f, g, q], i) => { ajusta(ctx, ps[i].frequency, f, s); ajusta(ctx, ps[i].gain, i === 2 ? g - 4 * m : g, s); ajusta(ctx, ps[i].Q, q, s); });
        const sem = c.lpf >= 20000; l1.type = sem ? "allpass" : "lowpass"; l2.type = sem ? "allpass" : "lowpass"; const f = Math.min(20000, c.lpf * (1 - 0.4 * m)); ajusta(ctx, l1.frequency, f, s); ajusta(ctx, l2.frequency, f, s);
        ajusta(ctx, nv.gain, lin(p.nivel), s); ajusta(ctx, dry.gain, 1 - p.mistura / 100, s); ajusta(ctx, wet.gain, p.mistura / 100, s); };
      ap(p, false); return { entrada, saida, atualizar: (q) => ap(q, true), parar() {} };
    },
  };

  REG.pedal = {
    nome: "Pedal (overdrive, distorção, fuzz, boost)", grupo: "Guitarra, violão e baixo", descr: "O pedal que fica na frente do amplificador: Overdrive (médios, graves preservados), Distorção (corte duro), Fuzz (rasgado, assimétrico) e Boost (só empurra o sinal).",
    params: [S("tipo", "Pedal", [["overdrive", "Overdrive"], ["distorcao", "Distorção"], ["fuzz", "Fuzz"], ["boost", "Boost limpo"]], "overdrive"), N("ganho", "Ganho", "%", 0, 100, 40), N("tom", "Tom", "%", 0, 100, 55), N("nivel", "Nível", "dB", -24, 12, -4, { passo: 0.5 })],
    criar(ctx, p) {
      const entrada = gn(ctx, 1), saida = gn(ctx, 1), hp = bw(ctx, "highpass"), pre = gn(ctx, 1), ws = ctx.createWaveShaper(), lp = bw(ctx, "lowpass"), post = gn(ctx, 1), lpL = bw(ctx, "lowpass"), gL = gn(ctx, 0); ws.oversample = "4x"; lpL.frequency.value = 260;
      serie([entrada, hp, pre, ws, lp, post, saida]); entrada.connect(lpL); lpL.connect(gL); gL.connect(saida); let tipoAtual = null;
      const ap = (p, s) => { const d = p.ganho / 100, t = p.tipo; if (t !== tipoAtual) { ws.curve = curvaPedal(t); tipoAtual = t; }
        const cfg = t === "overdrive" ? { hp: 500, g: 1 + d * 30, lowB: 0.5, comp: -4 } : t === "distorcao" ? { hp: 120, g: 4 + d * 60, lowB: 0, comp: -5 } : t === "fuzz" ? { hp: 70, g: 6 + d * 80, lowB: 0, comp: -9 } : { hp: 20, g: lin(d * 24), lowB: 0, comp: 0 };
        hp.type = t === "boost" ? "allpass" : "highpass"; ajusta(ctx, hp.frequency, cfg.hp, s); ajusta(ctx, pre.gain, cfg.g, s); ajusta(ctx, lp.frequency, 1500 + (p.tom / 100) * 7500, s); ajusta(ctx, post.gain, lin(p.nivel + cfg.comp), s); ajusta(ctx, gL.gain, cfg.lowB, s); };
      ap(p, false); return { entrada, saida, atualizar: (q) => ap(q, true), parar() {} };
    },
  };

  REG.octaver = {
    nome: "Octaver (oitava abaixo)", grupo: "Guitarra, violão e baixo", descr: "Acrescenta uma nota uma ou duas oitavas abaixo, no estilo dos pedais analógicos. Funciona melhor tocando uma nota de cada vez.",
    params: [N("o1", "Uma oitava abaixo", "%", 0, 150, 90), N("o2", "Duas oitavas abaixo", "%", 0, 150, 0), N("seco", "Som original", "%", 0, 150, 100), N("tom", "Suavizar (corte)", "Hz", 150, 3000, 700, { log: true })],
    criar(ctx, p) { const no = wk(ctx, "oh-octaver"); const ap = (p, s) => { wpar(ctx, no, "o1", p.o1 / 100, s); wpar(ctx, no, "o2", p.o2 / 100, s); wpar(ctx, no, "seco", p.seco / 100, s); wpar(ctx, no, "tom", p.tom, s); }; ap(p, false); return { entrada: no, saida: no, atualizar: (q) => ap(q, true), parar() {} }; },
  };

  REG.autowah = {
    nome: "Wah de toque (auto-wah)", grupo: "Guitarra, violão e baixo", descr: "O wah que abre sozinho conforme a força com que você toca: forte abre, fraco fecha. Clássico do funk, em guitarra e baixo.",
    params: [N("sens", "Sensibilidade", "%", 0, 100, 60), N("fmin", "Fechado em", "Hz", 100, 2000, 350, { log: true }), N("fmax", "Aberto em", "Hz", 500, 5000, 2600, { log: true }), N("q", "Ressonância (Q)", "", 0.7, 12, 3.5, { passo: 0.1 }), N("ataque", "Rapidez p/ abrir", "ms", 1, 200, 10, { log: true }), N("liberacao", "Rapidez p/ fechar", "ms", 20, 1500, 200, { log: true }), S("dir", "Direção", [["1", "Abre ao tocar forte"], ["0", "Fecha ao tocar forte"]], "1"), N("mistura", "Mistura", "%", 0, 100, 100)],
    criar(ctx, p) { const no = wk(ctx, "oh-autowah"); const ap = (p, s) => { wpar(ctx, no, "sens", p.sens / 100, s); wpar(ctx, no, "fmin", p.fmin, s); wpar(ctx, no, "fmax", p.fmax, s); wpar(ctx, no, "q", p.q, s); wpar(ctx, no, "ataque", p.ataque / 1000, s); wpar(ctx, no, "liberacao", p.liberacao / 1000, s); wpar(ctx, no, "dir", +p.dir, s); wpar(ctx, no, "mistura", p.mistura / 100, s); }; ap(p, false); return { entrada: no, saida: no, atualizar: (q) => ap(q, true), parar() {} }; },
  };

  // ── Bateria e dinâmica ──
  REG.transiente = {
    nome: "Transientes (ataque e sustento)", grupo: "Dinâmica", descr: "Realça ou suaviza o ATAQUE da pancada e o SUSTENTO que vem depois, sem mexer no volume geral: dá punch na bateria e define o violão.",
    params: [N("ataque", "Ataque", "%", -100, 100, 40), N("sust", "Sustento", "%", -100, 100, 0)],
    criar(ctx, p) { const no = wk(ctx, "oh-transiente"); const ap = (p, s) => { wpar(ctx, no, "ataque", p.ataque / 100, s); wpar(ctx, no, "sust", p.sust / 100, s); }; ap(p, false); return { entrada: no, saida: no, atualizar: (q) => ap(q, true), parar() {} }; },
  };

  // ── Eletrônicos e criativos ──
  const PASSOS = [["0.25", "1/16"], ["0.5", "1/8"], ["1", "1/4"], ["2", "1/2"]];
  REG.ritmico = {
    nome: "Gate rítmico (trance gate)", grupo: "Eletrônicos e criativos", descr: "Pica o som num padrão rítmico preso ao andamento do projeto: o efeito de pulsos de música eletrônica.",
    params: [S("passo", "Divisão", PASSOS, "0.5"), S("padrao", "Padrão", [["0", "Contratempo"], ["1", "Quebrado"], ["2", "Sincopado"], ["3", "Pulsos curtos (1 em 4)"], ["5", "Meio-tempo"]], "1"), N("prof", "Profundidade", "%", 0, 100, 100), N("suav", "Suavidade", "ms", 0.5, 60, 4, { log: true, passo: 0.1 }), N("fase", "Deslocar", "passos", 0, 15, 0, { passo: 1 })], usaBpm: true,
    criar(ctx, p, amb) { const no = wk(ctx, "oh-ritmico"); const ap = (p, s, a) => { const am = a || amb || {}; wpar(ctx, no, "bpm", am.bpm || 100, s); wpar(ctx, no, "origem", am.origem || 0, false); wpar(ctx, no, "passo", +p.passo, s); wpar(ctx, no, "padrao", +p.padrao, s); wpar(ctx, no, "prof", p.prof / 100, s); wpar(ctx, no, "suav", p.suav / 1000, s); wpar(ctx, no, "forma", 0, s); wpar(ctx, no, "fase", p.fase, s); }; ap(p, false); return { entrada: no, saida: no, atualizar: (q, a) => ap(q, true, a), parar() {} }; },
  };
  REG.pump = {
    nome: "Pump (sidechain no ritmo)", grupo: "Eletrônicos e criativos", descr: "O \"respirar\" da música eletrônica: o volume cai a cada batida e volta suavemente, como se um bumbo estivesse comprimindo o som.",
    params: [S("passo", "A cada", [["0.5", "1/8"], ["1", "1/4 (cada tempo)"], ["2", "1/2"], ["4", "1 compasso"]], "1"), N("prof", "Profundidade", "%", 0, 100, 70), N("rapidez", "Rapidez da volta", "", 1, 30, 6, { passo: 0.5 }), N("suav", "Suavidade", "ms", 0.5, 30, 2, { log: true, passo: 0.1 })], usaBpm: true,
    criar(ctx, p, amb) { const no = wk(ctx, "oh-ritmico"); const ap = (p, s, a) => { const am = a || amb || {}; wpar(ctx, no, "bpm", am.bpm || 100, s); wpar(ctx, no, "origem", am.origem || 0, false); wpar(ctx, no, "passo", +p.passo, s); wpar(ctx, no, "padrao", 4, s); wpar(ctx, no, "prof", p.prof / 100, s); wpar(ctx, no, "suav", p.suav / 1000, s); wpar(ctx, no, "forma", 1, s); wpar(ctx, no, "rapidez", p.rapidez, s); wpar(ctx, no, "fase", 0, s); }; ap(p, false); return { entrada: no, saida: no, atualizar: (q, a) => ap(q, true, a), parar() {} }; },
  };

  REG.ecofita = {
    nome: "Eco de fita (space echo)", grupo: "Espaço e tempo", descr: "Eco de máquina de fita: cada repetição fica mais escura, mais suja e levemente ondulada (wow e flutter). Ótimo para solos e para deixar o violão \"jogado\".",
    params: [B("sync", "Seguir o andamento", false), S("nota", "Valor da nota", OPC_NOTAS, "1/8.", { mostrarSe: "sync" }), N("tempo", "Tempo", "ms", 30, 1500, 380, { log: true, mostrarSe: "!sync" }), N("realim", "Repetições", "%", 0, 95, 40), N("escurecer", "Escurece os ecos", "Hz", 1000, 12000, 4500, { log: true }), N("graves", "Tira graves dos ecos", "Hz", 40, 600, 140, { log: true }), N("saturacao", "Sujeira da fita", "%", 0, 100, 30), N("wow", "Ondulação lenta (wow)", "%", 0, 100, 25), N("flutter", "Tremida rápida (flutter)", "%", 0, 100, 15), N("mistura", "Mistura", "%", 0, 100, 30)], usaBpm: true,
    criar(ctx, p, amb) {
      const entrada = gn(ctx, 1), saida = gn(ctx, 1), wet = gn(ctx, 0), d = ctx.createDelay(4), hp = bw(ctx, "highpass"), pre = gn(ctx, 1), ws = ctx.createWaveShaper(), post = gn(ctx, 1), lp = bw(ctx, "lowpass"), fb = gn(ctx, 0), o1 = osc(ctx, "sine", 0.6), o2 = osc(ctx, "sine", 7.3), g1 = gn(ctx, 0), g2 = gn(ctx, 0);
      const cv = new Float32Array(2048); for (let i = 0; i < 2048; i++) cv[i] = Math.tanh((i / 1023.5 - 1) * 1.6) / 1.6; ws.curve = cv; ws.oversample = "none";   // sem oversampling: ele tem latência e, dentro do laço do eco, atrasaria cada repetição
      const dP = ctx.createDelay(0.05); dP.delayTime.value = QUANTO / ctx.sampleRate; entrada.connect(saida); entrada.connect(dP); dP.connect(d); serie([d, hp, pre, ws, post, lp]); lp.connect(wet); wet.connect(saida); lp.connect(fb); fb.connect(d); o1.connect(g1); g1.connect(d.delayTime); o2.connect(g2); g2.connect(d.delayTime);
      const ap = (p, s, a) => { const bpm = (a || amb || {}).bpm || 100, t = Math.max(0.03, Math.min(3.9, p.sync ? segDeNota(p.nota, bpm) : p.tempo / 1000)), sat = p.saturacao / 100;
        ajusta(ctx, d.delayTime, Math.max(0, t - QUANTO / ctx.sampleRate), s); ajusta(ctx, hp.frequency, p.graves, s); ajusta(ctx, pre.gain, 1 + sat * 5, s); ajusta(ctx, post.gain, 1 / (1 + sat * 2.2), s); ajusta(ctx, lp.frequency, p.escurecer, s); ajusta(ctx, fb.gain, p.realim / 100, s); ajusta(ctx, g1.gain, (p.wow / 100) * 0.0025, s); ajusta(ctx, g2.gain, (p.flutter / 100) * 0.0004, s); ajusta(ctx, wet.gain, p.mistura / 100, s); };
      ap(p, false); return { entrada, saida, atualizar: (q, a) => ap(q, true, a), parar: para([o1, o2]) };
    },
  };

  REG.ambiente = {
    nome: "Ambiente (shimmer)", grupo: "Espaço e tempo", descr: "Reverb enorme com um \"brilho celestial\": uma cópia mais aguda (oitava ou quinta) se perde dentro do reverb. O efeito \"jogadão\" para violão, guitarra e voz.",
    params: [N("tempo", "Tamanho", "s", 1.5, 10, 5, { passo: 0.1 }), N("shimmer", "Brilho celestial", "%", 0, 100, 40), S("semi", "Cópia aguda em", [["12", "Oitava acima"], ["7", "Quinta acima"], ["19", "Oitava e quinta"], ["-12", "Oitava abaixo (profundo)"]], "12"), N("amort", "Brilho do ambiente", "Hz", 1500, 20000, 8000, { log: true }), N("pre", "Pré-atraso", "ms", 0, 200, 30), N("graves", "Corta graves do efeito", "Hz", 20, 800, 150, { log: true }), N("mistura", "Mistura", "%", 0, 100, 40)],
    criar(ctx, p) {
      const entrada = gn(ctx, 1), saida = gn(ctx, 1), pit = wk(ctx, "oh-pitch"), c1 = ctx.createConvolver(), c2 = ctx.createConvolver(), sh = gn(ctx, 0), wet = gn(ctx, 0), hp = bw(ctx, "highpass"); c1.normalize = true; c2.normalize = true; let sig = "", timer = null;
      entrada.connect(saida); entrada.connect(c1); entrada.connect(pit); pit.connect(sh); sh.connect(c2); c1.connect(wet); c2.connect(wet); wet.connect(hp); hp.connect(saida);
      const novoIR = (p) => { const sg = [p.tempo, p.amort, p.pre].join("|"); if (sg === sig) return; sig = sg; const ir = gerarIR(ctx, { tipo: "salao", tempo: p.tempo, pre: p.pre, amort: p.amort, largura: 1 }); c1.buffer = ir; c2.buffer = ir; };
      const ap = (p, s) => { wpar(ctx, pit, "semi1", +p.semi, s); wpar(ctx, pit, "v1", 1, s); wpar(ctx, pit, "v2", 0, s); wpar(ctx, pit, "janela", 0.08, s); wpar(ctx, pit, "mistura", 1, s); ajusta(ctx, sh.gain, p.shimmer / 100, s); ajusta(ctx, wet.gain, p.mistura / 100, s); ajusta(ctx, hp.frequency, p.graves, s); if (!s) novoIR(p); else { clearTimeout(timer); timer = setTimeout(() => novoIR(p), 150); } };
      ap(p, false); return { entrada, saida, atualizar: (q) => ap(q, true), parar() { clearTimeout(timer); } };
    },
  };

  REG.vinil = {
    nome: "Vinil e fita velha (lo-fi)", grupo: "Eletrônicos e criativos", descr: "Estalos de disco, chiado, ondulação de toca-discos e agudos abafados: dá cara de gravação antiga a qualquer faixa.",
    params: [N("ruido", "Chiado", "%", 0, 100, 25), N("estalos", "Estalos de vinil", "%", 0, 100, 35), N("ondulacao", "Ondulação (wow/flutter)", "%", 0, 100, 30), N("brilho", "Agudos (corte)", "Hz", 3000, 16000, 9000, { log: true }), N("graves", "Graves (corte)", "Hz", 20, 200, 40, { log: true })],
    criar(ctx, p) {
      const entrada = gn(ctx, 1), saida = gn(ctx, 1), d = ctx.createDelay(0.1), o1 = osc(ctx, "sine", 0.55), o2 = osc(ctx, "sine", 6.8), g1 = gn(ctx, 0), g2 = gn(ctx, 0), lp = bw(ctx, "lowpass"), hp = bw(ctx, "highpass"), sr = ctx.sampleRate, n = sr * 4, rnd = prng(77);
      const bc = ctx.createBuffer(1, n, sr), dc = bc.getChannelData(0); for (let i = 0; i < n; i++) if (rnd() < 22 / sr) { const a = (0.3 + 0.7 * rnd()) ** 2 * 1.6 * (rnd() < 0.5 ? -1 : 1), L = Math.round(0.0015 * sr * (1 + 2 * rnd())); for (let j = 0; j < L && i + j < n; j++) dc[i + j] += a * Math.exp((-4 * j) / L); }
      const bh = ctx.createBuffer(1, n, sr), dh = bh.getChannelData(0), r2 = prng(91); for (let i = 0; i < n; i++) dh[i] = (r2() - 0.5) * 2;
      const sc = ctx.createBufferSource(), sh = ctx.createBufferSource(), gc = gn(ctx, 0), gh = gn(ctx, 0), hpn = bw(ctx, "highpass"); sc.buffer = bc; sc.loop = true; sh.buffer = bh; sh.loop = true; hpn.frequency.value = 900; sc.start(); sh.start();
      entrada.connect(d); d.connect(hp); hp.connect(lp); lp.connect(saida); o1.connect(g1); g1.connect(d.delayTime); o2.connect(g2); g2.connect(d.delayTime); sc.connect(gc); gc.connect(saida); sh.connect(hpn); hpn.connect(gh); gh.connect(saida);
      const ap = (p, s) => { const w = p.ondulacao / 100; ajusta(ctx, d.delayTime, 0.006, s); ajusta(ctx, g1.gain, w * 0.0035, s); ajusta(ctx, g2.gain, w * 0.0004, s); ajusta(ctx, lp.frequency, p.brilho, s); ajusta(ctx, hp.frequency, p.graves, s); ajusta(ctx, gc.gain, (p.estalos / 100) * 0.45, s); ajusta(ctx, gh.gain, (p.ruido / 100) * 0.06, s); };
      ap(p, false); return { entrada, saida, atualizar: (q) => ap(q, true), parar: para([o1, o2, sc, sh]) };
    },
  };

  const GRUPOS = ["Equalização e filtros", "Dinâmica", "Cor e distorção", "Guitarra, violão e baixo", "Espaço e tempo", "Modulação", "Voz e criativos", "Eletrônicos e criativos", "Estéreo e utilidades"];
  const CATEGORIAS = [["voz", "Voz"], ["violao", "Violão"], ["guitarra", "Guitarra"], ["baixo", "Baixo"], ["bateria", "Bateria"], ["eletronica", "Eletrônicos"], ["geral", "Geral"]];
  const INST = { eq: ["voz", "violao", "guitarra", "baixo", "bateria", "eletronica", "geral"], filtro: ["guitarra", "baixo", "eletronica", "geral"], exciter: ["voz", "violao", "geral"], compressor: ["voz", "violao", "guitarra", "baixo", "bateria", "eletronica", "geral"], multibanda: ["baixo", "bateria", "geral"], limitador: ["geral", "baixo", "bateria"], gate: ["voz", "guitarra", "bateria"], deesser: ["voz"], transiente: ["bateria", "violao", "baixo"], saturacao: ["voz", "guitarra", "baixo", "bateria", "eletronica"], bitcrusher: ["eletronica", "bateria"], robo: ["voz", "eletronica"], reverb: ["voz", "violao", "guitarra", "bateria", "geral"], delay: ["voz", "violao", "guitarra", "eletronica"], chorus: ["voz", "violao", "guitarra", "baixo"], flanger: ["guitarra", "baixo", "eletronica"], phaser: ["guitarra", "baixo", "eletronica"], tremolo: ["guitarra", "eletronica"], vibrato: ["voz", "guitarra"], autopan: ["guitarra", "eletronica", "geral"], harmonizador: ["voz", "violao", "guitarra"], largura: ["geral", "violao", "eletronica"], utilitario: ["geral"], amp: ["guitarra", "baixo"], caixa: ["guitarra", "baixo", "violao"], pedal: ["guitarra", "baixo", "eletronica"], octaver: ["guitarra", "baixo"], autowah: ["guitarra", "baixo", "eletronica"], ritmico: ["eletronica", "guitarra", "geral"], pump: ["eletronica", "geral"], ecofita: ["guitarra", "violao", "voz", "eletronica"], ambiente: ["guitarra", "violao", "voz", "eletronica"], vinil: ["eletronica", "violao", "geral"] };
  Object.keys(INST).forEach((k) => { if (REG[k]) REG[k].inst = INST[k]; });
  const USA_WORKLET = new Set(["compressor", "multibanda", "limitador", "gate", "deesser", "bitcrusher", "flanger", "phaser", "harmonizador", "octaver", "autowah", "ritmico", "pump", "transiente", "ambiente"]);
  let seq = 1;
  const padroes = (tipo) => { const o = {}; REG[tipo].params.forEach((q) => { o[q.id] = q.padrao; }); return o; };
  const novo = (tipo, ov) => ({ id: "fx" + Date.now().toString(36) + (seq++), tipo, ligado: true, p: Object.assign(padroes(tipo), ov || {}) });
  const precisaWorklet = (lista) => (lista || []).some((f) => f.ligado && USA_WORKLET.has(f.tipo));
  const assinatura = (lista) => (lista || []).filter((f) => f.ligado && REG[f.tipo]).map((f) => f.id + ":" + f.tipo).join("|");

  // cadeia: efeitos em série. `entrada` e `saida` são nós de ganho 1.
  function criarCadeia(ctx, lista, amb) {
    const entrada = gn(ctx, 1), saida = gn(ctx, 1), itens = new Map(), ativos = (lista || []).filter((f) => f.ligado && REG[f.tipo]); let anterior = entrada;
    for (const f of ativos) { const inst = REG[f.tipo].criar(ctx, Object.assign(padroes(f.tipo), f.p), amb || {}); anterior.connect(inst.entrada); anterior = inst.saida; itens.set(f.id, inst); }
    anterior.connect(saida);
    entrada.channelCount = 2; entrada.channelCountMode = "explicit"; entrada.channelInterpretation = "speakers";   // a cadeia é sempre estéreo: adicionar um efeito não muda o volume da faixa
    return { entrada, saida, itens, assinatura: assinatura(lista),
      atualizar(nova, a) { (nova || []).forEach((f) => { const i = itens.get(f.id); if (i) i.atualizar(Object.assign(padroes(f.tipo), f.p), a || amb || {}); }); },
      parar() { itens.forEach((i) => i.parar && i.parar()); try { entrada.disconnect(); } catch (e) { /* solto */ } } };
  }
  function cauda(lista) {   // quanto tempo (s) o efeito ainda "soa" depois que o áudio acaba (reverb e eco): usado na exportação
    let t = 0.05; for (const f of lista || []) { if (!f.ligado) continue; const p = f.p || {};
      if (f.tipo === "reverb") t += Math.min(10, (p.pre || 0) / 1000 + (p.tempo || 1) * 1.1) * ((p.mistura || 0) > 0 ? 1 : 0);
      else if (f.tipo === "delay") { const fb = (p.realim || 0) / 100, tt = Math.min(4, (p.tempo || 350) / 1000 + 0.05); t += fb > 0 && (p.mistura || 0) > 0 ? Math.min(8, tt * (1 + Math.log(0.001) / Math.log(Math.max(0.05, fb)))) : tt; }
      else if (f.tipo === "ambiente") t += Math.min(10, (p.pre || 0) / 1000 + (p.tempo || 5) * 1.1) * ((p.mistura || 0) > 0 ? 1 : 0);
      else if (f.tipo === "ecofita") { const fb = (p.realim || 0) / 100, tt = Math.min(4, p.sync ? 0.5 : (p.tempo || 380) / 1000); t += fb > 0 && (p.mistura || 0) > 0 ? Math.min(8, tt * (1 + Math.log(0.001) / Math.log(Math.max(0.05, fb)))) : tt; }
      else if (f.tipo === "harmonizador") t += 0.2; else if (f.tipo === "chorus" || f.tipo === "flanger") t += 0.05; }
    return Math.min(14, t);
  }
  async function renderizar(lista, canais, sr, opc) {   // aplica uma cadeia em áudio de teste e devolve [L, R]
    opc = opc || {}; const amb = opc.amb || { bpm: 100 }, n = canais[0].length + Math.round((opc.cauda == null ? cauda(lista) : opc.cauda) * sr), off = new OfflineAudioContext(2, n, sr);
    if (precisaWorklet(lista)) await carregarWorklet(off);
    const b = off.createBuffer(canais.length, canais[0].length, sr); canais.forEach((c, i) => b.copyToChannel(c, i));
    const src = off.createBufferSource(); src.buffer = b; const cad = criarCadeia(off, lista, amb); src.connect(cad.entrada); cad.saida.connect(off.destination); src.start();
    const r = await off.startRendering(); return [r.getChannelData(0), r.getChannelData(1)];
  }
  // curva de resposta do equalizador (em dB) para desenhar
  function curvaEq(p, n) {
    n = n || 96; const f = new Float32Array(n); for (let i = 0; i < n; i++) f[i] = 20 * Math.pow(1000, i / (n - 1)); const oc = new OfflineAudioContext(1, 1, 48000), tot = new Float32Array(n), mag = new Float32Array(n), fase = new Float32Array(n);
    const filtros = [[p.hpf <= 20 ? "allpass" : "highpass", Math.max(20, p.hpf), 0, QBW], ["lowshelf", p.b1f, p.b1g, 1], ["peaking", p.b2f, p.b2g, p.b2q], ["peaking", p.b3f, p.b3g, p.b3q], ["peaking", p.b4f, p.b4g, p.b4q], ["highshelf", p.b5f, p.b5g, 1], [p.lpf >= 20000 ? "allpass" : "lowpass", Math.min(20000, p.lpf), 0, QBW]];
    for (const [t, fr, g, q] of filtros) { const b = oc.createBiquadFilter(); b.type = t; b.frequency.value = fr; b.gain.value = g; b.Q.value = q; b.getFrequencyResponse(f, mag, fase); for (let i = 0; i < n; i++) tot[i] += 20 * Math.log10(Math.max(mag[i], 1e-6)); }
    return { f, db: tot };
  }

  // ═════════ predefinições (cadeias prontas) ═════════
  const PRE = [
    ["voz-limpa", "Voz limpa", "Tira o ronco, doma os \"sss\", nivela e dá um brilho leve.", [["eq", { hpf: 80, b2g: -2, b2f: 300, b4g: 2.5, b4f: 4500, b5g: 1.5 }], ["deesser", {}], ["compressor", { limiar: -20, razao: 3, ganho: 2 }], ["reverb", { tipo: "quarto", tempo: 0.4, pre: 2, mistura: 8 }]]],
    ["voz-pop", "Voz pop brilhante", "Voz na frente, brilhante e firme, com um espaço curto.", [["eq", { hpf: 90, b2g: -2.5, b3g: 1.5, b3f: 2000, b4g: 3, b4f: 6000, b5g: 3 }], ["deesser", { limiar: -30 }], ["compressor", { limiar: -22, razao: 4, ataque: 6, ganho: 3 }], ["exciter", { mistura: 20 }], ["reverb", { tipo: "placa", tempo: 1.4, mistura: 14 }], ["delay", { sync: true, nota: "1/8", realim: 25, mistura: 10 }]]],
    ["locutor", "Locutor (voz grave e encorpada)", "Realça os graves e a presença, bem nivelado.", [["eq", { hpf: 70, b1g: 4, b1f: 140, b2g: 1.5, b4g: 2, b4f: 3500 }], ["compressor", { limiar: -24, razao: 4, ataque: 15, ganho: 4 }], ["limitador", { teto: -1.5 }]]],
    ["radio", "Voz de rádio (AM)", "Faixa estreita e saturada, como num rádio antigo.", [["filtro", { tipo: "highpass", freq: 450, q: 0.7, inclin: "24" }], ["eq", { lpf: 4200, b3g: 4, b3f: 1800 }], ["saturacao", { tipo: "fita", drive: 10, mistura: 70 }], ["compressor", { limiar: -26, razao: 6, ganho: 4 }]]],
    ["telefone", "Voz de telefone", "Só médios, com chiado de linha.", [["filtro", { tipo: "bandpass", freq: 1500, q: 1.1, inclin: "24" }], ["saturacao", { tipo: "corte", drive: 8, mistura: 60 }], ["bitcrusher", { bits: 10, reduz: 4, mistura: 40 }]]],
    ["slapback", "Eco de fita (slapback)", "Um eco curto e escuro, clássico do rock antigo.", [["delay", { sync: false, tempo: 120, realim: 12, amort: 3500, mistura: 30 }], ["saturacao", { tipo: "fita", drive: 6, mistura: 40 }]]],
    ["catedral", "Catedral", "Reverb enorme e longo.", [["reverb", { tipo: "catedral", tempo: 5.5, pre: 40, mistura: 35 }], ["eq", { hpf: 150 }]]],
    ["palco", "Palco", "Reverb de salão com eco no ritmo da música.", [["reverb", { tipo: "salao", tempo: 2.2, mistura: 22 }], ["delay", { modo: "pingpong", sync: true, nota: "1/4", realim: 35, amort: 5000, mistura: 18 }]]],
    ["coro", "Coro", "Engrossa a voz como se fossem várias pessoas.", [["chorus", { vozes: 4, prof: 5, mistura: 55 }], ["reverb", { tipo: "camara", mistura: 18 }]]],
    ["dobrada", "Voz dobrada", "Uma segunda voz sutilmente diferente, para dar corpo.", [["chorus", { vozes: 2, taxa: 0.5, prof: 3, atraso: 22, largura: 100, mistura: 45 }], ["largura", { largura: 140 }]]],
    ["harmonia", "Harmonia em terça e quinta", "Duas vozes sintéticas acima: efeito criativo.", [["harmonizador", { semi1: 4, v1: 100, semi2: 7, v2: 80, mistura: 55 }], ["reverb", { tipo: "sala", mistura: 18 }]]],
    ["robo", "Robô", "Voz metálica de ficção científica.", [["robo", { freq: 120, mistura: 100 }], ["eq", { b4g: 4 }]]],
    ["lofi", "Lo-fi", "Som velho e empoeirado.", [["bitcrusher", { bits: 9, reduz: 5, mistura: 60 }], ["filtro", { tipo: "lowpass", freq: 5500, q: 0.8 }], ["saturacao", { tipo: "fita", drive: 10 }], ["tremolo", { taxa: 0.6, prof: 15 }]]],
    ["submarino", "Debaixo d'água", "Abafado e ondulando.", [["filtro", { tipo: "lowpass", freq: 700, q: 2, lfoTaxa: 0.4, lfoProf: 0.6 }], ["chorus", { vozes: 2, prof: 8, taxa: 0.3, mistura: 50 }], ["reverb", { tipo: "salao", mistura: 20 }]]],
    ["sonhador", "Sonhador (espacial)", "Phaser lento com reverb longo.", [["phaser", { taxa: 0.15, prof: 1.8, realim: 55, mistura: 45 }], ["reverb", { tipo: "salao", tempo: 3.4, mistura: 35 }]]],
    ["bateria-pesada", "Bateria / graves firmes", "Compressão paralela e saturação para dar peso.", [["compressor", { limiar: -26, razao: 6, ataque: 20, mistura: 55, ganho: 4 }], ["saturacao", { tipo: "tubo", drive: 8, mistura: 40 }], ["limitador", { teto: -1 }]]],
    ["master", "Acabamento geral", "Multibanda suave e limitador, para o fim da cadeia.", [["multibanda", {}], ["eq", { hpf: 25, b5g: 1.5 }], ["limitador", { teto: -0.8 }]]],
  ];
  const INST_PRE = { "voz-limpa": "voz", "voz-pop": "voz", locutor: "voz", radio: "voz", telefone: "voz", coro: "voz", dobrada: "voz", harmonia: "voz", robo: "voz", catedral: "geral", palco: "geral", master: "geral", slapback: "guitarra", sonhador: "eletronica", lofi: "eletronica", submarino: "eletronica", "bateria-pesada": "bateria" };
  const E = (tipo, p) => [tipo, p || {}];
  const NOVAS = [
    ["violao-corpo", "Violão com corpo", "Realça o corpo da madeira e nivela a dinâmica, com um espaço curto.", [E("eq", { hpf: 70, b1g: 2, b1f: 120, b2g: -2.5, b2f: 280, b4g: 2, b4f: 4500, b5g: 1.5 }), E("compressor", { limiar: -22, razao: 2.5, ataque: 20, liberacao: 150, ganho: 2 }), E("reverb", { tipo: "quarto", mistura: 8 })], "violao"],
    ["violao-estudio", "Violão brilhante de estúdio", "Brilho e presença de gravação profissional.", [E("eq", { hpf: 80, b2g: -2, b2f: 250, b3g: 1.5, b3f: 2500, b5g: 3, b5f: 9000 }), E("compressor", { limiar: -24, razao: 3, ataque: 12, ganho: 3 }), E("exciter", { mistura: 15 }), E("reverb", { tipo: "placa", tempo: 1.5, mistura: 12 })], "violao"],
    ["violao-jogadao", "Violão jogadão (ambiente)", "Eco de fita e reverb gigante com brilho celestial: o violão flutuando.", [E("eq", { hpf: 90 }), E("ecofita", { sync: true, nota: "1/8.", realim: 45, escurecer: 5000, mistura: 30 }), E("ambiente", { tempo: 5.5, shimmer: 35, mistura: 42 })], "violao"],
    ["violao-12", "Violão de 12 cordas", "Dobra de oitava e um chorus leve, como as cordas duplas de um violão de 12.", [E("harmonizador", { semi1: 12, v1: 100, v2: 0, mistura: 35, janela: 40 }), E("chorus", { vozes: 2, prof: 3, mistura: 25 }), E("eq", { b5g: 2 })], "violao"],
    ["violao-lofi", "Violão lo-fi empoeirado", "Estalos de vinil, ondulação e agudos abafados.", [E("eq", { hpf: 100, lpf: 6500 }), E("vinil", { ruido: 20, estalos: 40, ondulacao: 35, brilho: 7000 }), E("reverb", { tipo: "quarto", mistura: 10 })], "violao"],
    ["violao-eco", "Violão com eco de fita", "Eco quente de fita e um espaço de câmara.", [E("ecofita", { tempo: 340, realim: 38, mistura: 28 }), E("reverb", { tipo: "camara", mistura: 12 })], "violao"],
    ["violao-transiente", "Violão definido (mais ataque)", "Realça o ataque da palhetada para o violão aparecer na mixagem.", [E("transiente", { ataque: 45, sust: -10 }), E("eq", { hpf: 80, b2g: -2, b2f: 300 }), E("compressor", { limiar: -22, razao: 2.5, ganho: 2 })], "violao"],
    ["guit-limpa", "Guitarra limpa cristalina", "Compressor, amplificador limpo, caixa aberta, chorus suave e mola.", [E("compressor", { limiar: -20, razao: 3, ataque: 25, ganho: 2 }), E("amp", { modelo: "limpo", ganho: 20, agudos: 2, presenca: 45, volume: -4 }), E("caixa", { tipo: "2x12" }), E("chorus", { vozes: 2, prof: 3, mistura: 25 }), E("reverb", { tipo: "mola", tempo: 2, mistura: 18 })], "guitarra"],
    ["guit-crunch", "Crunch (rock clássico)", "Overdrive na frente de um amplificador crunch e caixa 4×12.", [E("pedal", { tipo: "overdrive", ganho: 30, tom: 55, nivel: -3 }), E("amp", { modelo: "crunch", ganho: 45 }), E("caixa", { tipo: "4x12" }), E("reverb", { tipo: "sala", mistura: 10 })], "guitarra"],
    ["guit-solo", "Solo com sustain", "Compressão para sustentar, overdrive e amplificador de lead, eco de fita e placa.", [E("compressor", { limiar: -28, razao: 6, ataque: 8, liberacao: 300, ganho: 5 }), E("pedal", { tipo: "overdrive", ganho: 55, tom: 60 }), E("amp", { modelo: "lead", ganho: 55, medios: 3 }), E("caixa", { tipo: "4x12" }), E("ecofita", { sync: true, nota: "1/8.", realim: 32, mistura: 22 }), E("reverb", { tipo: "placa", tempo: 1.8, mistura: 16 })], "guitarra"],
    ["guit-hard", "Hard rock / alto ganho", "Porta de ruído para a distorção não chiar, e amplificador lead pesado.", [E("gate", { limiar: -48 }), E("pedal", { tipo: "overdrive", ganho: 25, tom: 50 }), E("amp", { modelo: "lead", ganho: 75, graves: 2, medios: -1 }), E("caixa", { tipo: "4x12" })], "guitarra"],
    ["guit-fuzz", "Fuzz setentista", "Fuzz rasgado e mola de amplificador.", [E("pedal", { tipo: "fuzz", ganho: 70, tom: 50, nivel: -8 }), E("amp", { modelo: "crunch", ganho: 30 }), E("caixa", { tipo: "2x12" }), E("reverb", { tipo: "mola", tempo: 2, mistura: 15 })], "guitarra"],
    ["guit-wah", "Funk com wah de toque", "O wah abre com a força da palhetada.", [E("compressor", { limiar: -22, razao: 3, ganho: 2 }), E("autowah", { sens: 70, q: 4 }), E("amp", { modelo: "limpo", ganho: 25 }), E("caixa", { tipo: "1x12" })], "guitarra"],
    ["guit-ambiente", "Guitarra jogadona (ambiente)", "Eco de fita e shimmer: a guitarra flutuando no espaço.", [E("amp", { modelo: "limpo", ganho: 22, volume: -5 }), E("caixa", { tipo: "2x12" }), E("ecofita", { sync: true, nota: "1/4.", realim: 50, mistura: 32 }), E("ambiente", { tempo: 6.5, shimmer: 45, mistura: 50 })], "guitarra"],
    ["guit-surf", "Surf (mola e trêmolo)", "Trêmolo, mola e amplificador limpo.", [E("tremolo", { taxa: 6, prof: 55 }), E("amp", { modelo: "limpo", ganho: 25 }), E("caixa", { tipo: "1x12" }), E("reverb", { tipo: "mola", tempo: 3, mistura: 40 })], "guitarra"],
    ["baixo-estudio", "Baixo de estúdio", "Compressão firme, graves definidos e limitador.", [E("compressor", { limiar: -24, razao: 4, ataque: 30, liberacao: 120, ganho: 3 }), E("eq", { hpf: 35, b1g: 2, b1f: 90, b3g: 1.5, b3f: 900 }), E("amp", { modelo: "baixo", ganho: 20 }), E("limitador", { teto: -1.5 })], "baixo"],
    ["baixo-sujo", "Baixo sujo (overdrive)", "Overdrive com os graves preservados, amplificador e caixa de baixo.", [E("pedal", { tipo: "overdrive", ganho: 45, tom: 40 }), E("amp", { modelo: "baixo", ganho: 35 }), E("caixa", { tipo: "1x15" }), E("compressor", { limiar: -22, razao: 4, ganho: 2 })], "baixo"],
    ["baixo-octaver", "Baixo grosso (oitava abaixo)", "Uma oitava abaixo para um baixo enorme.", [E("octaver", { o1: 80, o2: 0, seco: 100, tom: 400 }), E("compressor", { limiar: -24, razao: 4, ganho: 3 }), E("amp", { modelo: "baixo", ganho: 15 })], "baixo"],
    ["baixo-funk", "Baixo funk (wah de toque)", "Wah de envelope no baixo.", [E("autowah", { fmin: 250, fmax: 1800, q: 3, sens: 70 }), E("compressor", { limiar: -22, razao: 4, ganho: 3 }), E("amp", { modelo: "baixo", ganho: 15 })], "baixo"],
    ["bat-punch", "Bateria com punch", "Mais ataque, compressão e um corte nos médios que embolam.", [E("transiente", { ataque: 60, sust: -10 }), E("compressor", { limiar: -22, razao: 4, ataque: 15, liberacao: 90, ganho: 2 }), E("eq", { b2g: -2, b2f: 350, b4g: 2, b4f: 5000 })], "bateria"],
    ["bat-esmagada", "Bateria esmagada (paralelo)", "Compressão paralela pesada e saturação de fita.", [E("compressor", { limiar: -34, razao: 10, ataque: 3, liberacao: 80, mistura: 55, ganho: 6 }), E("saturacao", { tipo: "fita", drive: 8, mistura: 40 }), E("limitador", { teto: -1 })], "bateria"],
    ["bat-gated", "Reverb gated anos 80", "O estrondo cortado seco da bateria dos anos 80.", [E("transiente", { ataque: 40, sust: -30 }), E("reverb", { tipo: "gated", tempo: 0.35, mistura: 45, graves: 100 })], "bateria"],
    ["bat-lofi", "Bateria lo-fi", "Bitcrusher, agudos abafados e fita.", [E("bitcrusher", { bits: 10, reduz: 3, mistura: 50 }), E("filtro", { tipo: "lowpass", freq: 7000, q: 0.8 }), E("saturacao", { tipo: "fita", drive: 8 })], "bateria"],
    ["bat-seca", "Bateria seca e firme", "Corta o sustento e o ambiente: bateria direta e controlada.", [E("gate", { limiar: -40 }), E("transiente", { ataque: 30, sust: -50 }), E("eq", { b2g: -2, b2f: 400 })], "bateria"],
    ["ele-trance", "Trance gate (1/16)", "Pulsos picados no andamento do projeto.", [E("ritmico", { passo: "0.25", padrao: "1", prof: 100, suav: 3 })], "eletronica"],
    ["ele-pump", "Pump (sidechain no ritmo)", "O som \"respira\" a cada batida, como na música eletrônica.", [E("pump", { passo: "1", prof: 75, rapidez: 6 })], "eletronica"],
    ["ele-vinil", "Vinil antigo", "Estalos, chiado e ondulação de disco velho.", [E("vinil", { ruido: 25, estalos: 45, ondulacao: 30, brilho: 8000 })], "eletronica"],
    ["ele-fita", "Fita gasta (wobble)", "Ondulação forte, saturação de fita e agudos caídos.", [E("vinil", { ruido: 15, estalos: 0, ondulacao: 65, brilho: 6500 }), E("saturacao", { tipo: "fita", drive: 8, mistura: 60 })], "eletronica"],
    ["ele-jogado", "Tudo jogado (ambient)", "Eco de fita e shimmer gigante: som que flutua.", [E("ecofita", { sync: true, nota: "1/4.", realim: 55, mistura: 40 }), E("ambiente", { tempo: 8, shimmer: 55, mistura: 60 })], "eletronica"],
    ["ele-digital", "Digital sujo", "Bitcrusher picado no ritmo.", [E("bitcrusher", { bits: 6, reduz: 8, mistura: 45 }), E("ritmico", { passo: "0.5", padrao: "2", prof: 80, suav: 3 })], "eletronica"],
  ];
  PRE.push(...NOVAS);
  const PREDEFINICOES = PRE.map(([id, nome, descr, fx, inst]) => ({ id, nome, descr, inst: inst || INST_PRE[id] || "geral", fx: fx.map(([tipo, p]) => ({ tipo, p })) }));
  const daPredefinicao = (pre) => pre.fx.map((f) => novo(f.tipo, f.p));

  const api = { REGISTRO: REG, GRUPOS, CATEGORIAS, PERFIS, NOTAS_SYNC, OPC_NOTAS, PREDEFINICOES, novo, padroes, daPredefinicao, assinatura, precisaWorklet, carregarWorklet, criarCadeia, cauda, renderizar, curvaEq, segDeNota, gerarIR };
  raiz.EstudioFx = api;
})(typeof window !== "undefined" ? window : globalThis);
