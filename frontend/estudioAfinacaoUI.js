// ══════════════════════════════════════════════════════════════════════════
// estudioAfinacaoUI.js — editor de afinação por linha contínua (o mesmo componente vale para o protótipo e para o Estúdio).
//
//   const ed = EstudioAfinacaoUI.criar(elemento, { modo: "estudio" | "prototipo", aoAplicar(cents, det) {...}, aoAmpliar() {...} });
//   await ed.carregar({ mono, sr, nome, chave, cents, origemTempo, batidaSeg, porCompasso, tonica });
//
// A voz vira uma LINHA (laranja). Onde você mexeu, a linha fica TURQUESA; a voz de antes fica como um traço claro fino.
// Puxar um ponto forma um triângulo; selecionar um trecho (arrastando numa área vazia) move/corrige só ele.
// Depende de estudioAfinacao.js (detecção da altura e correção por PSOLA).
// ══════════════════════════════════════════════════════════════════════════
(function (raiz) {
  "use strict";
  const CSS = `
.af { --af-fundo:#0a0705; --af-painel:#14100b; --af-painel2:#1b150e; --af-borda:rgba(249,115,22,.28); --af-borda2:rgba(249,115,22,.6); --af-laranja:#f97316; --af-texto:#f4ece4; --af-suave:#b9ab9d; --af-turq:#2dd4bf;
  display:flex; flex-direction:column; height:100%; min-height:0; background:var(--af-fundo); color:var(--af-texto); font:13px 'Bricolage Grotesque',system-ui,sans-serif; position:relative; }
.af *, .af *::before, .af *::after { box-sizing:border-box; }
.af-barra { display:flex; align-items:center; gap:7px; padding:6px 10px; background:var(--af-painel2); border-bottom:1px solid var(--af-borda); flex-wrap:wrap; flex:0 0 auto; }
.af-grupo { display:flex; align-items:center; gap:6px; padding:2px 8px; border:1px solid var(--af-borda); border-radius:12px; background:#100c08; }
.af-grupo > b { font-size:10px; text-transform:uppercase; letter-spacing:.6px; color:var(--af-suave); }
.af-seg { display:inline-flex; border:1px solid var(--af-borda2); border-radius:999px; overflow:hidden; } .af-seg button { border:0; border-radius:0; padding:4px 11px; } .af-seg button + button { border-left:1px solid var(--af-borda2); }
.af label { display:flex; align-items:center; gap:5px; color:var(--af-suave); font-size:11px; white-space:nowrap; }
.af select, .af input[type=number] { background:#0a0705; border:1px solid var(--af-borda); border-radius:8px; color:var(--af-texto); padding:3px 6px; font:inherit; font-size:12px; }
.af input[type=range] { accent-color:var(--af-laranja); width:84px; } .af input[type=checkbox] { accent-color:var(--af-laranja); }
.af button { font:inherit; background:transparent; border:1px solid var(--af-borda2); color:var(--af-laranja); border-radius:999px; padding:4px 11px; font-weight:700; cursor:pointer; white-space:nowrap; transition:background .12s, box-shadow .12s, transform .06s; }
.af button:hover { background:rgba(249,115,22,.16); box-shadow:0 0 14px rgba(249,115,22,.3); } .af button:active { transform:translateY(1px) scale(.98); }
.af button.cheio { background:linear-gradient(145deg,#ff9a4d,#ec5a0c); color:#1a0c02; border-color:#ff9a4d; } .af button.cheio:hover { box-shadow:0 0 18px rgba(255,138,42,.6); }
.af button.on { background:var(--af-laranja); color:#1a0c02; } .af button:disabled { opacity:.4; cursor:not-allowed; box-shadow:none; }
.af-esp { flex:1; } .af-g1 { order:1; } .af-dir { order:2; margin-left:auto; display:flex; gap:7px; align-items:center; flex-wrap:wrap; } .af-quebra { order:3; flex-basis:100%; height:0; } .af-g2 { order:4; } .af-g3 { order:5; } .af-tempo { font-variant-numeric:tabular-nums; min-width:44px; font-weight:700; }
.af-painel { display:none; padding:6px 10px; background:#110d09; border-bottom:1px solid var(--af-borda); gap:8px; flex-wrap:wrap; align-items:center; flex:0 0 auto; } .af-painel.on { display:flex; }
.af-vp { position:relative; overflow:auto; flex:1; min-height:150px; background:var(--af-fundo); scrollbar-color:rgba(249,115,22,.5) var(--af-fundo); }
.af-cv { position:sticky; left:0; top:0; display:block; touch-action:none; } .af-espaco { position:absolute; left:0; top:0; pointer-events:none; }
.af-rodape { display:flex; gap:12px; align-items:center; padding:5px 96px 5px 10px; background:#090604; border-top:1px solid var(--af-borda); color:var(--af-suave); font-size:11px; flex-wrap:wrap; flex:0 0 auto; }
.af-rodape .e { flex:1; min-width:180px; } .af-leg i { display:inline-block; width:20px; height:4px; border-radius:2px; margin:0 5px 2px 8px; vertical-align:middle; }
.af-vazio { position:absolute; inset:0; display:none; align-items:center; justify-content:center; text-align:center; padding:24px; color:var(--af-suave); line-height:1.6; background:var(--af-fundo); z-index:2; } .af-vazio.on { display:flex; }
.af-carregando { position:absolute; inset:0; background:rgba(0,0,0,.7); display:none; align-items:center; justify-content:center; z-index:5; font-size:15px; } .af-carregando.on { display:flex; } .af-carregando div { background:var(--af-painel); border:1px solid var(--af-borda2); border-radius:16px; padding:16px 24px; }
.af-tut { position:fixed; inset:0; background:rgba(0,0,0,.72); backdrop-filter:blur(2px); display:none; align-items:center; justify-content:center; z-index:400; padding:16px; } .af-tut.on { display:flex; }
.af-tut .cartao { width:min(560px,100%); max-height:96vh; overflow:auto; background:linear-gradient(165deg,rgba(28,18,10,.99),rgba(12,9,6,.99)); border:1px solid var(--af-borda2); border-radius:20px; padding:18px 22px 16px; box-shadow:0 30px 90px rgba(0,0,0,.7); }
.af-tut h2 { margin:0 0 4px; font-size:18px; color:var(--af-laranja); } .af-tut p { margin:0 0 10px; line-height:1.5; color:#e6dacb; } .af-tut .passo { font-size:11px; color:var(--af-suave); text-transform:uppercase; letter-spacing:.6px; }
.af-tut svg { width:100%; height:auto; background:#0a0705; border:1px solid var(--af-borda); border-radius:12px; margin:4px 0 10px; }
.af-tut .nav { display:flex; align-items:center; gap:8px; } .af-tut .pontos { flex:1; display:flex; gap:6px; justify-content:center; } .af-tut .pontos i { width:8px; height:8px; border-radius:50%; background:#3a2f23; } .af-tut .pontos i.on { background:var(--af-laranja); box-shadow:0 0 8px var(--af-laranja); }
`;
  const AF = raiz.EstudioAfinacao;
  const LEFT = 62, TOP = 28, NOMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const mod12 = (m) => ((m % 12) + 12) % 12, nomeNota = (m) => NOMES[mod12(m)] + (Math.floor(m / 12) - 1), ehPreta = (m) => [1, 3, 6, 8, 10].includes(mod12(m));
  const MAIOR = [0, 2, 4, 5, 7, 9, 11], MENOR = [0, 2, 3, 5, 7, 8, 10];
  const med = (a) => { const o = a.slice().sort((x, y) => x - y); return o[o.length >> 1]; };
  const fmt = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, "0")}`;
  const rr = (g, x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
  function wav(x, sr) { const b = new ArrayBuffer(44 + x.length * 2), v = new DataView(b), w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); }; w(0, "RIFF"); v.setUint32(4, 36 + x.length * 2, true); w(8, "WAVEfmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, x.length * 2, true); for (let i = 0; i < x.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, x[i])) * 32767, true); return new Blob([b], { type: "audio/wav" }); }

  // ── tutorial (desenhos) ──
  const L = "#ff8a2a", TQ = "#2dd4bf", T = (x, y, t, o) => `<text x="${x}" y="${y}" fill="${(o && o.c) || "#e6dacb"}" font-size="${(o && o.s) || 11}" font-weight="${(o && o.w) || 600}" text-anchor="${(o && o.a) || "start"}" font-family="Bricolage Grotesque, system-ui">${t}</text>`;
  const grade = (n = 5) => Array.from({ length: n }, (_, i) => `<line x1="30" y1="${20 + i * 20}" x2="310" y2="${20 + i * 20}" stroke="rgba(249,115,22,.3)"/>`).join("") + [70, 130, 190, 250].map((x) => `<line x1="${x}" y1="14" x2="${x}" y2="106" stroke="rgba(255,255,255,.07)"/>`).join("");
  const linha = (d, c = L, w = 4) => `<path d="${d}" fill="none" stroke="${c}" stroke-opacity=".3" stroke-width="${w + 6}" stroke-linecap="round" stroke-linejoin="round"/><path d="${d}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
  const passos = (modo) => [
    ["A linha é a sua voz", "Para a direita passa o tempo; para cima a nota fica mais aguda. Cada faixa horizontal é uma nota (o teclado está à esquerda) e as linhas laranja mais fortes são as notas do tom escolhido. Os traços verticais são os tempos e os compassos. Laranja é como a voz foi cantada; turquesa é o que você ajustou.",
      `<svg viewBox="0 0 320 120">${grade()}${linha("M40 80 q10 -6 20 0 t20 0 t20 0 t20 0 L150 58 q10 -6 20 0 t20 0 t20 0 t20 0 L260 40")}${T(14, 112, "tempo →", { c: "#b9ab9d" })}${T(2, 14, "↑ nota", { c: "#b9ab9d" })}${T(48, 98, "vibrato = onda", { c: "#ffb070" })}</svg>`],
    ["Ouça primeiro", "Toque no ▶ e alterne entre Original e Afinado para comparar. A Velocidade (de 25% a 200%) não muda o tom: ótima para ouvir um pedacinho com calma. Selecione um trecho e marque “Repetir a seleção” para ele tocar em volta.",
      `<svg viewBox="0 0 320 120"><rect x="20" y="22" width="86" height="30" rx="15" fill="${L}"/>${T(63, 42, "Original", { c: "#1a0c02", a: "middle", w: 800, s: 12 })}<rect x="106" y="22" width="86" height="30" rx="15" fill="none" stroke="${L}"/>${T(149, 42, "Afinado", { c: L, a: "middle", w: 800, s: 12 })}<rect x="214" y="22" width="86" height="30" rx="15" fill="${L}"/>${T(257, 42, "▶ Tocar", { c: "#1a0c02", a: "middle", w: 800, s: 12 })}<rect x="20" y="68" width="150" height="30" rx="8" fill="none" stroke="rgba(249,115,22,.5)"/>${T(95, 88, "Velocidade: 50%", { a: "middle", s: 12 })}${T(190, 88, "o tom NÃO muda", { c: "#ffb070", s: 12 })}</svg>`],
    ["Selecione um trecho", "Arraste numa área vazia (acima ou abaixo da linha) para marcar um pedaço do tempo: ele ganha uma moldura laranja, com alças nas pontas (arraste-as para ajustar) e mostra quanto tempo e quantas notas tem. Dá para corrigir só ele, tocar só ele ou mover tudo junto.",
      `<svg viewBox="0 0 320 120">${grade()}<rect x="110" y="14" width="110" height="92" fill="rgba(249,115,22,.14)" stroke="${L}" stroke-width="2"/><rect x="106" y="22" width="8" height="26" rx="3" fill="${L}"/><rect x="216" y="22" width="8" height="26" rx="3" fill="${L}"/>${linha("M40 70 q10 -6 20 0 t20 0 t20 0 t20 0 q10 -6 20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 L300 50")}${T(165, 30, "0,8 s · 2 notas", { a: "middle", c: "#fff" })}</svg>`],
    ["Puxe a linha", "Segure um ponto da linha e arraste para cima ou para baixo: a linha acompanha formando um triângulo, e o Alcance (em Ajustes) controla a largura. O ponto anda de semitom em semitom (ou só pelas notas do tom, ou livre: escolha em Ajustes). Se o ponto estiver dentro de uma seleção, ela inteira se move junto.",
      `<svg viewBox="0 0 320 120">${grade()}<path d="M40 80 L290 80" stroke="rgba(255,255,255,.35)" stroke-width="2" fill="none" stroke-dasharray="4 3"/>${linha("M40 80 L110 80", L)}${linha("M110 80 L160 36 L210 80", TQ)}${linha("M210 80 L290 80", L)}<circle cx="160" cy="36" r="7" fill="#fff" stroke="${TQ}" stroke-width="3"/>${T(160, 112, "alcance", { a: "middle", c: "#b9ab9d" })}<path d="M110 104 L210 104" stroke="#b9ab9d" stroke-width="1.5"/>${T(172, 28, "↑", { c: "#fff", s: 16 })}</svg>`],
    ["Corrigir sozinho", "“Corrigir tudo” (ou só a seleção) leva cada nota ao centro da nota certa do tom escolhido (em “Cromática” são todos os semitons). A Força diz quanto (100% = no centro). Em Ajustes, “Tirar vibrato” alisa a onda. As etiquetas mostram o nome de cada nota e, se estiver fora, uma seta com quantos cents faltam.",
      `<svg viewBox="0 0 320 120">${grade()}<path d="M40 74 q10 -5 20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="2"/>${linha("M40 60 q10 -5 20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0", TQ)}<rect x="70" y="20" width="62" height="18" rx="9" fill="${L}"/>${T(101, 33, "D4 ▼38", { c: "#1a0c02", a: "middle", s: 10, w: 800 })}<rect x="186" y="20" width="42" height="18" rx="9" fill="#14100b" stroke="rgba(249,115,22,.6)"/>${T(207, 33, "D4", { a: "middle", s: 10, w: 800 })}${T(101, 108, "antes", { a: "middle", c: "#b9ab9d" })}${T(207, 108, "depois", { a: "middle", c: "#b9ab9d" })}</svg>`],
    modo === "estudio"
      ? ["Aplicar na região", "Quando estiver bom, clique em “Aplicar na região”: o áudio da região passa a tocar afinado, e a versão sem afinação fica guardada (use “Ouvir a versão sem afinação” na aba Região para comparar). Ctrl+Z desfaz. Dica: limpe o ruído antes de afinar e ouça com fone de ouvido.",
        `<svg viewBox="0 0 320 120"><rect x="60" y="22" width="200" height="34" rx="17" fill="${L}"/>${T(160, 44, "Aplicar na região", { c: "#1a0c02", a: "middle", w: 800, s: 13 })}<rect x="40" y="72" width="110" height="28" rx="14" fill="none" stroke="${L}"/>${T(95, 90, "Desfazer", { c: L, a: "middle", w: 800 })}<rect x="170" y="72" width="110" height="28" rx="14" fill="none" stroke="${L}"/>${T(225, 90, "Reverter tudo", { c: L, a: "middle", w: 800 })}</svg>`]
      : ["Desfazer e levar", "Ctrl+Z desfaz, Ctrl+Y refaz, e “Reverter tudo” volta à voz original. “Baixar WAV” guarda a voz afinada. Dica: grave e ouça com fone de ouvido, e comece pelas notas que as etiquetas mostram mais fora.",
        `<svg viewBox="0 0 320 120"><rect x="20" y="20" width="84" height="28" rx="14" fill="none" stroke="${L}"/>${T(62, 38, "Desfazer", { c: L, a: "middle", w: 800 })}<rect x="118" y="20" width="84" height="28" rx="14" fill="none" stroke="${L}"/>${T(160, 38, "Refazer", { c: L, a: "middle", w: 800 })}<rect x="216" y="20" width="84" height="28" rx="14" fill="none" stroke="${L}"/>${T(258, 38, "Reverter", { c: L, a: "middle", w: 800 })}<rect x="90" y="68" width="140" height="30" rx="15" fill="${L}"/>${T(160, 88, "Baixar WAV", { c: "#1a0c02", a: "middle", w: 800, s: 12 })}</svg>`],
  ];

  function criar(host, opc) {
    opc = opc || {}; const modo = opc.modo || "estudio";
    if (!document.getElementById("afEstilo")) { const s = document.createElement("style"); s.id = "afEstilo"; s.textContent = CSS; document.head.appendChild(s); }
    const TONS = [["cromatica", "Cromática (todos os semitons)"]]; NOMES.forEach((n, i) => TONS.push(["M" + i, n + " maior"])); NOMES.forEach((n, i) => TONS.push(["m" + i, n + " menor"]));
    host.innerHTML = `<div class="af">
      <div class="af-barra">
        <div class="af-grupo af-g1"><b>Ouvir</b><span class="af-seg"><button id="afOrig" class="on">Original</button><button id="afAfin">Afinado</button></span>
          <button id="afPlay" class="cheio">▶ Tocar</button><span class="af-tempo" id="afTempo">0:00.0</span>
          <label title="Muda a velocidade SEM mudar o tom (bom para ouvir um pedacinho com calma)">Velocidade <select id="afVel"><option value="0.25">25%</option><option value="0.5">50%</option><option value="0.75">75%</option><option value="1" selected>100%</option><option value="1.25">125%</option><option value="1.5">150%</option><option value="2">200%</option></select></label>
          <label title="Seleciona um trecho (arrastando numa área vazia) e toca só ele, sem parar"><input type="checkbox" id="afLoop"> Repetir a seleção</label></div>
        <div class="af-grupo af-g2"><b>Corrigir</b><label>Tom <select id="afTom"></select></label>
          <label title="0% não mexe; 100% leva a nota ao centro">Força <input type="range" id="afForca" min="0" max="100" value="100"><span id="afForcaV">100%</span></label>
          <button id="afCorrigir">Corrigir tudo</button><button id="afCorrigirSel" disabled>Corrigir seleção</button></div>
        <div class="af-grupo af-g3"><button id="afDesfazer" disabled>Desfazer</button><button id="afRefazer" disabled>Refazer</button><button id="afReverter">Reverter tudo</button></div>
        <div class="af-dir"><button id="afTut">Como usar</button><button id="afAjustes">Ajustes ▾</button>
        ${modo === "estudio" ? '<button id="afAmpliar" title="Ocupa a tela toda para ver melhor">Ampliar ⤢</button><button id="afAplicar" class="cheio" title="Grava a afinação no áudio da região (a versão sem afinação fica guardada)">Aplicar na região</button>' : '<button id="afBaixar" class="cheio" title="Baixa a voz afinada em WAV">Baixar WAV</button>'}</div><div class="af-quebra"></div>
      </div>
      <div class="af-painel" id="afPainel">
        <label title="Quanto da linha acompanha o ponto que você puxa (a largura do triângulo)">Alcance do puxão <input type="range" id="afAlcance" min="50" max="600" value="200"><span id="afAlcanceV">200 ms</span></label>
        <label title="Como o ponto anda ao puxar. Segure Alt para soltar de vez">Encaixe ao puxar <select id="afEncaixe"><option value="semitom">Semitom em semitom (todas as notas)</option><option value="tom">Só as notas do tom</option><option value="livre">Livre (qualquer altura)</option></select></label>
        <label title="Quanto do vibrato é retirado ao corrigir (0% mantém todo o vibrato)">Tirar vibrato <input type="range" id="afVib" min="0" max="100" value="0"><span id="afVibV">0%</span></label>
        <label><input type="checkbox" id="afNomes" checked> Mostrar o nome das notas</label>
        ${modo === "prototipo" ? '<label>Andamento <input type="number" id="afBpm" value="100" min="40" max="220" style="width:58px"></label>' : ""}
        <label>Zoom do tempo <input type="range" id="afZoomT" min="30" max="400" value="110"></label>
        <label>Altura das notas <input type="range" id="afZoomV" min="12" max="44" value="22"></label>
      </div>
      <div class="af-vp" id="afVp"><canvas class="af-cv" id="afCv"></canvas><div class="af-espaco" id="afEspaco"></div><div class="af-vazio on" id="afVazio"></div></div>
      <div class="af-rodape"><span class="e" id="afStatus">Selecione uma região de voz.</span><span id="afInfo"></span>
        <span class="af-leg">Linha: <i style="background:linear-gradient(90deg,#ff8a2a,#ffd2a8)"></i>como foi cantado <i style="background:linear-gradient(90deg,#2dd4bf,#ccfbf1)"></i>ajustado por você <i style="background:rgba(255,255,255,.35)"></i>antes do ajuste</span></div>
      <div class="af-carregando" id="afCarregando"><div id="afCarregandoTxt">Analisando a voz…</div></div>
      <div class="af-tut" id="afTutModal"><div class="cartao"><div class="passo" id="afTutPasso"></div><h2 id="afTutTitulo"></h2><div id="afTutSvg"></div><p id="afTutTexto"></p>
        <div class="nav"><button id="afTutVoltar">Voltar</button><div class="pontos" id="afTutPontos"></div><button id="afTutProx" class="cheio">Próximo</button></div></div></div>
    </div>`;
    const $ = (id) => host.querySelector("#" + id), vp = $("afVp"), cv = $("afCv"), status = (t) => { $("afStatus").textContent = t; };
    const E = { sr: 44100, mono: null, dur: 0, det: null, midi: null, cents: null, trans: null, nts: null, sel: null, pps: 110, ph: 22, minM: 48, maxM: 72, tom: "cromatica", bpm: 100, beat: 0.6, porComp: 4, origem: 0, alcance: 0.2, encaixe: "semitom", nomes: true, undo: [], redo: [], sujo: true, afinado: null, urlO: null, urlA: null, tocando: false, ocupado: false, pos: 0, ouvir: "original", vel: 1, loop: false, voltas: 0, nTocadas: 0, hover: -1, drag: null, nome: "voz", chave: null, carregado: false };
    $("afTom").innerHTML = TONS.map(([v, n]) => `<option value="${v}">${n}</option>`).join("");

    // ── escala e encaixe ──
    function pcs() { if (E.tom === "cromatica") return null; const t = +E.tom.slice(1), g = E.tom[0] === "M" ? MAIOR : MENOR; return new Set(g.map((d) => (d + t) % 12)); }
    function notaMaisPerto(m) { const s = pcs(), r = Math.round(m); if (!s) return r; let best = r, bd = 1e9; for (let k = -4; k <= 4; k++) { const c = r + k; if (s.has(mod12(c)) && Math.abs(m - c) < bd) { bd = Math.abs(m - c); best = c; } } return best; }
    const alvoDeEncaixe = (m, alt) => (alt || E.encaixe === "livre" ? m : E.encaixe === "tom" ? notaMaisPerto(m) : Math.round(m));

    // ── coordenadas ──
    const X = (t) => LEFT + t * E.pps - vp.scrollLeft, Y = (m) => TOP + (E.maxM + 0.5 - m) * E.ph - vp.scrollTop;
    const tempoEm = (x) => (x - LEFT + vp.scrollLeft) / E.pps, midiEm = (y) => E.maxM + 0.5 - (y - TOP + vp.scrollTop) / E.ph;
    const tq = (q) => E.det.t0 + q * E.det.hop, mcorr = (q) => E.midi[q] + E.cents[q] / 100;
    function dimensionar() {
      const w = vp.clientWidth, h = vp.clientHeight, dpr = window.devicePixelRatio || 1; if (!w || !h) return;
      cv.width = w * dpr; cv.height = h * dpr; cv.style.width = w + "px"; cv.style.height = h + "px"; cv.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0);
      const es = $("afEspaco"); es.style.width = LEFT + E.dur * E.pps + 80 + "px"; es.style.height = TOP + (E.maxM - E.minM + 1) * E.ph + 24 + "px"; desenhar();
    }

    // ── análise ──
    function notas() {   // separa a linha em notas (trechos estáveis); trechos curtos (< 80 ms) são "passagens" e não são corrigidos
      const d = E.det, out = []; let q = 0;
      while (q < d.n) {
        if (!d.voz[q]) { q++; continue; }
        const q0 = q; let jan = [E.midi[q]], centro = E.midi[q]; q++;
        while (q < d.n && d.voz[q]) {
          const m = E.midi[q];
          if (Math.abs(m - centro) <= 0.8) { jan.push(m); if (jan.length > 25) jan.shift(); centro = med(jan); q++; }
          else { let troca = true; for (let k = 0; k < 3; k++) { const i = q + k; if (i >= d.n || !d.voz[i] || Math.abs(E.midi[i] - centro) <= 0.8) { troca = false; break; } } if (troca) break; jan.push(m); q++; }
        }
        const todos = []; for (let i = q0; i < q; i++) todos.push(E.midi[i]);
        out.push({ q0, q1: q - 1, centro: med(todos), curta: q - q0 < 8 });
      }
      return out;
    }
    function rotulos(ini, fim) {   // etiqueta de cada nota: nome da nota mais perto e, se estiver fora (> 25 cents), uma seta com quantos cents faltam
      if (!E.det || !E.nts) return []; const out = [];
      for (const n of E.nts) {
        if (n.curta || tq(n.q1) < ini || tq(n.q0) > fim) continue;
        const v = []; for (let q = n.q0; q <= n.q1; q++) if (E.det.voz[q]) v.push(mcorr(q)); const c = med(v), nota = notaMaisPerto(c), dev = (c - nota) * 100, fora = Math.abs(dev) > 25;
        out.push({ q0: n.q0, q1: n.q1, nota, dev, fora, texto: nomeNota(nota) + (fora ? (dev < 0 ? " ▼" : " ▲") + Math.round(Math.abs(dev)) : ""), y: c });
      }
      return out;
    }
    const notasNaSelecao = () => (E.sel && E.nts ? E.nts.filter((n) => !n.curta && tq(n.q1) >= E.sel[0] && tq(n.q0) <= E.sel[1]).length : 0);

    // ── desenho ──
    function desenhar() {
      const g = cv.getContext("2d"), W = vp.clientWidth, H = vp.clientHeight; if (!W || !H) return; g.clearRect(0, 0, W, H); g.fillStyle = "#0a0705"; g.fillRect(0, 0, W, H);
      const s = pcs(), m0 = Math.max(E.minM, Math.floor(midiEm(H))), m1 = Math.min(E.maxM, Math.ceil(midiEm(TOP))), tIni = Math.max(0, tempoEm(LEFT)), tFim = tempoEm(W);
      for (let m = m0; m <= m1; m++) {                                      // referências HORIZONTAIS: uma faixa por nota; as do tom ficam em destaque
        const y = Y(m), ativa = !s || s.has(mod12(m));
        g.fillStyle = ehPreta(m) ? "rgba(255,255,255,.03)" : "rgba(255,255,255,.012)"; g.fillRect(LEFT, y - E.ph / 2, W - LEFT, E.ph);
        if (s && ativa) { g.fillStyle = "rgba(249,115,22,.07)"; g.fillRect(LEFT, y - E.ph / 2, W - LEFT, E.ph); }
        g.strokeStyle = ativa && s ? "rgba(249,115,22,.34)" : "rgba(255,255,255,.06)"; g.lineWidth = 1; g.beginPath(); g.moveTo(LEFT, Math.round(y) + .5); g.lineTo(W, Math.round(y) + .5); g.stroke();
      }
      const dt = E.beat;                                                     // referências VERTICAIS: tempos (fracos) e compassos (fortes), alinhados com a régua do projeto
      for (let b = Math.floor((E.origem + tIni) / dt); b * dt - E.origem <= tFim; b++) { const x = X(b * dt - E.origem), compasso = b % E.porComp === 0; if (x < LEFT) continue; g.strokeStyle = compasso ? "rgba(249,115,22,.32)" : "rgba(255,255,255,.055)"; g.lineWidth = 1; g.beginPath(); g.moveTo(Math.round(x) + .5, TOP); g.lineTo(Math.round(x) + .5, H); g.stroke(); }
      if (E.det) {
        const q0 = Math.max(0, Math.floor((tIni - E.det.t0) / E.det.hop) - 1), q1 = Math.min(E.det.n - 1, Math.ceil((tFim - E.det.t0) / E.det.hop) + 1);
        g.lineCap = "round"; g.lineJoin = "round";
        const trechos = [];                                                  // trechos contínuos de voz
        for (let q = q0; q <= q1;) { if (!E.det.voz[q]) { q++; continue; } const a = q; while (q <= q1 && E.det.voz[q]) q++; trechos.push([a, q - 1]); }
        const caminho = (a, b, corrigida) => { g.beginPath(); for (let q = a; q <= b; q++) { const x = X(tq(q)), y = Y(corrigida ? mcorr(q) : E.midi[q]); q === a ? g.moveTo(x, y) : g.lineTo(x, y); } };
        for (const [a, b] of trechos) {                                      // a voz como era antes (só aparece onde você mexeu)
          let mexido = false; for (let q = a; q <= b; q++) if (Math.abs(E.cents[q]) > 0.5) { mexido = true; break; }
          if (mexido) { caminho(a, b, false); g.strokeStyle = "rgba(255,255,255,.35)"; g.lineWidth = 2; g.stroke(); }
        }
        if (E.sel) for (const [a, b] of trechos) {                           // dentro da seleção a linha ganha um halo claro
          let ini = -1; for (let q = a; q <= b + 1; q++) { const dentro = q <= b && tq(q) >= E.sel[0] && tq(q) <= E.sel[1]; if (dentro && ini < 0) ini = q; if (!dentro && ini >= 0) { caminho(Math.max(a, ini - 1), Math.min(b, q), true); g.strokeStyle = "rgba(255,255,255,.22)"; g.lineWidth = 16; g.stroke(); ini = -1; } }
        }
        for (const [a, b] of trechos) {                                      // a linha da voz: laranja (como cantou) ou turquesa (onde você ajustou), grossa e brilhante
          for (let q = a; q <= b;) {
            const ed = Math.abs(E.cents[q]) > 0.5; let z = q; while (z + 1 <= b && (Math.abs(E.cents[z + 1]) > 0.5) === ed) z++;
            caminho(Math.max(a, q - 1), Math.min(b, z + 1), true);
            g.strokeStyle = ed ? "rgba(20,184,166,.32)" : "rgba(249,115,22,.28)"; g.lineWidth = 11; g.stroke();
            g.strokeStyle = ed ? "#2dd4bf" : "#ff8a2a"; g.lineWidth = 5; g.stroke();
            g.strokeStyle = ed ? "rgba(204,251,241,.9)" : "rgba(255,226,196,.9)"; g.lineWidth = 1.6; g.stroke();
            q = z + 1;
          }
        }
        if (E.nomes) {                                                       // etiquetas
          g.font = "700 11px 'Bricolage Grotesque', system-ui"; g.textBaseline = "middle"; g.textAlign = "center";
          for (const r of rotulos(tIni, tFim)) {
            const xa = X(tq(r.q0)), xb = X(tq(r.q1)); if (xb - xa < 44) continue; const w = g.measureText(r.texto).width + 16, cx = (xa + xb) / 2, cy = Y(r.y) - 24; if (cx < LEFT + w / 2) continue;
            rr(g, cx - w / 2, cy - 10, w, 20, 10); g.fillStyle = r.fora ? "rgba(249,115,22,.95)" : "rgba(20,16,11,.92)"; g.fill(); g.strokeStyle = r.fora ? "#ffb070" : "rgba(249,115,22,.55)"; g.lineWidth = 1; g.stroke();
            g.fillStyle = r.fora ? "#1a0c02" : "#f4ece4"; g.fillText(r.texto, cx, cy + 1);
          }
          g.textAlign = "left";
        }
        if (E.hover >= 0 && E.det.voz[E.hover]) { g.fillStyle = "#fff"; g.strokeStyle = "#f97316"; g.lineWidth = 3; g.shadowColor = "rgba(249,115,22,.9)"; g.shadowBlur = 14; g.beginPath(); g.arc(X(tq(E.hover)), Y(mcorr(E.hover)), 7, 0, 7); g.fill(); g.stroke(); g.shadowBlur = 0; }
      }
      if (E.sel) {                                                           // SELEÇÃO: moldura laranja, alças nas pontas e etiqueta com a duração
        const a = X(E.sel[0]), b = X(E.sel[1]);
        g.fillStyle = "rgba(249,115,22,.10)"; g.fillRect(a, TOP, b - a, H - TOP);
        g.strokeStyle = "#f97316"; g.lineWidth = 2; g.strokeRect(a + 1, TOP + 1, b - a - 2, H - TOP - 2);
        g.fillStyle = "#f97316"; rr(g, a - 5, TOP + 10, 9, 30, 4); g.fill(); rr(g, b - 4, TOP + 10, 9, 30, 4); g.fill();
        g.fillStyle = "#1a0c02"; for (const x of [a, b]) { g.fillRect(x - 1, TOP + 17, 1.5, 16); g.fillRect(x + 1.5, TOP + 17, 1.5, 16); }
        const n = notasNaSelecao(), tx = `Selecionado · ${(E.sel[1] - E.sel[0]).toFixed(2).replace(".", ",")} s · ${n} ${n === 1 ? "nota" : "notas"}`;
        g.font = "700 11px 'Bricolage Grotesque', system-ui"; const w = g.measureText(tx).width + 18, cx = Math.max(LEFT + w / 2 + 4, (a + b) / 2);
        rr(g, cx - w / 2, TOP + 6, w, 20, 10); g.fillStyle = "#f97316"; g.fill(); g.fillStyle = "#1a0c02"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(tx, cx, TOP + 16.5); g.textAlign = "left";
      }
      g.fillStyle = "#14100b"; g.fillRect(0, 0, W, TOP); g.fillRect(0, 0, LEFT, H);                         // régua de tempo (topo) e teclado (esquerda)
      for (let m = m0; m <= m1; m++) {
        const y = Y(m), p = ehPreta(m), noTom = !s || s.has(mod12(m)), alt = E.ph - 3;
        const grad = g.createLinearGradient(0, y - alt / 2, LEFT, y - alt / 2); if (p) { grad.addColorStop(0, "#15110c"); grad.addColorStop(1, "#2b2219"); } else { grad.addColorStop(0, "#d6c9b8"); grad.addColorStop(1, "#f1e8dc"); }
        rr(g, 3, y - alt / 2, p ? LEFT - 22 : LEFT - 8, alt, 4); g.fillStyle = grad; g.fill();
        if (s && noTom) { g.fillStyle = "#f97316"; g.beginPath(); g.arc(LEFT - 8, y, 2.6, 0, 7); g.fill(); }
        if (!p || E.ph >= 18) { g.fillStyle = p ? "#9a8d7e" : "#2a2118"; g.font = (p ? "600 9px" : "700 10px") + " 'Bricolage Grotesque', system-ui"; g.textBaseline = "middle"; g.fillText(nomeNota(m), 8, y + 0.5); }
      }
      g.fillStyle = "#b9ab9d"; g.font = "600 10px 'Bricolage Grotesque', system-ui"; g.textBaseline = "middle";
      for (let b = Math.floor((E.origem + tIni) / dt); b * dt - E.origem <= tFim; b++) { const x = X(b * dt - E.origem); if (x < LEFT) continue; if (b % E.porComp === 0) g.fillText(`${b / E.porComp + 1}`, x + 4, TOP / 2); }
      g.strokeStyle = "rgba(249,115,22,.4)"; g.lineWidth = 1; g.beginPath(); g.moveTo(0, TOP + .5); g.lineTo(W, TOP + .5); g.moveTo(LEFT + .5, 0); g.lineTo(LEFT + .5, H); g.stroke();
      const xp = X(E.pos); if (xp >= LEFT) { g.strokeStyle = "#fff"; g.lineWidth = 2; g.shadowColor = "rgba(255,255,255,.8)"; g.shadowBlur = 8; g.beginPath(); g.moveTo(xp, 0); g.lineTo(xp, H); g.stroke(); g.shadowBlur = 0; g.fillStyle = "#fff"; g.beginPath(); g.moveTo(xp - 6, 0); g.lineTo(xp + 6, 0); g.lineTo(xp, 9); g.fill(); }
    }
    function atualizarInfo() { if (!E.det) { $("afInfo").textContent = ""; return; } const r = rotulos(0, E.dur); $("afInfo").textContent = `${r.length} notas · ${r.filter((x) => x.fora).length} fora do tom (> 25 cents)`; }
    function suavizar() { const c = E.cents, d = E.det, o = Float32Array.from(c); for (let q = 0; q < d.n; q++) { if (!d.voz[q]) continue; let s = 0, w = 0; for (let k = -2; k <= 2; k++) { const i = q + k; if (i < 0 || i >= d.n || !d.voz[i]) continue; const p = 3 - Math.abs(k); s += c[i] * p; w += p; } o[q] = s / w; } c.set(o); }

    // ── edição ──
    function mudou() { E.sujo = true; if (opc.aoMudar) opc.aoMudar(); }
    function empilhar(antes) { E.undo.push(antes); if (E.undo.length > 60) E.undo.shift(); E.redo.length = 0; botoes(); mudou(); }
    function botoes() { $("afDesfazer").disabled = !E.undo.length; $("afRefazer").disabled = !E.redo.length; $("afCorrigirSel").disabled = !E.sel; }
    function corrigir(F, V, so) {
      if (!E.det) return; const antes = Float32Array.from(E.cents);
      for (const n of notas()) {
        if (n.curta) continue; const ti = tq(n.q0), tf = tq(n.q1); if (so && !(tf >= so[0] && ti <= so[1])) continue;
        const T = notaMaisPerto(n.centro), Tb = n.centro + F * (T - n.centro);
        for (let q = n.q0; q <= n.q1; q++) if (E.det.voz[q]) E.cents[q] = ((Tb - n.centro) - V * (E.midi[q] - n.centro)) * 100;
      }
      suavizar(); empilhar(antes); desenhar(); atualizarInfo();
    }
    function acharPonto(mx, my) { if (!E.det || mx < LEFT || my < TOP) return -1; const t = tempoEm(mx), qc = Math.round((t - E.det.t0) / E.det.hop); let best = -1, bd = 15; for (let q = qc - 3; q <= qc + 3; q++) { if (q < 0 || q >= E.det.n || !E.det.voz[q]) continue; const d = Math.hypot(X(tq(q)) - mx, Y(mcorr(q)) - my); if (d < bd) { bd = d; best = q; } } return best; }
    function acharBorda(mx, my) { if (!E.sel || my < TOP || acharPonto(mx, my) >= 0) return -1; const a = X(E.sel[0]), b = X(E.sel[1]); if (Math.abs(mx - a) <= 7) return 0; if (Math.abs(mx - b) <= 7) return 1; return -1; }
    function puxar(dr, my, alt) {
      const alvo = alvoDeEncaixe(midiEm(my), alt), delta = (alvo - (E.midi[dr.q0] + dr.base[dr.q0] / 100)) * 100, t0 = tq(dr.q0), R = E.alcance;
      for (let q = 0; q < E.det.n; q++) {
        if (!E.det.voz[q]) continue; const dt = Math.abs(tq(q) - t0); let w;
        if (dr.rigido) { const t = tq(q), a = E.sel[0], b = E.sel[1]; w = t >= a && t <= b ? 1 : Math.max(0, 1 - (t < a ? a - t : t - b) / (R / 2)); } else w = Math.max(0, 1 - dt / R);
        E.cents[q] = w > 0 ? dr.base[q] + delta * w : dr.base[q];
      }
      desenhar();
    }
    cv.addEventListener("pointerdown", (e) => {
      if (!E.det) return; cv.setPointerCapture(e.pointerId); const mx = e.offsetX, my = e.offsetY;
      if (my < TOP) { definirPos(Math.max(0, tempoEm(mx))); E.drag = { tipo: "regua" }; return; }
      const lado = acharBorda(mx, my); if (lado >= 0) { E.drag = { tipo: "borda", lado }; return; }
      const q = acharPonto(mx, my);
      if (q >= 0) { const t = tq(q), rigido = !!(E.sel && t >= E.sel[0] && t <= E.sel[1]); E.drag = { tipo: "puxar", q0: q, base: Float32Array.from(E.cents), rigido }; }
      else { E.drag = { tipo: "sel", t0: Math.max(0, tempoEm(mx)) }; E.sel = null; botoes(); desenhar(); }
    });
    cv.addEventListener("pointermove", (e) => {
      const mx = e.offsetX, my = e.offsetY, d = E.drag;
      if (!d) { const q = acharPonto(mx, my), lado = acharBorda(mx, my); if (q !== E.hover) { E.hover = q; desenhar(); } cv.style.cursor = lado >= 0 ? "ew-resize" : q >= 0 ? "ns-resize" : "crosshair"; return; }
      if (d.tipo === "regua") definirPos(Math.max(0, tempoEm(mx)));
      else if (d.tipo === "sel") { const t1 = Math.max(0, Math.min(E.dur, tempoEm(mx))); E.sel = Math.abs(t1 - d.t0) > 0.03 ? [Math.min(d.t0, t1), Math.max(d.t0, t1)] : null; botoes(); desenhar(); }
      else if (d.tipo === "borda") { const t = Math.max(0, Math.min(E.dur, tempoEm(mx))), o = 1 - d.lado; if (Math.abs(t - E.sel[o]) > 0.03) { E.sel[d.lado] = t; if (E.sel[0] > E.sel[1]) { E.sel.reverse(); d.lado = 1 - d.lado; } } desenhar(); }
      else puxar(d, my, e.altKey);
    });
    cv.addEventListener("pointerup", () => { const d = E.drag; E.drag = null; if (d && d.tipo === "puxar") { let mexeu = false; for (let q = 0; q < E.cents.length; q++) if (E.cents[q] !== d.base[q]) { mexeu = true; break; } if (mexeu) { empilhar(d.base); atualizarInfo(); status("Linha ajustada (o trecho ajustado ficou turquesa). Toque em “Afinado” para ouvir."); } } });
    cv.addEventListener("pointerleave", () => { if (!E.drag && E.hover >= 0) { E.hover = -1; desenhar(); } });
    vp.addEventListener("scroll", desenhar); if (window.ResizeObserver) new ResizeObserver(() => dimensionar()).observe(vp); else window.addEventListener("resize", dimensionar);
    vp.addEventListener("wheel", (e) => { if (e.ctrlKey) { e.preventDefault(); $("afZoomT").value = Math.max(30, Math.min(400, E.pps * (e.deltaY < 0 ? 1.12 : 0.89))); $("afZoomT").dispatchEvent(new Event("input")); } }, { passive: false });
    function desfazer() { if (!E.undo.length) return; E.redo.push(Float32Array.from(E.cents)); E.cents.set(E.undo.pop()); botoes(); desenhar(); atualizarInfo(); mudou(); }
    function refazer() { if (!E.redo.length) return; E.undo.push(Float32Array.from(E.cents)); E.cents.set(E.redo.pop()); botoes(); desenhar(); atualizarInfo(); mudou(); }

    // ── áudio de prévia: um <audio> do navegador, que muda a velocidade SEM mudar o tom ──
    const au = new Audio(); au.preload = "auto"; au.preservesPitch = true; au.webkitPreservesPitch = true;
    au.addEventListener("ended", () => { if (!E.ocupado) { E.tocando = false; $("afPlay").textContent = "▶ Tocar"; } });
    function renderizar() { if (!E.det) return; E.afinado = AF.corrigirAltura(E.mono, E.sr, E.det, E.cents); E.sujo = false; if (E.urlA) { URL.revokeObjectURL(E.urlA); E.urlA = null; } }
    function urlDe(m) {
      if (m === "original") { if (!E.urlO) E.urlO = URL.createObjectURL(wav(E.mono, E.sr)); return E.urlO; }
      if (E.sujo || !E.afinado) renderizar(); if (!E.urlA) E.urlA = URL.createObjectURL(wav(E.afinado, E.sr)); return E.urlA;
    }
    const esperarEv = (ev) => new Promise((ok) => au.addEventListener(ev, ok, { once: true }));
    async function carregarFonte(m) { const url = urlDe(m); if (au.dataset.url === url) return; au.src = url; au.dataset.url = url; await esperarEv("loadedmetadata"); }
    function aplicarVel() { au.defaultPlaybackRate = E.vel; au.playbackRate = E.vel; au.preservesPitch = true; au.webkitPreservesPitch = true; }
    function definirPos(t) { E.pos = Math.max(0, Math.min(E.dur, t)); if (au.dataset.url) { try { au.currentTime = E.pos; } catch (e) { /* ainda carregando */ } } $("afTempo").textContent = fmt(E.pos); desenhar(); }
    async function tocar() {
      if (!E.mono || E.ocupado) return; E.ocupado = true; if (opc.aoTocar) opc.aoTocar();
      try {
        await carregarFonte(E.ouvir); aplicarVel(); let ini = E.pos; if (E.loop && E.sel && (ini < E.sel[0] || ini >= E.sel[1])) ini = E.sel[0]; if (ini >= E.dur - 0.05) ini = 0;
        au.currentTime = ini; await au.play(); E.tocando = true; E.nTocadas++; $("afPlay").textContent = "■ Parar"; requestAnimationFrame(tick);
      } catch (e) { status("Não consegui tocar o áudio neste navegador."); } finally { E.ocupado = false; }
    }
    function parar() { au.pause(); E.tocando = false; $("afPlay").textContent = "▶ Tocar"; }
    async function trocarFonte() { if (!E.tocando || E.ocupado) return; E.ocupado = true; const t = au.currentTime; try { au.pause(); await carregarFonte(E.ouvir); aplicarVel(); au.currentTime = t; await au.play(); E.nTocadas++; } finally { E.ocupado = false; } }
    function tick() {
      if (!E.tocando) return; E.pos = au.currentTime;
      if (E.loop && E.sel && E.pos >= E.sel[1]) { au.currentTime = E.sel[0]; E.pos = E.sel[0]; E.voltas++; }
      $("afTempo").textContent = fmt(E.pos); const x = X(E.pos); if (x > vp.clientWidth * 0.9 || x < LEFT) vp.scrollLeft = Math.max(0, E.pos * E.pps - vp.clientWidth * 0.2); desenhar(); requestAnimationFrame(tick);
    }

    // ── carregar uma voz ──
    function vazio(txt) { const v = $("afVazio"); v.textContent = txt || ""; v.classList.toggle("on", !!txt); }
    function sugestaoDeTom(t) { const i = NOMES.indexOf(String(t || "").toUpperCase().replace("♯", "#")); const sel = $("afTom"); sel.querySelectorAll("option[data-sug]").forEach((o) => o.remove()); if (i >= 0) { const o = document.createElement("option"); o.value = "M" + i; o.dataset.sug = "1"; o.textContent = `Sugestão do app: ${NOMES[i]} maior (o app só estima a nota-base)`; sel.insertBefore(o, sel.options[1]); } }
    function limpar(msg) { parar(); E.det = null; E.mono = null; E.carregado = false; E.chave = null; E.sel = null; vazio(msg || "Selecione uma região de voz na linha do tempo para ver e ajustar a afinação."); status(msg ? "" : "Selecione uma região de voz."); $("afInfo").textContent = ""; desenhar(); }
    async function carregar(d) {
      E.beat = d.batidaSeg || 60 / (d.bpm || E.bpm); E.porComp = d.porCompasso || 4; E.origem = d.origemTempo || 0; E.nome = d.nome || "voz"; sugestaoDeTom(d.tonica);
      if (E.carregado && d.chave && d.chave === E.chave && E.det) { if (d.cents && d.cents.length === E.cents.length) E.cents.set(d.cents); desenhar(); atualizarInfo(); return true; }
      parar(); au.removeAttribute("src"); au.dataset.url = ""; if (E.urlO) { URL.revokeObjectURL(E.urlO); E.urlO = null; } if (E.urlA) { URL.revokeObjectURL(E.urlA); E.urlA = null; }
      E.mono = d.mono; E.sr = d.sr; E.dur = d.mono.length / d.sr; E.chave = d.chave || null; E.carregado = false; vazio("");
      $("afCarregandoTxt").textContent = "Analisando a voz…"; $("afCarregando").classList.add("on");
      try {
        E.det = await AF.detectarAltura(d.mono, d.sr, {}, (p) => { $("afCarregandoTxt").textContent = `Analisando a voz… ${Math.round(p * 100)}%`; });
        E.midi = new Float32Array(E.det.n); let mn = 1e9, mx = -1e9; for (let q = 0; q < E.det.n; q++) if (E.det.voz[q]) { E.midi[q] = AF.hzParaMidi(E.det.f0[q]); mn = Math.min(mn, E.midi[q]); mx = Math.max(mx, E.midi[q]); }
        if (mn > mx) { E.det = null; vazio("Não encontrei voz cantada ou falada nesta região. Selecione uma região com voz."); status("Sem voz nesta região."); return false; }
        E.minM = Math.floor(mn) - 4; E.maxM = Math.ceil(mx) + 4; while (E.maxM - E.minM < 24) { E.minM--; E.maxM++; }
        E.cents = new Float32Array(E.det.n); if (d.cents && d.cents.length) for (let q = 0; q < E.det.n && q < d.cents.length; q++) E.cents[q] = d.cents[q];
        E.nts = notas(); E.trans = new Uint8Array(E.det.n); for (const n of E.nts) if (n.curta) for (let q = n.q0; q <= n.q1; q++) E.trans[q] = 1;
        E.undo = []; E.redo = []; E.sel = null; E.pos = 0; E.sujo = true; E.afinado = null; E.carregado = true; vp.scrollLeft = 0; vp.scrollTop = Math.max(0, TOP + (E.maxM + 0.5 - (mx + 3)) * E.ph - 10);
        dimensionar(); botoes(); atualizarInfo(); $("afTempo").textContent = fmt(0); status(`Voz analisada (${fmt(E.dur)}). Arraste um ponto da linha para puxá-la, ou use “Corrigir tudo”.`); return true;
      } finally { $("afCarregando").classList.remove("on"); }
    }

    // ── tutorial ──
    let passo = 0; const PASSOS = passos(modo);
    function mostrarPasso() { const [t, tx, svg] = PASSOS[passo]; $("afTutPasso").textContent = `Passo ${passo + 1} de ${PASSOS.length}`; $("afTutTitulo").textContent = t; $("afTutTexto").textContent = tx; $("afTutSvg").innerHTML = svg; $("afTutPontos").innerHTML = PASSOS.map((_, i) => `<i class="${i === passo ? "on" : ""}"></i>`).join(""); $("afTutVoltar").style.visibility = passo ? "visible" : "hidden"; $("afTutProx").textContent = passo === PASSOS.length - 1 ? "Entendi" : "Próximo"; }
    function abrirTut() { passo = 0; mostrarPasso(); $("afTutModal").classList.add("on"); }
    function fecharTut() { $("afTutModal").classList.remove("on"); try { localStorage.setItem("oh-afin-tut", "1"); } catch (e) { /* sem armazenamento */ } }
    $("afTut").onclick = abrirTut; $("afTutVoltar").onclick = () => { if (passo) { passo--; mostrarPasso(); } }; $("afTutProx").onclick = () => { if (passo < PASSOS.length - 1) { passo++; mostrarPasso(); } else fecharTut(); };
    $("afTutModal").addEventListener("click", (e) => { if (e.target.id === "afTutModal") fecharTut(); });

    // ── controles ──
    $("afTom").onchange = (e) => { E.tom = e.target.value; desenhar(); atualizarInfo(); };
    const bpm = $("afBpm"); if (bpm) bpm.onchange = (e) => { const v = Math.max(40, Math.min(220, +e.target.value || 100)); e.target.value = v; E.bpm = v; E.beat = 60 / v; desenhar(); };
    $("afAlcance").oninput = (e) => { E.alcance = e.target.value / 1000; $("afAlcanceV").textContent = e.target.value + " ms"; }; $("afEncaixe").onchange = (e) => { E.encaixe = e.target.value; };
    $("afNomes").onchange = (e) => { E.nomes = e.target.checked; desenhar(); };
    $("afForca").oninput = (e) => { $("afForcaV").textContent = e.target.value + "%"; }; $("afVib").oninput = (e) => { $("afVibV").textContent = e.target.value + "%"; };
    $("afCorrigir").onclick = () => { corrigir($("afForca").value / 100, $("afVib").value / 100, null); status("Corrigi todas as notas (a linha corrigida ficou turquesa). Compare em “Original” e “Afinado”."); };
    $("afCorrigirSel").onclick = () => { if (E.sel) { corrigir($("afForca").value / 100, $("afVib").value / 100, E.sel); status("Corrigi as notas da seleção."); } };
    $("afDesfazer").onclick = desfazer; $("afRefazer").onclick = refazer;
    $("afReverter").onclick = () => { if (!E.det) return; const antes = Float32Array.from(E.cents); E.cents.fill(0); empilhar(antes); desenhar(); atualizarInfo(); status("Voltou tudo para a voz como foi cantada."); };
    $("afOrig").onclick = () => { E.ouvir = "original"; $("afOrig").classList.add("on"); $("afAfin").classList.remove("on"); trocarFonte(); };
    $("afAfin").onclick = () => { E.ouvir = "afinado"; $("afAfin").classList.add("on"); $("afOrig").classList.remove("on"); trocarFonte(); };
    $("afPlay").onclick = () => { if (E.tocando) parar(); else tocar(); };
    $("afVel").onchange = (e) => { E.vel = +e.target.value; aplicarVel(); status(`Velocidade ${Math.round(E.vel * 100)}%: o tom continua o mesmo.`); };
    $("afLoop").onchange = (e) => { E.loop = e.target.checked; status(E.loop ? "Vai repetir a seleção (arraste numa área vazia para selecionar um trecho)." : "Repetição desligada."); };
    $("afAjustes").onclick = () => { const on = $("afPainel").classList.toggle("on"); $("afAjustes").textContent = on ? "Ajustes ▴" : "Ajustes ▾"; dimensionar(); };
    $("afZoomT").oninput = (e) => { E.pps = +e.target.value; dimensionar(); }; $("afZoomV").oninput = (e) => { E.ph = +e.target.value; dimensionar(); };
    const baixar = $("afBaixar"); if (baixar) baixar.onclick = () => { if (!E.det) return; if (E.sujo || !E.afinado) renderizar(); const a = document.createElement("a"); a.href = URL.createObjectURL(wav(E.afinado, E.sr)); a.download = E.nome + "_afinado.wav"; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); };
    const aplicar = $("afAplicar"); if (aplicar) aplicar.onclick = () => { if (!E.det) return status("Selecione uma região com voz primeiro."); parar(); if (opc.aoAplicar) opc.aoAplicar(Float32Array.from(E.cents), E.det); };
    const ampliar = $("afAmpliar"); if (ampliar) ampliar.onclick = () => { if (opc.aoAmpliar) opc.aoAmpliar(); };
    function tecla(e) {   // atalhos locais do editor (o Estúdio chama isto quando a aba está ativa)
      if ($("afTutModal").classList.contains("on")) { if (e.key === "Escape") fecharTut(); else if (e.key === "ArrowRight") $("afTutProx").click(); else if (e.key === "ArrowLeft") $("afTutVoltar").click(); return true; }
      const meta = e.ctrlKey || e.metaKey;
      if (meta && e.key.toLowerCase() === "z" && E.undo.length && !e.shiftKey) { e.preventDefault(); desfazer(); return true; }
      if (meta && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey)) && E.redo.length) { e.preventDefault(); refazer(); return true; }
      if (e.key === "Escape" && E.sel) { E.sel = null; botoes(); desenhar(); return true; }
      return false;
    }
    const __p = { E, au, notas, rotulos, corrigir, renderizar, desenhar, X, Y, tq, mcorr, acharPonto, notaMaisPerto, alvoDeEncaixe, abrirTut, definirPos, notasNaSelecao };
    limpar();
    const ctrl = { zerarHistorico: () => { E.undo = []; E.redo = []; botoes(); }, E, carregar, limpar, parar, dimensionar, tecla, abrirTut, __p,
      obterCents: () => Float32Array.from(E.cents || []), obterDet: () => E.det, temEdicao: () => !!(E.cents && E.cents.some((v) => Math.abs(v) > 0.5)), tocando: () => E.tocando, definirModoAmpliado: (on) => { const b = $("afAmpliar"); if (b) b.textContent = on ? "Reduzir ⤡" : "Ampliar ⤢"; dimensionar(); }, definirTutorialAuto: () => { let visto = false; try { visto = localStorage.getItem("oh-afin-tut") === "1"; } catch (e) { /* sem armazenamento */ } if (!visto) abrirTut(); }, status };
    return ctrl;
  }
  raiz.EstudioAfinacaoUI = { criar };
})(window);
