// ══════════════════════════════════════════════════════════════
// transposicao.js — Muda o tom de um áudio sem mudar a velocidade.
// Usa a SoundTouchJS (soundtouch.js, na mesma pasta), que roda no
// próprio aparelho. Nada disso passa pelo servidor.
//
// - Tom por música fica guardado neste aparelho (localStorage).
// - O download também sai no tom escolhido (quando diferente do original).
// ══════════════════════════════════════════════════════════════
(function () {
  const CHAVE_TOM = "oh-tom:";
  const cache = new Map();           // "url|semitons" -> blob URL
  const MAX_CACHE = 3;
  let stLib = null;

  async function biblioteca() {
    if (!stLib) stLib = await import("./soundtouch.js");
    return stLib;
  }

  async function baixarComoArrayBuffer(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Não consegui abrir o áudio (${r.status}).`);
    return await r.arrayBuffer();
  }

  // Garante estéreo (a biblioteca trabalha com dois canais)
  function paraEstereo(buffer) {
    if (buffer.numberOfChannels >= 2) return buffer;
    const ctx = new OfflineAudioContext(2, buffer.length, buffer.sampleRate);
    const out = ctx.createBuffer(2, buffer.length, buffer.sampleRate);
    const mono = buffer.getChannelData(0);
    out.getChannelData(0).set(mono);
    out.getChannelData(1).set(mono);
    return out;
  }

  function codificarWav(amostras, sampleRate, canais) {
    const bytesPorAmostra = 2;
    const dados = new DataView(new ArrayBuffer(44 + amostras.length * bytesPorAmostra));
    const escrever = (off, texto) => { for (let i = 0; i < texto.length; i++) dados.setUint8(off + i, texto.charCodeAt(i)); };
    escrever(0, "RIFF");
    dados.setUint32(4, 36 + amostras.length * bytesPorAmostra, true);
    escrever(8, "WAVE");
    escrever(12, "fmt ");
    dados.setUint32(16, 16, true);
    dados.setUint16(20, 1, true);            // PCM
    dados.setUint16(22, canais, true);
    dados.setUint32(24, sampleRate, true);
    dados.setUint32(28, sampleRate * canais * bytesPorAmostra, true);
    dados.setUint16(32, canais * bytesPorAmostra, true);
    dados.setUint16(34, 16, true);
    escrever(36, "data");
    dados.setUint32(40, amostras.length * bytesPorAmostra, true);
    let off = 44;
    for (let i = 0; i < amostras.length; i++, off += 2) {
      const v = Math.max(-1, Math.min(1, amostras[i]));
      dados.setInt16(off, v < 0 ? v * 0x8000 : v * 0x7fff, true);
    }
    return new Blob([dados], { type: "audio/wav" });
  }

  // Processa o áudio inteiro no aparelho e devolve um Blob WAV no tom pedido
  async function transporBlob(url, semitons) {
    const { SoundTouch, SimpleFilter, WebAudioBufferSource } = await biblioteca();
    const arrayBuffer = await baixarComoArrayBuffer(url);
    const ctxDecod = new (window.AudioContext || window.webkitAudioContext)();
    const decodificado = await ctxDecod.decodeAudioData(arrayBuffer);
    ctxDecod.close();
    const buffer = paraEstereo(decodificado);

    const st = new SoundTouch();
    st.pitchSemitones = semitons;
    const origem = new WebAudioBufferSource(buffer);
    const filtro = new SimpleFilter(origem, st);

    const pedacos = [];
    const temp = new Float32Array(4096 * 2);
    let total = 0;
    for (;;) {
      const lidos = filtro.extract(temp, 4096);
      if (!lidos) break;
      const copia = new Float32Array(lidos * 2);
      copia.set(temp.subarray(0, lidos * 2));
      pedacos.push(copia);
      total += lidos * 2;
    }
    const todas = new Float32Array(total);
    let pos = 0;
    for (const p of pedacos) { todas.set(p, pos); pos += p.length; }
    return codificarWav(todas, buffer.sampleRate, 2);
  }

  // Devolve uma URL pronta para tocar/baixar no tom pedido (cache em memória)
  async function obterUrl(url, semitons) {
    if (!semitons) return url;
    const chave = `${url}|${semitons}`;
    if (cache.has(chave)) return cache.get(chave);
    const blob = await transporBlob(url, semitons);
    const blobUrl = URL.createObjectURL(blob);
    cache.set(chave, blobUrl);
    if (cache.size > MAX_CACHE) {
      const primeira = cache.keys().next().value;
      URL.revokeObjectURL(cache.get(primeira));
      cache.delete(primeira);
    }
    return blobUrl;
  }

  // Tom guardado por música, neste aparelho
  function lerTom(chave) {
    const v = parseInt(localStorage.getItem(CHAVE_TOM + chave) || "0", 10);
    return Number.isFinite(v) ? Math.max(-6, Math.min(6, v)) : 0;
  }
  function salvarTom(chave, semitons) {
    if (!semitons) localStorage.removeItem(CHAVE_TOM + chave);
    else localStorage.setItem(CHAVE_TOM + chave, String(semitons));
  }

  function rotuloTom(s) {
    if (!s) return "tom original";
    return (s > 0 ? "+" : "−") + Math.abs(s) + (Math.abs(s) === 1 ? " semitom" : " semitons");
  }

  // Monta o controle − / + dentro de um elemento. Devolve { el, definir(s) }.
  function montarControle(opcoes) {
    const { chave, onMudar } = opcoes;
    let s = lerTom(chave);
    const el = document.createElement("div");
    el.className = "oh-tom-controle";
    el.innerHTML = `
      <button type="button" class="oh-tom-btn" data-d="-1" aria-label="Baixar tom">−</button>
      <span class="oh-tom-rotulo">${rotuloTom(s)}</span>
      <button type="button" class="oh-tom-btn" data-d="1" aria-label="Subir tom">+</button>`;
    const rotulo = el.querySelector(".oh-tom-rotulo");
    const pintar = () => { rotulo.textContent = rotuloTom(s); };
    el.querySelectorAll(".oh-tom-btn").forEach((b) => b.addEventListener("click", () => {
      const nova = Math.max(-6, Math.min(6, s + parseInt(b.dataset.d, 10)));
      if (nova === s) return;
      definir(nova);
    }));
    async function definir(nova) {
      s = nova;
      salvarTom(chave, s);
      pintar();
      await onMudar(s);
    }
    return { el, get semitons() { return s; }, definir, pintar };
  }

  window.Transposicao = { obterUrl, lerTom, salvarTom, rotuloTom, montarControle };
})();
