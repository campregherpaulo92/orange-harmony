// estudioCifra.js — aba "Cifra" do Orange Studio: tom, andamento e acordes de uma música + a letra com os acordes na posição em que acontecem, rolando junto com o áudio.
// Duas partes: (1) a LÓGICA (pura, testada em Node): palavras, tempo de cada palavra, em que palavra cai cada acorde, transposição, texto para copiar;
//              (2) a TELA: análise (servidor), player com velocidade sem mudar o tom, acompanhamento da música, edição da letra.
(function (raiz) {
  "use strict";
  const NOMES_SUST = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"], NOMES_BEM = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
  const PC = { C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5, "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11 };
  const BEMOL_MAIOR = new Set([5, 10, 3, 8, 1]), BEMOL_MENOR = new Set([2, 7, 0, 5, 10, 3]);
  const usaBemol = (tonica, modo) => (modo === "menor" ? BEMOL_MENOR : BEMOL_MAIOR).has(((tonica % 12) + 12) % 12);
  const nomeNota = (pc, bemol) => (bemol ? NOMES_BEM : NOMES_SUST)[((pc % 12) + 12) % 12];

  function transporAcorde(nome, semitons, bemol) {
    const m = /^([A-G][b#]?)([^/]*)(?:\/([A-G][b#]?))?$/.exec(nome || ""); if (!m || PC[m[1]] === undefined) return nome;
    const r = nomeNota(PC[m[1]] + semitons, bemol), baixo = m[3] && PC[m[3]] !== undefined ? "/" + nomeNota(PC[m[3]] + semitons, bemol) : "";
    return r + m[2] + baixo;
  }
  function nomeMostrado(a, opc) {
    const base = opc.simples ? a.simples || a.acorde : a.acorde;
    if (!opc.transpor) return base;                                             // sem transposição: mantém exatamente a grafia do servidor (Bb continua Bb)
    const bemol = opc.tom && PC[opc.tom] !== undefined ? usaBemol((PC[opc.tom] + opc.transpor + 120) % 12, opc.modo) : false;
    return transporAcorde(base, opc.transpor, bemol);
  }
  function transporTom(tom, modo, semitons) {
    if (!tom || PC[tom] === undefined) return { tom, modo, rotulo: tom ? `${tom} ${modo || ""}`.trim() : "" };
    const pc = (PC[tom] + semitons + 120) % 12, t = nomeNota(pc, usaBemol(pc, modo));
    return { tom: t, modo, rotulo: `${t} ${modo}` };
  }
  function relativo(tom, modo) {
    if (!tom || PC[tom] === undefined) return "";
    const pc = modo === "maior" ? (PC[tom] + 9) % 12 : (PC[tom] + 3) % 12, m2 = modo === "maior" ? "menor" : "maior";
    return `${nomeNota(pc, usaBemol(pc, m2))} ${m2}`;
  }

  // sílabas (aproximação para o português: cada grupo de vogais conta uma): serve só para repartir o tempo de uma linha entre as palavras
  function silabas(palavra) {
    const g = (palavra || "").toLowerCase().match(/[aeiouyáéíóúâêôãõàü]+/g);
    return Math.max(1, g ? g.length : 0);
  }
  function palavrasDaLinha(texto, ini, fim) {
    const ps = (texto || "").split(/\s+/).filter(Boolean); if (!ps.length) return [];
    const pesos = ps.map(silabas), total = pesos.reduce((a, b) => a + b, 0), dur = Math.max(0.05, fim - ini); let t = ini;
    return ps.map((p, i) => { const d = dur * pesos[i] / total, w = { t: p, ini: t, fim: t + d, acordes: [] }; t += d; return w; });
  }
  function acordeAtivo(acordes, t) {
    if (!acordes || !acordes.length) return -1;
    let lo = 0, hi = acordes.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (acordes[mid].ini <= t) lo = mid; else hi = mid - 1; }
    return acordes[lo].ini <= t + 1e-9 ? lo : -1;
  }

  // ── a peça central: monta as linhas da cifra (letra com acordes sobre as palavras, trechos instrumentais, ou só a grade de acordes) ──
  function montar(linhas, acordes, opc) {
    opc = Object.assign({ simples: true, transpor: 0, tom: null, modo: "maior", lacuna: 2.5, repetirNoInicio: false, duracao: null }, opc || {});
    const ac = (acordes || []).map((a, i) => ({ nome: nomeMostrado(a, opc), ini: a.ini, fim: a.fim, incerto: !!a.incerto, idx: i }));
    const dur = opc.duracao != null ? opc.duracao : ac.length ? ac[ac.length - 1].fim : 0;
    const chip = (a) => ({ nome: a.nome, ini: a.ini, incerto: a.incerto, idx: a.idx });
    const rows = [];
    if (!linhas || !linhas.length) {
      for (let i = 0; i < ac.length; i += 4) { const g = ac.slice(i, i + 4); rows.push({ tipo: "grade", ini: g[0].ini, fim: g[g.length - 1].fim, acordes: g.map(chip) }); }
      return rows;
    }
    const L = linhas.filter((l) => (l.texto || "").trim()).sort((a, b) => a.ini - b.ini), usados = new Set(); let ultimo = null;   // linha em branco não vira linha da cifra
    const sobrepoe = (a, ini, fim) => Math.min(a.fim, fim) - Math.max(a.ini, ini);
    const instrumental = (rot, ini, fim) => {            // trecho sem letra: mostra os acordes que tocam nele
      const g = ac.filter((a) => sobrepoe(a, ini, fim) >= 0.5 || (a.ini >= ini - 1e-6 && a.ini < fim - 0.05)); g.forEach((a) => usados.add(a.idx));
      if (g.length) rows.push({ tipo: "instrumental", rotulo: rot, ini, fim, acordes: g.map(chip) });
    };
    let fimAnterior = 0;
    L.forEach((l, k) => {
      if (l.ini - fimAnterior >= opc.lacuna) instrumental(k === 0 ? "Intro" : "Instrumental", fimAnterior, l.ini - 0.3);
      const ps = palavrasDaLinha(l.texto, l.ini, l.fim);
      if (ps.length) {
        // acordes que começam entre o fim da linha anterior e o fim desta (inclui a pausa curta antes dela)
        const eventos = ac.filter((a) => !usados.has(a.idx) && a.ini >= fimAnterior - 1e-6 && a.ini < l.fim);
        const ia = acordeAtivo(ac.map((a) => ({ ini: a.ini })), l.ini), ativo = ia >= 0 ? ac[ia] : null;
        if (ativo && !eventos.includes(ativo) && (opc.repetirNoInicio || ativo.nome !== ultimo)) eventos.unshift(ativo);   // o acorde que já estava tocando quando a linha começa
        eventos.sort((a, b) => a.ini - b.ini); eventos.forEach((a) => usados.add(a.idx));
        let anterior = ultimo;
        eventos.forEach((a, n) => {
          if (a.nome === anterior && !(opc.repetirNoInicio && n === 0)) return;     // o mesmo acorde de novo (ex.: Am e Am7 viram "Am"): não repete
          let w = ps.length - 1; for (let i = 0; i < ps.length; i++) { if (a.ini < ps[i].fim) { w = i; break; } }
          ps[w].acordes.push(chip(a)); anterior = a.nome;                              // cai na palavra que está sendo cantada quando o acorde muda
        });
        ultimo = anterior;
      }
      rows.push({ tipo: "linha", ini: l.ini, fim: l.fim, palavras: ps, texto: l.texto, ordem: k });
      fimAnterior = Math.max(fimAnterior, l.fim);
    });
    if (dur - fimAnterior >= opc.lacuna) instrumental("Final", fimAnterior, dur + 1);
    else {                                                // final curto: os acordes que sobraram vão na última palavra
      const ult = rows.slice().reverse().find((r) => r.tipo === "linha");
      if (ult && ult.palavras.length) ac.filter((a) => !usados.has(a.idx) && a.ini >= fimAnterior - 0.3).forEach((a) => { if (a.nome !== ultimo) { ult.palavras[ult.palavras.length - 1].acordes.push(chip(a)); ultimo = a.nome; } });
    }
    return rows;
  }

  // texto para copiar / levar para Composições: acordes entre colchetes antes da palavra; acordes incertos levam "?"
  function paraTexto(rows, info) {
    const c = (a) => `[${a.nome}${a.incerto ? "?" : ""}]`, out = [];
    if (info && info.rotulo) out.push(`Tom: ${info.rotulo}${info.bpm ? ` · ${Math.round(info.bpm)} BPM` : ""}`, "");
    rows.forEach((r) => {
      if (r.tipo === "linha") out.push(r.palavras.map((w) => w.acordes.map(c).join("") + w.t).join(" "));
      else { if (r.tipo === "instrumental") out.push(`# ${r.rotulo}`); out.push(r.acordes.map(c).join(" ")); }
    });
    return out.join("\n").replace(/\n{3,}/g, "\n\n");
  }

  // ── edição da letra: troca o texto das linhas mantendo os tempos; se a quantidade mudou, reparte o tempo de forma proporcional ──
  function editarTextos(linhas, textos) {
    const novos = textos.map((t) => t.trim()).filter(Boolean);
    if (novos.length === linhas.length) return linhas.map((l, i) => Object.assign({}, l, { texto: novos[i] }));
    if (!linhas.length || !novos.length) return novos.map((t, i) => ({ ini: i * 4, fim: i * 4 + 4, texto: t }));
    const ini = linhas[0].ini, fim = linhas[linhas.length - 1].fim, pesos = novos.map((t) => Math.max(1, t.length)), tot = pesos.reduce((a, b) => a + b, 0); let t0 = ini;
    return novos.map((t, i) => { const d = (fim - ini) * pesos[i] / tot, l = { ini: +t0.toFixed(2), fim: +(t0 + d).toFixed(2), texto: t }; t0 += d; return l; });
  }
  function deslocar(linhas, delta, duracao) {
    return linhas.map((l) => ({ ini: Math.max(0, Math.min(duracao - 0.3, +(l.ini + delta).toFixed(2))), fim: Math.max(0.3, Math.min(duracao, +(l.fim + delta).toFixed(2))), texto: l.texto }));
  }

  const logica = { nomeMostrado, usaBemol, transporAcorde, transporTom, relativo, silabas, palavrasDaLinha, acordeAtivo, montar, paraTexto, editarTextos, deslocar, PC };
  if (typeof module !== "undefined" && module.exports) { module.exports = { logica }; return; }

  // ═════════════════════════════ A TELA (só no navegador) ═════════════════════════════
  const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (s) => { s = Math.max(0, s || 0); const m = Math.floor(s / 60); return `${m}:${(s - m * 60).toFixed(1).padStart(4, "0")}`; };
  const VELOCIDADES = [0.25, 0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.25, 1.5, 2];

  function wavMono16(f32, sr) {
    const n = f32.length, b = new ArrayBuffer(44 + n * 2), v = new DataView(b), w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); w(8, "WAVEfmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) { const x = Math.max(-1, Math.min(1, f32[i])); v.setInt16(44 + i * 2, x < 0 ? x * 32768 : x * 32767, true); }
    return new Blob([b], { type: "audio/wav" });
  }
  async function paraWav22k(buf) {   // mono a 22,05 kHz: é o que o servidor analisa, e fica pequeno para enviar (5 min ≈ 13 MB)
    const OC = window.OfflineAudioContext || window.webkitOfflineAudioContext, sr = 22050, off = new OC(1, Math.max(1, Math.ceil(buf.duration * sr)), sr), src = off.createBufferSource();
    src.buffer = buf; src.connect(off.destination); src.start(); const out = await off.startRendering(); return wavMono16(out.getChannelData(0), sr);
  }

  function criar(el, api) {
    const E = { ocupado: false, msg: "", rid: null, chave: "", opc: { simples: true, transpor: 0 }, audio: null, urlAudio: null, rows: [], intervalo: null, repetir: false, editando: false, vel: 1, quadroAtivo: { linha: -1, palavra: -1, acorde: -1 }, aviso: "", colar: "", comLetra: true };
    const $ = (s) => el.querySelector(s);
    const regiao = () => api.regiaoSel();
    const cifraDe = (r) => (r && r.cifra) || null;
    const valida = (r, c) => c && c.sig && c.sig.buf === r.buf && Math.abs(c.sig.off - r.off) < 1e-6 && Math.abs(c.sig.dur - r.dur) < 0.05;

    function liberarAudio() { if (E.intervalo) { clearInterval(E.intervalo); E.intervalo = null; } if (E.audio) { E.audio.pause(); E.audio.removeAttribute("src"); E.audio.load(); E.audio = null; } if (E.urlAudio) { URL.revokeObjectURL(E.urlAudio); E.urlAudio = null; } E.quadroAtivo = { linha: -1, palavra: -1, acorde: -1 }; }
    async function garantirAudio() {
      if (E.audio) return E.audio; const r = regiao(); if (!r) return null; api.dica("Preparando o áudio para tocar…");
      const buf = await api.renderRegiao(r), blob = api.wavBlob(buf); E.urlAudio = URL.createObjectURL(blob);
      const a = new Audio(); a.preload = "auto"; a.src = E.urlAudio; a.preservesPitch = true; a.webkitPreservesPitch = true; a.mozPreservesPitch = true; a.defaultPlaybackRate = E.vel; a.playbackRate = E.vel;
      a.addEventListener("ended", () => { atualizarBotao(); }); a.addEventListener("pause", atualizarBotao); a.addEventListener("play", atualizarBotao); a.addEventListener("timeupdate", acompanhar);
      E.audio = a; await new Promise((ok) => { if (a.readyState >= 1) ok(); else { a.addEventListener("loadedmetadata", ok, { once: true }); setTimeout(ok, 4000); } }); return a;
    }
    function atualizarBotao() { const b = $("#cfPlay"); if (b) b.textContent = E.audio && !E.audio.paused ? "⏸ Pausar" : "▶ Tocar"; }

    // ── o que mostrar ──
    function opcoes(c) { return { simples: E.opc.simples, transpor: E.opc.transpor, tom: c.tom, modo: c.modo, duracao: c.duracao }; }
    function montarRows(c) { (c.linhas || []).sort((a, b) => a.ini - b.ini); return montar(((c.linhas || []).map((l) => Object.assign({}, l, { ini: l.ini, fim: l.fim }))), c.acordes || [], opcoes(c)); }
    function resumoAcordes(c) { const nomes = []; (c.acordes || []).forEach((a) => { const n = nomeMostrado(a, opcoes(c)); if (!nomes.length || nomes[nomes.length - 1] !== n) nomes.push(n); }); return nomes; }
    const chipHTML = (a) => `<span class="cf-ac${a.incerto ? " inc" : ""}" data-t="${a.ini}" data-ac="${a.idx}" title="${a.incerto ? "Acorde incerto: o detector não tem certeza deste" : "Toque para ir até aqui"}">${esc(a.nome)}${a.incerto ? "?" : ""}</span>`;
    function letraHTML(rows) {
      return rows.map((r, i) => {
        if (r.tipo === "linha") return `<div class="cf-linha" data-l="${r.ordem}" data-t="${r.ini}">${r.palavras.map((w, j) => `<span class="cf-pal" data-t="${w.ini.toFixed(2)}" data-w="${j}"><span class="cf-acs">${w.acordes.map(chipHTML).join("") || "&nbsp;"}</span><span class="cf-tx">${esc(w.t)}</span></span>`).join(" ")}</div>`;
        return `<div class="cf-instr"><span class="cf-rot">${esc(r.rotulo || "♪")}</span>${r.acordes.map(chipHTML).join("")}</div>`;
      }).join("");
    }

    function render(forcar) {
      const r = regiao(), c = cifraDe(r), chave = [r ? r.id : "", c ? c.criadoEm : "", E.ocupado, E.editando, E.opc.simples, E.opc.transpor].join("|");
      if (!forcar && chave === E.chave) return; E.chave = chave;
      if (!r || E.rid !== r.id) { liberarAudio(); E.rid = r ? r.id : null; E.aviso = ""; E.msg = ""; }
      const sem = !r ? "Selecione, na linha do tempo, a região (a música inteira, o instrumental…) que você quer analisar." : "";
      let corpo = "";
      if (!r) corpo = `<div class="cf-vazio">${sem}</div>`;
      else if (!c || !valida(r, c)) {
        corpo = `${c && !valida(r, c) ? `<div class="cf-alerta">A região mudou desde a última análise (você cortou, moveu o começo ou aplicou limpeza/afinação). Analise de novo.</div>` : ""}
          <div class="cf-intro"><h4>Descobrir o tom, o andamento e os acordes</h4>
          <p class="cf-dica">Analisa o áudio da região <b>${esc(r.nome)}</b> (até 5 minutos). Para acertar mais, use uma região com a música tocando, de preferência <b>sem voz alta por cima</b> (o instrumental separado dá o melhor resultado).</p>
          <label class="cf-bool"><input type="checkbox" id="cfComLetra" ${E.comLetra ? "checked" : ""}> Transcrever também a letra com a IA</label>
          <details class="cf-colar"><summary>Já tenho a letra (ex.: a do Songwriter)</summary><textarea id="cfColar" rows="5" placeholder="Cole aqui, um verso por linha. A IA só marca o tempo de cada um (fica bem mais certo do que ouvir tudo do zero).">${esc(E.colar)}</textarea></details>
          <button class="dw-btn cheio" id="cfAnalisar" ${E.ocupado ? "disabled" : ""}>${E.ocupado ? "Analisando…" : "Analisar a música"}</button></div>`;
      } else {
        E.rows = montarRows(c); const tr = transporTom(c.tom, c.modo, E.opc.transpor), rel = relativo(tr.tom, c.modo), nAc = (c.acordes || []).length, nInc = (c.acordes || []).filter((a) => a.incerto).length;
        corpo = `<div class="cf-topo"><div class="cf-resumo"><span class="cf-chip"><b>Tom</b> ${esc(tr.rotulo || "—")}${rel ? ` <small>(ou ${esc(rel)})</small>` : ""}</span>${c.bpm ? `<span class="cf-chip"><b>${Math.round(c.bpm)}</b> BPM</span>` : ""}<span class="cf-chip"><b>Acordes</b> ${esc(resumoAcordes(c).slice(0, 10).join(" – "))}${resumoAcordes(c).length > 10 ? "…" : ""}</span></div>
          <div class="cf-player"><button class="dw-btn cheio" id="cfPlay">▶ Tocar</button><input type="range" id="cfPos" min="0" max="${c.duracao}" step="0.05" value="0"><span id="cfTempo" class="cf-tempo">0:00.0 / ${fmt(c.duracao)}</span>
            <label>Velocidade <select id="cfVel">${VELOCIDADES.map((v) => `<option value="${v}" ${v === E.vel ? "selected" : ""}>${Math.round(v * 100)}%</option>`).join("")}</select></label>
            <label class="cf-bool"><input type="checkbox" id="cfRepetir" ${E.repetir ? "checked" : ""}> Repetir a linha</label>
            <label class="cf-transp">Transpor <button class="dw-btn" id="cfMenos">−</button><b id="cfTransp">${E.opc.transpor > 0 ? "+" : ""}${E.opc.transpor}</b><button class="dw-btn" id="cfMais">+</button></label>
            <label class="cf-bool"><input type="checkbox" id="cfSimples" ${E.opc.simples ? "checked" : ""}> Acordes simples (sem sétima)</label></div>
          <div class="cf-agora" id="cfAgora">Agora: <b id="cfAgoraAc">—</b> <span class="cf-prox">próximo: <b id="cfProxAc">—</b></span></div></div>
          ${E.editando ? editorHTML(c) : `<div class="cf-letra" id="cfLetra">${letraHTML(E.rows) || '<div class="cf-vazio">Não achei acordes nesta região.</div>'}</div>`}
          ${(c.linhas || []).length ? "" : `<div class="cf-alerta">Sem letra: ${esc(c.avisoLetra || "a transcrição da letra não foi pedida ou não funcionou")}. Os acordes aparecem em grade; use “Colar letra e alinhar” para juntar a letra.</div>`}
          ${nInc ? `<div class="cf-leg">Os acordes com <b>?</b> apagados são os que o detector não tem certeza (${nInc} de ${nAc}). Ouça e confira esses.</div>` : ""}
          <div class="cf-acoes">${E.editando ? `<button class="dw-btn cheio" id="cfFimEd">Concluir edição</button>` : `<button class="dw-btn" id="cfEditar">Editar a letra</button>`}<button class="dw-btn" id="cfLetraIA">${(c.linhas || []).length ? "Refazer a letra com a IA" : "Transcrever a letra"}</button><button class="dw-btn" id="cfCopiar">Copiar a cifra</button><button class="dw-btn" id="cfSalvar">Salvar em Composições</button><button class="dw-btn" id="cfDeNovo">Analisar de novo</button></div>
          <details class="cf-colar"><summary>Colar a letra e alinhar com a IA</summary><textarea id="cfColarMais" rows="5" placeholder="Cole a letra, um verso por linha. A IA ouve a música e só marca o tempo de cada verso.">${esc(E.colar)}</textarea><button class="dw-btn" id="cfAlinhar">Alinhar a letra com a música</button></details>
          ${c.avisos && c.avisos.length ? `<div class="cf-leg">${c.avisos.map(esc).join(" ")}</div>` : ""}`;
      }
      el.innerHTML = `<div class="dw-fx-barra"><span class="dw-dica">${r ? `Região: <b>${esc(r.nome)}</b> (${fmt(r.dur)}) · faixa <b>${esc(api.nomeFaixa(r))}</b>` : "Cifra e letra"}</span></div><div class="cf-corpo">${corpo}<div class="cf-msg" id="cfMsg" role="status">${esc(E.ocupado ? E.msg : E.msg)}</div></div>`;
      E.quadroAtivo = { linha: -1, palavra: -1, acorde: -1 }; atualizarBotao(); if (E.audio) acompanhar();
    }
    function editorHTML(c) {
      return `<div class="cf-editor"><div class="cf-dica">Edite o texto de cada linha. O tempo de cada uma fica como está; para acertar um tempo, toque a música e clique em <b>Marcar agora</b> na linha. Uma linha por verso.</div>
        <div class="cf-desloc">Deslocar toda a letra: <button class="dw-btn" data-d="-0.5">−0,5 s</button><button class="dw-btn" data-d="-0.1">−0,1 s</button><button class="dw-btn" data-d="0.1">+0,1 s</button><button class="dw-btn" data-d="0.5">+0,5 s</button></div>
        ${(c.linhas || []).map((l, i) => `<div class="cf-ed-linha" data-i="${i}"><input type="text" class="cf-ed-t" value="${esc(l.texto)}"><span class="cf-ed-ini">${fmt(l.ini)}</span><button class="dw-btn" data-marcar="${i}" title="Usa o ponto atual da música como começo desta linha">Marcar agora</button><button class="dw-btn" data-mais="${i}" title="Nova linha abaixo">+</button><button class="dw-btn" data-del="${i}" title="Apagar a linha">✕</button></div>`).join("")}</div>`;
    }

    // ── acompanhar a música ──
    function acompanhar() {
      const r = regiao(), c = cifraDe(r); if (!E.audio || !c) return; const t = E.audio.currentTime;
      if (E.repetir && !E.audio.paused && E.quadroAtivo.linha >= 0) { const l = (c.linhas || [])[E.quadroAtivo.linha]; if (l && t >= l.fim - 0.05) { E.audio.currentTime = l.ini; return; } }
      const pos = $("#cfPos"); if (pos && document.activeElement !== pos) pos.value = t; const tp = $("#cfTempo"); if (tp) tp.textContent = `${fmt(t)} / ${fmt(c.duracao)}`;
      const ia = acordeAtivo(c.acordes || [], t), nome = (a) => nomeMostrado(a, opcoes(c));
      const ag = $("#cfAgoraAc"), px = $("#cfProxAc"); if (ag) { const a = ia >= 0 ? c.acordes[ia] : null; ag.textContent = a ? nome(a) + (a.incerto ? "?" : "") : "—"; ag.classList.toggle("inc", !!(a && a.incerto)); const p = ia >= 0 ? c.acordes[ia + 1] : c.acordes[0]; if (px) px.textContent = p ? nome(p) + (p.incerto ? "?" : "") : "—"; }
      let il = -1, iw = -1; (c.linhas || []).forEach((l, k) => { if (t >= l.ini - 0.05 && t < l.fim) il = k; });
      if (il >= 0) { const row = E.rows.find((x) => x.tipo === "linha" && x.ordem === il); if (row) row.palavras.forEach((w, j) => { if (t >= w.ini) iw = j; }); }
      const q = E.quadroAtivo; if (il === q.linha && iw === q.palavra && ia === q.acorde) return;
      el.querySelectorAll(".cf-linha.ativa").forEach((x) => x.classList.remove("ativa")); el.querySelectorAll(".cf-pal.ativa").forEach((x) => x.classList.remove("ativa")); el.querySelectorAll(".cf-ac.ativo").forEach((x) => x.classList.remove("ativo"));
      let linhaEl = null; if (il >= 0) { linhaEl = el.querySelector(`.cf-linha[data-l="${il}"]`); if (linhaEl) { linhaEl.classList.add("ativa"); const p = linhaEl.querySelector(`.cf-pal[data-w="${iw}"]`); if (p) p.classList.add("ativa"); } }
      if (ia >= 0) el.querySelectorAll(`.cf-ac[data-ac="${ia}"]`).forEach((x) => x.classList.add("ativo"));
      if (il !== q.linha && linhaEl && E.audio && !E.audio.paused) {
        const sc = el.closest(".dw-painel-aba") || el, topo = $(".cf-topo"), y = linhaEl.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop;
        sc.scrollTo({ top: Math.max(0, y - (topo ? topo.offsetHeight : 0) - Math.max(20, (sc.clientHeight - (topo ? topo.offsetHeight : 0)) / 4)), behavior: "smooth" });
      }
      E.quadroAtivo = { linha: il, palavra: iw, acorde: ia };
    }
    function irPara(t) { if (!E.audio) return garantirAudio().then((a) => { if (a) { a.currentTime = t; acompanhar(); } }); E.audio.currentTime = Math.max(0, t); acompanhar(); }
    async function tocar() {
      const a = await garantirAudio(); if (!a) return; if (!a.paused) { a.pause(); return; }
      api.pausarStudio(); a.playbackRate = E.vel; await a.play().catch(() => {});
      if (!E.intervalo) E.intervalo = setInterval(() => { if (api.studioTocando() && E.audio && !E.audio.paused) { E.audio.pause(); return; } acompanhar(); }, 60);
    }

    // ── servidor ──
    function msg(t) { E.msg = t; const m = $("#cfMsg"); if (m) m.textContent = t; api.dica(t); }
    async function pedir(rota, form) {
      let resp; try { resp = await fetch(`${api.apiBase}${rota}`, { method: "POST", body: form }); } catch (e) { throw new Error("Não consegui falar com o servidor. Confira a conexão e tente de novo."); }
      if (!resp.ok) { let det = ""; try { det = (await resp.json()).detail || ""; } catch (e) { /* sem corpo */ } throw new Error(resp.status === 503 && !det ? "O servidor está ocupado com outra tarefa pesada. Tente de novo em instantes." : det || `O servidor respondeu com erro (${resp.status}).`); }
      return resp.json();
    }
    async function preparar() {
      const r = regiao(), full = await api.renderRegiao(r), n = Math.min(full.length, Math.round(300 * full.sampleRate));
      let buf = full; if (n < full.length) { buf = new (window.AudioBuffer)({ length: n, numberOfChannels: full.numberOfChannels, sampleRate: full.sampleRate }); for (let c = 0; c < full.numberOfChannels; c++) buf.copyToChannel(full.getChannelData(c).subarray(0, n), c); }
      return { wav: await paraWav22k(buf), cortou: n < full.length };
    }
    async function pedirLetra(wav, letra) {
      const fd = new FormData(); fd.append("arquivo", new File([wav], "cifra.wav", { type: "audio/wav" })); if (letra && letra.trim()) fd.append("letra", letra); return pedir("/api/transcricao/letra", fd);
    }
    async function analisar() {
      const r = regiao(); if (!r || E.ocupado) return; const c0 = $("#cfComLetra"); E.comLetra = c0 ? c0.checked : E.comLetra; const col = $("#cfColar"); E.colar = col ? col.value : E.colar;
      E.ocupado = true; E.msg = "Preparando o áudio…"; render(true);
      try {
        const { wav, cortou } = await preparar(); msg("Descobrindo o tom e os acordes… (alguns segundos)");
        const fd = new FormData(); fd.append("arquivo", new File([wav], "cifra.wav", { type: "audio/wav" })); const res = await pedir("/api/transcricao/acordes", fd);
        if (!res.acordes || !res.acordes.length) throw new Error(res.aviso || "Não identifiquei acordes nesta região.");
        const c = { versao: 1, sig: { buf: r.buf, off: r.off, dur: r.dur }, duracao: res.duracao, tom: res.tom, modo: res.modo, rotulo: res.rotulo, relativo: res.relativo, bpm: res.bpm, acordes: res.acordes.map((a) => ({ ini: a.ini, fim: a.fim, acorde: a.acorde, simples: a.simples, incerto: !!a.incerto, conf: a.conf })), linhas: [], avisos: [], criadoEm: Date.now() };
        if (res.aviso_duracao || cortou) c.avisos.push(res.aviso_duracao || "A região passa de 5 minutos: analisei só os 5 primeiros.");
        r.cifra = c; api.persistir(); E.ocupado = false; E.opc = { simples: true, transpor: 0 };
        if (E.comLetra) {
          E.ocupado = true; render(true); msg("Acordes prontos. Agora a IA está ouvindo a letra… (pode levar até 1 minuto)");
          try { const lt = await pedirLetra(wav, E.colar); c.linhas = lt.linhas || []; if (lt.avisos && lt.avisos.length) c.avisos.push(...lt.avisos); if (!c.linhas.length) c.avisoLetra = (lt.avisos && lt.avisos[0]) || "a IA não achou letra"; msg(c.linhas.length ? `Pronto: ${c.linhas.length} linhas de letra. Confira as palavras (a IA pode errar) e, se precisar, use “Editar a letra”.` : "Os acordes saíram, mas a letra não."); }
          catch (e) { c.avisoLetra = e.message; msg("Os acordes saíram, mas a letra não: " + e.message); }
          c.criadoEm = Date.now(); api.persistir();
        } else msg("Pronto: tom, andamento e acordes.");
      } catch (e) { msg(e.message || "Não consegui analisar."); }
      finally { E.ocupado = false; render(true); }
    }
    async function refazerLetra(letra) {
      const r = regiao(), c = cifraDe(r); if (!c || E.ocupado) return; letra = letra || "";
      E.ocupado = true; msg("A IA está ouvindo a letra… (pode levar até 1 minuto)"); render(true);
      try { const { wav } = await preparar(); const lt = await pedirLetra(wav, letra); c.linhas = lt.linhas || []; c.avisos = (lt.avisos || []).slice(); c.avisoLetra = c.linhas.length ? "" : (lt.avisos && lt.avisos[0]) || "a IA não achou letra"; c.criadoEm = Date.now(); api.persistir(); msg(c.linhas.length ? `Pronto: ${c.linhas.length} linhas de letra.` : "A IA não devolveu a letra."); }
      catch (e) { msg("Não consegui a letra: " + e.message); }
      finally { E.ocupado = false; render(true); }
    }

    // ── cliques e campos ──
    function lerEditor() { return Array.from(el.querySelectorAll(".cf-ed-t")).map((i) => i.value); }
    function salvarEditor(c) { const textos = lerEditor(); c.linhas = editarTextos(c.linhas, textos); }
    el.addEventListener("click", async (e) => {
      const t = e.target, r = regiao(), c = cifraDe(r);
      const alvo = t.closest("[data-t]"); if (alvo && !E.editando && c && (t.closest(".cf-pal") || t.closest(".cf-ac") || t.closest(".cf-linha"))) { irPara(parseFloat(alvo.dataset.t)); return; }
      if (t.id === "cfAnalisar" || t.id === "cfDeNovo") { if (t.id === "cfDeNovo" && r) { r.cifra = null; E.chave = ""; liberarAudio(); E.comLetra = true; E.msg = ""; render(true); } else analisar(); return; }
      if (t.id === "cfPlay") return tocar();
      if (t.id === "cfMenos" || t.id === "cfMais") { E.opc.transpor = Math.max(-11, Math.min(11, E.opc.transpor + (t.id === "cfMais" ? 1 : -1))); render(true); return; }
      if (t.id === "cfEditar") { E.editando = true; render(true); return; }
      if (t.id === "cfFimEd") { if (c) { salvarEditor(c); c.criadoEm = Date.now(); api.persistir(); } E.editando = false; render(true); return; }
      if (t.id === "cfLetraIA" && c) return refazerLetra("");
      if (t.id === "cfAlinhar" && c) { const col = $("#cfColarMais"), letra = col ? col.value : ""; if (!letra.trim()) { msg("Cole a letra primeiro (um verso por linha)."); return; } E.colar = letra; return refazerLetra(letra); }
      if (t.id === "cfCopiar" && c) { const txt = paraTexto(E.rows, { rotulo: transporTom(c.tom, c.modo, E.opc.transpor).rotulo, bpm: c.bpm }); try { await navigator.clipboard.writeText(txt); msg("Cifra copiada (acordes entre colchetes antes de cada palavra; os com ? são os incertos)."); } catch (err) { msg("Não consegui copiar automaticamente. Selecione o texto da cifra e copie."); } return; }
      if (t.id === "cfSalvar" && c) {
        const txt = paraTexto(E.rows, null), fd = new FormData(); fd.append("titulo", `${r.nome} (cifra)`); fd.append("tom", transporTom(c.tom, c.modo, E.opc.transpor).rotulo || ""); fd.append("letra", txt);
        try { const resp = await fetch(`${api.apiBase}/api/composicoes`, { method: "POST", body: fd }); if (!resp.ok) { let d = ""; try { d = (await resp.json()).detail; } catch (x) { /* ok */ } throw new Error(d || "erro " + resp.status); } msg("Salvo em Composições (Orange Create). Lá você edita a cifra e a letra."); } catch (err) { msg("Não consegui salvar em Composições: " + err.message); } return;
      }
      if (E.editando && c) {
        if (t.dataset.d) { salvarEditor(c); c.linhas = deslocar(c.linhas, parseFloat(t.dataset.d), c.duracao); render(true); api.persistir(); return; }
        if (t.dataset.marcar !== undefined) { salvarEditor(c); const i = +t.dataset.marcar, agora = E.audio ? E.audio.currentTime : 0, l = c.linhas[i], dur = l.fim - l.ini; l.ini = +agora.toFixed(2); l.fim = +Math.min(c.duracao, agora + dur).toFixed(2); render(true); return; }
        if (t.dataset.mais !== undefined) { salvarEditor(c); const i = +t.dataset.mais, l = c.linhas[i], meio = +((l.ini + l.fim) / 2).toFixed(2); c.linhas.splice(i + 1, 0, { ini: meio, fim: l.fim, texto: "nova linha" }); l.fim = meio; render(true); return; }
        if (t.dataset.del !== undefined) { salvarEditor(c); c.linhas.splice(+t.dataset.del, 1); render(true); return; }
      }
    });
    el.addEventListener("change", (e) => {
      const t = e.target, r = regiao(), c = cifraDe(r);
      if (t.id === "cfVel") { E.vel = +t.value; if (E.audio) { E.audio.defaultPlaybackRate = E.vel; E.audio.playbackRate = E.vel; E.audio.preservesPitch = true; E.audio.webkitPreservesPitch = true; } msg(`Velocidade ${Math.round(E.vel * 100)}%: o tom continua o mesmo.`); }
      else if (t.id === "cfRepetir") E.repetir = t.checked;
      else if (t.id === "cfSimples") { E.opc.simples = t.checked; render(true); }
      else if (t.id === "cfComLetra") E.comLetra = t.checked;
      else if (t.id === "cfPos" && E.audio) { E.audio.currentTime = +t.value; acompanhar(); }
    });
    el.addEventListener("input", (e) => { if (e.target.id === "cfColar" || e.target.id === "cfColarMais") E.colar = e.target.value; else if (e.target.id === "cfPos" && E.audio) { E.audio.currentTime = +e.target.value; acompanhar(); } });
    return { render, parar: liberarAudio, pausar() { if (E.audio) E.audio.pause(); }, _estado: E };
  }

  raiz.EstudioCifra = { criar, logica, paraWav22k, wavMono16 };
})(typeof window !== "undefined" ? window : globalThis);
