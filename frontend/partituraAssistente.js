// ══════════════════════════════════════════════════════════════════════════
// partituraAssistente.js — Assistente musical da aba Partitura.
//
//  Etapa 1: lê e EXPLICA a partitura (notas, compassos, tonalidade, ritmo, estrutura).
//  Etapa 2: COMPARA a partitura original (a que o Songwriter extraiu) com a atual.
//  Etapa 3: conversa por VOZ, com o mesmo reconhecimento de fala da Laranjinha.
//
// Ele trabalha sobre o MODELO musical (partituraModelo.js), não sobre texto solto,
// e age pelo editor (window.Partitura.api). Tudo aqui roda no navegador: sem
// servidor, sem IA paga. As respostas vêm do próprio modelo, sempre conferidas.
//
// Sobre dúvida: quando o pedido pode significar duas coisas, ele PERGUNTA em vez de chutar.
// ══════════════════════════════════════════════════════════════════════════
(function () {
  const M = window.PartituraModelo;
  const $ = (id) => document.getElementById(id);
  const API = () => (window.Partitura && window.Partitura.api) || null;
  const K_ABERTO = "oh-assistente-aberto";

  let atual = null, original = null, cacheA = "", cacheO = "";
  let mensagens = [];                // histórico da conversa (só na tela)
  let ultimaResposta = null;
  let avisoPendente = null;          // suposição feita ao resolver a referência: sempre vai junto da resposta
  let proposta = null;               // mudança proposta (e exercício guiado): { alvos:[{id, midiOrig, midiAlvo,...}], ... }
  const previa = { synth: null, timer: null, token: 0 };

  // ── modelos (reconstruídos só quando o texto muda) ───────────────────────
  function modelos() {
    const api = API();
    if (!api || !M) return { atual: null, original: null };
    const a = api.abcAtual(), o = api.abcOriginal();
    if (a !== cacheA) { atual = M.construir(a); cacheA = a; }
    if (o !== cacheO) { original = o ? M.construir(o) : null; cacheO = o; }
    return { atual, original };
  }
  const mesmaPartitura = () => cacheA === cacheO;

  // ══ TEXTO: normalização e números por extenso ════════════════════════════
  const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s'#º°ª/.,?!=()\-]/g, " ").replace(/\s+/g, " ").trim();
  const UNID = { zero: 0, um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12, treze: 13, catorze: 14, quatorze: 14, quinze: 15, dezesseis: 16, dezessete: 17, dezoito: 18, dezenove: 19 };
  const DEZ = { vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, sessenta: 60, setenta: 70, oitenta: 80, noventa: 90 };
  function numerosPorExtenso(t) {
    const p = t.split(" "), out = [];
    for (let i = 0; i < p.length; i++) {
      const w = p[i];
      if (DEZ[w] !== undefined) {
        let v = DEZ[w];
        if (p[i + 1] === "e" && UNID[p[i + 2]] !== undefined && UNID[p[i + 2]] < 10) { v += UNID[p[i + 2]]; i += 2; }
        out.push(String(v));
      } else if (UNID[w] !== undefined) out.push(String(UNID[w]));
      else out.push(w);
    }
    return out.join(" ");
  }
  const ORDINAIS = { primeira: 1, primeiro: 1, segunda: 2, segundo: 2, terceira: 3, terceiro: 3, quarta: 4, quarto: 4, quinta: 5, quinto: 5, sexta: 6, sexto: 6, setima: 7, setimo: 7, oitava: 8, oitavo: 8, nona: 9, nono: 9, decima: 10, decimo: 10 };

  // ══ REFERÊNCIAS NA PARTITURA ═════════════════════════════════════════════
  function extrairRef(t, vozes) {
    const r = {};
    let m;
    const explicita = /\(voz=([^)]+)\)/.exec(t);
    if (explicita) {
      const idn = explicita[1].trim();
      const vz = vozes.find((v) => norm(v.id) === idn);
      r.voz = vz ? vz.id : idn;
      t = t.replace(explicita[0], " ");
    }
    if ((m = /\b(?:medida|compasso)s?\s*(?:numero\s*)?(\d+)/.exec(t))) r.medida = parseInt(m[1], 10);
    if ((m = /\b(primeira|primeiro|segunda|segundo|terceira|terceiro|quarta|quarto|quinta|quinto|sexta|sexto|setima|setimo|oitava|oitavo|nona|nono|decima|decimo)\s+nota\b/.exec(t))) r.nota = ORDINAIS[m[1]];
    else if ((m = /\bnota\s*(?:numero\s*)?(\d+)\b/.exec(t)) || (m = /\b(\d+)\s*(?:a|o|º|°|ª)\s+nota\b/.exec(t))) r.nota = parseInt(m[1], 10);
    if (/\bpenultima\s+nota\b/.test(t)) r.ordinal = "penultima";
    else if (/\bultima\s+nota\b/.test(t)) r.ordinal = "ultima";
    if (/ultima nota d[ao] linha/.test(t)) { r.ultimaDaLinha = true; r.ordinal = null; }
    if ((m = /\b(primeira|segunda|terceira|quarta|quinta|\d+)\s+nota\s+depois\s+d[ao]\s+pausa/.exec(t))) r.aposPausa = ORDINAIS[m[1]] || parseInt(m[1], 10);
    if (/\b(essa|esta|esse|este)\s+(nota|aqui|ponto|medida|compasso)\b|\bessa aqui\b|\bnota aqui\b|\bessa\b(?=\s+(primeira|segunda|terceira|quarta|quinta|ultima|\d))/.test(t)) r.essa = true;
    if (/\b(essa|esta|esse|este|nesse|nessa|neste|nesta|dessa|desse|desta|deste)\s+(trecho|frase|sequencia|parte|pedaco|passagem)\b|\bo trecho\b|\ba frase\b|\ba sequencia\b|\bselecao\b|\bselecionad/.test(t)) r.trecho = true;
    if (/\b(essa|esta|esse|este)\s+(medida|compasso)\b/.test(t)) r.essaMedida = true;
    // seções da música (marcadas pela pessoa na partitura): introdução, verso, pré-refrão, refrão, pós-refrão, ponte, solo, interlúdio, final
    const marcadas = (API() && API().secoes()) || [];
    const tem = (tipo) => marcadas.some((x) => x.tipo === tipo);
    const exp = /\(secao=([a-z]+)-(\d+)\)/.exec(t);
    const TIPO_COMPACTO = { introducao: "introducao", verso: "verso", prerefrao: "pre_refrao", refrao: "refrao", posrefrao: "pos_refrao", ponte: "ponte", solo: "solo", interludio: "interludio", final: "final" };
    if (exp && TIPO_COMPACTO[exp[1]]) { r.secao = { tipo: TIPO_COMPACTO[exp[1]], num: parseInt(exp[2], 10) }; t = t.replace(exp[0], " "); }
    else {
      const ALIAS = [["pre_refrao", /\bpre[- ]?refrao\b/, true], ["pos_refrao", /\bpos[- ]?refrao\b/, true], ["refrao", /\brefrao\b/, true], ["verso", /\b(?:verso|estrofe)\b/, true], ["introducao", /\b(?:introducao|intro)\b/, false], ["interludio", /\binterludio\b/, false], ["ponte", /\bponte\b/, false], ["solo", /\bsolo\b/, false], ["final", /\b(?:final|coda)\b/, false]];
      for (const [tipo, re, sempre] of ALIAS) {
        const mt = re.exec(t);
        if (!mt || !(sempre || tem(tipo))) continue;                                // "final", "solo", "ponte" só valem se a seção existe
        const depois = new RegExp(re.source.replace(/^\\b/, "").replace(/\\b$/, "") + "\\s*(\\d+)").exec(t);
        const antes = new RegExp("\\b(primeiro|primeira|segundo|segunda|terceiro|terceira|quarto|quarta)\\s+" + re.source.replace(/^\\b/, "")).exec(t);
        r.secao = { tipo, num: depois ? parseInt(depois[1], 10) : antes ? ORDINAIS[antes[1]] : 0 };
        break;
      }
    }
    if ((m = /\bvoz\s*(\d+)\b/.exec(t)) && !r.voz) { const v = vozes[parseInt(m[1], 10) - 1]; if (v) r.voz = v.id; }
    if (!r.voz) {
      const achadas = vozes.filter((v) => { const n = norm(v.nome).replace(/\b(melody|melodia)\b/g, "").trim(); return n && n.length >= 2 && new RegExp("\\b" + n.replace(/[^a-z0-9 ]/g, "") + "\\b").test(t); });
      if (achadas.length === 1) r.voz = achadas[0].id;
    }
    if ((m = /\b(?:aos?|no minuto|em|por volta d[oe]s?)\s*(\d+)(?::(\d{1,2}))?\s*(?:segundos?|s\b|min)?/.exec(t)) && /(segundo|minuto|\d:\d\d)/.test(t)) {
      r.tempoSeg = m[2] !== undefined ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : parseInt(m[1], 10);
    }
    return r;
  }
  const temReferencia = (r) => !!r.secao || r.medida != null || r.nota != null || r.ordinal || r.essa || r.trecho || r.ultimaDaLinha || r.aposPausa || r.tempoSeg != null || r.essaMedida;

  // Resolve a referência para eventos reais da partitura. Devolve { eventos, rotulo } ou { erro } ou { ambiguo }.
  function resolver(r, modelo) {
    const api = API();
    const sel = api.selecao();
    const evSel = sel.inicio != null ? eventoNaPosicao(modelo, sel.inicio) : null;
    const ctx = { vozPreferida: evSel ? evSel.voz : null };
    const vozes = modelo.vozes.filter((v) => v.eventos.length);
    const rotuloEv = (e) => "medida " + e.medida + ", " + (e.tipo === "nota" ? "nota " : "pausa ") + e.indice + " (" + e.vozNome + ")";

    if (r.tempoSeg != null) {
      M.completarTempos(modelo);
      const alvoMs = r.tempoSeg * 1000;
      const notas = modelo.eventos.filter((e) => e.tipo === "nota" && e.ms != null);
      const e = notas.reduce((b, x) => (!b || Math.abs(x.ms - alvoMs) < Math.abs(b.ms - alvoMs) ? x : b), null);
      return e ? { eventos: [e], rotulo: rotuloEv(e) + ", perto de " + Math.round(e.ms / 1000) + " s" } : { erro: "Não consegui achar uma nota nesse momento da música." };
    }
    if (r.secao) {
      const nomeTipo = { introducao: "Introdução", verso: "Verso", pre_refrao: "Pré-refrão", refrao: "Refrão", pos_refrao: "Pós-refrão", ponte: "Ponte", solo: "Solo", interludio: "Interlúdio", final: "Final" }[r.secao.tipo];
      const lista = api.secoes().filter((x) => x.tipo === r.secao.tipo && (!r.secao.num || x.num === r.secao.num));
      if (!lista.length) return { erro: "Não encontrei \"" + nomeTipo + (r.secao.num ? " " + r.secao.num : "") + "\" marcado nesta partitura. Para marcar: selecione o trecho (Selecionar trecho), escolha o tipo ao lado de \"Marcar seção\" e clique nele." };
      if (lista.length > 1) return { ambiguo: lista.map((x) => ({ id: "sec:" + x.tipo.replace("_", "") + "-" + x.num, nome: x.nome })), motivo: "Há mais de um " + nomeTipo + " marcado." , porSecao: true };
      const sec = lista[0];
      const comNotas = vozes.filter((v) => v.eventos.some((e) => e.tipo === "nota" && e.medida >= sec.de && e.medida <= sec.ate));
      const voz = r.voz ? vozes.find((v) => v.id === r.voz) : (ctx.vozPreferida && comNotas.find((v) => v.id === ctx.vozPreferida)) || (comNotas.length === 1 ? comNotas[0] : null);
      if (!voz) return comNotas.length ? { ambiguo: comNotas.map((v) => ({ id: v.id, nome: v.nome })), motivo: "O " + sec.nome + " tem notas em mais de uma voz." } : { erro: "Não há notas no " + sec.nome + "." };
      const evs = voz.eventos.filter((e) => e.medida >= sec.de && e.medida <= sec.ate);
      return { eventos: evs, trecho: true, voz, secaoNome: sec.nome, rotulo: sec.nome + " (medidas " + sec.de + " a " + sec.ate + ", " + voz.nome + ")" };
    }
    if (r.ultimaDaLinha) {
      if (!evSel) return { erro: "Para eu achar a última nota da linha, clique antes em alguma nota dessa linha." };
      const x = M.localizar(modelo, { ultimaDaLinha: evSel.inicio }, ctx);
      return x.ok ? { eventos: [x.evento], rotulo: rotuloEv(x.evento) + ", última nota da linha" } : { erro: x.motivo };
    }
    if (r.aposPausa) {
      if (!evSel) return { erro: "Para eu achar a nota depois da pausa, clique antes numa nota perto dela." };
      const e = M.notaDepoisDaPausa(modelo, evSel.inicio, r.aposPausa);
      return e ? { eventos: [e], rotulo: rotuloEv(e) + ", depois da pausa" } : { erro: "Não achei essa nota depois de uma pausa na voz \"" + evSel.vozNome + "\"." };
    }
    if (r.medida != null) {
      const x = M.localizar(modelo, { voz: r.voz, medida: r.medida, nota: r.nota, ordinal: r.ordinal }, ctx);
      if (x.ambiguo) return { ambiguo: x.opcoes, motivo: x.motivo };
      if (!x.ok) return { erro: x.motivo };
      // se a voz veio da nota selecionada (e há outra voz com notas ali), diz que supôs
      let aviso = null;
      if (!r.voz && ctx.vozPreferida && x.voz && x.voz.id === ctx.vozPreferida) {
        const outras = vozes.filter((v) => v.id !== x.voz.id && M.medidaDaVoz(v, r.medida) && M.medidaDaVoz(v, r.medida).eventos.some((e) => e.tipo === "nota"));
        if (outras.length) aviso = "Usei a voz \"" + x.voz.nome + "\" porque é a da nota selecionada. Para ver a outra, diga \"voz " + outras[0].nome + "\".";
      }
      if (x.evento) return { eventos: [x.evento], rotulo: rotuloEv(x.evento), aviso };
      return { medida: x.medida, voz: x.voz, eventos: x.medida.eventos, rotulo: "medida " + r.medida + " (" + x.voz.nome + ")", aviso };
    }
    if ((r.nota != null || r.ordinal) && !r.essa && !evSel) return { erro: "Em qual medida? Diga, por exemplo, \"medida 25, segunda nota\", ou clique antes numa nota da partitura." };
    if (r.nota != null || r.ordinal) {
      // "essa segunda nota": a 2ª nota da medida da nota que está selecionada
      if (!evSel) return { erro: "Clique antes numa nota para eu saber de qual medida você fala." };
      const voz = modelo.vozes.find((v) => v.id === evSel.voz);
      const notas = M.notasDaMedida(voz, evSel.medida);
      const alvo = r.ordinal === "ultima" ? notas[notas.length - 1] : r.ordinal === "penultima" ? notas[notas.length - 2] : notas[r.nota - 1];
      return alvo ? { eventos: [alvo], rotulo: rotuloEv(alvo) } : { erro: "A medida " + evSel.medida + " (" + evSel.vozNome + ") tem " + notas.length + " notas; não achei a nota pedida." };
    }
    if (r.trecho) {
      if (sel.trecho) {
        const a = modelo.porInicio.get(sel.trecho.de), b = modelo.porInicio.get(sel.trecho.ate);
        if (a && b) {
          const voz = modelo.vozes.find((v) => v.id === a.voz);
          const i = voz.eventos.indexOf(a), j = voz.eventos.indexOf(b);
          const evs = voz.eventos.slice(Math.min(i, j), Math.max(i, j) + 1);
          return { eventos: evs, trecho: true, voz, rotulo: "trecho selecionado, das medidas " + evs[0].medida + " a " + evs[evs.length - 1].medida + " (" + voz.nome + ")" };
        }
      }
      if (evSel) {
        const voz = modelo.vozes.find((v) => v.id === evSel.voz);
        const med = M.medidaDaVoz(voz, evSel.medida);
        return { eventos: med.eventos, voz, medida: med, rotulo: "medida " + evSel.medida + " (" + voz.nome + "), a medida da nota selecionada", aviso: "Você não marcou um trecho, então usei a medida da nota selecionada. (Para marcar um trecho: Selecionar trecho, ou Shift + clique.)" };
      }
      return { erro: "Qual trecho? Marque um trecho na partitura (botão Selecionar trecho ou Shift + clique em duas notas) ou diga a medida." };
    }
    if (r.essaMedida && evSel) {
      const voz = modelo.vozes.find((v) => v.id === evSel.voz);
      const med = M.medidaDaVoz(voz, evSel.medida);
      return { eventos: med.eventos, voz, medida: med, rotulo: "medida " + evSel.medida + " (" + voz.nome + ")" };
    }
    if (r.essa || sel.inicio != null) {
      if (!evSel) return { erro: sel.inicio != null ? "O que está selecionado é uma barra de compasso, não uma nota. Clique numa nota." : "Clique antes numa nota da partitura." };
      return { eventos: [evSel], rotulo: rotuloEv(evSel) };
    }
    return { vazio: true };
  }
  function eventoNaPosicao(modelo, pos) {
    const direto = modelo.porInicio.get(pos);
    if (direto) return direto;
    return modelo.eventos.find((e) => e.inicio > pos) || null;      // barra de compasso: usa a nota logo depois
  }

  // ══ GLOSSÁRIO: ensina usando a partitura aberta ══════════════════════════
  const GLOSSARIO = [
    { chaves: [/semitom|semitons/, /\bsemi tom/], titulo: "Semitom e tom", texto: "Um semitom é o menor passo entre duas notas: no piano, de uma tecla para a vizinha (preta ou branca). Dois semitons formam um tom. Então \"subir um tom\" é subir 2 semitons, e \"subir um semitom\" é subir um passinho só.", exemplo: (c) => exemploSobe(c, 2) },
    { chaves: [/\b(tom|tons)\b/], titulo: "Tom", texto: "Um tom são dois semitons. Quando alguém diz \"sobe um tom\", são dois passinhos de piano para cima. (Atenção: \"tom\" também é usado para o \"tom da música\", que é a tonalidade.)", exemplo: (c) => exemploSobe(c, 2) },
    { chaves: [/oitavas?/], titulo: "Oitava", texto: "Oitava é a mesma nota só que mais aguda ou mais grave: um Lá e o Lá seguinte, por exemplo. A distância é de 12 semitons. No nome científico o número mostra a oitava: Dó4 é o Dó do meio do piano, Dó5 é o Dó uma oitava acima.", exemplo: (c) => c.ev && c.ev.midi != null ? "Na sua partitura: " + c.ev.nome + " tem a mesma nota uma oitava acima em " + M.nomeDeMidi(c.ev.midi + 12) + "." : "" },
    { chaves: [/compasso|medida/], titulo: "Compasso (medida)", texto: "Compasso, ou medida, é cada \"caixinha\" de tempo da música, separada por barras verticais na partitura. Todas têm a mesma duração. É por ele que dá para dizer \"medida 25\" e todo mundo saber onde fica.", exemplo: (c) => c.modelo ? "Na sua música, a voz principal tem " + Math.max(...c.modelo.vozes.map((v) => v.totalMedidas)) + " medidas." : "" },
    { chaves: [/formula de compasso|\b[2-9]\/[48]\b|\b12\/8\b/], titulo: "Fórmula de compasso", texto: "É o número do começo (como 4/4 ou 3/4). O de cima diz quantos tempos cabem em cada medida e o de baixo diz que figura vale um tempo (4 = semínima). Em 4/4 cabem 4 semínimas por medida.", exemplo: (c) => c.modelo ? "Sua música está em " + c.modelo.meta.compasso.texto + ": cada medida soma " + (c.modelo.meta.compasso.num) + " tempos de 1/" + c.modelo.meta.compasso.den + "." : "" },
    { chaves: [/figuras?|ritmic|semibreve|minima|seminima|colcheia|semicolcheia|fusa|duracao|duracoes|tempos?\b/], titulo: "Figuras rítmicas (duração das notas)", texto: "As figuras dizem quanto tempo a nota dura. A semibreve dura 4 tempos, a mínima 2, a semínima 1, a colcheia meio e a semicolcheia um quarto de tempo. Um pontinho depois da nota soma metade do valor dela.", exemplo: (c) => c.ev ? "A nota selecionada dura " + M.descreverDuracao(c.ev.duracao, c.modelo.meta.compasso.den) + "." : "" },
    { chaves: [/pausas?|silencio/], titulo: "Pausa", texto: "Pausa é um silêncio com duração marcada. Ela conta tempo como uma nota, mas sem som. Ela é importante porque mantém a música no ritmo certo.", exemplo: (c) => { const p = c.modelo && c.modelo.eventos.find((e) => e.tipo === "pausa"); return p ? "A primeira pausa da sua partitura está na medida " + p.medida + " (" + p.vozNome + "): " + M.descreverDuracao(p.duracao, c.modelo.meta.compasso.den) + "." : ""; } },
    { chaves: [/tonalidade|armadura|armadura de clave|tom da musica/], titulo: "Tonalidade e armadura", texto: "Tonalidade é a \"casa\" da música: a nota que parece o ponto de descanso e o conjunto de notas que mais aparece. A armadura são os sustenidos ou bemóis desenhados no começo da pauta; eles valem para a música toda, sem precisar repetir.", exemplo: (c) => c.modelo ? "Sua música está em " + c.modelo.meta.tonalidade.nome + ", com " + c.modelo.meta.tonalidade.armadura + "." : "" },
    { chaves: [/sustenidos?|bemol|bemois|bequadro|acidentes?/], titulo: "Sustenido, bemol e bequadro", texto: "Sustenido (♯) sobe a nota um semitom. Bemol (♭) desce um semitom. Bequadro (♮) cancela e volta à nota natural. Eles valem até o fim da medida em que aparecem.", exemplo: (c) => { const e = c.modelo && c.modelo.eventos.find((x) => x.tipo === "nota" && x.acidente !== 0); return e ? "Na sua partitura, " + e.nomePt + " (medida " + e.medida + ") é " + (e.acidente > 0 ? "sustenida" : "bemol") + "." : ""; } },
    { chaves: [/intervalos?/], titulo: "Intervalo", texto: "Intervalo é a distância entre duas notas, contada em semitons. 1 semitom é o menor; 12 é uma oitava inteira. Intervalos pequenos fazem a melodia andar suave; saltos grandes dão sensação de pulo.", exemplo: (c) => exemploSobe(c, 2) },
    { chaves: [/escalas?/], titulo: "Escala", texto: "Escala é a sequência de notas que \"combina\" com a tonalidade, subindo de grau em grau. A maior parte das melodias usa quase só as notas da escala da música.", exemplo: (c) => c.modelo ? "A escala da sua música é a de " + c.modelo.meta.tonalidade.nome + "." : "" },
    { chaves: [/acordes?|cifras?|harmonia/], titulo: "Acorde e cifra", texto: "Acorde são várias notas tocadas juntas (o violão faz isso). A cifra é o nome do acorde escrito em cima da partitura, como Am ou G7.", exemplo: (c) => { const e = c.modelo && c.modelo.eventos.find((x) => x.cifra); return e ? "A primeira cifra da sua partitura é " + e.cifra + ", na medida " + e.medida + "." : "Esta partitura não tem cifras escritas."; } },
    { chaves: [/ligaduras?|ligada/], titulo: "Ligadura", texto: "Ligadura une duas notas do mesmo som: elas viram uma nota só, mais longa, soando sem repetir o ataque.", exemplo: (c) => { const e = c.modelo && c.modelo.eventos.find((x) => x.ligada === "inicio"); return e ? "Na sua partitura há uma ligadura na medida " + e.medida + " (" + e.vozNome + ")." : "Não há ligaduras nesta partitura."; } },
    { chaves: [/anacruse/], titulo: "Anacruse", texto: "Anacruse é quando a música começa antes do primeiro tempo forte, numa medida incompleta (a medida 0).", exemplo: (c) => c.modelo ? (c.modelo.meta.anacruse > 1e-6 ? "Sua música tem anacruse." : "Sua música não tem anacruse.") : "" },
    { chaves: [/andamento|bpm|velocidade|batidas por minuto/], titulo: "Andamento", texto: "Andamento é a velocidade da música, contada em batidas por minuto (BPM). Quanto maior o número, mais rápida.", exemplo: (c) => c.modelo && c.modelo.meta.bpm ? "Sua música está em cerca de " + c.modelo.meta.bpm + " BPM." : "" },
    { chaves: [/letra|silaba|silabas/], titulo: "Letra e sílabas", texto: "Cada sílaba da letra cai sobre uma nota. Quando a letra e as notas ficam desalinhadas, as palavras parecem cantadas fora do tempo.", exemplo: (c) => { const e = c.modelo && c.modelo.eventos.find((x) => x.letra); return e ? "Na sua partitura, a primeira sílaba (\"" + e.letra + "\") cai na medida " + e.medida + "." : "Esta partitura ainda não tem letra."; } },
    { chaves: [/melodia|contorno|frase musical/], titulo: "Melodia e contorno", texto: "Melodia é a sequência de notas que você canta. O contorno é o desenho que ela faz: sobe, desce ou fica parada.", exemplo: (c) => { const v = c.modelo && c.modelo.vozes.find((x) => x.eventos.some((e) => e.tipo === "nota")); return v ? "Na voz \"" + v.nome + "\": " + M.contorno(v.eventos.filter((e) => e.tipo === "nota")) : ""; } },
    { chaves: [/altura|agudo|grave/], titulo: "Altura", texto: "Altura é o quanto a nota é aguda (fina) ou grave (grossa). Na pauta, quanto mais alta a nota é desenhada, mais aguda ela soa.", exemplo: (c) => c.ev && c.ev.midi != null ? "A nota selecionada é " + c.ev.nomePt + "." : "" },
    { chaves: [/\bnotas?\b/], titulo: "Nota", texto: "Nota é um som com duas características: a altura (grave ou aguda) e a duração (curta ou longa). Na partitura, a posição vertical diz a altura e a figura diz a duração.", exemplo: (c) => c.ev ? M.explicarEvento(c.modelo, c.ev) : "" },
    { chaves: [/partitura original|versao original|\boriginal\b/], titulo: "Partitura original e atual", texto: "A partitura original é a que o Songwriter extraiu da sua gravação. A atual é a que você está editando. A original fica guardada só como referência: eu nunca mudo ela sozinho.", exemplo: () => "" },
  ];
  function exemploSobe(c, semitons) {
    if (!c.ev || c.ev.midi == null) return "";
    return "Na sua partitura: se a nota " + c.ev.nomePt + " subir " + M.intervaloTexto(semitons) + " (" + semitons + " semitons), ela viraria " + M.nomeDeMidi(c.ev.midi + semitons) + ".";
  }
  function achaTopico(t) {
    return GLOSSARIO.find((g) => g.chaves.some((re) => re.test(t))) || null;
  }

  // ══ INTENÇÃO ═════════════════════════════════════════════════════════════
  function intencao(t, ref) {
    const curto = t.split(" ").length <= 7;
    if (/\b(refaz\w*|refazer)\b/.test(t)) return "refazer";
    if (/\b(desfaz\w*|desfazer|volta atras|volte atras|anul\w*)\b/.test(t) && !/original/.test(t)) return "desfazer";
    if (proposta && curto && !temReferencia(ref) && /\b(aplic\w*|confirm\w*|aprov\w*|manda ver|pode fazer|faz isso|faca isso|sim|ok)\b/.test(t)) return "aplicar";
    if (proposta && curto && !temReferencia(ref) && /\b(rejeit\w*|cancel\w*|descart\w*|nao aplic\w*|esquece|deixa pra la|nao quero|nao)\b/.test(t)) return "rejeitar";
    if (/\b(previa|ouvir como ficaria|toca como ficaria)\b/.test(t)) return "previa";
    const ensina = /\bo que (e|sao|significa|quer dizer)\b|\bpara que serve\b|\bme ensina\b|\bcomo funciona\b|\bqual a diferenca entre\b|\bsignifica\b/.test(t);
    if (ensina && achaTopico(t) && !temReferencia(ref)) return "ensinar";
    if (/\bna original\b.*\b(mais agud\w*|mais grav\w*|era)\b|\bera mais (agud|grav)\w*|\boriginal.*(mais agud|mais grav)/.test(t)) return "original_altura";
    if (/\bqual (era|e) a sequencia original\b|\bsequencia original\b|\bcomo (era|estava) (na original|antes)\b|\bqual era\b.*\b(original|antes)\b|\bo que (tinha|havia) (na original|antes)\b/.test(t)) return "original_sequencia";
    if (/\b(compar\w*|diferenc\w*|diferente\w*|o que (eu )?(mudei|alterei|mexi)|mudei|alterei (demais|muito)|mexi demais|o que mudou)\b/.test(t)) return "comparar";
    if (/\b(erro\w*|errad\w*|problema\w*|desproporc\w*|proporc\w*|verific\w*|confer\w*|valid\w*|incompleto\w*|esta certo|tem algo|algo errado|inconsist\w*)\b/.test(t)) return "verificar";
    if (/\b(suba|subir|subo|sobe|sobem|subindo|aument\w*|diminu\w*|desca|descer|desce|descendo|abaix\w*|mais agud\w*|mais grav\w*|encurt\w*|along\w*|duplic\w*|dobr\w*|transpo\w*|mude|muda\w*|troc\w*|corrig\w*|restaur\w*|volt\w*|recuper\w*|apag\w*|exclu\w*|remov\w*|copi\w*|cole|acima|mais alt\w*|mais baix\w*)\b/.test(t)) return "editar";
    if (/\b(muito|esta|ta|ficou)\s+(muito\s+)?(baix\w*|alt\w*|agud\w*|grav\w*)\b/.test(t) && !/\b(explic\w*|o que|por que|porque)\b/.test(t)) return "editar";
    if (/\b(explic\w*|descrev\w*|analis\w*|o que (esta|ta|tem) acontecendo|me fala|me conta|o que e isso|como (e|esta) (essa|esse)|o que significa (essa|esse|isso))\b/.test(t)) return "explicar";
    if (achaTopico(t) && /\?|o que|como|por que|porque|qual/.test(t) && !temReferencia(ref)) return "ensinar";
    if (temReferencia(ref)) return "explicar";
    if (/\b(oi|ola|bom dia|boa tarde|boa noite|ajuda|ajudar|o que (voce )?(faz|sabe|pode))\b/.test(t)) return "ajuda";
    return "desconhecido";
  }

  // ══ RESPOSTAS ════════════════════════════════════════════════════════════
  const ajudaTexto = () => [
    "Eu leio a partitura que está aberta e posso:",
    "• explicar uma nota, uma medida ou a música toda (\"explica a medida 25\", \"explica essa nota\");",
    "• comparar com a partitura original (\"o que eu mudei?\") e verificar erros (\"tem algum erro?\");",
    "• mudar a ALTURA de uma nota, medida ou trecho (\"na medida 25, segunda nota, sobe meio tom\", \"desce essa frase um tom\", \"sobe uma oitava\"). Eu mostro a proposta, deixo a nota em roxo e você ajusta sozinho ou manda eu aplicar;",
    "• voltar a altura para a da original (\"volta essa nota para a original\");",
    "• entender as seções que você marcou (\"explica o refrão\", \"sobe o verso 2 um tom\", \"compara o pré-refrão com a original\");",
    "• ensinar música com exemplos da sua partitura (\"o que é semitom?\").",
    "Clique numa nota e diga \"essa nota\", ou cite a medida. Você também pode falar, pelo microfone.",
  ].join("\n");

  // ══ EDIÇÃO DE ALTURA: proposta → exercício guiado → aplicar ═══════════════
  // O assistente NUNCA altera a partitura sozinho. Ele propõe (a nota-alvo fica em ROXO), a pessoa ajusta
  // por conta própria (rosa = fora do alvo, turquesa = no alvo) ou manda aplicar. Tudo passa pelo planejador
  // verificado (PartituraEdicao), que confere o som de todas as outras notas.
  function interpretarAltura(t) {
    let dir = 0, m, dica = false;
    const sobe = /\b(suba|subir|subo|sobe|sobem|subindo|aument\w*|mais agud\w*|mais alt\w*|para cima|acima|elev\w*)\b/.test(t);
    const desce = /\b(desca|descer|desce|descendo|diminu\w*|mais grav\w*|mais baix\w*|para baixo|abaixo|rebaix\w*)\b/.test(t);
    if (sobe && !desce) dir = 1; else if (desce && !sobe) dir = -1;
    if (!dir) {
      if (/\b(muito|esta|ta|ficou)\s+(muito\s+)?(baix\w*|grav\w*)\b/.test(t)) { dir = 1; dica = true; }
      else if (/\b(muito|esta|ta|ficou)\s+(muito\s+)?(alt\w*|agud\w*)\b/.test(t)) { dir = -1; dica = true; }
    }
    let semitons = null;
    if (/\bmeio tom\b/.test(t)) semitons = 1;
    else if ((m = /\b(\d+)\s*(?:tom|tons)\s+e\s+meio\b/.exec(t))) semitons = parseInt(m[1], 10) * 2 + 1;
    else if ((m = /\b(\d+)\s*(?:oitava|oitavas)\b/.exec(t))) semitons = 12 * parseInt(m[1], 10);
    else if ((m = /\b(\d+)\s*(?:semitom|semitons)\b/.exec(t))) semitons = parseInt(m[1], 10);
    else if ((m = /\b(\d+)\s*(?:tom|tons)\b/.exec(t))) semitons = 2 * parseInt(m[1], 10);
    return { dir, semitons, dica };
  }
  const semitonsTexto = (n) => Math.abs(n) + (Math.abs(n) === 1 ? " semitom" : " semitons");
  const mostrarLegenda = (sim) => document.querySelectorAll(".pt-leg-ex").forEach((el) => { el.hidden = !sim; });
  let contadorProposta = 0;

  function limparProposta() {
    proposta = null;
    pararPrevia();
    mostrarLegenda(false);
    const api = API();
    if (api) api.marcarExercicio(null);
  }

  function proporMudancas(A, lista, rotulo, titulo, extraAviso) {
    const plano = window.PartituraEdicao.planejar(A.abc, lista.map((x) => ({ inicio: x.ev.inicio, midiAlvo: x.midiAlvo })));
    if (!plano.ok) return { texto: "Não posso fazer isso: " + plano.erro, destacar: lista.map((x) => x.ev.inicio) };
    limparProposta();
    proposta = {
      id: ++contadorProposta, rotulo, titulo,
      alvos: lista.map((x) => { const it = plano.itens.find((i) => i.id === x.ev.id); return { id: x.ev.id, midiOrig: x.ev.midi, midiAlvo: x.midiAlvo, nomeAlvo: it.depois.nome, nomeAlvoPt: it.depois.nomePt, nomeOrigPt: x.ev.nomePt }; }),
    };
    const den = A.meta.compasso.den;
    const linhas = [];
    if (lista.length === 1) {
      const x = lista[0], d = x.midiAlvo - x.ev.midi, it = plano.itens[0];
      linhas.push(titulo + " (" + rotulo + "): a nota vai de " + x.ev.nomePt + " para " + it.depois.nomePt + ", " + (d > 0 ? "sobe " : "desce ") + M.intervaloTexto(d) + " (" + semitonsTexto(d) + ").");
      linhas.push("A duração continua " + M.descreverDuracao(x.ev.duracao, den) + ".");
    } else {
      linhas.push(titulo + " (" + rotulo + "): " + lista.length + " notas mudam.");
      plano.itens.slice(0, 8).forEach((it) => linhas.push("• medida " + it.medida + ", nota " + it.indice + ": " + it.antes.nome + " → " + it.depois.nome));
      if (plano.itens.length > 8) linhas.push("• ... e mais " + (plano.itens.length - 8) + ".");
      linhas.push("As durações continuam iguais.");
    }
    if (plano.efeitos.length) linhas.push("Para as outras notas não mudarem de som, eu também " + plano.efeitos.map((e) => e.texto).join("; ") + ".");
    linhas.push("Deixei " + (lista.length === 1 ? "a nota" : "as notas") + " em roxo: " + (lista.length === 1 ? "esse é o alvo (" + plano.itens[0].depois.nome + ")" : "esse é o alvo") + ". Você pode ajustar sozinho (setas ↑ ↓ mexem meio tom; Shift + seta, uma linha): fica turquesa quando acertar, rosa se sair do alvo. Ou eu aplico, e dá para desfazer.");
    const api = API();
    api.selecionarNota(lista[0].ev.inicio);
    reavaliarExercicio(false);
    const pid = proposta.id;
    return {
      texto: linhas.join("\n"), propostaCard: true,
      chips: [{ rotulo: "Aplicar por mim", acao: "aplicar", pid }, { rotulo: "Ouvir prévia", acao: "previa", pid }, { rotulo: "Ouvir como está", acao: "atual", pid }, { rotulo: "Comparar A/B", acao: "ab", pid }, { rotulo: "Rejeitar", acao: "rejeitar", pid }],
    };
  }

  // refaz o plano a partir do estado ATUAL da partitura (a pessoa pode já ter mexido em parte das notas)
  function planoDaProposta() {
    const { atual: A } = modelos();
    if (!proposta || !A) return null;
    const muds = [];
    proposta.alvos.forEach((al) => { const ev = A.eventos.find((e) => e.id === al.id); if (ev && ev.tipo === "nota" && ev.midi !== al.midiAlvo) muds.push({ inicio: ev.inicio, midiAlvo: al.midiAlvo }); });
    if (!muds.length) return { vazio: true };
    return window.PartituraEdicao.planejar(A.abc, muds);
  }

  function reavaliarExercicio(anunciar) {
    const api = API();
    if (!api) return;
    mostrarLegenda(!!proposta);
    if (!proposta) { api.marcarExercicio(null); return; }
    const { atual: A } = modelos();
    if (!A) return;
    const mapa = {}, estados = {}, det = [];
    proposta.alvos.forEach((al) => {
      const ev = A.eventos.find((e) => e.id === al.id);
      if (!ev || ev.tipo !== "nota" || ev.midi == null) { estados[al.id] = "perdida"; return; }
      const est = ev.midi === al.midiAlvo ? "certa" : ev.midi === al.midiOrig ? "alvo" : "errada";
      mapa[ev.inicio] = est; estados[al.id] = est; det.push({ al, ev, est });
    });
    api.marcarExercicio(mapa);
    const assinatura = JSON.stringify(estados);
    const mudou = proposta.assinatura !== undefined && proposta.assinatura !== assinatura;
    proposta.assinatura = assinatura;
    if (!det.length) { if (anunciar && !$("partituraAssistente").hidden) adicionar("assistente", "A nota do exercício mudou de lugar na partitura, então encerrei o exercício."); limparProposta(); return; }
    if (!anunciar || !mudou || $("partituraAssistente").hidden) return;
    const todasCertas = det.every((x) => x.est === "certa");
    if (todasCertas) {
      const ef = proposta.efeitosAplicados && proposta.efeitosAplicados.length ? " Para as outras notas não mudarem, eu também " + proposta.efeitosAplicados.join("; ") + "." : "";
      const pronto = proposta.aplicadoPorMim ? "Pronto, apliquei." : "Acertou!";
      proposta.concluida = true;
      adicionar("assistente", pronto + (det.length === 1 ? " A nota está em " + det[0].ev.nomePt + ", que era o alvo." : " As " + det.length + " notas estão no alvo.") + ef + " Ficou em turquesa. Dá para desfazer (↶ ou Ctrl+Z) ou ouvir como ficou.", { chips: [{ rotulo: "Ouvir como ficou", acao: "atual", pid: proposta.id }, { rotulo: "Comparar com a original", enviar: "o que eu mudei em relação à original?" }] });
      return;
    }
    const erradas = det.filter((x) => x.est === "errada");
    if (erradas.length) {
      const linhas = erradas.slice(0, 3).map(({ al, ev }) => {
        const falta = al.midiAlvo - ev.midi, desde = ev.midi - al.midiOrig, total = al.midiAlvo - al.midiOrig;
        const noCaminho = Math.sign(desde) === Math.sign(total) && Math.abs(desde) < Math.abs(total);
        const quando = det.length > 1 ? "medida " + ev.medida + ", nota " + ev.indice + ": " : "";
        return noCaminho
          ? quando + "está no caminho (" + ev.nomePt + "). Falta " + semitonsTexto(falta) + " para " + (falta > 0 ? "cima" : "baixo") + " para chegar em " + al.nomeAlvoPt + "."
          : quando + "fora do alvo: está em " + ev.nomePt + " e o alvo é " + al.nomeAlvoPt + ". " + (falta > 0 ? "Suba " : "Desça ") + semitonsTexto(falta) + ".";
      });
      adicionar("assistente", linhas.join("\n") + (erradas.length > 3 ? "\n... e mais " + (erradas.length - 3) + " nota(s)." : ""));
    }
  }

  function aplicarProposta() {
    if (!proposta) return { texto: "Não há nenhuma proposta pendente. Peça, por exemplo: \"sobe meio tom na medida 25, segunda nota\"." };
    const plano = planoDaProposta();
    if (plano && plano.vazio) return { texto: "Já está tudo no alvo: não há nada para aplicar." };
    if (!plano || !plano.ok) return { texto: "Não consegui aplicar: " + (plano ? plano.erro : "a partitura mudou.") };
    const api = API();
    api.pausar(); pararPrevia();
    proposta.efeitosAplicados = plano.efeitos.map((e) => e.texto);
    proposta.aplicadoPorMim = true;
    api.aplicarTrocas(plano.trocas);           // a resposta ("Pronto, apliquei") vem da reavaliação do exercício
    return { silencio: true };
  }

  function rejeitarProposta() {
    if (!proposta) return { texto: "Não há nenhuma proposta pendente." };
    limparProposta();
    return { texto: "Ok, descartei a proposta. Eu não alterei nada na partitura. (O que você mesmo mexeu continua lá; Ctrl+Z desfaz.)" };
  }

  function controleHistorico(tipo) {
    const api = API();
    if (tipo === "desfazer") {
      if (!api.podeDesfazer()) return { texto: "Não há nada para desfazer." };
      api.desfazer();
      return { texto: "Desfiz a última mudança. Para voltar atrás nisso, diga \"refaz\" ou use o botão ↷." };
    }
    if (!api.podeRefazer()) return { texto: "Não há nada para refazer." };
    api.refazer();
    return { texto: "Refiz a mudança." };
  }

  // ── prévia de áudio: toca um trecho da versão proposta (ou da atual) SEM mexer na partitura ──
  function janelaMs(modelo, ids) {
    M.completarTempos(modelo);
    const evs = ids.map((id) => modelo.eventos.find((e) => e.id === id)).filter(Boolean);
    if (!evs.length) return null;
    const voz = modelo.vozes.find((v) => v.id === evs[0].voz);
    const m1 = Math.min(...evs.map((e) => e.medida)), m2 = Math.max(...evs.map((e) => e.medida));
    const primeira = (n) => { const md = M.medidaDaVoz(voz, n); return md && md.eventos[0] ? md.eventos[0] : null; };
    const ini = primeira(m1 - 1) || primeira(m1), fim = primeira(m2 + 1);
    const iniMs = ini && ini.ms != null ? ini.ms : 0;
    return { iniMs, fimMs: fim && fim.ms != null ? fim.ms : (modelo.meta.duracaoTotalMs || iniMs + 4000), alvoMs: evs[0].ms };
  }
  function pararSynth() {
    try { if (previa.synth) previa.synth.stop(); } catch (e) { /* já parou */ }
    previa.synth = null;
  }
  function pararPrevia() { previa.token++; pararSynth(); }
  async function tocarJanela(abc, iniMs, fimMs, token) {
    pararSynth();
    const api = API();
    if (api) api.pausar();                                         // o player principal para: só uma coisa toca por vez
    const ABCJS = window.ABCJS;
    if (!ABCJS || !ABCJS.synth || !ABCJS.synth.supportsAudio()) return false;
    const div = document.createElement("div");
    const tune = ABCJS.renderAbc(div, abc, {})[0];
    const synth = new ABCJS.synth.CreateSynth();
    try { await ABCJS.synth.activeAudioContext().resume(); } catch (e) { /* segue */ }
    await synth.init({ visualObj: tune, options: { program: api ? api.timbre() : 0, chordsOff: false } });
    await synth.prime();
    if (previa.token !== token) return false;
    previa.synth = synth;
    synth.seek(iniMs / 1000, "seconds");
    synth.start();
    await new Promise((res) => setTimeout(res, Math.max(300, fimMs - iniMs) + 250));
    if (previa.token !== token) return false;
    pararSynth();
    return true;
  }
  function tocarPrevia(qual) {
    const { atual: A } = modelos();
    if (!proposta || !A) return { texto: "Não há proposta para ouvir. Peça primeiro uma mudança, por exemplo: \"sobe um tom na medida 25, segunda nota\"." };
    const ids = proposta.alvos.map((a) => a.id);
    const plano = planoDaProposta();
    if (plano && !plano.vazio && !plano.ok) return { texto: "Não consegui montar a prévia: " + plano.erro };
    const abcProp = plano && plano.ok ? plano.texto : A.abc, modeloProp = plano && plano.ok ? plano.modeloDepois : A;
    const jA = janelaMs(A, ids), jP = janelaMs(modeloProp, ids);
    if (!jA || !jP) return { texto: "Não consegui achar o trecho para tocar." };
    const token = ++previa.token;
    const erro = (e) => { if (previa.token === token) adicionar("assistente", "Não consegui tocar a prévia (" + (e && e.message ? e.message : e) + ")."); };
    if (qual === "atual") { tocarJanela(A.abc, jA.iniMs, jA.fimMs, token).catch(erro); return { texto: "Tocando como está agora (da medida anterior até o fim da medida)." }; }
    if (qual === "proposta") { tocarJanela(abcProp, jP.iniMs, jP.fimMs, token).catch(erro); return { texto: plano && plano.vazio ? "A nota já está no alvo: tocando como está." : "Tocando a prévia, como ficaria depois de aplicar. A partitura não foi alterada." }; }
    (async () => { if (await tocarJanela(A.abc, jA.iniMs, jA.fimMs, token)) await tocarJanela(abcProp, jP.iniMs, jP.fimMs, token); })().catch(erro);
    return { texto: "Tocando A (como está) e depois B (como ficaria). A partitura não foi alterada." };
  }
  function acaoChip(acao, pid) {
    let r;
    if (!proposta || proposta.id !== pid) r = { texto: "Essa proposta já não está ativa. Peça a mudança de novo, se ainda quiser." };
    else if (acao === "aplicar") r = aplicarProposta();
    else if (acao === "rejeitar") r = rejeitarProposta();
    else if (acao === "previa") r = tocarPrevia("proposta");
    else if (acao === "atual") r = tocarPrevia("atual");
    else if (acao === "ab") r = tocarPrevia("ab");
    if (r && !r.silencio) adicionar("assistente", r.texto, r);
  }

  function responder(textoBruto) {
    const { atual: A, original: O } = modelos();
    const t = numerosPorExtenso(norm(textoBruto));
    if (!A) return { texto: "Ainda não há uma partitura carregada. Gere uma no Songwriter ou cole um texto ABC aqui na aba, e eu analiso." };
    const vozes = A.vozes.filter((v) => v.eventos.length);
    const ref = extrairRef(t, vozes);
    const tipo = intencao(t, ref);
    if (tipo === "ajuda") return { texto: ajudaTexto() };
    if (tipo === "desconhecido") return { texto: "Não entendi esse pedido. " + ajudaTexto() };
    if (tipo === "desfazer" || tipo === "refazer") return controleHistorico(tipo);
    if (tipo === "aplicar") return aplicarProposta();
    if (tipo === "rejeitar") return rejeitarProposta();
    if (tipo === "previa") return tocarPrevia("proposta");

    if (tipo === "ensinar") {
      const g = achaTopico(t);
      const sel = API().selecao();
      const ev = sel.inicio != null ? eventoNaPosicao(A, sel.inicio) : null;
      const ex = g.exemplo ? g.exemplo({ modelo: A, ev }) : "";
      return { texto: g.titulo + "\n" + g.texto + (ex ? "\n" + ex : ""), destacar: ev && /nota|altura|figura|tom|semitom/.test(norm(g.titulo)) ? [ev.inicio] : [] };
    }

    // Escopo: só restringe quando a pessoa cita uma parte. "o que mudei?" e "tem erro?" olham a música toda;
    // "explica a música" dá a visão geral mesmo com uma nota selecionada.
    const explicito = temReferencia(ref);
    const geral = /\b(a musica|a partitura|musica inteira|musica toda|partitura toda|partitura inteira|visao geral|no geral|de um modo geral)\b/.test(t) && !explicito;
    const alvo = geral || ((tipo === "comparar" || tipo === "verificar") && !explicito) ? { vazio: true } : resolver(ref, A);
    avisoPendente = alvo.aviso || null;
    if (alvo.ambiguo) {
      return {
        texto: (alvo.motivo || "Preciso de mais um detalhe.") + " Em qual voz você quer?",
        chips: alvo.ambiguo.map((v) => ({ rotulo: v.nome, enviar: textoBruto + (String(v.id).indexOf("sec:") === 0 ? " (secao=" + v.id.slice(4) + ")" : " (voz=" + v.id + ")") })),
      };
    }
    if (alvo.erro) return { texto: alvo.erro };

    // ── explicar ──
    if (tipo === "explicar") {
      if (alvo.vazio) return { texto: M.explicarGeral(A), destacar: [] };
      if (alvo.trecho) {
        const n = alvo.eventos.filter((e) => e.tipo === "nota");
        return { texto: (alvo.secaoNome || "Trecho") + ", medidas " + alvo.eventos[0].medida + " a " + alvo.eventos[alvo.eventos.length - 1].medida + " (" + alvo.voz.nome + "):\nEm ordem: " + M.descreverNotas(A, alvo.eventos) + ".\n" + M.contorno(n), destacar: alvo.eventos.map((e) => e.inicio) };
      }
      if (alvo.eventos.length === 1 && !alvo.medida) {
        const ev = alvo.eventos[0];
        return { texto: (alvo.aviso ? alvo.aviso + "\n" : "") + M.explicarEvento(A, ev), destacar: [ev.inicio], foco: ev };
      }
      return { texto: (alvo.aviso ? alvo.aviso + "\n" : "") + M.explicarMedida(A, alvo.voz, alvo.medida.numero), destacar: alvo.eventos.map((e) => e.inicio) };
    }

    // ── editar a ALTURA: propõe, não aplica ──
    if (tipo === "editar") {
      const restaurar = /\b(restaur\w*|volt\w*|recuper\w*)\b/.test(t) && /\b(original|antes)\b/.test(t);
      const op = interpretarAltura(t);
      if (!restaurar && !op.dir && op.semitons == null) {
        const pedeDuracao = /\b(dur\w*|encurt\w*|along\w*|mais (curt\w*|long\w*))\b/.test(t);
        return { texto: (pedeDuracao ? "Mudar a duração pelo assistente ainda não está pronto. " : "Entendi que é uma edição, mas por enquanto eu só mudo a ALTURA. ") + "Posso subir ou descer uma nota, medida ou trecho (meio tom, um tom, uma oitava...) e voltar a altura para a da original. Exemplo: \"na medida 25, segunda nota, sobe meio tom\".", destacar: alvo.vazio ? [] : alvo.eventos.map((e) => e.inicio) };
      }
      if (alvo.vazio) return { texto: "Em qual nota ou trecho? Clique numa nota (ou marque um trecho) e peça de novo, ou diga, por exemplo, \"medida 25, segunda nota\"." };
      const notas = alvo.eventos.filter((e) => e.tipo === "nota");
      if (!notas.length) return { texto: "Nesse ponto só há pausas, e pausa não tem altura." };
      if (restaurar) {
        const { original: O } = modelos();
        if (!O) return { texto: "Não encontrei a partitura original para voltar." };
        const lista = [];
        notas.forEach((ev) => { const o = M.correspondenteNaOriginal(O, A, ev); if (o && o.tipo === "nota" && o.midi != null && !o.acorde && o.midi !== ev.midi) lista.push({ ev, midiAlvo: o.midi }); });
        if (!lista.length) return { texto: "A altura " + (notas.length === 1 ? "dessa nota" : "dessas notas") + " já é igual à da original." };
        return proporMudancas(A, lista, alvo.rotulo, "Voltar à altura da original");
      }
      if (!op.dir) return { texto: "Você quer subir ou descer?", chips: [{ rotulo: "Subir", enviar: textoBruto + " (subir)" }, { rotulo: "Descer", enviar: textoBruto + " (descer)" }] };
      if (op.semitons == null) return { texto: (op.dica ? "Entendi que ela precisa " + (op.dir > 0 ? "subir" : "descer") + ". " : "") + "Quanto?", chips: [["Meio tom", "meio tom"], ["Um tom", "um tom"], ["Dois tons", "dois tons"], ["Uma oitava", "uma oitava"]].map(([r, q]) => ({ rotulo: r, enviar: textoBruto + " " + q + (op.dica ? " " + (op.dir > 0 ? "(subir)" : "(descer)") : "") })) };
      const delta = op.dir * op.semitons;
      return proporMudancas(A, notas.map((ev) => ({ ev, midiAlvo: ev.midi + delta })), alvo.rotulo, (delta > 0 ? "Subir " : "Descer ") + semitonsTexto(delta));
    }

    // ── tudo daqui pra baixo compara com a ORIGINAL ──
    if (!O) return { texto: "Não encontrei a partitura original guardada para comparar. Se esta já é a versão de referência, use \"Definir a versão atual como original\" aqui no painel." };

    if (tipo === "verificar") {
      let ps = M.validar(A, O);
      if (!alvo.vazio) { const medidas = new Set(alvo.eventos.map((e) => e.voz + ":" + e.medida)); ps = ps.filter((p) => p.medida == null || medidas.has(p.voz + ":" + p.medida)); }
      const c = M.comparar(O, A);
      const artisticas = c.resumo.altura || 0;
      const erros = ps.filter((p) => p.gravidade === "erro"), avisos = ps.filter((p) => p.gravidade === "aviso"), infos = ps.filter((p) => p.gravidade === "info");
      if (!ps.length) return { texto: "Não encontrei nenhum problema técnico: os compassos somam o que a fórmula " + A.meta.compasso.texto + " pede, não há saltos exagerados e as durações são iguais às da original." + (artisticas ? "\nVocê mudou a altura de " + artisticas + (artisticas === 1 ? " nota" : " notas") + " em relação à original. Isso não é erro: é uma escolha sua." : "") };
      const linhas = [];
      const lista = (titulo, arr) => { if (arr.length) { linhas.push(titulo); arr.slice(0, 8).forEach((p) => linhas.push("• " + p.texto)); if (arr.length > 8) linhas.push("• ... e mais " + (arr.length - 8) + "."); } };
      lista("Problemas que precisam de atenção:", erros);
      lista("Pontos para conferir:", avisos);
      lista("Informações:", infos);
      if (artisticas) linhas.push("Obs.: " + artisticas + (artisticas === 1 ? " nota está" : " notas estão") + " com a altura diferente da original. Isso, por si só, não é erro: é escolha artística.");
      const inicios = [].concat(...ps.filter((p) => p.gravidade !== "info").map((p) => p.inicios || []));
      const primeiro = ps.find((p) => p.inicios && p.inicios.length);
      return { texto: linhas.join("\n"), destacar: inicios, chips: primeiro ? [{ rotulo: "Ir para o primeiro problema", selecionar: primeiro.inicios[0] }] : [] };
    }

    if (mesmaPartitura()) return { texto: "A versão atual e a original são idênticas: ainda não houve nenhuma mudança." };
    const comp = M.comparar(O, A);

    if (tipo === "original_altura") {
      if (alvo.vazio || alvo.eventos.length !== 1) return { texto: "De qual nota você quer saber? Clique nela ou diga, por exemplo, \"medida 25, segunda nota\"." };
      const ev = alvo.eventos[0];
      const o = M.correspondenteNaOriginal(O, A, ev);
      if (!o) return { texto: "Essa nota (" + alvo.rotulo + ") não existe na partitura original: foi adicionada por você.", destacar: [ev.inicio] };
      if (o.tipo !== "nota" || ev.tipo !== "nota" || o.midi == null || ev.midi == null) return { texto: "Na original, esse ponto era " + (o.tipo === "pausa" ? "uma pausa" : o.nomePt) + "; agora é " + (ev.tipo === "pausa" ? "uma pausa" : ev.nomePt) + ".", destacar: [ev.inicio] };
      const d = ev.midi - o.midi;
      const durTxt = Math.abs(o.duracao - ev.duracao) < 1e-6 ? "A duração é a mesma." : "A duração também mudou: era " + M.descreverDuracao(o.duracao, A.meta.compasso.den) + " e agora é " + M.descreverDuracao(ev.duracao, A.meta.compasso.den) + ".";
      const txt = d === 0 ? "Na original essa nota era igual: " + o.nomePt + ". A altura não mudou. " + durTxt
        : "Na original essa nota era " + (d > 0 ? "mais grave" : "mais aguda") + ": era " + o.nomePt + " e agora é " + ev.nomePt + ". Você " + (d > 0 ? "subiu" : "desceu") + " " + M.intervaloTexto(d) + " (" + Math.abs(d) + (Math.abs(d) === 1 ? " semitom" : " semitons") + "). " + durTxt;
      return { texto: "Medida " + ev.medida + ", nota " + ev.indice + " (" + ev.vozNome + "):\n" + txt, destacar: [ev.inicio] };
    }

    if (tipo === "original_sequencia") {
      let base = alvo;
      if (alvo.vazio) return { texto: "De qual parte você quer a sequência original? Clique numa nota, marque um trecho ou diga a medida." };
      const medidas = [...new Set(base.eventos.map((e) => e.medida))].sort((a, b) => a - b);
      const voz = A.vozes.find((v) => v.id === base.eventos[0].voz), vozO = O.vozes.find((v) => v.id === base.eventos[0].voz);
      if (!vozO) return { texto: "Essa voz não existe na original." };
      const linhas = [];
      medidas.slice(0, 8).forEach((n) => {
        const ma = voz.medidas[n], mo = vozO.medidas[n];
        linhas.push("Medida " + n + " (" + voz.nome + "):");
        linhas.push("  Original: " + (mo ? M.descreverNotas(O, mo.eventos) : "(não existia)"));
        linhas.push("  Atual:    " + (ma ? M.descreverNotas(A, ma.eventos) : "(não existe mais)"));
      });
      return { texto: linhas.join("\n"), destacar: base.eventos.map((e) => e.inicio) };
    }

    // comparar
    const escopo = alvo.vazio ? null : new Set(alvo.eventos.map((e) => e.inicio));
    const medidasEscopo = alvo.vazio ? null : new Set(alvo.eventos.map((e) => e.voz + ":" + e.medida));
    const difs = escopo ? comp.diferencas.filter((d) => medidasEscopo.has(d.voz + ":" + d.medida)) : comp.diferencas;
    const cab = escopo ? "Comparação de " + alvo.rotulo + " com a original:" : "Comparação geral entre a versão atual e a original:";
    const linhas = [cab];
    if (!escopo) comp.meta.forEach((m) => linhas.push("• Mudou o(a) " + m.tipo + ": de " + m.antes + " para " + m.depois + "."));
    if (!difs.length && !(comp.meta.length && !escopo)) { linhas.push("Nenhuma diferença: esse trecho está igual à partitura original."); return { texto: linhas.join("\n"), destacar: alvo.vazio ? [] : alvo.eventos.map((e) => e.inicio) }; }
    if (difs.length) {
      if (!escopo) {
        const r = comp.resumo, partes = [];
        if (r.altura) partes.push(r.altura + " de altura");
        if (r.duracao) partes.push(r.duracao + " de duração");
        if (r.altura_e_duracao) partes.push(r.altura_e_duracao + " de altura e duração");
        if (r.adicionada) partes.push(r.adicionada + " nota(s) adicionada(s)");
        if (r.removida) partes.push(r.removida + " nota(s) removida(s)");
        if (r.nota_virou_pausa || r.pausa_virou_nota) partes.push((r.nota_virou_pausa || 0) + (r.pausa_virou_nota || 0) + " troca(s) entre nota e pausa");
        if (r.cifra) partes.push(r.cifra + " de acorde");
        if (r.letra) partes.push(r.letra + " de letra");
        linhas.push(difs.length + (difs.length === 1 ? " diferença" : " diferenças") + ": " + partes.join(", ") + ".");
      }
      difs.slice(0, 12).forEach((d) => linhas.push("• " + M.textoDiferenca(A, d)));
      if (difs.length > 12) linhas.push("• ... e mais " + (difs.length - 12) + ". Peça uma medida específica para ver o resto.");
    }
    const inicios = difs.map((d) => (d.atual ? d.atual.inicio : null)).filter((x) => x != null);
    const primeira = difs.find((d) => d.atual);
    return { texto: linhas.join("\n"), destacar: inicios, chips: primeira ? [{ rotulo: "Ir para a primeira diferença", selecionar: primeira.atual.inicio }] : [] };
  }

  // ══ INTERFACE ════════════════════════════════════════════════════════════
  function escapar(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

  function adicionar(papel, texto, extras) {
    const lista = $("ptaMensagens");
    if (!lista) return;
    const div = document.createElement("div");
    div.className = "pta-msg pta-" + papel + (extras && extras.propostaCard ? " pta-proposta" : "");
    div.innerHTML = "<div class=\"pta-txt\">" + escapar(texto).replace(/\n/g, "<br>") + "</div>";
    if (extras && extras.chips && extras.chips.length) {
      const chips = document.createElement("div");
      chips.className = "pta-chips";
      extras.chips.forEach((c) => {
        const b = document.createElement("button");
        b.type = "button"; b.className = "pta-chip"; b.textContent = c.rotulo;
        b.addEventListener("click", () => {
          if (c.selecionar != null) { const api = API(); if (api) api.selecionarNota(c.selecionar); }
          else if (c.acao) acaoChip(c.acao, c.pid);
          else if (c.enviar) enviar(c.enviar, true);
        });
        chips.appendChild(b);
      });
      div.appendChild(chips);
    }
    lista.appendChild(div);
    lista.scrollTop = lista.scrollHeight;
    mensagens.push({ papel, texto });
  }

  function enviar(texto, silenciosoNoUsuario) {
    const limpo = String(texto || "").trim();
    if (!limpo) return;
    pararVoz(true);
    if (!silenciosoNoUsuario) adicionar("usuario", limpo);
    let r;
    avisoPendente = null;
    try { r = responder(limpo); if (avisoPendente && r.texto.indexOf(avisoPendente) < 0) r.texto = avisoPendente + "\n" + r.texto; }
    catch (e) { r = { texto: "Tive um problema ao analisar isso (" + (e.message || e) + "). A partitura não foi alterada." }; }
    ultimaResposta = r;
    if (!r.silencio) adicionar("assistente", r.texto, r);
    const api = API();
    if (api) api.destacarAnalise(r.destacar || []);
  }

  function atualizarContexto() {
    const el = $("ptaContexto");
    const api = API();
    if (!el || !api) return;
    const { atual: A, original: O } = modelos();
    const sel0 = api.selecao();
    const evSel0 = A && sel0.inicio != null ? eventoNaPosicao(A, sel0.inicio) : null;
    const bd = $("ptaDesfazer"), br = $("ptaRefazer");
    if (bd) bd.disabled = !api.podeDesfazer();
    if (br) br.disabled = !api.podeRefazer();
    [$("ptaMeioBaixo"), $("ptaMeioCima")].forEach((b) => { if (b) b.disabled = !(evSel0 && evSel0.tipo === "nota" && sel0.inicio === evSel0.inicio); });
    if (!A) { el.textContent = "Nenhuma partitura carregada."; return; }
    const sel = api.selecao();
    let partes = [];
    if (sel.trecho) {
      const a = A.porInicio.get(sel.trecho.de), b = A.porInicio.get(sel.trecho.ate);
      if (a && b) partes.push("Trecho: medidas " + Math.min(a.medida, b.medida) + " a " + Math.max(a.medida, b.medida) + " (" + a.vozNome + ")");
    } else if (sel.inicio != null) {
      const e = eventoNaPosicao(A, sel.inicio);
      if (e) {
        const sec = api.secoes().find((x) => e.medida >= x.de && e.medida <= x.ate);
        partes.push(e.vozNome + " · medida " + e.medida + " · " + (e.tipo === "nota" ? "nota " + e.indice + " (" + e.nome + ")" : "pausa " + e.indice) + (sec ? " · " + sec.nome : ""));
      }
    }
    if (!partes.length) partes.push("Nada selecionado");
    partes.push(!O ? "sem original guardada" : mesmaPartitura() ? "versão atual = original" : "editada em relação à original");
    el.textContent = "Analisando: " + partes.join(" · ");
  }

  // ── voz: mesmo reconhecimento de fala da Laranjinha (navegador, pt-BR, sem custo) ──
  const voz = { rec: null, ativo: false, base: "", descartar: false, programatico: false };
  function atualizarBotaoMic(ativo) {
    const b = $("ptaMic");
    if (!b) return;
    b.classList.toggle("pta-gravando", !!ativo);
    b.setAttribute("aria-pressed", ativo ? "true" : "false");
    b.title = ativo ? "Parar de ouvir" : "Falar (microfone)";
  }
  function avisoVoz(texto) {
    const a = $("ptaAvisoVoz");
    if (a) { a.textContent = texto || ""; a.hidden = !texto; }
  }
  function pararVoz(descartar) {
    if (!voz.rec || !voz.ativo) return;
    voz.descartar = !!descartar;
    try { descartar ? voz.rec.abort() : voz.rec.stop(); } catch (e) { /* já encerrou */ }
  }
  const ERROS_VOZ = {
    "not-allowed": "O navegador bloqueou o microfone. Libere o microfone para este site nas configurações.",
    "service-not-allowed": "O navegador bloqueou o reconhecimento de voz.",
    "no-speech": "Não ouvi nada. Toque no microfone e fale de novo.",
    "audio-capture": "Não encontrei um microfone neste aparelho.",
    "network": "O reconhecimento de voz precisa de internet.",
  };
  function iniciarVoz(input) {
    const btn = $("ptaMic");
    if (!btn) return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { btn.disabled = true; btn.title = "Este navegador não tem reconhecimento de voz. No celular, use o microfone do teclado."; return; }
    btn.addEventListener("click", () => {
      if (voz.ativo) { pararVoz(false); return; }
      const rec = new SR();
      rec.lang = "pt-BR"; rec.continuous = true; rec.interimResults = true; rec.maxAlternatives = 1;
      voz.descartar = false;
      voz.base = input.value && !/\s$/.test(input.value) ? input.value + " " : input.value;
      rec.onstart = () => { voz.ativo = true; atualizarBotaoMic(true); avisoVoz(null); };
      rec.onresult = (ev) => {
        if (voz.descartar || voz.rec !== rec) return;
        let fala = "";
        for (let i = 0; i < ev.results.length; i++) {
          const trecho = ev.results[i][0].transcript;
          fala = !fala ? trecho.replace(/^\s+/, "") : (/\s$/.test(fala) || /^\s/.test(trecho) ? fala + trecho : fala + " " + trecho);
        }
        voz.programatico = true;
        input.value = voz.base + fala;                       // a transcrição aparece na caixa: dá para corrigir antes de enviar
        voz.programatico = false;
      };
      rec.onerror = (ev) => { if (ev.error !== "aborted") avisoVoz(ERROS_VOZ[ev.error] || "Não consegui usar o microfone (" + ev.error + ")."); };
      rec.onend = () => { voz.ativo = false; voz.rec = null; voz.descartar = false; atualizarBotaoMic(false); };
      voz.rec = rec;
      try { rec.start(); voz.ativo = true; atualizarBotaoMic(true); }
      catch (e) { voz.rec = null; voz.ativo = false; avisoVoz("Não consegui iniciar o microfone. Tente de novo."); }
    });
    input.addEventListener("input", () => { if (!voz.programatico && voz.ativo) pararVoz(false); });   // digitou: o ditado para
  }

  function abrir(abrirPainel) {
    const painel = $("partituraAssistente"), corpo = $("partituraCorpo"), btn = $("partituraAssistenteBtn");
    if (!painel) return;
    painel.hidden = !abrirPainel;
    if (corpo) corpo.classList.toggle("com-assistente", !!abrirPainel);
    const secao = $("page-partitura"); if (secao) secao.classList.toggle("pta-aberto", !!abrirPainel);
    if (btn) { btn.classList.toggle("oh-ativo", !!abrirPainel); btn.setAttribute("aria-expanded", abrirPainel ? "true" : "false"); }
    try { localStorage.setItem(K_ABERTO, abrirPainel ? "1" : "0"); } catch (e) { /* sem armazenamento */ }
    if (abrirPainel) {
      atualizarContexto();
      if (!mensagens.length) adicionar("assistente", "Oi! Eu sou o assistente da sua partitura. Clique numa nota e pergunte \"explica essa nota\", ou peça \"o que eu mudei em relação à original?\". Também dá para falar pelo microfone.\nDigite \"ajuda\" para ver o que eu sei fazer.");
    } else {
      pararVoz(true);
      limparProposta();
      const api = API(); if (api) api.destacarAnalise([]);
    }
  }

  function iniciarAssistente() {
    if (!$("partituraAssistente") || !M) return;
    const input = $("ptaTexto");
    $("partituraAssistenteBtn").addEventListener("click", () => abrir($("partituraAssistente").hidden));
    $("ptaFechar").addEventListener("click", () => abrir(false));
    $("ptaEnviar").addEventListener("click", () => { const v = input.value; input.value = ""; enviar(v); input.focus(); });
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); const v = input.value; input.value = ""; enviar(v); }
      ev.stopPropagation();                                   // digitar aqui não pode acionar os atalhos do editor (Delete, Espaço...)
    });
    document.querySelectorAll("[data-pta-atalho]").forEach((b) => b.addEventListener("click", () => {
      let txt = b.getAttribute("data-pta-atalho");
      if (txt === "__selecao__") { const api = API(); txt = api && api.selecao().trecho ? "explica esse trecho" : "explica essa nota"; }
      enviar(txt);
    }));
    $("ptaDefinirOriginal").addEventListener("click", () => {
      const api = API();
      if (!api) return;
      if (!api.abcAtual().trim()) { adicionar("assistente", "Ainda não há partitura para definir como original."); return; }
      api.definirOriginal(api.abcAtual());
      cacheO = null;
      atualizarContexto();
      adicionar("assistente", "Pronto: a versão atual agora é a partitura original (a referência das comparações).");
    });
    $("ptaDesfazer").addEventListener("click", () => { const api = API(); if (api) api.desfazer(); });
    $("ptaRefazer").addEventListener("click", () => { const api = API(); if (api) api.refazer(); });
    $("ptaMeioBaixo").addEventListener("click", () => { const api = API(); if (api) api.moverSemitom(-1); });
    $("ptaMeioCima").addEventListener("click", () => { const api = API(); if (api) api.moverSemitom(1); });
    iniciarVoz(input);
    document.addEventListener("oh-partitura-estado", (ev) => {
      const tipo = ev.detail && ev.detail.tipo;
      if (tipo === "texto") { const api = API(); if (api) api.destacarAnalise([]); reavaliarExercicio(true); }
      if (!$("partituraAssistente").hidden) atualizarContexto();
    });
    let aberto = false;
    try { aberto = localStorage.getItem(K_ABERTO) === "1"; } catch (e) { /* ok */ }
    abrir(aberto);
  }

  window.PartituraAssistente = { _teste: { voz, previa, proposta: () => proposta, responder, extrairRef, numerosPorExtenso, norm, intencao, enviar, modelos, resolver, abrir, atualizarContexto } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciarAssistente);
  else iniciarAssistente();
})();
