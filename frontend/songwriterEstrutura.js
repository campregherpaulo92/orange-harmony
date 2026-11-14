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
      bloco = { id: blocos.length, secao: sec.id, linhas: [], linhasVoz: [], compVoz: 0, compOutras: 0, notas: 0, notasSeq: [], campos: [], temMusica: false };
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
        if (voz === vozPrincipal || voz === null) { bloco.compVoz += n; const tk = tokensNotas(l); bloco.notas += tk.length; bloco.notasSeq.push(...tk); bloco.linhasVoz.push(l); } else bloco.compOutras += n;
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
      marcas.copias.push({ blocos: quais, depoisDe: dest.blocos[dest.blocos.length - 1], comMarca: p.blocos.length === est.secoes[p.secao].blocos.length && quais.length === p.blocos.length && p.blocos.every((id) => est.blocos[id].secao === p.secao), secao: p.secao, parte: k });
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
      antes: { compassos: est.compassosTotal, segundos: spc ? est.compassosTotal * spc : null, linhas: est.blocos.filter((b) => b.cantado).length, notas: est.blocos.reduce((a, b) => a + b.notas, 0) },
      depois: { compassos: r.compassosFinal, segundos: spc ? r.compassosFinal * spc : null, linhas: saidas.reduce((a, s) => a + s.linhas, 0), notas: saidas.reduce((a, s) => a + (s.notas || 0), 0) },
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
      if (ch !== chave) { chave = ch; const nome = partes[k].nome + (e.copia && !/ \(cópia\)$/.test(partes[k].nome) ? " (cópia)" : ""); atual = { parte: k, nome, rotulo: nome, tipo: partes[k].tipo, copia: !!e.copia, compassos: 0, linhas: 0, nBlocos: 0, notas: 0 }; saidas.push(atual); }
      const b = est.blocos[e.id]; atual.compassos += b.compassos; atual.nBlocos++; atual.notas += b.notas; if (b.cantado) atual.linhas++;
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
  const modeloLetraPartes = (est, partes, marcas) => {
    const res = resumoPartes(est, partes, marcas); res.secoes.forEach((s) => { if (s.linhas > 0) s.linhas = Math.max(1, Math.round(s.notas / SIL_POR_LINHA)); });   // versos pelas NOTAS (≈ 9 sílabas por verso)
    return modeloDe(res);
  };
  // ABC tocável de um conjunto de blocos (cabeçalho + as linhas deles), para a prévia
  function abcDeBlocos(est, ids) { const out = est.cabecalho.slice(); ids.forEach((id) => est.blocos[id].linhas.forEach((l) => out.push(l))); return out.join("\n") + "\n"; }


  // ───────── sílabas, letra com partes e alinhamento com a gravação ─────────
  const SIL_POR_LINHA = 9;                              // um verso de música tem, em geral, uns 9 sílabas (usado só para estimar "uns N versos")
  const DESCENDENTES = new Set(["ai", "ei", "oi", "ui", "au", "eu", "ou", "iu", "éi", "ói", "éu", "êi", "ôu", "ãe", "ão", "õe", "ãi", "ói", "ái", "áu", "êu", "âi"]);
  const CRESCENTES = new Set(["ia", "ie", "io", "ua", "ue", "uo", "iá", "ié", "ió"]);
  // Contagem aproximada de sílabas em português (a mesma ideia de “uma sílaba por grupo de vogais”, com os ditongos mais comuns).
  function silabasDaPalavra(palavra) {
    const w = String(palavra).toLowerCase().normalize("NFC").replace(/(q|g)u(?=[eiéêíèaoáâãõóô])/g, "$1");   // u mudo (que, guerra) ou semivogal que cola na consoante (quando, água)
    const grupos = w.match(/[aeiouáéíóúâêôãõàü]+/g) || [];
    if (!grupos.length) return 0;
    let n = 0;
    grupos.forEach((g, gi) => {
      if (g.length === 1) { n += 1; return; }
      const final = gi === grupos.length - 1 && w.endsWith(g);
      if (g.length === 2 && final && grupos.length > 1 && CRESCENTES.has(g)) { n += 1; return; }   // história, armário, água: ditongo no fim da palavra
      let sil = 1;
      for (let i = 1; i < g.length; i++) {
        const par = g[i - 1] + g[i];
        if (/[íú]/.test(par)) { sil++; continue; }       // vogal tônica i/u acentuada: hiato (sa-í-da)
        if (DESCENDENTES.has(par)) continue;             // mesmo ditongo
        sil++;                                            // hiato (po-e-ta, vi-o-lão)
      }
      n += sil;
    });
    return Math.max(1, n);
  }
  function contarSilabas(texto) { return (String(texto || "").match(/[A-Za-zÀ-ÖØ-öø-ÿ]+/g) || []).reduce((a, p) => a + silabasDaPalavra(p), 0); }

  // A letra do usuário, lida por partes: [Verso 1], [Refrão]… ou # Refrão. Devolve as partes e as linhas na ordem.
  function secoesDaLetra(letra) {
    const bruto = []; let atual = null;
    String(letra || "").split(/\r?\n/).forEach((l0) => {
      const l = l0.trim(); if (!l) return;
      const m = /^\[(.+)\]$/.exec(l) || /^#\s*(.+)$/.exec(l);
      if (m) { atual = { nome: m[1].trim(), tipo: tipoDeCabecalho(m[1]), linhas: [], silabas: 0 }; bruto.push(atual); return; }
      if (!atual) { atual = { nome: "(sem título de parte)", tipo: null, linhas: [], silabas: 0, implicita: true }; bruto.push(atual); }
      atual.linhas.push(l); atual.silabas += contarSilabas(l);
    });
    const secoes = bruto.filter((s) => s.linhas.length), planas = [];
    secoes.forEach((s, k) => s.linhas.forEach((t) => planas.push({ texto: t, secao: k })));
    return { secoes, planas, total: planas.length, temCabecalhos: secoes.some((s) => !s.implicita) };
  }
  const textoParaAlinhar = (sl) => sl.planas.map((x) => x.texto).join("\n");   // só as linhas cantadas: os títulos [Verso 1] não são cantados

  function unidadeL(est) { for (const l of est.cabecalho) { const x = /^L:\s*(\d+)\/(\d+)/.exec(l); if (x) return +x[1] / +x[2]; } return est.campos.m / est.campos.n < 0.75 ? 1 / 16 : 1 / 8; }
  // Quanto do começo e do fim do bloco é pausa da voz, em compassos (a voz quase nunca começa exatamente no início do bloco).
  function restosDoBloco(est, b) {
    const compU = (est.campos.m / est.campos.n) / unidadeL(est), compassos = [];
    b.linhasVoz.forEach((linha) => {
      linha.replace(/"[^"]*"/g, "").replace(/\|\]|\|\||\|:|:\||::/g, "|").split("|").forEach((tok) => {
        const s = tok.trim(); if (!s) return;
        const mz = /^Z(\d*)$/.exec(s);
        if (mz) { for (let i = 0; i < (mz[1] ? +mz[1] : 1); i++) compassos.push({ tudo: true, s: "" }); return; }
        compassos.push({ s, tudo: false });
      });
    });
    const unidades = (rest, deTras) => {
      let u = 0, m; const re = deTras ? /[zx](\d*)(?:\/(\d+))?\s*$/ : /^\s*[zx](\d*)(?:\/(\d+))?/;
      while ((m = re.exec(rest))) { u += (m[1] ? +m[1] : 1) / (m[2] ? +m[2] : 1); rest = deTras ? rest.slice(0, m.index) : rest.slice(m[0].length); }
      return { u, resto: rest.trim() };
    };
    let antes = 0, depois = 0;
    for (let i = 0; i < compassos.length; i++) { const c = compassos[i]; if (c.tudo) { antes += 1; continue; } const r = unidades(c.s, false); if (r.resto === "") { antes += 1; continue; } antes += r.u / compU; break; }
    for (let i = compassos.length - 1; i >= 0; i--) { const c = compassos[i]; if (c.tudo) { depois += 1; continue; } const r = unidades(c.s, true); if (r.resto === "") { depois += 1; continue; } depois += r.u / compU; break; }
    return { antes, depois };
  }
  // Casa o tempo da gravação (onde a voz começa e termina, pela letra alinhada) com o tempo da melodia: dá o deslocamento e a escala (andamento).
  function calibrar(est, alinhadas) {
    const spc = est.segundosPorCompasso, cant = est.blocos.filter((b) => b.cantado), ok = (alinhadas || []).filter((a) => a && a.ini != null);
    if (!spc || !cant.length || ok.length < 2) return null;
    const b0 = cant[0], b1 = cant[cant.length - 1], r0 = restosDoBloco(est, b0), r1 = restosDoBloco(est, b1);
    const A0 = (b0.de - 1 + r0.antes) * spc, A1 = (b1.ate - r1.depois) * spc;
    const L0 = Math.min(...ok.map((a) => a.ini)), L1 = Math.max(...ok.map((a) => (a.fim != null ? a.fim : a.ini)));
    let f = (A1 - A0) > 1 && (L1 - L0) > 1 ? (L1 - L0) / (A1 - A0) : 1;
    if (!(f > 0.3 && f < 3)) f = 1;
    return { f, off: L0 - f * A0, A0, A1, L0, L1 };
  }
  // Monta as PARTES da melodia a partir das partes da letra e do tempo de cada linha na gravação.
  function partesPelaLetra(est, sl, alinhadas, cal) {
    const spc = est.segundosPorCompasso, avisos = [], faixas = sl.secoes.map(() => ({ ini: null, fim: null }));
    sl.planas.forEach((p, i) => {
      const a = alinhadas[i]; if (!a || a.ini == null) return;
      const fx = faixas[p.secao], f = a.fim != null ? a.fim : a.ini;
      fx.ini = fx.ini == null ? a.ini : Math.min(fx.ini, a.ini); fx.fim = fx.fim == null ? f : Math.max(fx.fim, f);
    });
    const rot = est.blocos.map((b) => {
      const bi = cal.f * (b.de - 1) * spc + cal.off, bf = cal.f * b.ate * spc + cal.off, dur = bf - bi;
      let melhor = -1, ov = 0;
      faixas.forEach((fx, k) => { if (fx.ini == null) return; const o = Math.min(bf, fx.fim) - Math.max(bi, fx.ini); if (o > ov) { ov = o; melhor = k; } });
      return ov >= 0.3 * dur ? melhor : -1;
    });
    for (let i = 1; i < rot.length - 1; i++) if (rot[i] < 0 && rot[i - 1] >= 0 && rot[i - 1] === rot[i + 1]) rot[i] = rot[i - 1];   // um bloco solto no meio de uma parte pertence a ela
    const grupos = [];
    rot.forEach((k, i) => { const g = grupos[grupos.length - 1]; if (g && g.k === k) g.blocos.push(i); else grupos.push({ k, blocos: [i] }); });
    if (!grupos.some((g) => g.k >= 0)) return { partes: [], avisos: ["Nenhuma parte da letra caiu em cima da melodia extraída."], semBlocos: sl.secoes.map((s) => s.nome) };
    const semBlocos = sl.secoes.map((s, k) => (rot.includes(k) ? null : s.nome)).filter(Boolean);
    if (semBlocos.length) avisos.push(`Estas partes da letra são curtas demais para ocupar um bloco inteiro de 4 compassos e ficaram sem parte própria: ${semBlocos.join(", ")}.`);
    const entre = grupos.filter((g, i) => g.k < 0 && i > 0 && i < grupos.length - 1).length; let nInter = 0;
    const partes = grupos.map((g, i) => {
      let nome, tipo, letraSecao = null;
      if (g.k >= 0) { nome = sl.secoes[g.k].nome; tipo = sl.secoes[g.k].tipo || "verse"; letraSecao = g.k; }
      else if (i === 0) { nome = "Introdução"; tipo = "intro"; }
      else if (i === grupos.length - 1) { nome = "Final"; tipo = "outro"; }
      else { nInter++; nome = entre > 1 ? `Interlúdio ${nInter}` : "Interlúdio"; tipo = "interlude"; }
      return { id: i, blocos: g.blocos, secao: est.blocos[g.blocos[0]].secao, tipo, nome, sugerida: false, pelaLetra: true, letraSecao };
    });
    return { partes, avisos, semBlocos };
  }
  const MARCA_ABC = { intro: "intro", verse: "verse", chorus: "chorus", interlude: "interlude", bridge: "bridge", outro: "outro", prechorus: "pre-chorus", solo: "interlude", instrumental: "interlude" };
  // Reescreve SÓ os comentários de seção (% verse, % chorus…) para a melodia ter uma seção para cada parte. Nenhuma nota é mexida.
  function reescreverSecoes(est, partes) {
    const saida = est.cabecalho.slice();
    est.itens.forEach((it) => { if (it.t === "texto") saida.push(it.linha); });
    partes.forEach((p) => { saida.push(`% ${MARCA_ABC[p.tipo] || "verse"}`); p.blocos.forEach((id) => est.blocos[id].linhas.forEach((l) => saida.push(l))); });
    return { abc: saida.join(est.eol) + (est.fimNL ? est.eol : "") };
  }
  // Troca só o andamento (Q:) do cabeçalho.
  function reescreverAndamento(abc, bpm) {
    const n = Math.max(30, Math.min(300, Math.round(bpm))), linhas = String(abc).split(/\r?\n/), eol = String(abc).indexOf("\r\n") >= 0 ? "\r\n" : "\n";
    const k = linhas.findIndex((l) => /^K:/.test(l)); let feito = false;
    for (let i = 0; i < (k < 0 ? linhas.length : k); i++) {
      if (/^Q:/.test(linhas[i])) {
        if (/=\s*\d/.test(linhas[i])) linhas[i] = linhas[i].replace(/=\s*\d+(?:\.\d+)?/, "=" + n); else linhas[i] = linhas[i].replace(/(\d+(?:\.\d+)?)\s*$/, String(n));
        feito = true; break;
      }
    }
    if (!feito && k >= 0) linhas.splice(k, 0, "Q:1/4=" + n);
    return linhas.join(eol);
  }
  function sugerirAndamento(est, cal) {
    if (!cal || !est.campos.bpm || Math.abs(cal.f - 1) < 0.06) return null;   // o alinhamento tem 1–2 s de imprecisão: abaixo de 6% seria falso alarme
    const para = Math.round(est.campos.bpm / cal.f); return para === Math.round(est.campos.bpm) ? null : { de: Math.round(est.campos.bpm), para };
  }
  // A letra cabe nas notas? Uma sílaba por nota é o normal; bem menos que isso e as palavras esticam, bem mais e a voz aperta.
  function avaliarEncaixe(notas, silabas) {
    if (notas < 8) return { nivel: "n/a", marca: "" };
    const r = silabas / notas;
    if (r < 0.7) return { nivel: "curta", marca: "⚠ letra curta (as palavras vão esticar)" };
    if (r > 1.35) return { nivel: "longa", marca: "⚠ letra longa (vai apertar)" };
    return { nivel: "ok", marca: "✓" };
  }
  // Confere a letra com a melodia pelas SÍLABAS (a conta que realmente importa), parte por parte, já considerando o plano.
  function conferirEncaixe(est, partes, marcas, letra) {
    const res = resumoPartes(est, partes, marcas), pedidas = res.secoes.filter((s) => s.linhas > 0), sl = secoesDaLetra(letra);
    if (!sl.total) return { nivel: "", texto: `A melodia tem ${res.depois.notas} notas: cabem uns ${res.depois.notas} sílabas (uns ${Math.max(1, Math.round(res.depois.notas / SIL_POR_LINHA))} versos).`, linhas: [] };
    const silTotal = sl.secoes.reduce((a, s) => a + s.silabas, 0), notasTotal = res.depois.notas, linhas = [];
    if (sl.temCabecalhos && sl.secoes.some((s) => s.tipo)) {
      let tudo = pedidas.length === sl.secoes.length;
      pedidas.forEach((p, i) => {
        const d = sl.secoes[i];
        if (!d) { linhas.push({ ok: false, texto: `${p.rotulo}: a melodia tem ~${p.notas} notas e a sua letra não tem essa parte.` }); tudo = false; return; }
        const ev = avaliarEncaixe(p.notas, d.silabas);
        if (ev.nivel === "ok" || ev.nivel === "n/a") linhas.push({ ok: true, texto: `${p.rotulo}: ~${d.silabas} sílabas para ~${p.notas} notas ✓` });
        else { linhas.push({ ok: false, texto: `${p.rotulo}: ~${d.silabas} sílabas para ~${p.notas} notas. ${ev.marca.replace("⚠ ", "")}.` }); tudo = false; }
      });
      for (let i = pedidas.length; i < sl.secoes.length; i++) { linhas.push({ ok: false, texto: `Sobra uma parte na letra (“${sl.secoes[i].nome}”, ~${sl.secoes[i].silabas} sílabas) sem melodia.` }); tudo = false; }
      return { nivel: tudo ? "ok" : "aviso", texto: tudo ? `A letra encaixa nas notas de todas as partes (~${silTotal} sílabas para ~${notasTotal} notas).` : `A letra não encaixa direito em alguma parte (~${silTotal} sílabas para ~${notasTotal} notas no total).`, linhas };
    }
    const ev = avaliarEncaixe(notasTotal, silTotal);
    return ev.nivel === "ok" || ev.nivel === "n/a"
      ? { nivel: "ok", texto: `A sua letra tem ~${silTotal} sílabas para ~${notasTotal} notas.`, linhas }
      : { nivel: "aviso", texto: `A sua letra tem ~${silTotal} sílabas para ~${notasTotal} notas: ${ev.marca.replace("⚠ ", "")}. (Dica: marque as partes da letra com [Verso], [Refrão]… para eu conferir parte por parte.)`, linhas };
  }

  const logica = { analisar, plano, reconstruir, resumo, resumoPartes, contarLetra, conferirLetra, conferirLetraPartes, modeloLetra, modeloLetraPartes, contarCompassos, contarNotas, marcasVazias, tempo, parseTempo, tipoDeCabecalho,
    faixaDeBlocos, blocosNoIntervalo, sugerirPartes, renomearParte, dividirParte, juntarParte, montarMarcas, descreverPlano, partesAposAplicar, abcDeBlocos, MIN_NOTAS_CANTADO,
    contarSilabas, secoesDaLetra, textoParaAlinhar, restosDoBloco, calibrar, partesPelaLetra, reescreverSecoes, reescreverAndamento, sugerirAndamento, avaliarEncaixe, conferirEncaixe, SIL_POR_LINHA };
  if (typeof module !== "undefined" && module.exports) { module.exports = { logica }; return; }

  // ═════════════════════════ O PAINEL (só no navegador) ═════════════════════════
  const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
  let somAtual = null;                                   // só uma prévia toca por vez

  function pararSom() { if (somAtual) { const s = somAtual; somAtual = null; s.parar(); } }
  // A prévia NÃO baixa som nenhum da internet: a biblioteca da partitura (abcjs) entrega a lista de notas das duas vozes (altura, início e
  // duração, em fração de compasso) e o app toca isso direto no aparelho, com um som simples. Serve para reconhecer a parte de ouvido.
  function agendarNotas(ctx, destino, seq, msPorCompasso, t0) {
    const seg = msPorCompasso / 1000; let fim = 0;
    seq.tracks.forEach((trilha, ti) => trilha.forEach((e) => {
      if (e.cmd !== "note" || !(e.duration > 0)) return;
      const ini = t0 + e.start * seg, dur = Math.max(0.05, e.duration * seg * 0.96), freq = 440 * Math.pow(2, (e.pitch - 69) / 12);
      const o = ctx.createOscillator(), g = ctx.createGain(), pico = (ti === 0 ? 0.3 : 0.16) * Math.min(1, (e.volume || 90) / 127);
      o.type = ti === 0 ? "triangle" : "sine"; o.frequency.value = freq;                       // voz: triângulo; instrumental: senoide
      g.gain.setValueAtTime(0.0001, ini); g.gain.linearRampToValueAtTime(pico, ini + 0.012);
      g.gain.exponentialRampToValueAtTime(pico * 0.55, ini + Math.min(dur * 0.7, 0.5)); g.gain.linearRampToValueAtTime(0.0001, ini + dur + 0.05);
      o.connect(g); g.connect(destino); o.start(ini); o.stop(ini + dur + 0.08);
      fim = Math.max(fim, e.start * seg + dur + 0.08);
    }));
    return fim;                                                                                  // segundos até a última nota acabar
  }
  function prepararSom(abc) {
    const A = window.ABCJS;
    if (!A || !A.renderAbc) throw new Error("A biblioteca da partitura não está carregada nesta página, então não dá para tocar a prévia.");
    const visual = A.renderAbc("*", abc, {})[0];
    if (!visual || !visual.setUpAudio) throw new Error("Esta versão da partitura não sabe preparar o som da prévia.");
    try { if (visual.setTiming) visual.setTiming(); } catch (e) { /* já calculado */ }
    return { seq: visual.setUpAudio({}), ms: visual.millisecondsPerMeasure() };
  }
  async function ouvirAbc(abc, aoFim) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) throw new Error("Este navegador não consegue tocar som pela página.");
    pararSom();
    const ctx = new AC();                                                                        // criado já no clique: o navegador libera o som
    try { if (ctx.state === "suspended") ctx.resume(); } catch (e) { /* segue */ }
    let som; try { som = prepararSom(abc); } catch (e) { try { ctx.close(); } catch (e2) { /* ok */ } throw e; }
    const comp = ctx.createDynamicsCompressor(), mestre = ctx.createGain(); mestre.gain.value = 0.8; mestre.connect(comp); comp.connect(ctx.destination);
    const dur = agendarNotas(ctx, mestre, som.seq, som.ms, ctx.currentTime + 0.1);
    let fim = false, relogio = null;
    const terminar = () => { if (fim) return; fim = true; clearTimeout(relogio); try { ctx.close(); } catch (e) { /* já fechado */ } if (somAtual === ctrl) somAtual = null; if (aoFim) aoFim(); };
    const ctrl = { parar: terminar };
    somAtual = ctrl; relogio = setTimeout(terminar, (dur + 0.4) * 1000);
  }

  function criar(el, api) {
    const E = { base: "", original: "", est: null, partes: [], acoes: {}, trechos: [], abertos: {}, tDe: "", tAte: "", msg: "", msgTrecho: "", tocando: null, pelaLetra: null, msgLetra: "" };
    el.innerHTML = `<p class="oh-label-campo"><i class="oh-ic" data-ic="mix"></i> Mapa da música: o que fica, o que sai e o que se copia</p>
      <p class="oh-hint">O app lê a melodia e <b>sugere as partes</b> (a divisão é um palpite, feito pela repetição das melodias: confira ouvindo e corrija se precisar). O <b>▶ Ouvir</b> toca a melodia da partitura (voz e instrumental) com um som simples, feito no próprio aparelho, sem internet: <b>não é o áudio da gravação</b>, serve para reconhecer a parte. Os tempos seguem o andamento escrito na melodia e podem não bater exatamente com o áudio original.</p>
      <div class="sw-letra-info" id="swLetraInfo" hidden></div>
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

    function infoParte(p) {
      const bs = p.blocos.map((id) => E.est.blocos[id]), notas = bs.reduce((a, b) => a + b.notas, 0);
      if (!bs.some((b) => b.cantado)) return "instrumental";
      const sec = E.pelaLetra && p.letraSecao != null ? E.pelaLetra.sl.secoes[p.letraSecao] : null;
      if (sec) { const ev = avaliarEncaixe(notas, sec.silabas); return `${plural(sec.linhas.length, "linha", "linhas")} da sua letra · ~${sec.silabas} sílabas para ~${notas} notas ${ev.marca}`.trim(); }
      return `≈ ${notas} notas: cabem uns ${notas} sílabas (uns ${Math.max(1, Math.round(notas / SIL_POR_LINHA))} versos)`;
    }
    function renderLetraInfo() {
      const box = $("#swLetraInfo"), pl = E.pelaLetra;
      if (!pl && !E.msgLetra) { box.hidden = true; box.innerHTML = ""; return; }
      box.hidden = false;
      let h = E.msgLetra ? `<p class="oh-hint sw-letra-msg">${esc(E.msgLetra)}</p>` : "";
      if (pl) {
        const cal = pl.cal, spc = E.est.segundosPorCompasso;
        h += `<p class="sw-sub">Estrutura montada pela sua letra: ${E.partes.length} partes</p>`;
        h += `<p class="oh-hint">${esc(`Na gravação a sua voz vai de ${tempo(cal.L0)} a ${tempo(cal.L1)}; na melodia, de ${tempo(cal.A0)} a ${tempo(cal.A1)}.${pl.duracao && spc ? ` A gravação dura ${tempo(pl.duracao)} e a melodia, ${tempo(E.est.compassosTotal * spc)}.` : ""}`)}</p>`;
        (pl.avisos || []).forEach((a) => { h += `<p class="oh-hint sw-conf aviso">${esc("⚠️ " + a)}</p>`; });
        if (pl.sug) h += `<p class="oh-hint sw-conf aviso">${esc(`⚠️ A gravação está ${Math.round(Math.abs(cal.f - 1) * 100)}% ${cal.f > 1 ? "mais lenta" : "mais rápida"} que a melodia extraída (o modelo calculou ${pl.sug.de} BPM; pela sua voz seriam uns ${pl.sug.para} BPM).`)}</p><div class="oh-row"><button type="button" class="oh-btn oh-btn-secundario" id="swAjustarAndamento">Ajustar o andamento para ${pl.sug.para} BPM</button></div>`;
        h += pl.aplicada
          ? `<p class="oh-hint sw-conf ok">✅ A melodia já tem as mesmas partes da sua letra.</p>`
          : `<div class="oh-row"><button type="button" class="oh-btn" id="swAplicarLetra">Aplicar a estrutura da letra à melodia</button></div><p class="oh-hint">Reescreve só os comentários de seção da melodia (% verse, % chorus…) para ela ter as mesmas partes da sua letra. Nenhuma nota é mexida.</p>`;
      }
      box.innerHTML = h;
    }
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
      renderLetraInfo();
      $("#swPartes").innerHTML = E.partes.map((p, k) => {
        const a = E.acoes[k], aberto = !!E.abertos[k];
        const pode = k > 0 && E.partes[k - 1].secao === p.secao;
        return `<li class="sw-parte${a && a.tipo === "tirar" ? " tirada" : ""}${a && a.tipo === "copiar" ? " copiada" : ""}" data-p="${k}">
          <div class="sw-parte-topo"><button type="button" class="sw-ouvir" data-a="ouvir" aria-label="Ouvir ${esc(p.nome)}">${E.tocando === "p" + k ? "■ Parar" : "▶ Ouvir"}</button>
            <b class="sw-nome">${esc(p.nome)}</b>${p.sugerida ? '<em class="sw-sug" title="Divisão sugerida pelo app, pela repetição das melodias. Confira ouvindo.">sugestão</em>' : ""}
            <span class="sw-tempo">${esc(faixaTxt(p.blocos))}</span></div>
          <div class="sw-parte-base"><span class="sw-info">${esc(infoParte(p))}</span>
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
        ? `A melodia iria de ${h(r.antes)} para ${h(r.depois)}. Ficaria com ~${r.depois.notas} notas: cabem uns ${r.depois.notas} sílabas (estimativa: uma sílaba por nota).`
        : `A melodia tem ${h(r.antes)} e ~${r.antes.notas} notas: cabem uns ${r.antes.notas} sílabas, uns ${Math.max(1, Math.round(r.antes.notas / SIL_POR_LINHA))} versos de ${SIL_POR_LINHA} sílabas (estimativa: uma sílaba por nota).`;
      if (vazia) E.msg = "Com esse plano a melodia ficaria vazia. Deixe pelo menos uma parte.";
      $("#swEstrAplicar").disabled = !pendente || vazia; $("#swEstrModelo").disabled = false; $("#swEstrOriginal").disabled = E.base === E.original;
      atualizarLetra();
      $("#swEstrMsg").textContent = E.msg;
    }
    function atualizarLetra() {
      const p = $("#swEstrLetra"); if (!E.est || !E.est.ok) { p.textContent = ""; return; }
      const c = conferirEncaixe(E.est, E.partes, marcasAtuais(), api.lerLetra ? api.lerLetra() : "");
      p.className = "oh-hint sw-conf " + (c.nivel || "");
      p.innerHTML = esc((c.nivel === "aviso" ? "⚠️ " : c.nivel === "ok" ? "✅ " : "") + c.texto) + (c.linhas.length ? `<br>${c.linhas.map((x) => esc(x.texto)).join("<br>")}` : "");
    }
    function recomecar(abc, opc) {
      E.base = String(abc || ""); E.est = E.base.trim() ? analisar(E.base) : null; E.partes = opc && opc.partes ? opc.partes : (E.est && E.est.ok ? sugerirPartes(E.est) : []);
      E.acoes = {}; E.trechos = []; E.abertos = {}; E.tDe = E.tAte = ""; E.msgTrecho = ""; E.msg = (opc && opc.msg) || ""; E.pelaLetra = null; E.msgLetra = ""; pararSom(); E.tocando = null; render();
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
      if (t.id === "swAplicarLetra") {
        const pl = E.pelaLetra, novo = reescreverSecoes(E.est, E.partes), est2 = analisar(novo.abc);
        if (!pl || !est2.ok || est2.blocos.length !== E.est.blocos.length || est2.compassosTotal !== E.est.compassosTotal) { E.msg = "Não consegui aplicar a estrutura da letra com segurança; a melodia ficou como estava."; render(); return; }
        api.aplicarAbc(novo.abc); E.base = novo.abc; E.est = est2; E.partes = E.partes.map((p) => Object.assign({}, p, { secao: est2.blocos[p.blocos[0]].secao })); pl.aplicada = true;
        E.msg = `Pronto: a melodia agora tem ${E.partes.length} seções, uma para cada parte da sua letra. Nenhuma nota foi mexida. Para desfazer, use “Voltar ao original”.`; render(); return;
      }
      if (t.id === "swAjustarAndamento") {
        const pl = E.pelaLetra; if (!pl || !pl.sug) return;
        const novo = reescreverAndamento(E.base, pl.sug.para); api.aplicarAbc(novo); E.base = novo; E.est = analisar(novo);
        pl.cal = calibrar(E.est, pl.alin) || pl.cal; const de = pl.sug.de; pl.sug = sugerirAndamento(E.est, pl.cal);
        E.msg = `Andamento ajustado de ${de} para ${Math.round(E.est.campos.bpm)} BPM. As notas são as mesmas; só o ritmo de leitura mudou.`; render(); return;
      }
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
    // Alinha a letra do usuário (com as partes marcadas) à gravação e monta as partes da melodia com os nomes dela. Devolve uma frase de status.
    async function alinharComLetra(letra) {
      if (!E.est || !E.est.ok) return "";
      const sl = secoesDaLetra(letra); if (!sl.total) return "";
      const falha = (m) => { E.pelaLetra = null; E.msgLetra = m; render(); return "⚠️ " + m; };
      if (!sl.temCabecalhos) return falha("Para montar as partes pela letra, marque cada parte com uma linha só com o nome entre colchetes, como [Verso 1] ou [Refrão]. Mantive as partes sugeridas pela melodia.");
      if (sl.total < 4) return falha("A letra tem poucas linhas para montar as partes. Mantive as partes sugeridas pela melodia.");
      if (!api.alinharLetra) return "";
      E.msgLetra = "Alinhando a sua letra à gravação… (a IA ouve a gravação; pode levar um pouco)"; render();
      let r; try { r = await api.alinharLetra(textoParaAlinhar(sl)); } catch (e) { return falha(`Não consegui alinhar a letra à gravação (${e && e.message ? e.message : "erro"}). Mantive as partes sugeridas pela melodia.`); }
      const avisos = (r && r.avisos) || [], alin = ((r && r.linhas) || []).map((x) => ({ ini: x.ini, fim: x.fim }));
      if (avisos.some((a) => /igualmente/.test(a))) return falha("A IA não deu os tempos das linhas com segurança, então mantive as partes sugeridas pela melodia.");
      if (alin.length !== sl.planas.length) return falha("A IA devolveu um número de linhas diferente da sua letra, então mantive as partes sugeridas pela melodia.");
      const cal = calibrar(E.est, alin); if (!cal) return falha("Não consegui casar o tempo da gravação com o da melodia. Mantive as partes sugeridas pela melodia.");
      const res = partesPelaLetra(E.est, sl, alin, cal); if (!res.partes.length) return falha(res.avisos[0] || "Nenhuma parte da letra caiu em cima da melodia. Mantive as partes sugeridas.");
      E.partes = res.partes; E.acoes = {}; E.trechos = []; E.abertos = {}; E.msgLetra = "";
      E.pelaLetra = { sl, alin, cal, avisos: res.avisos.concat(avisos), duracao: r.duracao, aplicada: false, sug: sugerirAndamento(E.est, cal) };
      render(); return `✅ Letra alinhada: ${res.partes.length} partes montadas pela sua letra (veja o mapa abaixo).`;
    }
    return {
      carregar, alinharComLetra,
      aoEditarMelodia(valor) { if (!E.original) E.original = valor; recomecar(valor); },
      atualizarLetra,
      temEstrutura: () => !!(E.est && E.est.ok),
      temMarcasPendentes: () => !!(E.est && E.est.ok && (Object.keys(E.acoes).length > 0 || E.trechos.length > 0)),
      avisoDeMetrica(letra) { if (!E.est || !E.est.ok) return ""; const c = conferirEncaixe(E.est, E.partes, marcasAtuais(), letra); return c.nivel === "aviso" ? "⚠️ " + c.texto : ""; },
      _estado: E,
    };
  }
  raiz.SongwriterEstrutura = { criar, logica, _som: { agendarNotas, prepararSom, ouvirAbc, pararSom } };
})(typeof window !== "undefined" ? window : globalThis);
