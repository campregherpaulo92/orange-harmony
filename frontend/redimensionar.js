// ══════════════════════════════════════════════════════════════════════════
// redimensionar.js — Deixa a pessoa mudar o tamanho das caixas flutuantes puxando por qualquer borda ou canto
// (assistente musical, Laranjinha e Orange Studio). O tamanho fica guardado no aparelho.
// Duplo clique em qualquer borda volta ao tamanho original.
// ══════════════════════════════════════════════════════════════════════════
(function () {
  const chaveArm = (c) => "oh-caixa-" + c;
  const ler = (c) => { try { return JSON.parse(localStorage.getItem(chaveArm(c)) || "null"); } catch (e) { return null; } };
  const gravar = (c, r) => { try { if (r) localStorage.setItem(chaveArm(c), JSON.stringify(r)); else localStorage.removeItem(chaveArm(c)); } catch (e) { /* sem armazenamento */ } };
  const LADOS = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];
  const PROPS = ["position", "left", "top", "right", "bottom", "width", "height", "maxWidth", "maxHeight", "margin"];

  function tornar(el, cfg) {
    if (!el) return null;
    const minL = cfg.minL || 280, minA = cfg.minA || 220, ativo = cfg.ativo || (() => true);
    let aplicado = false;
    const handles = LADOS.map((lado) => {
      const h = document.createElement("div");
      h.className = "oh-resize oh-resize-" + lado;
      h.dataset.lado = lado;
      h.dataset.caixa = cfg.chave;
      h.title = "Arraste para mudar o tamanho (duplo clique volta ao padrão)";
      h.style.display = "none";
      document.body.appendChild(h);
      return h;
    });

    function zBase() { let z = 0; for (let n = el; n && n !== document.body; n = n.parentElement) { const v = parseInt(getComputedStyle(n).zIndex, 10); if (!isNaN(v)) z = Math.max(z, v); } return z + 1; }
    function visivel() { return ativo() && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden"; }
    function posicionar() {
      const ok = visivel();
      handles.forEach((h) => { h.style.display = ok ? "" : "none"; });
      if (!ok) return;
      const r = el.getBoundingClientRect(), E = 10, C = 18, z = zBase();
      const pos = {
        n: [r.left + C, r.top - E / 2, r.width - 2 * C, E], s: [r.left + C, r.bottom - E / 2, r.width - 2 * C, E],
        w: [r.left - E / 2, r.top + C, E, r.height - 2 * C], e: [r.right - E / 2, r.top + C, E, r.height - 2 * C],
        nw: [r.left - E / 2, r.top - E / 2, C, C], ne: [r.right - C + E / 2, r.top - E / 2, C, C], sw: [r.left - E / 2, r.bottom - C + E / 2, C, C], se: [r.right - C + E / 2, r.bottom - C + E / 2, C, C],
      };
      handles.forEach((h) => { const p = pos[h.dataset.lado]; h.style.left = p[0] + "px"; h.style.top = p[1] + "px"; h.style.width = Math.max(4, p[2]) + "px"; h.style.height = Math.max(4, p[3]) + "px"; h.style.zIndex = String(z); });
    }
    function aplicar(L, T, R, B) {
      el.style.position = "fixed"; el.style.margin = "0";
      el.style.left = L + "px"; el.style.top = T + "px"; el.style.width = (R - L) + "px"; el.style.height = (B - T) + "px";
      el.style.right = "auto"; el.style.bottom = "auto"; el.style.maxWidth = "none"; el.style.maxHeight = "none";
      aplicado = true;
    }
    function limparInline() { PROPS.forEach((p) => { el.style[p] = ""; }); aplicado = false; }
    function guardar() { const r = el.getBoundingClientRect(); gravar(cfg.chave, { l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }); }
    function encaixar(r) {                              // cabe na tela e respeita o tamanho mínimo
      const vw = window.innerWidth, vh = window.innerHeight;
      const w = Math.max(Math.min(minL, vw), Math.min(r.w, vw)), h = Math.max(Math.min(minA, vh), Math.min(r.h, vh));
      return { L: Math.max(0, Math.min(r.l, vw - w)), T: Math.max(0, Math.min(r.t, vh - h)), w, h };
    }
    function restaurarGuardado() {
      if (!ativo()) { if (aplicado) limparInline(); return; }
      const g = ler(cfg.chave);
      if (!g) return;
      const e = encaixar(g);
      aplicar(e.L, e.T, e.L + e.w, e.T + e.h);
    }
    function padrao() { gravar(cfg.chave, null); limparInline(); posicionar(); if (cfg.aoPadrao) cfg.aoPadrao(); }

    handles.forEach((h) => {
      h.addEventListener("dblclick", padrao);
      h.addEventListener("pointerdown", (ev) => {
        if (ev.button != null && ev.button !== 0) return;
        ev.preventDefault();
        const lado = h.dataset.lado, r0 = el.getBoundingClientRect(), x0 = ev.clientX, y0 = ev.clientY;
        h.setPointerCapture(ev.pointerId);
        h.classList.add("arrastando");
        aplicar(r0.left, r0.top, r0.right, r0.bottom);                  // a partir daqui a caixa tem posição e tamanho explícitos
        const mover = (e) => {
          const vw = window.innerWidth, vh = window.innerHeight, dx = e.clientX - x0, dy = e.clientY - y0;
          let L = r0.left, T = r0.top, R = r0.right, B = r0.bottom;
          if (lado.indexOf("w") >= 0) L = Math.min(Math.max(0, r0.left + dx), R - minL);
          if (lado.indexOf("e") >= 0) R = Math.max(Math.min(vw, r0.right + dx), L + minL);
          if (lado.indexOf("n") >= 0) T = Math.min(Math.max(0, r0.top + dy), B - minA);
          if (lado.indexOf("s") >= 0) B = Math.max(Math.min(vh, r0.bottom + dy), T + minA);
          aplicar(L, T, R, B); posicionar();
          if (cfg.aoMudar) cfg.aoMudar(el.getBoundingClientRect());
        };
        const soltar = (e) => {
          h.releasePointerCapture(ev.pointerId);
          h.classList.remove("arrastando");
          h.removeEventListener("pointermove", mover); h.removeEventListener("pointerup", soltar); h.removeEventListener("pointercancel", soltar);
          guardar(); posicionar();
        };
        h.addEventListener("pointermove", mover); h.addEventListener("pointerup", soltar); h.addEventListener("pointercancel", soltar);
      });
    });

    const reposicionar = () => { if (aplicado && ativo()) { const r = el.getBoundingClientRect(), e = encaixar({ l: r.left, t: r.top, w: r.width, h: r.height }); aplicar(e.L, e.T, e.L + e.w, e.T + e.h); } posicionar(); if (cfg.aoMudar && aplicado) cfg.aoMudar(el.getBoundingClientRect()); };
    if (window.ResizeObserver) new ResizeObserver(posicionar).observe(el);
    const mo = new MutationObserver(posicionar);
    for (let n = el; n && n !== document.body; n = n.parentElement) mo.observe(n, { attributes: true, attributeFilter: ["hidden", "class", "style"] });
    window.addEventListener("resize", reposicionar);
    restaurarGuardado();
    posicionar();
    return { posicionar, restaurarGuardado, padrao };
  }

  function iniciar() {
    const larga = window.matchMedia("(min-width: 1100px)");
    // a faixa que a Partitura reserva para o painel do assistente acompanha o tamanho/posição dele
    const reserva = (r) => {
      const card = document.querySelector("#page-partitura .oh-card");
      if (!card) return;
      const cr = card.getBoundingClientRect();
      document.documentElement.style.setProperty("--pta-reserva", Math.max(22, Math.round(cr.right - r.left + 14)) + "px");
    };
    const ass = tornar(document.getElementById("partituraAssistente"), { chave: "assistente", minL: 300, minA: 280, ativo: () => larga.matches, aoMudar: reserva, aoPadrao: () => document.documentElement.style.removeProperty("--pta-reserva") });
    if (ass) {
      const g = JSON.parse(localStorage.getItem(chaveArm("assistente")) || "null");
      const p = document.getElementById("partituraAssistente");
      if (g && p) reserva(p.getBoundingClientRect());
      const sincronizar = () => { ass.restaurarGuardado(); ass.posicionar(); };
      if (larga.addEventListener) larga.addEventListener("change", sincronizar);
    }
    tornar(document.getElementById("laranjinhaPainel"), { chave: "laranjinha", minL: 380, minA: 320 });
    tornar(document.querySelector(".oh-studio-conteudo"), { chave: "studio", minL: 520, minA: 380 });
  }
  window.OhRedimensionar = { tornar };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar); else iniciar();
})();
