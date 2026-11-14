// songwriterEstrutura.js — "Mapa da música" do Songwriter.
// A melodia ABC que o modelo devolve traz a estrutura nos comentários (% intro, % verse, % chorus, % interlude…) e cada seção é feita de
// BLOCOS de 4 compassos (uma linha da voz + uma linha do instrumental). O modelo só diz "verse" ou "chorus"; por isso o app também compara as
// melodias dos blocos (o que se repete) para SUGERIR as partes de verdade (verso, pré-refrão…). Quem corta, copia e tira por tempo é edição de
// TEXTO da melodia: nada é regravado nem reescrito por IA.
// Duas partes: (1) a LÓGICA (pura, testada em Node); (2) o PAINEL (só no navegador).
(function (raiz) {
  "use strict";
  const MIN_NOTAS_CANTADO = 4;                          // bloco com menos notas que isso é só um "ahh" solto, não uma linha de letra
  const SEMELHANCA = 0.8;                               // melodias com 80% das notas iguais contam como a mesma melodia
  const NOMES = { intro: "Introdução", verse: "Verso", chorus: "Refrão", interlude: "Interlúdio", bridge: "Ponte", outro: "Final", prechorus: "Pré-refrão", solo: "Solo", instrumental: "Instrumental", breakdown: "Breakdown", inicio: "Início", musica: "Música" };
  const CONHECIDAS = new Set(["intro", "verse", "chorus", "interlude", "bridge", "outro", "prechorus", "pre-chorus", "solo", "instrumental", "breakdown"]);
  const lin = (n) => (n === 1 ? "1 linha" : `${n} linhas`);
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
  function tokensNotas(linha) {
    const limpo = String(linha).replace(/"[^"]*"/g, "").replace(/![^!]*!/g, "").replace(/\{[^}]*\}/g, "").replace(/[zZxX]\d*(?:\/\d+)?/g, "");
    return limpo.match(/[=^_]*[A-Ga-g][,']*/g) || [];
  }
  const contarNotas = (linha) => tokensNotas(linha).length;
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
      bloco = { id: blocos.length, secao: sec.id, linhas: [], compVoz: 0, compOutras: 0, notas: 0, notasSeq: [], campos: [], temMusica: false };
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
        if (voz === vozPrincipal || voz === null) { bloco.compVoz += n; const tk = tokensNotas(l); bloco.notas += tk.length; bloco.notasSeq.push(...tk); } else bloco.compOutras += n;
      }
    }
    const avisos = [];
    for (const b of blocos) {
      b.compassos = b.compVoz || b.compOutras;
      b.cantado = b.notas >= MIN_NOTAS_CANTADO;
      if (b.compVoz && b.compOutras && b.compVoz !== b.compOutras) avisos.push(`O bloco ${b.id + 1} tem ${b.compVoz} compassos na voz e ${b.compOutras} no instrumental.`);
    }
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
  // marcas = { b: {idBloco: "tirar"|"repetir"}, s: {idSeção: "repetir"}, copias: [{ blocos:[ids], depoisDe: idBloco, comMarca, secao, parte }] }
  const marcasVazias = () => ({ b: {}, s: {}, copias: [] });
  function secaoTodaTirada(est, s, marcas) { return s.blocos.length > 0 && s.blocos.every((id) => marcas.b[id] === "tirar"); }

  // Sequência do que será emitido, na ordem: marcadores de seção, blocos (inclusive cópias) e linhas soltas.
  function plano(est, marcas) {
    marcas = marcas || marcasVazias();
    const seq = [], apos = {};
    (marcas.copias || []).forEach((c, ci) => { (apos[c.depoisDe] = apos[c.depoisDe] || []).push(Object.assign({ ci }, c)); });
    const emitirCopias = (idBloco) => (apos[idBloco] || []).forEach((c) => {
      if (c.comMarca) seq.push({ t: "marca", sec: c.secao, copiaSecao: true, copiaDe: c.parte, grupo: c.ci });
      c.blocos.forEach((id) => seq.push({ t: "bloco", id, sec: est.blocos[id].secao, copia: true, copiaDe: c.parte, grupo: c.ci }));
    });
    const emitirSecao = (s, copiaSecao) => {
      seq.push({ t: "marca", sec: s.id, copiaSecao });
      s.blocos.forEach((id) => {
        const m = marcas.b[id];
        if (m === "tirar") { if (est.blocos[id].campos.length) seq.push({ t: "campos", id }); if (!copiaSecao) emitirCopias(id); return; }
        seq.push({ t: "bloco", id, sec: s.id, copia: false, copiaSecao });
        if (m === "repetir") seq.push({ t: "bloco", id, sec: s.id, copia: true, copiaSecao });
        if (!copiaSecao) emitirCopias(id);
      });
    };
    est.itens.forEach((it) => {
      if (it.t === "texto") { seq.push({ t: "texto", linha: it.linha }); return; }
      if (it.t === "secao") {
        const s = est.secoes[it.id];
        if (secaoTodaTirada(est, s, marcas)) { s.blocos.forEach((id) => { if (est.blocos[id].campos.length) seq.push({ t: "campos", id }); emitirCopias(id); }); return; }
        emitirSecao(s, false);
        if (marcas.s && marcas.s[s.id] === "repetir") emitirSecao(s, true);
      }
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
    seq.forEach((e) => { if (e.t === "bloco" && (e.copia || e.copiaSecao)) { info.blocosRepetidos++; info.compassosRepetidos += est.blocos[e.id].compassos; } });   // cópias de bloco, de parte e de seção inteira
    const blocosEmitidos = seq.map((e, i) => (e.t === "bloco" ? i : -1)).filter((i) => i >= 0);
    seq.forEach((e, i) => {
      if (e.t === "texto") { saida.push(e.linha); return; }
      if (e.t === "marca") { const l = est.secoes[e.sec].linhaMarca; if (l !== null && l !== undefined) saida.push(l); return; }
      if (e.t === "campos") { est.blocos[e.id].campos.forEach((l) => saida.push(l)); return; }
      const b = est.blocos[e.id], pos = blocosEmitidos.indexOf(i), proximo = seq[blocosEmitidos[pos + 1]];
      info.compassosFinal += b.compassos;
      const continua = !proximo || proximo.id === e.id + 1;          // a ligadura só vale se o próximo bloco tocado é, de fato, o seguinte da melodia
      (continua ? b.linhas : tirarLigadura(b.linhas)).forEach((l) => saida.push(l));
    });
    const abc = saida.join(est.eol) + (est.fimNL ? est.eol : "");
    return Object.assign({ abc }, info);
  }

  // ───────── tempo ─────────
  function tempo(seg) { if (seg == null) return ""; const t = Math.round(seg), m = Math.floor(t / 60); return `${m}:${String(t - m * 60).padStart(2, "0")}`; }
  function parseTempo(s) {
    s = String(s == null ? "" : s).trim().replace(",", "."); let m;
    if ((m = /^(\d+):(\d{1,2})(?:\.(\d+))?$/.exec(s))) return +m[2] >= 60 ? NaN : +m[1] * 60 + +m[2] + (m[3] ? +("0." + m[3]) : 0);
    if ((m = /^(\d+(?:\.\d+)?)$/.exec(s))) return +m[1];
    return NaN;
  }
  function faixaDeBlocos(est, ids) {
    if (!ids || !ids.length) return null;
    const de = Math.min(...ids.map((id) => est.blocos[id].de)), ate = Math.max(...ids.map((id) => est.blocos[id].ate)), spc = est.segundosPorCompasso;
    return { de, ate, compassos: ids.reduce((a, id) => a + est.blocos[id].compassos, 0), ini: spc ? (de - 1) * spc : null, fim: spc ? ate * spc : null };
  }
  // Blocos que cabem no intervalo de tempo: entra o bloco que tem pelo menos metade dentro do intervalo.
  function blocosNoIntervalo(est, deSeg, ateSeg) {
    const spc = est.segundosPorCompasso;
    if (!spc || !(ateSeg > deSeg)) return null;
    return est.blocos.filter((b) => { const ini = (b.de - 1) * spc, fim = b.ate * spc, so = Math.min(fim, ateSeg) - Math.max(ini, deSeg); return so >= (fim - ini) / 2; }).map((b) => b.id);
  }

  // ───────── partes (verso, pré-refrão…) sugeridas pela repetição de melodia ─────────
  function lev(a, b) {
    const m = a.length, n = b.length; let ant = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) { const atual = [i]; for (let j = 1; j <= n; j++) atual[j] = Math.min(ant[j] + 1, atual[j - 1] + 1, ant[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); ant = atual; }
    return ant[n];
  }
  const semelhanca = (a, b) => 1 - lev(a, b) / (Math.max(a.length, b.length) || 1);
  function agruparMelodias(est) {                       // dá a cada bloco cantado o número da sua "melodia" (blocos parecidos = mesmo número)
    const reps = [];
    est.blocos.forEach((b) => {
      if (!b.cantado) { b.melodia = null; return; }
      let k = reps.findIndex((r) => semelhanca(r, b.notasSeq) >= SEMELHANCA);
      if (k < 0) { reps.push(b.notasSeq); k = reps.length - 1; }
      b.melodia = k;
    });
  }
  // Divide uma seção onde a melodia muda de "família": os dois lados com pelo menos 2 blocos cantados, sem nenhuma melodia em comum
  // e com repetição em pelo menos um dos lados (senão um refrão A-B-C-D seria cortado ao meio sem motivo).
  function dividirSecao(est, ids, prof) {
    if (prof >= 3) return [ids];
    for (let i = 1; i < ids.length; i++) {
      const esq = ids.slice(0, i).filter((id) => est.blocos[id].cantado), dir = ids.slice(i).filter((id) => est.blocos[id].cantado);
      if (esq.length < 2 || dir.length < 2) continue;
      const ce = esq.map((id) => est.blocos[id].melodia), cd = dir.map((id) => est.blocos[id].melodia);
      if (ce.some((c) => cd.includes(c))) continue;
      const repete = (a) => new Set(a).size < a.length;
      if (!repete(ce) && !repete(cd)) continue;
      const corte = ids.indexOf(dir[0]);
      return [...dividirSecao(est, ids.slice(0, corte), prof + 1), ...dividirSecao(est, ids.slice(corte), prof + 1)];
    }
    return [ids];
  }
  function sugerirPartes(est) {
    agruparMelodias(est);
    const partes = [];
    est.secoes.forEach((sec) => { if (sec.blocos.length) dividirSecao(est, sec.blocos, 0).forEach((ids) => partes.push({ blocos: ids, secao: sec.id, tipo: sec.tipo, nome: sec.rotulo, sugerida: false })); });
    // pré-refrão: a melodia nova no fim de verso que vem antes do refrão e que se repete nos versos
    const doTipo = (p) => est.secoes[p.secao];
    const cands = [];
    partes.forEach((p, k) => {
      const irmas = partes.filter((q) => q.secao === p.secao);
      const ultima = irmas[irmas.length - 1] === p, prox = est.secoes[p.secao + 1];
      if (doTipo(p).tipo === "verse" && irmas.length > 1 && ultima && prox && prox.tipo === "chorus") cands.push(new Set(p.blocos.filter((id) => est.blocos[id].cantado).map((id) => est.blocos[id].melodia)));
    });
    const cont = {}; cands.forEach((s) => s.forEach((c) => { cont[c] = (cont[c] || 0) + 1; }));
    const limiar = Math.max(1, Math.ceil(cands.length / 2));
    const pre = new Set(Object.keys(cont).filter((c) => cont[c] >= limiar).map(Number));
    partes.forEach((p) => {
      const irmas = partes.filter((q) => q.secao === p.secao), cant = p.blocos.filter((id) => est.blocos[id].cantado);
      p.pre = doTipo(p).tipo === "verse" && irmas.length > 1 && cant.length > 0 && cant.every((id) => pre.has(est.blocos[id].melodia));
    });
    const totalPre = partes.filter((p) => p.pre).length; let nPre = 0;
    partes.forEach((p) => {
      const sec = doTipo(p), irmas = partes.filter((q) => q.secao === p.secao && !q.pre);
      if (p.pre) { nPre++; p.tipo = "prechorus"; p.sugerida = true; p.nome = `Pré-refrão${totalPre > 1 ? " " + nPre : ""} (provável)`; }
      else { p.nome = irmas.length > 1 ? `${sec.rotulo} (parte ${irmas.indexOf(p) + 1})` : sec.rotulo; p.sugerida = partes.filter((q) => q.secao === p.secao).length > 1; }
    });
    partes.forEach((p) => { delete p.pre; });
    return partes.map((p, id) => Object.assign({ id }, p));
  }
  const clonarPartes = (partes) => partes.map((p) => Object.assign({}, p, { blocos: p.blocos.slice() }));
  function renomearParte(partes, k, nome) { const n = clonarPartes(partes); n[k].nome = String(nome || "").trim() || n[k].nome; n[k].sugerida = false; return n; }
  // Divide a parte k no ponto de 4 compassos mais próximo do tempo pedido. Devolve { partes, em } ou { erro }.
  function dividirParte(est, partes, k, seg) {
    const p = partes[k], spc = est.segundosPorCompasso;
    if (!p || p.blocos.length < 2) return { erro: "Esta parte tem só um bloco de 4 compassos; não dá para dividir mais." };
    if (!spc || !(seg >= 0)) return { erro: "Escreva um tempo dentro desta parte, assim: 0:45." };
    let melhor = 1, dist = Infinity;
    for (let i = 1; i < p.blocos.length; i++) { const d = Math.abs((est.blocos[p.blocos[i]].de - 1) * spc - seg); if (d < dist) { dist = d; melhor = i; } }
    const n = clonarPartes(partes), a = p.blocos.slice(0, melhor), b = p.blocos.slice(melhor);
    n[k].blocos = a; n[k].sugerida = false;
    n.splice(k + 1, 0, { id: 0, blocos: b, secao: p.secao, tipo: p.tipo, nome: `${p.nome.replace(/ \(provável\)$/, "")} (continuação)`, sugerida: false });
    n.forEach((x, i) => { x.id = i; });
    return { partes: n, em: (est.blocos[b[0]].de - 1) * spc };
  }
  function juntarParte(partes, k) {
    if (k < 1 || !partes[k] || partes[k - 1].secao !== partes[k].secao) return null;       // só junta partes da mesma seção do modelo
    const n = clonarPartes(partes); n[k - 1].blocos = n[k - 1].blocos.concat(n[k].blocos); n[k - 1].sugerida = false; n.splice(k, 1); n.forEach((x, i) => { x.id = i; }); return n;
  }

  // Monta as marcas a partir do que a pessoa escolheu: acoes = { [indiceDaParte]: {tipo:"tirar"} | {tipo:"copiar", depoisDe: indiceDaParte} }, trechos = [{blocos:[ids]}]
  function montarMarcas(est, partes, acoes, trechos) {
    const marcas = marcasVazias(), fora = new Set();
    (trechos || []).forEach((t) => (t.blocos || []).forEach((id) => fora.add(id)));
    partes.forEach((p, k) => { if (acoes[k] && acoes[k].tipo === "tirar") p.blocos.forEach((id) => fora.add(id)); });
    fora.forEach((id) => { marcas.b[id] = "tirar"; });
    partes.forEach((p, k) => {
      const a = acoes[k]; if (!a || a.tipo !== "copiar") return;
      const quais = p.blocos.filter((id) => !fora.has(id)); if (!quais.length) return;
      const dest = partes[a.depoisDe != null ? a.depoisDe : k] || p;
      marcas.copias.push({ blocos: quais, depoisDe: dest.blocos[dest.blocos.length - 1], comMarca: p.blocos.length === est.secoes[p.secao].blocos.length && quais.length === p.blocos.length, secao: p.secao, parte: k });
    });
    marcas.copias.sort((x, y) => x.parte - y.parte);
    return marcas;
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
    return montarResumo(est, r, saidas, marcas.b, marcas.s, marcas.copias);
  }
  function montarResumo(est, r, saidas, mb, ms, mc) {
    const spc = est.segundosPorCompasso;
    return {
      antes: { compassos: est.compassosTotal, segundos: spc ? est.compassosTotal * spc : null, linhas: est.blocos.filter((b) => b.cantado).length },
      depois: { compassos: r.compassosFinal, segundos: spc ? r.compassosFinal * spc : null, linhas: saidas.reduce((a, s) => a + s.linhas, 0) },
      tirados: { blocos: r.blocosTirados, compassos: r.compassosTirados }, repetidos: { blocos: r.blocosRepetidos, compassos: r.compassosRepetidos },
      secoes: saidas, temMarcas: Object.keys(mb || {}).length + Object.keys(ms || {}).length + (mc || []).length > 0,
    };
  }
  // O mesmo resumo, mas as "seções de saída" são as PARTES (com os nomes que a pessoa vê e pode mudar), inclusive as cópias.
  function resumoPartes(est, partes, marcas) {
    marcas = marcas || marcasVazias();
    const seq = plano(est, marcas), r = reconstruir(est, marcas), parteDe = {};
    partes.forEach((p, k) => p.blocos.forEach((id) => { parteDe[id] = k; }));
    const saidas = []; let atual = null, chave = null;
    seq.forEach((e) => {
      if (e.t !== "bloco") return;
      const k = e.copia ? e.copiaDe : parteDe[e.id], ch = (e.copia ? "c" + e.grupo : "o") + ":" + k;
      if (ch !== chave) { chave = ch; const nome = partes[k].nome + (e.copia && !/ \(cópia\)$/.test(partes[k].nome) ? " (cópia)" : ""); atual = { parte: k, nome, rotulo: nome, tipo: partes[k].tipo, copia: !!e.copia, compassos: 0, linhas: 0, nBlocos: 0 }; saidas.push(atual); }
      const b = est.blocos[e.id]; atual.compassos += b.compassos; atual.nBlocos++; if (b.cantado) atual.linhas++;
    });
    return montarResumo(est, r, saidas, marcas.b, marcas.s, marcas.copias);
  }
  // Depois de aplicar, as partes que sobraram (e as cópias) mantêm os NOMES que tinham, em vez de o app sugerir tudo de novo.
  // Devolve as partes novas, ou null se a conta não fechar (aí o app volta a sugerir).
  function partesAposAplicar(est, partes, marcas, novoEst) {
    if (!novoEst || !novoEst.ok) return null;
    const novas = []; let idx = 0;
    for (const g of resumoPartes(est, partes, marcas).secoes) {
      const base = partes[g.parte]; let resto = g.nBlocos;
      while (resto > 0) {
        const b0 = novoEst.blocos[idx]; if (!b0) return null;
        let n = 0; while (n < resto && novoEst.blocos[idx + n] && novoEst.blocos[idx + n].secao === b0.secao) n++;
        novas.push({ id: novas.length, blocos: Array.from({ length: n }, (_, i) => idx + i), secao: b0.secao, tipo: base.tipo, nome: g.nome, sugerida: base.sugerida });
        idx += n; resto -= n;
      }
    }
    return idx === novoEst.blocos.length ? novas : null;
  }
  // Frases em português do que vai acontecer.
  function descreverPlano(est, partes, acoes, trechos) {
    const out = [], faixa = (ids) => { const f = faixaDeBlocos(est, ids); return f && f.ini != null ? `${tempo(f.ini)}–${tempo(f.fim)}` : `compassos ${f.de}–${f.ate}`; };
    partes.forEach((p, k) => {
      const a = acoes[k]; if (!a) return;
      if (a.tipo === "tirar") out.push(`Tirar “${p.nome}” (${faixa(p.blocos)}).`);
      else if (a.tipo === "copiar") {
        const d = a.depoisDe != null ? a.depoisDe : k;
        out.push(`Copiar “${p.nome}” (${faixa(p.blocos)}) e colocar ${d === k ? "logo depois dela" : `depois de “${partes[d].nome}”`}.`);
      }
    });
    (trechos || []).forEach((t) => { if (t.blocos && t.blocos.length) out.push(`Tirar o trecho de ${faixa(t.blocos)} (${t.blocos.length} ${t.blocos.length === 1 ? "bloco" : "blocos"} de 4 compassos).`); });
    return out;
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
  // Confere a letra com o que a melodia pede (já considerando o plano). Devolve {nivel:'ok'|'aviso'|'', texto, linhas:[…]}.
  function conferir(res, letra) {
    const pedidas = res.secoes.filter((s) => s.linhas > 0), cl = contarLetra(letra);
    if (!cl.total) return { nivel: "", texto: `A melodia pede cerca de ${lin(res.depois.linhas)} de letra.`, linhas: [] };
    const linhas = [];
    if (cl.temCabecalhos && cl.secoes.some((s) => s.tipo)) {
      const dela = cl.secoes.filter((s) => s.linhas > 0);
      let tudoCerto = pedidas.length === dela.length;
      pedidas.forEach((p, i) => {
        const d = dela[i];
        if (!d) { linhas.push({ ok: false, texto: `${p.rotulo}: a melodia pede ${lin(p.linhas)} e a sua letra não tem essa parte.` }); tudoCerto = false; }
        else if (d.linhas !== p.linhas) { linhas.push({ ok: false, texto: `${p.rotulo}: a melodia pede ${lin(p.linhas)}, a sua letra tem ${d.linhas}.` }); tudoCerto = false; }
        else linhas.push({ ok: true, texto: `${p.rotulo}: ${lin(p.linhas)} ✓` });
      });
      for (let i = pedidas.length; i < dela.length; i++) { linhas.push({ ok: false, texto: `Sobra uma parte na letra (“${dela[i].nome}”, ${lin(dela[i].linhas)}) sem melodia.` }); tudoCerto = false; }
      return { nivel: tudoCerto ? "ok" : "aviso", texto: tudoCerto ? `A letra bate com a melodia (${lin(cl.total)}).` : `A letra não bate com a melodia em alguma parte (sua letra tem ${lin(cl.total)}, a melodia pede cerca de ${res.depois.linhas}).`, linhas };
    }
    const dif = res.depois.linhas ? Math.abs(cl.total - res.depois.linhas) / res.depois.linhas : 0;
    return dif > 0.3
      ? { nivel: "aviso", texto: `A sua letra tem ${lin(cl.total)} e a melodia pede cerca de ${res.depois.linhas}; pode encaixar mal. (Dica: marque as partes da letra com [Verso], [Refrão]… para eu conferir parte por parte.)`, linhas }
      : { nivel: "ok", texto: `A sua letra tem ${lin(cl.total)} e a melodia pede cerca de ${res.depois.linhas}.`, linhas };
  }
  const conferirLetra = (est, marcas, letra) => conferir(resumo(est, marcas), letra);
  const conferirLetraPartes = (est, partes, marcas, letra) => conferir(resumoPartes(est, partes, marcas), letra);
  function modeloDe(res) {
    const out = [];
    res.secoes.filter((s) => s.linhas > 0).forEach((s) => {
      out.push(`[${s.rotulo.replace(/ \((repetida|cópia|provável)\)$/, "")}]`);
      for (let i = 1; i <= s.linhas; i++) out.push(`(linha ${i})`);
      out.push("");
    });
    return out.join("\n").trim() + "\n";
  }
  const modeloLetra = (est, marcas) => modeloDe(resumo(est, marcas));
  const modeloLetraPartes = (est, partes, marcas) => modeloDe(resumoPartes(est, partes, marcas));
  // ABC tocável de um conjunto de blocos (cabeçalho + as linhas deles), para a prévia
  function abcDeBlocos(est, ids) { const out = est.cabecalho.slice(); ids.forEach((id) => est.blocos[id].linhas.forEach((l) => out.push(l))); return out.join("\n") + "\n"; }

  const logica = { analisar, plano, reconstruir, resumo, resumoPartes, contarLetra, conferirLetra, conferirLetraPartes, modeloLetra, modeloLetraPartes, contarCompassos, contarNotas, marcasVazias, tempo, parseTempo, tipoDeCabecalho,
    faixaDeBlocos, blocosNoIntervalo, sugerirPartes, renomearParte, dividirParte, juntarParte, montarMarcas, descreverPlano, partesAposAplicar, abcDeBlocos, MIN_NOTAS_CANTADO };
  if (typeof module !== "undefined" && module.exports) { module.exports = { logica }; return; }

  // ═════════════════════════ O PAINEL (só no navegador) ═════════════════════════
  const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
  let somAtual = null;                                   // só uma prévia toca por vez

  function pararSom() { if (somAtual) { const s = somAtual; somAtual = null; s.parar(); } }
  async function ouvirAbc(abc, aoFim) {
    const A = window.ABCJS;
    if (!A || !A.synth || !A.synth.CreateSynth || (A.synth.supportsAudio && !A.synth.supportsAudio())) throw new Error("O som da prévia não está disponível neste navegador.");
    pararSom();
    const visual = A.renderAbc("*", abc, {})[0], synth = new A.synth.CreateSynth();
    let fim = false;
    const terminar = () => { if (fim) return; fim = true; try { synth.stop(); } catch (e) { /* já parado */ } if (somAtual === ctrl) somAtual = null; if (aoFim) aoFim(); };
    const ctrl = { parar() { try { if (timer) timer.stop(); } catch (e) { /* ok */ } terminar(); } };
    let timer = null;
    somAtual = ctrl;
    await synth.init({ visualObj: visual }); await synth.prime();
    if (fim) return;                                     // alguém mandou parar enquanto carregava
    timer = new A.TimingCallbacks(visual, { eventCallback: (ev) => { if (ev === null) terminar(); return undefined; } });
    synth.start(); timer.start();
  }

  function criar(el, api) {
    const E = { base: "", original: "", est: null, partes: [], acoes: {}, trechos: [], abertos: {}, tDe: "", tAte: "", msg: "", msgTrecho: "", tocando: null };
    el.innerHTML = `<p class="oh-label-campo"><i class="oh-ic" data-ic="mix"></i> Mapa da música: o que fica, o que sai e o que se copia</p>
      <p class="oh-hint">O app lê a melodia e <b>sugere as partes</b> (a divisão é um palpite, feito pela repetição das melodias: confira ouvindo e corrija se precisar). Os tempos seguem o andamento escrito na melodia e podem não bater exatamente com o áudio original.</p>
      <ol class="sw-partes" id="swPartes"></ol>
      <div class="sw-tempo-box" id="swTempoBox">
        <p class="sw-sub">Tirar um trecho por tempo</p>
        <div class="sw-tempo-campos"><label>De <input type="text" id="swDe" inputmode="numeric" placeholder="1:25" autocomplete="off"></label><label>até <input type="text" id="swAte" inputmode="numeric" placeholder="1:40" autocomplete="off"></label>
          <button type="button" class="oh-btn oh-btn-secundario" id="swTrechoOuvir">▶ Ouvir o trecho</button><button type="button" class="oh-btn oh-btn-secundario" id="swTrechoTirar">Tirar este trecho</button></div>
        <p class="oh-hint" id="swTrechoMsg" role="status"></p><ul class="sw-trechos" id="swTrechos"></ul>
      </div>
      <div class="sw-plano" id="swPlano"><p class="sw-sub">O que vai acontecer</p><ul id="swPlanoLista"></ul>
        <p class="oh-hint" id="swEstrResumo"></p><p class="oh-hint" id="swEstrLetra" role="status"></p></div>
      <div class="oh-row sw-estr-botoes"><button type="button" class="oh-btn" id="swEstrAplicar">Aplicar à melodia</button><button type="button" class="oh-btn oh-btn-secundario" id="swEstrOriginal">Voltar ao original</button><button type="button" class="oh-btn oh-btn-secundario" id="swEstrModelo">Copiar modelo da letra</button></div>
      <p class="oh-hint" id="swEstrMsg" role="status"></p>`;
    const $ = (s) => el.querySelector(s);
    const marcasAtuais = () => montarMarcas(E.est, E.partes, E.acoes, E.trechos);
    const faixaTxt = (ids) => { const f = faixaDeBlocos(E.est, ids); return f.ini != null ? `${tempo(f.ini)}–${tempo(f.fim)} · ${Math.round(f.fim - f.ini)} s` : `compassos ${f.de}–${f.ate}`; };

    function render() {
      const est = E.est;
      if (!est) { el.hidden = true; return; }
      el.hidden = false;
      if (!est.ok) {
        $("#swPartes").innerHTML = `<li class="sw-estr-vazio">${esc(est.motivo)} Para esta melodia, edite pela aba Partitura.</li>`;
        ["#swTempoBox", "#swPlano"].forEach((s) => { $(s).hidden = true; });
        $("#swEstrAplicar").disabled = $("#swEstrModelo").disabled = true; $("#swEstrOriginal").disabled = E.base === E.original; return;
      }
      ["#swTempoBox", "#swPlano"].forEach((s) => { $(s).hidden = false; });
      $("#swPartes").innerHTML = E.partes.map((p, k) => {
        const a = E.acoes[k], cant = p.blocos.filter((id) => est.blocos[id].cantado).length, aberto = !!E.abertos[k];
        const pode = k > 0 && E.partes[k - 1].secao === p.secao;
        return `<li class="sw-parte${a && a.tipo === "tirar" ? " tirada" : ""}${a && a.tipo === "copiar" ? " copiada" : ""}" data-p="${k}">
          <div class="sw-parte-topo"><button type="button" class="sw-ouvir" data-a="ouvir" aria-label="Ouvir ${esc(p.nome)}">${E.tocando === "p" + k ? "■ Parar" : "▶ Ouvir"}</button>
            <b class="sw-nome">${esc(p.nome)}</b>${p.sugerida ? '<em class="sw-sug" title="Divisão sugerida pelo app, pela repetição das melodias. Confira ouvindo.">sugestão</em>' : ""}
            <span class="sw-tempo">${esc(faixaTxt(p.blocos))}</span></div>
          <div class="sw-parte-base"><span class="sw-info">${cant ? `≈ ${plural(cant, "linha", "linhas")} de letra` : "instrumental"}</span>
            <span class="sw-seg" role="group" aria-label="O que fazer com ${esc(p.nome)}"><button type="button" data-a="manter" aria-pressed="${!a}" class="${!a ? "on" : ""}">Manter</button><button type="button" data-a="tirar" aria-pressed="${!!a && a.tipo === "tirar"}" class="${a && a.tipo === "tirar" ? "on tirar" : ""}">Tirar</button><button type="button" data-a="copiar" aria-pressed="${!!a && a.tipo === "copiar"}" class="${a && a.tipo === "copiar" ? "on copiar" : ""}">Copiar</button></span>
            <button type="button" class="sw-mini" data-a="ajustar" aria-expanded="${aberto}">Ajustar ${aberto ? "▴" : "▾"}</button></div>
          ${a && a.tipo === "copiar" ? `<label class="sw-destino">Colocar a cópia depois de: <select data-a="destino" aria-label="Depois de qual parte">${E.partes.map((q, j) => `<option value="${j}"${(a.depoisDe != null ? a.depoisDe : k) === j ? " selected" : ""}>${j === k ? "esta mesma parte" : esc(q.nome)}</option>`).join("")}</select></label>` : ""}
          ${aberto ? `<div class="sw-ajustes"><label>Nome <input type="text" data-f="nome" value="${esc(p.nome)}" aria-label="Nome da parte"></label><button type="button" class="sw-mini" data-a="renomear">Renomear</button>
            <label>Dividir em <input type="text" data-f="dividir" placeholder="0:45" inputmode="numeric" aria-label="Tempo para dividir"></label><button type="button" class="sw-mini" data-a="dividir">Dividir aqui</button>
            <button type="button" class="sw-mini" data-a="juntar"${pode ? "" : " disabled"} title="${pode ? "Junta esta parte com a anterior" : "Só dá para juntar partes da mesma seção"}">Juntar com a anterior</button></div>` : ""}</li>`;
      }).join("");
      $("#swDe").value = E.tDe; $("#swAte").value = E.tAte; $("#swTrechoMsg").textContent = E.msgTrecho;
      $("#swTrechos").innerHTML = E.trechos.map((t, i) => `<li>Trecho ${esc(faixaTxt(t.blocos))} <button type="button" class="sw-mini" data-a="trecho-remover" data-t="${i}" aria-label="Tirar este trecho da lista">✕ desfazer</button></li>`).join("");
      const marcas = marcasAtuais(), r = resumoPartes(est, E.partes, marcas), h = (x) => `${x.compassos} compassos${x.segundos != null ? ` (≈ ${tempo(x.segundos)})` : ""}`;
      const frases = descreverPlano(est, E.partes, E.acoes, E.trechos), pendente = frases.length > 0;
      $("#swPlanoLista").innerHTML = pendente ? frases.map((f) => `<li>${esc(f)}</li>`).join("") : "<li class=\"sw-nada\">Nada marcado ainda. Tudo fica como está.</li>";
      const vazia = r.depois.compassos === 0;
      $("#swEstrResumo").textContent = pendente
        ? `A melodia iria de ${h(r.antes)} para ${h(r.depois)}. Passaria a pedir cerca de ${lin(r.depois.linhas)} de letra (estimativa: uma linha para cada trecho cantado de 4 compassos; pode variar).`
        : `A melodia tem ${h(r.antes)} e pede cerca de ${lin(r.antes.linhas)} de letra (estimativa: uma linha para cada trecho cantado de 4 compassos; pode variar).`;
      if (vazia) E.msg = "Com esse plano a melodia ficaria vazia. Deixe pelo menos uma parte.";
      $("#swEstrAplicar").disabled = !pendente || vazia; $("#swEstrModelo").disabled = false; $("#swEstrOriginal").disabled = E.base === E.original;
      atualizarLetra();
      $("#swEstrMsg").textContent = E.msg;
    }
    function atualizarLetra() {
      const p = $("#swEstrLetra"); if (!E.est || !E.est.ok) { p.textContent = ""; return; }
      const c = conferirLetraPartes(E.est, E.partes, marcasAtuais(), api.lerLetra ? api.lerLetra() : "");
      p.className = "oh-hint sw-conf " + (c.nivel || "");
      p.innerHTML = esc((c.nivel === "aviso" ? "⚠️ " : c.nivel === "ok" ? "✅ " : "") + c.texto) + (c.linhas.length ? `<br>${c.linhas.map((x) => esc(x.texto)).join("<br>")}` : "");
    }
    function recomecar(abc, opc) {
      E.base = String(abc || ""); E.est = E.base.trim() ? analisar(E.base) : null; E.partes = opc && opc.partes ? opc.partes : (E.est && E.est.ok ? sugerirPartes(E.est) : []);
      E.acoes = {}; E.trechos = []; E.abertos = {}; E.tDe = E.tAte = ""; E.msgTrecho = ""; E.msg = (opc && opc.msg) || ""; pararSom(); E.tocando = null; render();
    }
    function carregar(abc, opc) {
      opc = opc || {};
      if (!abc || !String(abc).trim()) { E.est = null; E.base = ""; render(); return; }
      const novo = String(abc); if (!opc.reenvio || !E.original) E.original = novo;
      recomecar(novo);
    }
    // remapeia as ações quando as partes mudam de posição (dividir/juntar)
    function remapear(fn) {
      const nova = {};
      Object.keys(E.acoes).forEach((k) => { const nk = fn(+k); if (nk == null) return; const a = Object.assign({}, E.acoes[k]); if (a.depoisDe != null) { const nd = fn(a.depoisDe); a.depoisDe = nd == null ? nk : nd; } nova[nk] = a; });
      E.acoes = nova;
    }
    function tocar(chave, ids) {
      if (E.tocando === chave) { pararSom(); E.tocando = null; render(); return; }
      E.tocando = chave; render();
      const abc = abcDeBlocos(E.est, ids), fim = () => { if (E.tocando === chave) { E.tocando = null; render(); } };
      (api.tocar ? Promise.resolve(api.tocar(abc, fim)) : ouvirAbc(abc, fim)).catch((err) => { E.tocando = null; E.msg = err && err.message ? err.message : "Não consegui tocar a prévia."; render(); });
    }
    function lerTrecho() {
      const de = parseTempo($("#swDe").value), ate = parseTempo($("#swAte").value); E.tDe = $("#swDe").value; E.tAte = $("#swAte").value;
      if (!E.est.segundosPorCompasso) return { erro: "Esta melodia não tem andamento escrito (Q:), então não dá para trabalhar por tempo." };
      if (isNaN(de) || isNaN(ate)) return { erro: "Escreva os dois tempos assim: 1:25 e 1:40." };
      if (!(ate > de)) return { erro: "O “até” precisa ser maior que o “de”." };
      const ids = blocosNoIntervalo(E.est, de, ate);
      if (!ids || !ids.length) return { erro: `Nenhum bloco de 4 compassos cabe entre ${tempo(de)} e ${tempo(ate)}. A música tem ${tempo(E.est.compassosTotal * E.est.segundosPorCompasso)}.` };
      return { ids, de, ate };
    }
    const textoDoTrecho = (t) => `Vai sair de ${tempo(faixaDeBlocos(E.est, t.ids).ini)} a ${tempo(faixaDeBlocos(E.est, t.ids).fim)} (${plural(t.ids.length, "bloco", "blocos")} de 4 compassos): o corte anda de 4 em 4 compassos, então pode não ser exatamente o que você digitou.`;

    el.addEventListener("input", (e) => { if (e.target.id === "swDe") E.tDe = e.target.value; if (e.target.id === "swAte") E.tAte = e.target.value; });
    el.addEventListener("change", (e) => {
      const t = e.target; if (t.dataset && t.dataset.a === "destino") { const k = +t.closest(".sw-parte").dataset.p; E.acoes[k] = { tipo: "copiar", depoisDe: +t.value }; E.msg = ""; render(); }
    });
    el.addEventListener("click", (e) => {
      const t = e.target.closest("button"); if (!t || !E.est || !E.est.ok) return;
      E.msg = "";
      const li = t.closest(".sw-parte"), k = li ? +li.dataset.p : null, a = t.dataset.a;
      if (a === "manter") { delete E.acoes[k]; render(); return; }
      if (a === "tirar") { E.acoes[k] = { tipo: "tirar" }; render(); return; }
      if (a === "copiar") { E.acoes[k] = { tipo: "copiar", depoisDe: k }; render(); return; }
      if (a === "ajustar") { E.abertos[k] = !E.abertos[k]; render(); return; }
      if (a === "ouvir") { tocar("p" + k, E.partes[k].blocos); return; }
      if (a === "renomear") { E.partes = renomearParte(E.partes, k, li.querySelector('[data-f="nome"]').value); render(); return; }
      if (a === "dividir") {
        const r = dividirParte(E.est, E.partes, k, parseTempo(li.querySelector('[data-f="dividir"]').value));
        if (r.erro) { E.msg = r.erro; render(); return; }
        E.partes = r.partes; remapear((i) => (i <= k ? (i === k ? k : i) : i + 1)); Object.keys(E.acoes).forEach((i) => { const x = E.acoes[i]; if (x.depoisDe === k) x.depoisDe = k + 1; }); delete E.acoes[k]; delete E.acoes[k + 1];
        E.abertos = {}; E.msg = `Dividi em ${tempo(r.em)}. As marcas desta parte foram limpas; marque de novo se precisar.`; render(); return;
      }
      if (a === "juntar") {
        const n = juntarParte(E.partes, k); if (!n) return;
        E.partes = n; remapear((i) => (i < k - 1 ? i : i === k - 1 || i === k ? k - 1 : i - 1)); delete E.acoes[k - 1]; E.abertos = {}; E.msg = "Juntei com a parte anterior. As marcas dela foram limpas."; render(); return;
      }
      if (a === "trecho-remover") { E.trechos.splice(+t.dataset.t, 1); render(); return; }
      if (t.id === "swTrechoOuvir") { const r = lerTrecho(); if (r.erro) { E.msgTrecho = r.erro; render(); return; } E.msgTrecho = textoDoTrecho(r); tocar("trecho", r.ids); return; }
      if (t.id === "swTrechoTirar") { const r = lerTrecho(); if (r.erro) { E.msgTrecho = r.erro; render(); return; } E.trechos.push({ blocos: r.ids }); E.tDe = E.tAte = ""; E.msgTrecho = ""; render(); return; }
      if (t.id === "swEstrAplicar") {
        const marcas = marcasAtuais(), r = reconstruir(E.est, marcas); api.aplicarAbc(r.abc);
        const seg = E.est.segundosPorCompasso ? ` (≈ ${tempo(r.compassosFinal * E.est.segundosPorCompasso)})` : "";
        const nomes = partesAposAplicar(E.est, E.partes, marcas, analisar(r.abc));
        recomecar(r.abc, { partes: nomes, msg: `Cortes aplicados: tirei ${r.compassosTirados} compassos e copiei ${r.compassosRepetidos}. A melodia acima já está atualizada (agora com ${r.compassosFinal} compassos${seg}). ${nomes ? "As partes mantiveram os nomes." : "As partes foram sugeridas de novo."} Se quiser desfazer, use “Voltar ao original”.` }); return;
      }
      if (t.id === "swEstrOriginal") { api.aplicarAbc(E.original); recomecar(E.original, { msg: "Voltei à melodia original." }); return; }
      if (t.id === "swEstrModelo") {
        const txt = modeloLetraPartes(E.est, E.partes, marcasAtuais());
        (api.copiar ? api.copiar(txt) : Promise.resolve(false)).then((ok) => { E.msg = ok ? "Modelo da letra copiado: cole no campo “Letra” e escreva a sua letra em cada parte." : "Não consegui copiar sozinho. O modelo é:\n" + txt; render(); });
      }
    });
    return {
      carregar,
      aoEditarMelodia(valor) { if (!E.original) E.original = valor; recomecar(valor); },
      atualizarLetra,
      temEstrutura: () => !!(E.est && E.est.ok),
      temMarcasPendentes: () => !!(E.est && E.est.ok && (Object.keys(E.acoes).length > 0 || E.trechos.length > 0)),
      avisoDeMetrica(letra) { if (!E.est || !E.est.ok) return ""; const c = conferirLetraPartes(E.est, E.partes, marcasAtuais(), letra); return c.nivel === "aviso" ? "⚠️ " + c.texto : ""; },
      _estado: E,
    };
  }
  raiz.SongwriterEstrutura = { criar, logica };
})(typeof window !== "undefined" ? window : globalThis);
