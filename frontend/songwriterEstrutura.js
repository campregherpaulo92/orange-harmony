// songwriterEstrutura.js — "Estrutura reconhecida" do Songwriter.
// A melodia ABC que o modelo devolve já traz a estrutura nos comentários (% intro, % verse, % chorus, % interlude…) e cada seção é feita de
// BLOCOS de 4 compassos (uma linha da voz + uma linha do instrumental). Aqui o app lê isso, deixa marcar o que SAI e o que se REPETE, e aplica
// os cortes por edição de TEXTO (nada é regravado nem reescrito por IA).
// Duas partes: (1) a LÓGICA (pura, testada em Node); (2) o PAINEL (só no navegador).
(function (raiz) {
  "use strict";
  const MIN_NOTAS_CANTADO = 4;                          // bloco com menos notas que isso é só um "ahh" solto, não uma linha de letra
  const NOMES = { intro: "Introdução", verse: "Verso", chorus: "Refrão", interlude: "Interlúdio", bridge: "Ponte", outro: "Final", prechorus: "Pré-refrão", solo: "Solo", instrumental: "Instrumental", breakdown: "Breakdown", inicio: "Início", musica: "Música" };
  const CONHECIDAS = new Set(["intro", "verse", "chorus", "interlude", "bridge", "outro", "prechorus", "pre-chorus", "solo", "instrumental", "breakdown"]);
  const semAcento = (t) => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

  // ───────── leitura da melodia ─────────
  function contarCompassos(linha) {
    const t = String(linha).replace(/"[^"]*"/g, "").replace(/\|\]|\|\||\|:|:\||::/g, "|");
    let n = 0;
    for (const tok of t.split("|")) {
      const s = tok.trim(); if (!s) continue;
      const m = /^Z(\d*)$/.exec(s);
      n += m ? (m[1] ? parseInt(m[1], 10) : 1) : 1;      // Z4 = quatro compassos de pausa
    }
    return n;
  }
  function contarNotas(linha) {
    const limpo = String(linha).replace(/"[^"]*"/g, "").replace(/![^!]*!/g, "").replace(/\{[^}]*\}/g, "").replace(/[zZxX]\d*(?:\/\d+)?/g, "");
    const m = limpo.match(/[=^_]*[A-Ga-g][,']*/g);
    return m ? m.length : 0;
  }
  const ehCampo = (l) => /^[A-Za-z]:/.test(l);            // K: M: L: Q: V: T: w: …
  const ehMusica = (l) => l.trim() !== "" && !/^\s*%/.test(l) && !ehCampo(l);

  function lerCampos(cabecalho) {
    let m = 4, n = 4, bpm = null, unidade = [1, 4], x;
    for (const l of cabecalho) {
      if ((x = /^M:\s*(\d+)\/(\d+)/.exec(l))) { m = +x[1]; n = +x[2]; }
      else if (/^M:\s*C\b/.test(l)) { m = 4; n = 4; }
      if ((x = /^Q:\s*(?:"[^"]*"\s*)?(\d+)\/(\d+)\s*=\s*(\d+(?:\.\d+)?)/.exec(l))) { unidade = [+x[1], +x[2]]; bpm = +x[3]; }
      else if ((x = /^Q:\s*(\d+(?:\.\d+)?)\s*$/.exec(l))) { unidade = [1, 4]; bpm = +x[1]; }
    }
    return { m, n, bpm, unidade };
  }
  const segundosPorCompasso = (c) => (c.bpm ? ((c.m / c.n) / (c.unidade[0] / c.unidade[1])) * 60 / c.bpm : null);

  function analisar(abc) {
    const texto = String(abc || "");
    const eol = texto.indexOf("\r\n") >= 0 ? "\r\n" : "\n";
    let linhas = texto.split(/\r?\n/), fimNL = false;
    if (linhas.length && linhas[linhas.length - 1] === "") { fimNL = true; linhas = linhas.slice(0, -1); }
    const k = linhas.findIndex((l) => /^K:/.test(l));
    if (k < 0) return { ok: false, motivo: "Não achei a linha do tom (K:) na melodia." };
    const cabecalho = linhas.slice(0, k + 1), campos = lerCampos(cabecalho);
    let vozPrincipal = null;
    for (const l of cabecalho) { const m = /^V:\s*(\S+)/.exec(l); if (m) { vozPrincipal = m[1]; break; } }
    const itens = [], blocos = [], secoes = [];
    let sec = null, bloco = null, voz = null;
    const novaSecao = (tipo, linhaMarca) => { sec = { id: secoes.length, tipo, linhaMarca, blocos: [] }; secoes.push(sec); itens.push({ t: "secao", id: sec.id }); bloco = null; };
    const novoBloco = () => {
      if (!sec) novaSecao("inicio", null);
      bloco = { id: blocos.length, secao: sec.id, linhas: [], compVoz: 0, compOutras: 0, notas: 0, campos: [], temMusica: false };
      blocos.push(bloco); sec.blocos.push(bloco.id); itens.push({ t: "bloco", id: bloco.id });
    };
    for (let i = k + 1; i < linhas.length; i++) {
      const l = linhas[i];
      let m;
      if ((m = /^\s*%\s*([A-Za-z][\w\- ]*?)\s*$/.exec(l)) && !/^\s*%%/.test(l) && CONHECIDAS.has(m[1].toLowerCase().replace(/\s+/g, ""))) {
        novaSecao(m[1].toLowerCase().replace(/\s+/g, "").replace("pre-chorus", "prechorus"), l); continue;
      }
      if ((m = /^V:\s*(\S+)/.exec(l))) {
        if (!vozPrincipal) vozPrincipal = m[1];
        voz = m[1];
        if (voz === vozPrincipal && (!bloco || bloco.temMusica)) novoBloco();   // a voz principal recomeçando = novo bloco de 4 compassos
        if (!bloco) novoBloco();
        bloco.linhas.push(l); continue;
      }
      if (l.trim() === "" && !bloco) { itens.push({ t: "texto", linha: l }); continue; }
      if (!bloco) novoBloco();
      bloco.linhas.push(l);
      if (/^[KMLQ]:/.test(l)) bloco.campos.push(l);
      if (ehMusica(l)) {
        bloco.temMusica = true;
        const n = contarCompassos(l);
        if (voz === vozPrincipal || voz === null) { bloco.compVoz += n; bloco.notas += contarNotas(l); } else bloco.compOutras += n;
      }
    }
    const avisos = [];
    for (const b of blocos) {
      b.compassos = b.compVoz || b.compOutras;
      b.cantado = b.notas >= MIN_NOTAS_CANTADO;
      if (b.compVoz && b.compOutras && b.compVoz !== b.compOutras) avisos.push(`O bloco ${b.id + 1} tem ${b.compVoz} compassos na voz e ${b.compOutras} no instrumental.`);
    }
    // rótulos e numeração; compassos globais de cada bloco (para bater com os números da Partitura)
    const total = {}; secoes.forEach((s) => { total[s.tipo] = (total[s.tipo] || 0) + 1; });
    const visto = {}; let globais = 1;
    secoes.forEach((s) => {
      visto[s.tipo] = (visto[s.tipo] || 0) + 1;
      const base = NOMES[s.tipo] || s.tipo;
      s.rotulo = total[s.tipo] > 1 ? `${base} ${visto[s.tipo]}` : (s.tipo === "inicio" && secoes.length === 1 ? NOMES.musica : base);   // sem nenhum comentário de seção: tudo é “Música”
      s.compassos = 0; s.cantados = 0;
      s.blocos.forEach((id) => { const b = blocos[id]; b.de = globais; b.ate = globais + b.compassos - 1; globais += b.compassos; s.compassos += b.compassos; if (b.cantado) s.cantados++; });
    });
    return { ok: true, eol, fimNL, cabecalho, campos, itens, blocos, secoes, avisos, compassosTotal: globais - 1, segundosPorCompasso: segundosPorCompasso(campos) };
  }

  // ───────── plano e reconstrução ─────────
  const marcasVazias = () => ({ b: {}, s: {} });
  function secaoTodaTirada(est, s, marcas) { return s.blocos.length > 0 && s.blocos.every((id) => marcas.b[id] === "tirar"); }

  // Sequência do que será emitido, na ordem: marcadores de seção, blocos (inclusive cópias) e linhas soltas.
  function plano(est, marcas) {
    marcas = marcas || marcasVazias();
    const seq = [];
    const emitirSecao = (s, copiaSecao) => {
      seq.push({ t: "marca", sec: s.id, copiaSecao });
      s.blocos.forEach((id) => {
        const m = marcas.b[id];
        if (m === "tirar") { if (est.blocos[id].campos.length) seq.push({ t: "campos", id }); return; }
        seq.push({ t: "bloco", id, sec: s.id, copia: false, copiaSecao });
        if (m === "repetir") seq.push({ t: "bloco", id, sec: s.id, copia: true, copiaSecao });
      });
    };
    est.itens.forEach((it) => {
      if (it.t === "texto") { seq.push({ t: "texto", linha: it.linha }); return; }
      if (it.t === "secao") {
        const s = est.secoes[it.id];
        if (secaoTodaTirada(est, s, marcas)) { s.blocos.forEach((id) => { if (est.blocos[id].campos.length) seq.push({ t: "campos", id }); }); return; }
        emitirSecao(s, false);
        if (marcas.s[s.id] === "repetir") emitirSecao(s, true);
        return;
      }
      // bloco que pertence a uma seção: já foi emitido junto da seção
    });
    return seq;
  }

  function tirarLigadura(linhas) {
    // última linha de música de cada voz no bloco: se terminar numa ligadura (…B2-|) que levaria a lugar nenhum, solta a ligadura
    const out = linhas.slice();
    const musicas = out.map((l, i) => (ehMusica(l) ? i : -1)).filter((i) => i >= 0);
    musicas.forEach((i, n) => {
      const proxima = musicas[n + 1];
      let entreVozes = proxima === undefined;
      if (!entreVozes) for (let j = i + 1; j < proxima; j++) if (/^V:/.test(out[j])) { entreVozes = true; break; }
      if (entreVozes) out[i] = out[i].replace(/-(\s*\|?[\]:|]*\s*)$/, "$1");
    });
    return out;
  }

  function reconstruir(est, marcas) {
    marcas = marcas || marcasVazias();
    const seq = plano(est, marcas), saida = est.cabecalho.slice();
    const info = { blocosTirados: 0, compassosTirados: 0, blocosRepetidos: 0, compassosRepetidos: 0, compassosFinal: 0 };
    est.blocos.forEach((b) => {
      if (marcas.b[b.id] === "tirar" || secaoTodaTirada(est, est.secoes[b.secao], marcas)) { info.blocosTirados++; info.compassosTirados += b.compassos; }
    });
    seq.forEach((e) => { if (e.t === "bloco" && (e.copia || e.copiaSecao)) { info.blocosRepetidos++; info.compassosRepetidos += est.blocos[e.id].compassos; } });   // cópias de bloco E de seção inteira
    const blocosEmitidos = seq.map((e, i) => (e.t === "bloco" ? i : -1)).filter((i) => i >= 0);
    seq.forEach((e, i) => {
      if (e.t === "texto") { saida.push(e.linha); return; }
      if (e.t === "marca") { const l = est.secoes[e.sec].linhaMarca; if (l !== null && l !== undefined) saida.push(l); return; }
      if (e.t === "campos") { est.blocos[e.id].campos.forEach((l) => saida.push(l)); return; }
      const b = est.blocos[e.id], pos = blocosEmitidos.indexOf(i), proximo = seq[blocosEmitidos[pos + 1]];
      info.compassosFinal += b.compassos;
      const continua = !proximo || (proximo.id === e.id + 1 && !proximo.copia);
      (continua ? b.linhas : tirarLigadura(b.linhas)).forEach((l) => saida.push(l));
    });
    const abc = saida.join(est.eol) + (est.fimNL ? est.eol : "");
    return Object.assign({ abc }, info);
  }

  // ───────── resumo, letra e conferência ─────────
  function resumo(est, marcas) {
    marcas = marcas || marcasVazias();
    const seq = plano(est, marcas), r = reconstruir(est, marcas);
    const saidas = []; let atual = null;
    seq.forEach((e) => {
      if (e.t === "marca") { const s = est.secoes[e.sec]; atual = { id: s.id, tipo: s.tipo, rotulo: s.rotulo + (e.copiaSecao ? " (repetida)" : ""), compassos: 0, linhas: 0 }; saidas.push(atual); }
      else if (e.t === "bloco") { const b = est.blocos[e.id]; if (!atual) { atual = { id: -1, tipo: "inicio", rotulo: "Início", compassos: 0, linhas: 0 }; saidas.push(atual); } atual.compassos += b.compassos; if (b.cantado) atual.linhas++; }
    });
    const spc = est.segundosPorCompasso;
    return {
      antes: { compassos: est.compassosTotal, segundos: spc ? est.compassosTotal * spc : null, linhas: est.blocos.filter((b) => b.cantado).length },
      depois: { compassos: r.compassosFinal, segundos: spc ? r.compassosFinal * spc : null, linhas: saidas.reduce((a, s) => a + s.linhas, 0) },
      tirados: { blocos: r.blocosTirados, compassos: r.compassosTirados }, repetidos: { blocos: r.blocosRepetidos, compassos: r.compassosRepetidos },
      secoes: saidas, temMarcas: Object.keys(marcas.b).length + Object.keys(marcas.s).length > 0,
    };
  }

  function tipoDeCabecalho(texto) {
    const t = semAcento(texto);
    if (/\bpre\b|pre-?refrao|pre-?chorus|prechorus/.test(t)) return "prechorus";
    if (/refrao|chorus|coro\b/.test(t)) return "chorus";
    if (/verso|verse|estrofe/.test(t)) return "verse";
    if (/ponte|bridge/.test(t)) return "bridge";
    if (/interludio|interlude/.test(t)) return "interlude";
    if (/\bintro/.test(t)) return "intro";
    if (/final|outro|fim\b/.test(t)) return "outro";
    if (/solo/.test(t)) return "solo";
    return null;
  }
  function contarLetra(letra) {
    const secoes = []; let atual = null, total = 0;
    String(letra || "").split(/\r?\n/).forEach((bruta) => {
      const l = bruta.trim(); if (!l) return;
      const m = /^\[(.+)\]$/.exec(l) || /^#\s*(.+)$/.exec(l);
      if (m) { atual = { nome: m[1].trim(), tipo: tipoDeCabecalho(m[1]), linhas: 0 }; secoes.push(atual); return; }
      if (!atual) { atual = { nome: "(sem título de seção)", tipo: null, linhas: 0, implicita: true }; secoes.push(atual); }
      atual.linhas++; total++;
    });
    return { total, secoes: secoes.filter((s) => s.linhas > 0 || !s.implicita), temCabecalhos: secoes.some((s) => !s.implicita) };
  }
  // Confere a letra com o que a melodia pede (já considerando o plano de cortes). Devolve {nivel:'ok'|'aviso'|'', texto, linhas:[…]}.
  function conferirLetra(est, marcas, letra) {
    const res = resumo(est, marcas), pedidas = res.secoes.filter((s) => s.linhas > 0), cl = contarLetra(letra);
    if (!cl.total) return { nivel: "", texto: `A melodia pede cerca de ${res.depois.linhas} linhas de letra.`, linhas: [] };
    const linhas = [];
    if (cl.temCabecalhos && cl.secoes.some((s) => s.tipo)) {
      const dela = cl.secoes.filter((s) => s.linhas > 0);
      let tudoCerto = pedidas.length === dela.length;
      pedidas.forEach((p, i) => {
        const d = dela[i];
        if (!d) { linhas.push({ ok: false, texto: `${p.rotulo}: a melodia pede ${p.linhas} linhas e a sua letra não tem essa parte.` }); tudoCerto = false; }
        else if (d.linhas !== p.linhas) { linhas.push({ ok: false, texto: `${p.rotulo}: a melodia pede ${p.linhas} linhas, a sua letra tem ${d.linhas}.` }); tudoCerto = false; }
        else linhas.push({ ok: true, texto: `${p.rotulo}: ${p.linhas} linhas ✓` });
      });
      for (let i = pedidas.length; i < dela.length; i++) { linhas.push({ ok: false, texto: `Sobra uma parte na letra (“${dela[i].nome}”, ${dela[i].linhas} linhas) sem melodia.` }); tudoCerto = false; }
      return { nivel: tudoCerto ? "ok" : "aviso", texto: tudoCerto ? `A letra bate com a melodia (${cl.total} linhas).` : `A letra não bate com a melodia em alguma parte (sua letra tem ${cl.total} linhas, a melodia pede cerca de ${res.depois.linhas}).`, linhas };
    }
    const dif = res.depois.linhas ? Math.abs(cl.total - res.depois.linhas) / res.depois.linhas : 0;
    return dif > 0.3
      ? { nivel: "aviso", texto: `A sua letra tem ${cl.total} linhas e a melodia pede cerca de ${res.depois.linhas}; pode encaixar mal. (Dica: marque as partes da letra com [Verso], [Refrão]… para eu conferir parte por parte.)`, linhas }
      : { nivel: "ok", texto: `A sua letra tem ${cl.total} linhas e a melodia pede cerca de ${res.depois.linhas}.`, linhas };
  }
  function modeloLetra(est, marcas) {
    const out = [];
    resumo(est, marcas).secoes.filter((s) => s.linhas > 0).forEach((s) => {
      out.push(`[${s.rotulo.replace(" (repetida)", "")}]`);
      for (let i = 1; i <= s.linhas; i++) out.push(`(linha ${i})`);
      out.push("");
    });
    return out.join("\n").trim() + "\n";
  }
  function tempo(seg) { if (seg == null) return ""; const m = Math.floor(seg / 60), s = Math.round(seg - m * 60); return `${m}:${String(s).padStart(2, "0")}`; }

  const logica = { analisar, plano, reconstruir, resumo, contarLetra, conferirLetra, modeloLetra, contarCompassos, contarNotas, marcasVazias, tempo, tipoDeCabecalho, MIN_NOTAS_CANTADO };
  if (typeof module !== "undefined" && module.exports) { module.exports = { logica }; return; }

  // ═════════════════════════ O PAINEL (só no navegador) ═════════════════════════
  const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const CICLO = { undefined: "tirar", tirar: "repetir", repetir: undefined };

  function criar(el, api) {
    const E = { base: "", original: "", est: null, marcas: marcasVazias(), msg: "" };
    el.innerHTML = `<p class="oh-label-campo"><i class="oh-ic" data-ic="mix"></i> Estrutura reconhecida: marque o que sai e o que se repete</p>
      <p class="oh-hint">Cada quadradinho é um bloco de 4 compassos (cheio = tem voz cantando; vazio = só instrumental). Clique para mudar: <b class="sw-leg fica">fica</b> → <b class="sw-leg tirar">tirar</b> → <b class="sw-leg repetir">repetir</b>.</p>
      <div class="sw-estr" id="swEstrLista"></div>
      <p class="oh-hint" id="swEstrResumo"></p>
      <p class="oh-hint" id="swEstrLetra" role="status"></p>
      <div class="oh-row sw-estr-botoes"><button type="button" class="oh-btn" id="swEstrAplicar">Aplicar à melodia</button><button type="button" class="oh-btn oh-btn-secundario" id="swEstrOriginal">Voltar ao original</button><button type="button" class="oh-btn oh-btn-secundario" id="swEstrModelo">Copiar modelo da letra</button></div>
      <p class="oh-hint" id="swEstrMsg" role="status"></p>`;
    const $ = (s) => el.querySelector(s);

    function render() {
      const est = E.est;
      if (!est) { el.hidden = true; return; }
      el.hidden = false;
      if (!est.ok) { $("#swEstrLista").innerHTML = `<p class="sw-estr-vazio">${esc(est.motivo)} Para esta melodia, edite pela aba Partitura.</p>`; $("#swEstrResumo").textContent = ""; $("#swEstrLetra").textContent = ""; $("#swEstrAplicar").disabled = $("#swEstrModelo").disabled = true; $("#swEstrOriginal").disabled = E.base === E.original; return; }
      $("#swEstrLista").innerHTML = est.secoes.map((s) => {
        const rep = E.marcas.s[s.id] === "repetir", tirada = secaoTodaTirada(est, s, E.marcas);
        return `<div class="sw-sec${tirada ? " tirada" : ""}${rep ? " repetida" : ""}" data-s="${s.id}">
          <div class="sw-sec-cab"><b>${esc(s.rotulo)}</b><span>${s.compassos} compassos${s.cantados ? ` · pede ${s.cantados} ${s.cantados === 1 ? "linha" : "linhas"} de letra` : " · instrumental"}</span>
            <button type="button" class="sw-mini" data-a="tirar-sec" title="Tira a seção inteira">${tirada ? "Tirada ✕" : "Tirar seção"}</button><button type="button" class="sw-mini" data-a="rep-sec" title="Repete a seção inteira logo depois dela">${rep ? "Repetida ✓" : "Repetir seção"}</button><button type="button" class="sw-mini" data-a="limpar-sec" title="Desmarca esta seção">Desmarcar</button></div>
          <div class="sw-blocos">${s.blocos.map((id) => { const b = est.blocos[id], m = E.marcas.b[id] || "fica", rot = m === "tirar" ? "sai" : m === "repetir" ? "repete" : "fica";
            return `<button type="button" class="sw-bl ${b.cantado ? "cheio" : "vazio"} ${m}" data-b="${id}" title="Compassos ${b.de} a ${b.ate} · ${b.cantado ? "com voz" : "só instrumental"} · ${rot}. Clique para mudar." aria-label="${esc(s.rotulo)}, compassos ${b.de} a ${b.ate}, ${b.cantado ? "com voz" : "só instrumental"}, ${rot}">${b.de}–${b.ate}</button>`; }).join("")}</div></div>`;
      }).join("");
      const r = resumo(est, E.marcas), h = (x) => `${x.compassos} compassos${x.segundos != null ? ` (≈ ${tempo(x.segundos)})` : ""}`;
      $("#swEstrResumo").textContent = r.temMarcas
        ? `Plano: tirar ${r.tirados.blocos} ${r.tirados.blocos === 1 ? "bloco" : "blocos"} (${r.tirados.compassos} compassos) e repetir ${r.repetidos.blocos} (${r.repetidos.compassos}). A melodia iria de ${h(r.antes)} para ${h(r.depois)}; passaria a pedir cerca de ${r.depois.linhas} linhas de letra.`
        : `Sem alterações marcadas. A melodia tem ${h(r.antes)} e pede cerca de ${r.antes.linhas} linhas de letra.`;
      const vazia = r.depois.compassos === 0;
      if (vazia) E.msg = "Com esse plano a melodia ficaria vazia. Deixe pelo menos um bloco.";
      $("#swEstrAplicar").disabled = !r.temMarcas || vazia; $("#swEstrModelo").disabled = false; $("#swEstrOriginal").disabled = E.base === E.original;
      atualizarLetra();
      $("#swEstrMsg").textContent = E.msg;
    }
    function atualizarLetra() {
      const p = $("#swEstrLetra"); if (!E.est || !E.est.ok) { p.textContent = ""; return; }
      const c = conferirLetra(E.est, E.marcas, api.lerLetra ? api.lerLetra() : "");
      p.className = "oh-hint sw-conf " + (c.nivel || "");
      p.innerHTML = esc((c.nivel === "aviso" ? "⚠️ " : c.nivel === "ok" ? "✅ " : "") + c.texto) + (c.linhas.length ? `<br>${c.linhas.map((x) => esc(x.texto)).join("<br>")}` : "");
    }

    function carregar(abc, opc) {
      opc = opc || {};
      if (!abc || !String(abc).trim()) { E.est = null; E.base = ""; render(); return; }
      E.base = String(abc); if (!opc.reenvio || !E.original) E.original = E.base;
      E.est = analisar(E.base); E.marcas = marcasVazias(); E.msg = ""; render();
    }
    el.addEventListener("click", (e) => {
      const t = e.target.closest("button"); if (!t || !E.est || !E.est.ok) return;
      E.msg = "";
      if (t.dataset.b !== undefined) { const id = +t.dataset.b, prox = CICLO[E.marcas.b[id]]; if (prox) E.marcas.b[id] = prox; else delete E.marcas.b[id]; render(); return; }
      const sid = t.closest(".sw-sec") ? +t.closest(".sw-sec").dataset.s : null;
      if (t.dataset.a === "tirar-sec") { const s = E.est.secoes[sid]; if (secaoTodaTirada(E.est, s, E.marcas)) s.blocos.forEach((id) => delete E.marcas.b[id]); else { s.blocos.forEach((id) => { E.marcas.b[id] = "tirar"; }); delete E.marcas.s[sid]; } render(); return; }
      if (t.dataset.a === "rep-sec") { if (E.marcas.s[sid]) delete E.marcas.s[sid]; else E.marcas.s[sid] = "repetir"; render(); return; }
      if (t.dataset.a === "limpar-sec") { E.est.secoes[sid].blocos.forEach((id) => delete E.marcas.b[id]); delete E.marcas.s[sid]; render(); return; }
      if (t.id === "swEstrAplicar") {
        const r = reconstruir(E.est, E.marcas); api.aplicarAbc(r.abc);
        E.msg = `Cortes aplicados: tirei ${r.compassosTirados} compassos e repeti ${r.compassosRepetidos}. A melodia acima já está atualizada (agora com ${r.compassosFinal} compassos). Se quiser desfazer, use “Voltar ao original”.`;
        E.base = r.abc; E.est = analisar(E.base); E.marcas = marcasVazias(); render(); return;
      }
      if (t.id === "swEstrOriginal") { api.aplicarAbc(E.original); E.base = E.original; E.est = analisar(E.base); E.marcas = marcasVazias(); E.msg = "Voltei à melodia original."; render(); return; }
      if (t.id === "swEstrModelo") {
        const txt = modeloLetra(E.est, E.marcas);
        (api.copiar ? api.copiar(txt) : Promise.resolve(false)).then((ok) => { E.msg = ok ? "Modelo da letra copiado: cole no campo “Letra” e escreva a sua letra em cada parte." : "Não consegui copiar sozinho. O modelo é:\n" + txt; render(); });
      }
    });
    return {
      carregar,
      aoEditarMelodia(valor) { if (!E.original) E.original = valor; E.base = String(valor || ""); E.est = E.base.trim() ? analisar(E.base) : null; E.marcas = marcasVazias(); E.msg = ""; render(); },
      atualizarLetra,
      temEstrutura: () => !!(E.est && E.est.ok),
      temMarcasPendentes: () => !!(E.est && E.est.ok && resumo(E.est, E.marcas).temMarcas),
      avisoDeMetrica(letra) { if (!E.est || !E.est.ok) return ""; const c = conferirLetra(E.est, E.marcas, letra); return c.nivel === "aviso" ? "⚠️ " + c.texto : ""; },
      _estado: E,
    };
  }
  raiz.SongwriterEstrutura = { criar, logica };
})(typeof window !== "undefined" ? window : globalThis);
