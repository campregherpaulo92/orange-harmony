// ══════════════════════════════════════════════════════════════════════════
// partituraModelo.js — Representação musical ESTRUTURADA da partitura ABC.
//
// O assistente não "lê o texto ABC": ele trabalha em cima deste modelo, que sabe
// o que é voz, compasso (medida), nota, pausa, altura (MIDI), duração, ligadura,
// letra e cifra. O ABC continua sendo o formato do Songwriter; este modelo é só
// uma leitura dele (nada é gravado aqui).
//
// Identificadores estáveis (não dependem da paginação visual):
//     v<voz>-m<medida>-n<nota>   ex.: v1-m25-n2  = voz 1, medida 25, 2ª nota
//     v<voz>-m<medida>-p<pausa>  ex.: v0-m3-p1   = voz 0, medida 3, 1ª pausa
// A linha visual (`linha`) é só informação auxiliar.
// ══════════════════════════════════════════════════════════════════════════
(function () {
  const PT_NOTA = { C: "Dó", D: "Ré", E: "Mi", F: "Fá", G: "Sol", A: "Lá", B: "Si" };
  const BASE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const ACIDENTE_ABC = { "^^": 2, "^": 1, "=": 0, "_": -1, "__": -2 };
  const EPS = 1e-6;

  // ── nomes ────────────────────────────────────────────────────────────────
  function nomeCientifico(letra, acid, oitava) {
    return letra + (acid > 0 ? "#".repeat(acid) : acid < 0 ? "b".repeat(-acid) : "") + oitava;
  }
  function nomePortugues(letra, acid, oitava) {
    const a = acid === 1 ? " sustenido" : acid === 2 ? " dobrado sustenido" : acid === -1 ? " bemol" : acid === -2 ? " dobrado bemol" : "";
    return PT_NOTA[letra] + a + " (" + nomeCientifico(letra, acid, oitava) + ")";
  }
  function nomeSimples(letra, acid) {
    return PT_NOTA[letra] + (acid === 1 ? " sustenido" : acid === 2 ? " dobrado sustenido" : acid === -1 ? " bemol" : acid === -2 ? " dobrado bemol" : "");
  }

  // Duração (fração de semibreve) em palavras simples
  const FIGURAS = [
    [1, "semibreve"], [0.75, "mínima pontuada"], [0.5, "mínima"], [0.375, "semínima pontuada"], [0.25, "semínima"],
    [0.1875, "colcheia pontuada"], [0.125, "colcheia"], [0.09375, "semicolcheia pontuada"], [0.0625, "semicolcheia"], [0.03125, "fusa"],
  ];
  function nomeFigura(d) {
    for (const [v, n] of FIGURAS) if (Math.abs(d - v) < EPS) return n;
    return null;
  }
  function textoTempos(d, den) {
    const t = d * (den || 4);
    const r = Math.round(t * 100) / 100;
    if (Math.abs(r - 0.5) < EPS) return "meio tempo";
    if (Math.abs(r - 1) < EPS) return "1 tempo";
    return String(r).replace(".", ",") + " tempos";
  }
  function descreverDuracao(d, den) {
    const fig = nomeFigura(d);
    const t = textoTempos(d, den);
    return fig ? fig + " (" + t + ")" : t;
  }

  // ── vozes: pelo "V:" do texto (a posição visual da voz muda entre as linhas) ──
  function lerVozes(abc) {
    const lista = [];
    const marcas = [];
    const registrar = (id, resto, pos, fimPos) => {
      let v = lista.find((x) => x.id === id);
      if (!v) { v = { id, nome: "", ordem: lista.length }; lista.push(v); }
      const nm = /(?:name|nm)\s*=\s*(?:"([^"]*)"|(\S+))/i.exec(resto || "");
      if (nm && !v.nome) v.nome = (nm[1] || nm[2] || "").trim();
      marcas.push({ pos, fim: fimPos, id });
    };
    let m;
    const reLinha = /^[ \t]*V:[ \t]*([^\s\]]+)([^\n]*)/gm;
    while ((m = reLinha.exec(abc))) registrar(m[1], m[2], m.index, m.index + m[0].length);
    const reInline = /\[V:[ \t]*([^\s\]]+)([^\]]*)\]/g;
    while ((m = reInline.exec(abc))) registrar(m[1], m[2], m.index, m.index + m[0].length);
    marcas.sort((a, b) => a.pos - b.pos);
    lista.forEach((v) => { if (!v.nome) v.nome = v.id; });
    return { lista, marcas };
  }

  // ── tonalidade ───────────────────────────────────────────────────────────
  function infoTonalidade(k) {
    k = k || {};
    const acs = (k.accidentals || []).map((a) => ({ nota: String(a.note).toUpperCase(), valor: a.acc === "sharp" ? 1 : a.acc === "flat" ? -1 : 0 }));
    const raiz = (k.root || "C").toUpperCase();
    const acRaiz = k.acc === "#" ? " sustenido" : k.acc === "b" ? " bemol" : "";
    const modoBruto = (k.mode || "").toLowerCase();
    const menor = modoBruto === "m" || modoBruto === "min" || modoBruto === "minor" || modoBruto === "aeo";
    const modo = menor ? "menor" : !modoBruto || modoBruto === "maj" || modoBruto === "ion" ? "maior" : modoBruto;
    const sust = acs.filter((a) => a.valor > 0), bem = acs.filter((a) => a.valor < 0);
    let armadura = "sem sustenidos nem bemóis";
    if (sust.length) armadura = sust.length + (sust.length === 1 ? " sustenido" : " sustenidos") + " (" + sust.map((a) => PT_NOTA[a.nota]).join(", ") + ")";
    if (bem.length) armadura = bem.length + (bem.length === 1 ? " bemol" : " bemóis") + " (" + bem.map((a) => PT_NOTA[a.nota]).join(", ") + ")";
    return { raiz, nome: (PT_NOTA[raiz] || raiz) + acRaiz + " " + modo, armadura, acidentes: acs, mapa: Object.fromEntries(acs.map((a) => [a.nota, a.valor])), modo };
  }

  // ══ CONSTRUIR O MODELO ═══════════════════════════════════════════════════
  function construir(abc) {
    if (!abc || !abc.trim() || !window.ABCJS) return null;
    let tune;
    try { tune = window.ABCJS.parseOnly(abc)[0]; } catch (e) { return null; }
    if (!tune || !tune.lines) return null;

    const mf = tune.getMeterFraction() || { num: 4, den: 4 };
    const duracaoMedida = tune.getBarLength() || mf.num / mf.den;
    const anacruse = tune.getPickupLength ? tune.getPickupLength() || 0 : 0;
    const tonal = infoTonalidade(tune.getKeySignature());
    const meta = {
      compasso: { num: mf.num, den: mf.den, texto: mf.num + "/" + mf.den },
      duracaoMedida, anacruse, bpm: Math.round(tune.getBpm() || 0), tonalidade: tonal,
      titulo: (tune.metaText && tune.metaText.title) || "",
      avisosAbc: (tune.warnings || []).map((w) => String(w).replace(/<[^>]+>/g, "").trim()),
    };

    const msPorInicio = new Map();            // preenchido sob demanda por completarTempos()

    // elementos de todas as linhas
    const { lista: listaVozes, marcas } = lerVozes(abc);
    const vozPadrao = listaVozes.length ? null : { id: "1", nome: "Melodia", ordem: 0 };
    if (vozPadrao) listaVozes.push(vozPadrao);
    const idDaPosicao = (pos) => {
      let id = listaVozes[0].id;
      for (const mk of marcas) { if (mk.pos <= pos) id = mk.id; else break; }
      return id;
    };
    const coletados = [];
    tune.lines.forEach((l, li) => (l.staff || []).forEach((s) => (s.voices || []).forEach((v) => v.forEach((e) => {
      if (e && e.startChar != null && e.endChar != null) coletados.push({ e, li });
    }))));

    const vozes = listaVozes.map((v) => ({ id: v.id, nome: v.nome, ordem: v.ordem, eventos: [], medidas: {}, totalMedidas: 0, faixa: null }));
    const porId = new Map(vozes.map((v) => [v.id, v]));
    const brutosPorVoz = new Map(vozes.map((v) => [v.id, []]));
    coletados.forEach((c) => { const id = idDaPosicao(c.e.startChar); (brutosPorVoz.get(id) || brutosPorVoz.get(vozes[0].id)).push(c); });

    const porInicio = new Map();
    vozes.forEach((voz) => {
      const itens = brutosPorVoz.get(voz.id).sort((a, b) => a.e.startChar - b.e.startChar);
      let medida = anacruse > EPS ? 0 : 1, temConteudo = false, barraPendente = false;
      let nNota = 0, nPausa = 0, acMedida = new Map(), mapaTonal = tonal.mapa, esperada = duracaoMedida;
      let anterior = null;
      itens.forEach(({ e, li }) => {
        if (e.el_type === "key") { const k = infoTonalidade({ root: e.root, acc: e.acc, mode: e.mode, accidentals: e.accidentals }); mapaTonal = k.mapa; return; }
        if (e.el_type === "meter") { const val = e.value && e.value[0]; if (val && val.num && val.den) esperada = val.num / val.den; return; }
        if (e.el_type === "bar") { if (temConteudo) barraPendente = true; return; }
        if (e.el_type !== "note") return;
        if (barraPendente) { medida++; temConteudo = false; barraPendente = false; nNota = 0; nPausa = 0; acMedida = new Map(); }
        const ehPausa = !!e.rest;
        const multi = ehPausa && e.rest.type === "multimeasure" ? Math.max(1, Math.round(e.rest.text || e.duration / (esperada || 1))) : 1;
        const token = abc.slice(e.startChar, e.endChar);
        const tk = token.trim();
        const ini = e.startChar + (token.length - token.replace(/^\s+/, "").length);
        const ev = {
          voz: voz.id, vozNome: voz.nome, vozOrdem: voz.ordem, medida, compassos: multi,
          tipo: ehPausa ? "pausa" : "nota", inicio: e.startChar, fim: e.endChar, tokenIni: ini, tokenFim: ini + tk.length, token: tk,
          duracao: e.duration, linha: li, ms: msPorInicio.has(e.startChar) ? msPorInicio.get(e.startChar) : null,
          letra: e.lyric ? e.lyric.map((x) => x.syllable).join("") : "", cifra: e.chord && e.chord[0] ? e.chord[0].name : "",
          ligada: null, midi: null, midis: null, nome: "", nomePt: "", acidente: 0, oitava: null,
        };
        if (ehPausa) {
          nPausa++;
          ev.indice = nPausa; ev.id = "v" + voz.ordem + "-m" + medida + "-p" + nPausa; ev.nome = "pausa"; ev.nomePt = "pausa";
        } else {
          nNota++;
          ev.indice = nNota; ev.id = "v" + voz.ordem + "-m" + medida + "-n" + nNota;
          const ps = e.pitches || [];
          const calc = ps.map((p) => {
            const m = /^(\^\^|\^|__|_|=)?([A-Ga-g])([,']*)$/.exec(String(p.name || ""));
            if (!m) return null;
            const letra = m[2].toUpperCase();
            let oit = m[2] === m[2].toUpperCase() ? 4 : 5;
            for (const ch of m[3]) oit += ch === "'" ? 1 : -1;
            const chave = letra + oit;
            let acid;
            if (m[1] !== undefined && m[1] !== "") { acid = ACIDENTE_ABC[m[1]]; acMedida.set(chave, acid); }
            else if (acMedida.has(chave)) acid = acMedida.get(chave);
            else acid = mapaTonal[letra] || 0;
            return { letra, oit, acid, midi: 12 * (oit + 1) + BASE[letra] + acid, tieIni: !!p.startTie, tieFim: !!p.endTie };
          }).filter(Boolean);
          if (calc.length) {
            const p0 = calc[0];
            // nota ligada à anterior: toca o mesmo som (inclusive atravessando a barra).
            // Ligadura entre alturas DIFERENTES não vale: o abcjs toca as duas notas, e o modelo também.
            p0.continua = false;
            if (p0.tieFim && anterior && anterior.tipo === "nota" && anterior.midi != null && (anterior.ligada === "inicio" || anterior.ligada === "meio") && anterior.letra_ === p0.letra && anterior.oitava === p0.oit) {
              p0.midi = anterior.midi; p0.acid = anterior.acidente; p0.continua = true;
            }
            ev.letra_ = p0.letra; ev.oitava = p0.oit; ev.acidente = p0.acid; ev.midi = p0.midi;
            ev.nome = nomeCientifico(p0.letra, p0.acid, p0.oit); ev.nomePt = nomePortugues(p0.letra, p0.acid, p0.oit);
            ev.ligada = p0.continua ? (p0.tieIni ? "meio" : "fim") : p0.tieIni ? "inicio" : null;
            if (calc.length > 1) {
              ev.midis = calc.map((c) => c.midi);
              ev.acorde = true;
              ev.nome = calc.map((c) => nomeCientifico(c.letra, c.acid, c.oit)).join("+");
              ev.nomePt = calc.map((c) => nomeSimples(c.letra, c.acid)).join(" + ");
            }
          }
        }
        voz.eventos.push(ev);
        porInicio.set(ev.inicio, ev);
        anterior = ev;
        temConteudo = true;
        const med = voz.medidas[medida] || (voz.medidas[medida] = { numero: medida, eventos: [], duracao: 0, ini: ev.inicio, fim: ev.fim, esperada });
        med.eventos.push(ev); med.duracao += ev.duracao; med.fim = ev.fim; med.esperada = med.esperada || esperada;
        if (multi > 1) { medida += multi - 1; barraPendente = true; temConteudo = true; }
      });
      voz.eventos.forEach((ev, i) => {
        if (ev.ligada !== "inicio" && ev.ligada !== "meio") return;
        const prox = voz.eventos.slice(i + 1).find((x) => x.tipo === "nota");
        const continua = prox && (prox.ligada === "fim" || prox.ligada === "meio") && prox.midi === ev.midi;
        if (!continua) ev.ligada = ev.ligada === "meio" ? "fim" : null;
      });
      voz.totalMedidas = voz.eventos.length ? Math.max(...voz.eventos.map((x) => x.medida + (x.compassos || 1) - 1)) : 0;
      const alturas = voz.eventos.filter((x) => x.midi != null).map((x) => x.midi);
      voz.faixa = alturas.length ? { min: Math.min(...alturas), max: Math.max(...alturas) } : null;
      voz.eventos.forEach((ev, i) => { ev.ordem = i; });
    });

    const eventos = [].concat(...vozes.map((v) => v.eventos)).sort((a, b) => a.inicio - b.inicio);
    return { abc, meta, vozes, eventos, porInicio, porIdVoz: porId };
  }

  // O abcjs só calcula os tempos de uma partitura DESENHADA. Para não desenhar a cada leitura, o modelo nasce sem
  // tempos e quem precisa deles (prévia de áudio, "aos 12 segundos", duração total) pede aqui.
  function completarTempos(modelo) {
    if (!modelo || modelo._temposOk) return modelo;
    modelo._temposOk = true;
    try {
      const tv = window.ABCJS.renderAbc(document.createElement("div"), modelo.abc, {})[0];
      const t = new window.ABCJS.TimingCallbacks(tv, {});
      const mapa = new Map();
      (t.noteTimings || []).forEach((ev) => {
        if (ev.type !== "event") return;
        (ev.startCharArray || [ev.startChar]).forEach((sc) => { if (sc != null && !mapa.has(sc)) mapa.set(sc, ev.milliseconds); });
      });
      modelo.eventos.forEach((e) => { if (mapa.has(e.inicio)) e.ms = mapa.get(e.inicio); });
      modelo.meta.duracaoTotalMs = Math.round(t.lastMoment || 0);
    } catch (e) { /* sem tempos: quem chamou usa um plano B */ }
    return modelo;
  }

  // ══ LOCALIZAR (medida / nota / posição) ══════════════════════════════════
  function medidaDaVoz(voz, n) {
    if (voz.medidas[n]) return voz.medidas[n];
    const ev = voz.eventos.find((e) => e.compassos > 1 && n > e.medida && n < e.medida + e.compassos);
    return ev ? { numero: n, eventos: [ev], duracao: ev.duracao / ev.compassos, esperada: ev.duracao / ev.compassos, coberta: true } : null;
  }

  function notasDaMedida(voz, n) {
    const m = voz.medidas[n];
    return m ? m.eventos.filter((e) => e.tipo === "nota") : [];
  }

  // ref: { voz?, medida?, nota? (número) | ordinal:'ultima'|'penultima', apos?: 'pausa', linhaDe?: inicio }
  // Devolve { ok, evento } | { ok:false, motivo, opcoes? } — sem chutar quando houver dúvida.
  function localizar(modelo, ref, ctx) {
    ctx = ctx || {};
    const vozes = modelo.vozes.filter((v) => v.eventos.length);
    const escolherVoz = (candidatas, motivoVazio) => {
      if (ref.voz) {
        const v = vozes.find((x) => x.id === ref.voz);
        return v ? { voz: v } : { erro: "Não encontrei essa voz." };
      }
      if (ctx.vozPreferida) { const v = candidatas.find((x) => x.id === ctx.vozPreferida); if (v) return { voz: v }; }
      if (candidatas.length === 1) return { voz: candidatas[0] };
      if (!candidatas.length) return { erro: motivoVazio };
      return { ambiguo: candidatas };
    };

    // última nota da linha visual de uma nota de referência
    if (ref.ultimaDaLinha != null) {
      const base = modelo.porInicio.get(ref.ultimaDaLinha);
      if (!base) return { ok: false, motivo: "Não achei a linha dessa nota." };
      const voz = modelo.vozes.find((v) => v.id === base.voz);
      const naLinha = voz.eventos.filter((e) => e.tipo === "nota" && e.linha === base.linha);
      return naLinha.length ? { ok: true, evento: naLinha[naLinha.length - 1], aviso: "linha visual " + (base.linha + 1) } : { ok: false, motivo: "Não há notas nessa linha." };
    }

    if (ref.medida != null) {
      const comMedida = vozes.filter((v) => { const m = medidaDaVoz(v, ref.medida); return m && m.eventos.length; });
      const comNotas = comMedida.filter((v) => medidaDaVoz(v, ref.medida).eventos.some((e) => e.tipo === "nota"));
      // se só uma voz tem NOTAS ali (a outra só tem pausa), não precisa perguntar
      const cand = comNotas.length === 1 ? comNotas : comMedida;
      const r = escolherVoz(cand, "Não existe a medida " + ref.medida + " (a música vai até a medida " + Math.max(0, ...vozes.map((v) => v.totalMedidas)) + ").");
      if (r.erro) return { ok: false, motivo: r.erro };
      if (r.ambiguo) return { ok: false, ambiguo: "voz", opcoes: r.ambiguo.map((v) => ({ id: v.id, nome: v.nome })), motivo: "A medida " + ref.medida + " existe em mais de uma voz." };
      const voz = r.voz;
      const med = medidaDaVoz(voz, ref.medida);
      if (!med) return { ok: false, motivo: "A voz " + voz.nome + " não tem a medida " + ref.medida + "." };
      const notas = med.eventos.filter((e) => e.tipo === "nota");
      if (ref.nota == null && !ref.ordinal) return { ok: true, medida: med, voz };
      let alvo = null;
      if (ref.ordinal === "ultima") alvo = notas[notas.length - 1];
      else if (ref.ordinal === "penultima") alvo = notas[notas.length - 2];
      else alvo = notas[ref.nota - 1];
      if (!alvo) return { ok: false, motivo: "A medida " + ref.medida + " (" + voz.nome + ") tem " + notas.length + (notas.length === 1 ? " nota" : " notas") + ", não achei a nota pedida." };
      return { ok: true, evento: alvo, medida: med, voz };
    }
    return { ok: false, motivo: "Não entendi qual parte da partitura você quer." };
  }

  // nota N depois da primeira pausa que vem depois de 'baseInicio'
  function notaDepoisDaPausa(modelo, baseInicio, n) {
    const base = modelo.porInicio.get(baseInicio);
    if (!base) return null;
    const voz = modelo.vozes.find((v) => v.id === base.voz);
    const i0 = voz.eventos.findIndex((e) => e.inicio >= baseInicio);
    let p = -1;
    for (let i = Math.max(0, i0); i < voz.eventos.length; i++) { if (voz.eventos[i].tipo === "pausa") { p = i; break; } }
    if (p < 0) return null;
    const depois = voz.eventos.slice(p + 1).filter((e) => e.tipo === "nota");
    return depois[n - 1] || null;
  }

  // ══ COMPARAR ORIGINAL x ATUAL ════════════════════════════════════════════
  const chaveEv = (e) => e.tipo + "|" + (e.midis ? e.midis.join(",") : e.midi) + "|" + Math.round(e.duracao * 1e5);

  // alinhamento (LCS) de duas sequências de eventos de uma medida
  function alinhar(a, b) {
    // mesmo número de eventos: a pessoa mexeu "no lugar" (trocou a altura ou a duração), então compara posição por posição.
    // Só quando entra ou sai nota é que o alinhamento por sequência (abaixo) decide quem foi adicionada/removida.
    if (a.length === b.length) return a.map((o, i) => ({ o, a: b[i] }));
    const n = a.length, m = b.length;
    const L = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = chaveEv(a[i]) === chaveEv(b[j]) ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    const out = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (chaveEv(a[i]) === chaveEv(b[j])) { out.push({ o: a[i], a: b[j] }); i++; j++; }
      else if (L[i + 1][j] >= L[i][j + 1]) { out.push({ o: a[i], a: null }); i++; }
      else { out.push({ o: null, a: b[j] }); j++; }
    }
    while (i < n) out.push({ o: a[i++], a: null });
    while (j < m) out.push({ o: null, a: b[j++] });
    // runs de "só original" + "só atual" viram alterações pareadas
    const res = [];
    let k = 0;
    while (k < out.length) {
      if (out[k].o && out[k].a) { res.push(out[k]); k++; continue; }
      const os = [], as = [];
      while (k < out.length && !(out[k].o && out[k].a)) { if (out[k].o) os.push(out[k].o); if (out[k].a) as.push(out[k].a); k++; }
      const comum = Math.min(os.length, as.length);
      for (let q = 0; q < comum; q++) res.push({ o: os[q], a: as[q] });
      for (let q = comum; q < os.length; q++) res.push({ o: os[q], a: null });
      for (let q = comum; q < as.length; q++) res.push({ o: null, a: as[q] });
    }
    return res;
  }

  function classificar(o, a) {
    if (o && !a) return "removida";
    if (!o && a) return "adicionada";
    const igualAltura = (o.midis ? o.midis.join(",") : o.midi) === (a.midis ? a.midis.join(",") : a.midi);
    const igualDur = Math.abs(o.duracao - a.duracao) < EPS;
    if (o.tipo !== a.tipo) return o.tipo === "nota" ? "nota_virou_pausa" : "pausa_virou_nota";
    if (igualAltura && igualDur) return o.cifra !== a.cifra ? "cifra" : o.letra !== a.letra ? "letra" : "igual";
    if (igualAltura) return "duracao";
    if (igualDur) return "altura";
    return "altura_e_duracao";
  }

  function comparar(original, atual) {
    const dif = [];
    const metaDif = [];
    if (!original || !atual) return { diferencas: dif, meta: metaDif, resumo: {} };
    if (original.meta.tonalidade.nome !== atual.meta.tonalidade.nome) metaDif.push({ tipo: "tonalidade", antes: original.meta.tonalidade.nome, depois: atual.meta.tonalidade.nome });
    if (original.meta.compasso.texto !== atual.meta.compasso.texto) metaDif.push({ tipo: "compasso", antes: original.meta.compasso.texto, depois: atual.meta.compasso.texto });
    if (original.meta.bpm !== atual.meta.bpm) metaDif.push({ tipo: "andamento", antes: original.meta.bpm, depois: atual.meta.bpm });
    atual.vozes.forEach((va) => {
      const vo = original.vozes.find((x) => x.id === va.id);
      if (!vo) { dif.push({ tipo: "voz_adicionada", voz: va.id, vozNome: va.nome, medida: null, atual: null, original: null }); return; }
      const nums = new Set([...Object.keys(va.medidas), ...Object.keys(vo.medidas)].map(Number));
      [...nums].sort((x, y) => x - y).forEach((n) => {
        const ma = va.medidas[n] ? va.medidas[n].eventos : [], mo = vo.medidas[n] ? vo.medidas[n].eventos : [];
        alinhar(mo, ma).forEach((par) => {
          const tipo = classificar(par.o, par.a);
          if (tipo === "igual") return;
          const ref = par.a || par.o;
          dif.push({
            tipo, voz: va.id, vozNome: va.nome, medida: n, nota: ref.indice, idAtual: par.a ? par.a.id : null, idOriginal: par.o ? par.o.id : null,
            original: par.o, atual: par.a,
            deltaSemitons: par.o && par.a && par.o.midi != null && par.a.midi != null ? par.a.midi - par.o.midi : null,
          });
        });
      });
    });
    original.vozes.forEach((vo) => { if (!atual.vozes.find((x) => x.id === vo.id)) dif.push({ tipo: "voz_removida", voz: vo.id, vozNome: vo.nome, medida: null }); });
    const resumo = {};
    dif.forEach((d) => { resumo[d.tipo] = (resumo[d.tipo] || 0) + 1; });
    return { diferencas: dif, meta: metaDif, resumo };
  }

  // evento da ORIGINAL que corresponde a um evento da ATUAL (pela mesma medida e alinhamento)
  function correspondenteNaOriginal(original, atual, evAtual) {
    if (!original || !evAtual) return null;
    const vo = original.vozes.find((x) => x.id === evAtual.voz), va = atual.vozes.find((x) => x.id === evAtual.voz);
    if (!vo || !va) return null;
    const ma = va.medidas[evAtual.medida] ? va.medidas[evAtual.medida].eventos : [], mo = vo.medidas[evAtual.medida] ? vo.medidas[evAtual.medida].eventos : [];
    const par = alinhar(mo, ma).find((p) => p.a && p.a.inicio === evAtual.inicio);
    return par ? par.o : null;
  }

  // ══ VALIDAR ══════════════════════════════════════════════════════════════
  function validar(modelo, original) {
    const problemas = [];
    if (!modelo) return problemas;
    modelo.meta.avisosAbc.forEach((w) => problemas.push({ gravidade: "erro", tipo: "sintaxe", texto: "O texto ABC tem um aviso de sintaxe: " + w }));
    modelo.vozes.forEach((voz) => {
      const nums = Object.keys(voz.medidas).map(Number).sort((a, b) => a - b);
      const ultimo = nums[nums.length - 1];
      nums.forEach((n) => {
        const m = voz.medidas[n];
        const esperada = n === 0 && modelo.meta.anacruse > EPS ? modelo.meta.anacruse : m.esperada || modelo.meta.duracaoMedida;
        const multi = m.eventos.some((e) => e.compassos > 1);
        if (multi) return;
        if (Math.abs(m.duracao - esperada) > 1e-4) {
          const ehUltima = n === ultimo;
          problemas.push({
            gravidade: ehUltima ? "aviso" : "erro", tipo: "compasso_incompleto", voz: voz.id, vozNome: voz.nome, medida: n, inicios: m.eventos.map((e) => e.inicio),
            texto: "A medida " + n + " (" + voz.nome + ") soma " + descreverSoma(m.duracao, modelo.meta.compasso.den) + ", mas o compasso " + modelo.meta.compasso.texto + " pede " + descreverSoma(esperada, modelo.meta.compasso.den) + "." + (ehUltima ? " (é a última medida, então pode ser só o fim da música)" : ""),
          });
        }
      });
      const notas = voz.eventos.filter((e) => e.tipo === "nota" && e.midi != null && !e.acorde);
      for (let i = 1; i < notas.length; i++) {
        const salto = Math.abs(notas[i].midi - notas[i - 1].midi);
        if (salto >= 12 && notas[i].medida - notas[i - 1].medida <= 1) {
          problemas.push({ gravidade: "aviso", tipo: "salto_grande", voz: voz.id, vozNome: voz.nome, medida: notas[i].medida, inicios: [notas[i - 1].inicio, notas[i].inicio], texto: "Salto grande entre duas notas seguidas na medida " + notas[i].medida + " (" + voz.nome + "): de " + notas[i - 1].nome + " para " + notas[i].nome + " (" + salto + " semitons)." });
        }
      }
      // letra: notas sem sílaba no meio de uma sequência com letra
      const comLetra = voz.eventos.filter((e) => e.tipo === "nota" && e.ligada !== "fim");
      const idxLetra = comLetra.map((e, i) => (e.letra ? i : -1)).filter((i) => i >= 0);
      if (idxLetra.length > 1) {
        const primeira = idxLetra[0], ultima = idxLetra[idxLetra.length - 1];
        const faltando = comLetra.slice(primeira, ultima + 1).filter((e) => !e.letra);
        if (faltando.length) problemas.push({ gravidade: "aviso", tipo: "letra_desalinhada", voz: voz.id, vozNome: voz.nome, medida: faltando[0].medida, inicios: faltando.map((e) => e.inicio), texto: faltando.length + (faltando.length === 1 ? " nota está sem sílaba" : " notas estão sem sílaba") + " no meio da letra (primeira na medida " + faltando[0].medida + ", " + voz.nome + "). A letra pode estar deslocada." });
      }
    });
    if (original) {
      const c = comparar(original, modelo);
      c.diferencas.forEach((d) => {
        if (d.tipo === "duracao" || d.tipo === "altura_e_duracao") problemas.push({ gravidade: "aviso", tipo: "duracao_alterada", voz: d.voz, vozNome: d.vozNome, medida: d.medida, inicios: [d.atual.inicio], texto: "Medida " + d.medida + " (" + d.vozNome + "), nota " + d.nota + ": a duração mudou em relação à original (de " + descreverDuracao(d.original.duracao, modelo.meta.compasso.den) + " para " + descreverDuracao(d.atual.duracao, modelo.meta.compasso.den) + ")." });
        if (d.tipo === "removida" || d.tipo === "adicionada") problemas.push({ gravidade: "info", tipo: d.tipo === "removida" ? "nota_removida" : "nota_adicionada", voz: d.voz, vozNome: d.vozNome, medida: d.medida, inicios: d.atual ? [d.atual.inicio] : [], texto: (d.tipo === "removida" ? "Uma nota da original foi removida" : "Uma nota nova foi adicionada") + " na medida " + d.medida + " (" + d.vozNome + ")." });
      });
    }
    return problemas;
  }
  function descreverSoma(d, den) {
    const t = Math.round(d * (den || 4) * 100) / 100;
    return String(t).replace(".", ",") + (t === 1 ? " tempo" : " tempos");
  }

  // ══ EXPLICAR EM LINGUAGEM SIMPLES ════════════════════════════════════════
  function registro(modelo, ev) {
    const voz = modelo.vozes.find((v) => v.id === ev.voz);
    if (!voz || !voz.faixa || ev.midi == null) return "";
    const { min, max } = voz.faixa;
    if (max - min < 4) return "";
    const p = (ev.midi - min) / (max - min);
    return p < 0.34 ? "uma nota grave dentro desta melodia" : p > 0.66 ? "uma nota aguda dentro desta melodia" : "uma nota do meio da melodia";
  }

  function intervaloTexto(semitons) {
    const n = Math.abs(semitons);
    const nomes = { 0: "a mesma nota", 1: "um semitom", 2: "um tom", 3: "um tom e meio", 4: "dois tons", 5: "dois tons e meio", 6: "três tons", 7: "três tons e meio", 8: "quatro tons", 9: "quatro tons e meio", 10: "cinco tons", 11: "cinco tons e meio", 12: "uma oitava" };
    return nomes[n] !== undefined ? nomes[n] : n + " semitons";
  }

  function explicarEvento(modelo, ev) {
    const den = modelo.meta.compasso.den;
    const lugar = "medida " + ev.medida + ", " + (ev.tipo === "nota" ? "nota " : "pausa ") + ev.indice + " (" + ev.vozNome + ")";
    if (ev.tipo === "pausa") {
      const multi = ev.compassos > 1 ? " Ela dura " + ev.compassos + " compassos inteiros." : "";
      return "Na " + lugar + " há uma pausa: um silêncio de " + descreverDuracao(ev.duracao, den) + "." + multi;
    }
    const voz = modelo.vozes.find((v) => v.id === ev.voz);
    const i = voz.eventos.indexOf(ev);
    const ant = voz.eventos.slice(0, i).reverse().find((e) => e.tipo === "nota" && e.midi != null);
    const prox = voz.eventos.slice(i + 1).find((e) => e.tipo === "nota" && e.midi != null);
    const partes = ["Na " + lugar + " a nota é " + ev.nomePt + (ev.acorde ? "" : ", " + (registro(modelo, ev) || "")).replace(/, $/, "") + "."];
    partes.push("Ela dura " + descreverDuracao(ev.duracao, den) + ".");
    if (ev.ligada === "inicio") partes.push("Ela está ligada à próxima nota do mesmo som, então as duas soam como uma nota só, mais longa.");
    if (ev.ligada === "fim") partes.push("Ela continua a nota anterior (ligadura), por isso não é um som novo.");
    if (ev.acidente !== 0 && ev.midi != null) partes.push(ev.acidente > 0 ? "Ela é sustenida: fica meio tom (um semitom) acima da nota natural." : "Ela é bemol: fica meio tom (um semitom) abaixo da nota natural.");
    if (ant && !ev.acorde) {
      const d = ev.midi - ant.midi;
      partes.push(d === 0 ? "Repete a nota anterior." : "Em relação à nota anterior (" + ant.nome + ") ela " + (d > 0 ? "sobe " : "desce ") + intervaloTexto(d) + " (" + Math.abs(d) + " semitons).");
    }
    if (prox && !ev.acorde) {
      const d = prox.midi - ev.midi;
      partes.push(d === 0 ? "A próxima nota é igual." : "A próxima nota " + (d > 0 ? "sobe " : "desce ") + intervaloTexto(d) + ".");
    }
    if (ev.letra) partes.push("A sílaba cantada aqui é \"" + ev.letra + "\".");
    if (ev.cifra) partes.push("O acorde marcado aqui é " + ev.cifra + ".");
    return partes.join(" ");
  }

  function contorno(notas) {
    const m = notas.filter((n) => n.midi != null && !n.acorde);
    if (m.length < 2) return "";
    let sobe = 0, desce = 0, igual = 0;
    for (let i = 1; i < m.length; i++) { const d = m[i].midi - m[i - 1].midi; if (d > 0) sobe++; else if (d < 0) desce++; else igual++; }
    const total = m[m.length - 1].midi - m[0].midi;
    const forma = total > 2 ? "sobe no geral" : total < -2 ? "desce no geral" : "termina perto de onde começou";
    return "O desenho da melodia " + forma + " (" + sobe + (sobe === 1 ? " passo sobe" : " passos sobem") + ", " + desce + (desce === 1 ? " desce" : " descem") + (igual ? ", " + igual + " repetidas" : "") + ").";
  }

  function descreverNotas(modelo, evs) {
    return evs.map((e) => (e.tipo === "pausa" ? "pausa" : e.nome) + " (" + (e.tipo === "pausa" ? "" : "") + descreverDuracao(e.duracao, modelo.meta.compasso.den).replace(/ \(.*\)/, "") + ")").join(" · ");
  }

  function explicarMedida(modelo, voz, n) {
    const m = medidaDaVoz(voz, n);
    if (!m) return "A voz " + voz.nome + " não tem a medida " + n + ".";
    const den = modelo.meta.compasso.den;
    const notas = m.eventos.filter((e) => e.tipo === "nota");
    const linhas = ["Medida " + n + " (" + voz.nome + "): " + notas.length + (notas.length === 1 ? " nota" : " notas") + (m.eventos.length > notas.length ? " e " + (m.eventos.length - notas.length) + (m.eventos.length - notas.length === 1 ? " pausa" : " pausas") : "") + "."];
    linhas.push("Em ordem: " + descreverNotas(modelo, m.eventos) + ".");
    const soma = descreverSoma(m.duracao, den), esp = descreverSoma(m.esperada || modelo.meta.duracaoMedida, den);
    linhas.push(Math.abs(m.duracao - (m.esperada || modelo.meta.duracaoMedida)) < 1e-4 ? "As durações somam " + soma + ", que é exatamente o que o compasso " + modelo.meta.compasso.texto + " pede." : "As durações somam " + soma + ", mas o compasso " + modelo.meta.compasso.texto + " pede " + esp + ".");
    const c = contorno(notas); if (c) linhas.push(c);
    const letra = notas.filter((x) => x.letra).map((x) => x.letra);
    if (letra.length) linhas.push("Letra: " + letra.join(" ") + ".");
    return linhas.join("\n");
  }

  function explicarGeral(modelo) {
    completarTempos(modelo);
    const mt = modelo.meta;
    const linhas = [];
    linhas.push("A música está em " + mt.tonalidade.nome + " (" + mt.tonalidade.armadura + "), no compasso " + mt.compasso.texto + (mt.bpm ? ", com andamento de cerca de " + mt.bpm + " batidas por minuto" : "") + ".");
    if (mt.anacruse > EPS) linhas.push("Ela começa com uma anacruse: uma primeira medida incompleta (medida 0).");
    modelo.vozes.filter((v) => v.eventos.length).forEach((v) => {
      const notas = v.eventos.filter((e) => e.tipo === "nota");
      const f = v.faixa ? " Vai da nota " + nomeDeMidi(v.faixa.min) + " até " + nomeDeMidi(v.faixa.max) + "." : "";
      linhas.push("Voz \"" + v.nome + "\": " + v.totalMedidas + " medidas, " + notas.length + " notas." + f);
    });
    if (mt.duracaoTotalMs) linhas.push("Duração aproximada: " + Math.round(mt.duracaoTotalMs / 1000) + " segundos.");
    return linhas.join("\n");
  }
  function nomeDeMidi(m) {
    const nomes = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    return nomes[m % 12] + (Math.floor(m / 12) - 1);
  }

  // ── texto de uma diferença ───────────────────────────────────────────────
  function textoDiferenca(modelo, d) {
    const den = modelo.meta.compasso.den;
    const onde = "medida " + d.medida + ", nota " + d.nota + " (" + d.vozNome + ")";
    switch (d.tipo) {
      case "altura": {
        const s = d.deltaSemitons;
        return onde + ": a altura mudou de " + d.original.nome + " para " + d.atual.nome + " (" + (s > 0 ? "subiu " : "desceu ") + Math.abs(s) + (Math.abs(s) === 1 ? " semitom" : " semitons") + "). O ritmo é o mesmo.";
      }
      case "duracao": return onde + ": a duração mudou de " + descreverDuracao(d.original.duracao, den) + " para " + descreverDuracao(d.atual.duracao, den) + ". A altura é a mesma.";
      case "altura_e_duracao": return onde + ": mudou a altura (" + d.original.nome + " → " + d.atual.nome + ") e também a duração (" + descreverDuracao(d.original.duracao, den) + " → " + descreverDuracao(d.atual.duracao, den) + ").";
      case "adicionada": return onde + ": nota nova (" + d.atual.nome + ", " + descreverDuracao(d.atual.duracao, den) + ") que não existia na original.";
      case "removida": return "Medida " + d.medida + " (" + d.vozNome + "): uma nota da original foi removida (" + d.original.nome + ", " + descreverDuracao(d.original.duracao, den) + ").";
      case "nota_virou_pausa": return onde + ": uma nota (" + d.original.nome + ") virou pausa.";
      case "pausa_virou_nota": return onde + ": uma pausa virou nota (" + d.atual.nome + ").";
      case "cifra": return onde + ": o acorde mudou de " + (d.original.cifra || "(nenhum)") + " para " + (d.atual.cifra || "(nenhum)") + ".";
      case "letra": return onde + ": a sílaba mudou de \"" + (d.original.letra || "") + "\" para \"" + (d.atual.letra || "") + "\".";
      case "voz_adicionada": return "A voz \"" + d.vozNome + "\" foi adicionada.";
      case "voz_removida": return "A voz \"" + d.vozNome + "\" foi removida.";
      default: return onde + ": " + d.tipo;
    }
  }

  // ══ EDIÇÃO MUSICAL VERIFICADA ════════════════════════════════════════════
  // Mudar uma nota em ABC pode mexer em OUTRAS: um sustenido vale até o fim da medida, então as notas iguais
  // que vêm depois mudariam de som sem ninguém pedir. Por isso toda edição passa por aqui:
  //   1) escreve a nova nota (sustenido ou bemol conforme a tonalidade);
  //   2) relê a partitura pelo modelo e confere o som de TODAS as notas;
  //   3) se alguma outra mudou, devolve a ela o som original com um acidente explícito (e avisa).
  const TAB_SUST = [["C", 0], ["C", 1], ["D", 0], ["D", 1], ["E", 0], ["F", 0], ["F", 1], ["G", 0], ["G", 1], ["A", 0], ["A", 1], ["B", 0]];
  const TAB_BEM = [["C", 0], ["D", -1], ["D", 0], ["E", -1], ["E", 0], ["F", 0], ["G", -1], ["G", 0], ["A", -1], ["A", 0], ["B", -1], ["B", 0]];
  const ACC_TOK = { "2": "^^", "1": "^", "0": "=", "-1": "_", "-2": "__" };

  function soletrar(midi, tonal, alternativa) {
    const pc = ((midi % 12) + 12) % 12;
    const bem = tonal.acidentes.some((a) => a.valor < 0);
    const tab = bem !== !!alternativa ? TAB_BEM : TAB_SUST;
    let letra = tab[pc][0], acid = tab[pc][1];
    if (!alternativa) {                                           // a própria tonalidade pode "dar" esse som (ex.: Fá# em Ré maior)
      for (const L of "CDEFGAB") { const ak = tonal.mapa[L] || 0; if ((((BASE[L] + ak) % 12) + 12) % 12 === pc) { letra = L; acid = ak; break; } }
    }
    return { letra, acid, oit: Math.round((midi - acid - BASE[letra]) / 12) - 1 };
  }

  function analisarNota(core) {
    let i = 0;
    for (;;) {
      const c = core[i];
      if (c === '"' || c === "!" || c === "+") { const f = core.indexOf(c, i + 1); if (f < 0) return null; i = f + 1; }
      else if (c === "{") { const f = core.indexOf("}", i + 1); if (f < 0) return null; i = f + 1; }
      else if (c === "(") { const m = /^\(\d+(?::\d+){0,2}/.exec(core.slice(i)); if (!m) return null; i += m[0].length; }
      else if (c && ".~HLMOPSTuv".indexOf(c) >= 0) i += 1;
      else break;
    }
    const m = /^(\^\^|\^|__|_|=)?([A-Ga-g])([,']*)([\s\S]*)$/.exec(core.slice(i));
    if (!m) return null;
    let oit = m[2] === m[2].toUpperCase() ? 4 : 5;
    for (const ch of m[3]) oit += ch === "'" ? 1 : -1;
    return { prefixo: core.slice(0, i), acidente: m[1] || "", letra: m[2].toUpperCase(), oit, resto: m[4] };
  }
  const letraOitava = (letra, oit) => (oit >= 5 ? letra.toLowerCase() + "'".repeat(oit - 5) : letra + ",".repeat(4 - oit));

  // mudancas: [{ inicio, midiAlvo } | { inicio, novoRaw }]  (novoRaw = a nota já escrita por quem chamou, sem se importar com acidentes alheios)
  function planejarMudanca(abc, mudancas) {
    const M0 = construir(abc);
    if (!M0) return { ok: false, erro: "Não consegui ler a partitura." };
    if (!mudancas || !mudancas.length) return { ok: false, erro: "Não há nada para mudar." };
    const evs = M0.eventos, tonal = M0.meta.tonalidade;
    const indiceDe = new Map(evs.map((e, i) => [e.inicio, i]));
    const onde = (e) => "medida " + e.medida + ", nota " + e.indice + " (" + e.vozNome + ")";
    const specs = new Map();
    for (const m of mudancas) {
      const i = indiceDe.get(m.inicio);
      if (i == null) return { ok: false, erro: "Não achei a nota que seria mudada." };
      const e = evs[i];
      if (e.tipo !== "nota") return { ok: false, erro: "Na " + onde(e).replace("nota", "pausa") + " há uma pausa, e pausa não tem altura." };
      if (e.acorde) return { ok: false, erro: "A nota da " + onde(e) + " faz parte de um acorde escrito entre colchetes, e eu ainda não mudo acordes." };
      const a = analisarNota(e.token);
      if (!a) return { ok: false, erro: "Não consegui entender como a nota da " + onde(e) + " está escrita (" + e.token + ")." };
      specs.set(i, { m, a, e });
    }
    for (const [, sp] of specs) {                                 // ligadura: as duas pontas mudam juntas ou nenhuma
      const e = sp.e, voz = M0.vozes.find((v) => v.id === e.voz), k = voz.eventos.indexOf(e);
      const vizinhos = [];
      if (e.ligada === "inicio" || e.ligada === "meio") vizinhos.push(voz.eventos.slice(k + 1).find((x) => x.tipo === "nota"));
      if (e.ligada === "fim" || e.ligada === "meio") vizinhos.push(voz.eventos.slice(0, k).reverse().find((x) => x.tipo === "nota"));
      for (const v of vizinhos) if (v && !specs.has(indiceDe.get(v.inicio))) return { ok: false, erro: "A nota da " + onde(e) + " está ligada (ligadura) à vizinha, e mudar só uma delas desfaria a ligadura. Escolha as duas juntas." };
    }
    const edits = new Map();
    for (const [i, sp] of specs) {
      if (sp.m.midiAlvo != null) {
        if (sp.m.midiAlvo < 21 || sp.m.midiAlvo > 108) return { ok: false, erro: "A nota da " + onde(sp.e) + " ficaria fora da extensão do piano." };
        const so = soletrar(sp.m.midiAlvo, tonal, false);
        edits.set(i, { letra: so.letra, oit: so.oit, acc: so.acid !== (tonal.mapa[so.letra] || 0) ? ACC_TOK[so.acid] : null, alvo: sp.m.midiAlvo, alternativa: false });
      } else {
        const a2 = analisarNota(String(sp.m.novoRaw).trim());
        if (!a2) return { ok: false, erro: "Não consegui entender a nota nova." };
        edits.set(i, { letra: a2.letra, oit: a2.oit, acc: a2.acidente || null, alvo: null });
      }
    }
    const emitir = (i, ed) => {
      const e = evs[i], raw = abc.slice(e.inicio, e.fim), a = analisarNota(e.token);
      return raw.match(/^\s*/)[0] + a.prefixo + (ed.acc || "") + letraOitava(ed.letra, ed.oit) + a.resto + raw.match(/\s*$/)[0];
    };
    const montar = () => {
      let out = "", cur = 0;
      [...edits.keys()].sort((x, y) => evs[x].inicio - evs[y].inicio).forEach((i) => { out += abc.slice(cur, evs[i].inicio) + emitir(i, edits.get(i)); cur = evs[i].fim; });
      return out + abc.slice(cur);
    };
    for (let passo = 0; passo < 40; passo++) {
      const texto = montar();
      const M1 = construir(texto);
      if (!M1 || M1.eventos.length !== evs.length) return { ok: false, erro: "Essa mudança deixaria a partitura ilegível, então não apliquei." };
      let mexeu = false;
      const tratadasNaMedida = new Set();            // corrige UMA nota por medida e voz de cada vez: as seguintes costumam se acertar sozinhas (o bequadro também vale até a barra)
      for (let i = 0; i < evs.length; i++) {
        const e0 = evs[i], e1 = M1.eventos[i];
        if (e0.tipo !== "nota") continue;
        if (e0.acorde) { if (JSON.stringify(e0.midis) !== JSON.stringify(e1.midis)) return { ok: false, erro: "Essa mudança alteraria um acorde próximo, então não apliquei." }; continue; }
        const ed = edits.get(i);
        const esperado = ed ? ed.alvo : e0.midi;                  // null = livre (a pessoa escolheu a nota exata)
        if (esperado == null || e1.midi === esperado) continue;
        const chaveMedida = e0.voz + ":" + e0.medida;
        if (tratadasNaMedida.has(chaveMedida)) continue;
        tratadasNaMedida.add(chaveMedida);
        const letra = ed ? ed.letra : e0.letra_, oit = ed ? ed.oit : e0.oitava;
        const acid = esperado - (12 * (oit + 1) + BASE[letra]);
        if (acid < -2 || acid > 2) {
          if (ed && !ed.alternativa) { const so = soletrar(esperado, tonal, true); edits.set(i, { letra: so.letra, oit: so.oit, acc: so.acid !== (tonal.mapa[so.letra] || 0) ? ACC_TOK[so.acid] : null, alvo: esperado, alternativa: true }); mexeu = true; continue; }
          return { ok: false, erro: "Não consegui escrever essa nota sem alterar outras, então não apliquei." };
        }
        edits.set(i, { ...(ed || { alvo: null }), letra, oit, acc: ACC_TOK[acid], alvo: ed ? ed.alvo : null });
        mexeu = true;
      }
      if (!mexeu) {
        const trocas = [], efeitos = [], itens = [];
        [...edits.keys()].sort((x, y) => evs[x].inicio - evs[y].inicio).forEach((i) => {
          const e0 = evs[i], novo = emitir(i, edits.get(i)), raw = abc.slice(e0.inicio, e0.fim), e1 = M1.eventos[i];
          if (novo !== raw) trocas.push({ inicio: e0.inicio, fim: e0.fim, novo });
          if (specs.has(i)) itens.push({ inicio: e0.inicio, id: e0.id, medida: e0.medida, indice: e0.indice, vozNome: e0.vozNome, duracao: e0.duracao, antes: { nome: e0.nome, nomePt: e0.nomePt, midi: e0.midi }, depois: { nome: e1.nome, nomePt: e1.nomePt, midi: e1.midi }, novo: novo.trim(), antesTexto: e0.token });
          else if (novo !== raw) efeitos.push({ inicio: e0.inicio, id: e0.id, medida: e0.medida, indice: e0.indice, vozNome: e0.vozNome, nomePt: e0.nomePt, texto: "coloquei " + (edits.get(i).acc === "=" ? "um bequadro" : edits.get(i).acc && edits.get(i).acc.indexOf("^") === 0 ? "um sustenido" : "um bemol") + " na nota " + e0.indice + " da medida " + e0.medida + " (" + e0.vozNome + ", " + e0.nomePt + ") para ela continuar soando igual" });
        });
        return { ok: true, trocas, texto, efeitos, itens, modeloDepois: M1 };
      }
    }
    return { ok: false, erro: "Não consegui garantir que as outras notas continuassem iguais, então não apliquei nada." };
  }

  window.PartituraEdicao = { planejar: planejarMudanca, soletrar, analisarNota };

    window.PartituraModelo = {
    construir, localizar, notaDepoisDaPausa, comparar, correspondenteNaOriginal, validar,
    explicarEvento, explicarMedida, explicarGeral, textoDiferenca, contorno, descreverNotas,
    descreverDuracao, intervaloTexto, nomeDeMidi, nomePortugues, lerVozes, infoTonalidade, notasDaMedida, medidaDaVoz, completarTempos,
  };
})();
