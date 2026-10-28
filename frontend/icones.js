// icones.js — ícones próprios do Orange Harmony (silhueta preta sobre círculo laranja).
// Uso no HTML: <i class="oh-ic" data-ic="mic"></i>  →  preenchido automaticamente ao carregar a página.
// Uso no JS:   ICONE("mic")  →  string com o SVG, para colocar em innerHTML.
(function () {
  const P = {
    mic: '<path d="M12 3.5a3.2 3.2 0 0 0-3.2 3.2v5.1a3.2 3.2 0 0 0 6.4 0V6.7A3.2 3.2 0 0 0 12 3.5z"/><path d="M6.8 11.2a.9.9 0 0 1 1.8 0 3.4 3.4 0 0 0 6.8 0 .9.9 0 0 1 1.8 0 5.2 5.2 0 0 1-4.5 5.1V19h2.4a.9.9 0 0 1 0 1.8H8.9a.9.9 0 0 1 0-1.8h2.4v-2.7a5.2 5.2 0 0 1-4.5-5.1z"/>',
    nota: '<path d="M9 17.5V6.2l10-2v11.3" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="6.8" cy="17.6" r="2.6"/><circle cx="16.8" cy="15.6" r="2.6"/>',
    chart: '<rect x="4" y="12" width="3.4" height="8" rx=".8"/><rect x="10.3" y="8" width="3.4" height="12" rx=".8"/><rect x="16.6" y="4.5" width="3.4" height="15.5" rx=".8"/>',
    mix: '<rect x="4" y="5" width="2" height="14" rx="1"/><rect x="11" y="5" width="2" height="14" rx="1"/><rect x="18" y="5" width="2" height="14" rx="1"/><circle cx="5" cy="9" r="2.2"/><circle cx="12" cy="15" r="2.2"/><circle cx="19" cy="11" r="2.2"/>',
    fone: '<path d="M5 14v-2a7 7 0 0 1 14 0v2" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><rect x="3.8" y="13" width="4.2" height="6.5" rx="1.6"/><rect x="16" y="13" width="4.2" height="6.5" rx="1.6"/>',
    lixo: '<path d="M6.5 7.5h11l-.9 12.2a1.8 1.8 0 0 1-1.8 1.6H9.2a1.8 1.8 0 0 1-1.8-1.6z"/><path d="M4.5 5.5h15v1.6h-15zM9.5 5.5V4a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1.5h-1.6V4.6h-1.8v.9z"/>',
    pasta: '<path d="M3.5 6.5a1.5 1.5 0 0 1 1.5-1.5h4.2l2 2.2h8.3a1.5 1.5 0 0 1 1.5 1.5v9.8a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5z"/>',
    livros: '<rect x="4" y="4" width="4" height="16" rx=".8"/><rect x="9.5" y="6" width="4" height="14" rx=".8"/><path d="M16 5.2l3.6-1 3.2 14.6-3.6 1z"/>',
    piano: '<rect x="3.5" y="4.5" width="17" height="15" rx="1.6"/><path d="M7 4.5h1.2v8.5H7zM10.3 4.5h1.2v8.5h-1.2zM13.6 4.5H15v8.5h-1.4zM16.9 4.5H18v8.5h-1.1z" fill="#f97316"/>',
    robo: '<rect x="5.5" y="8" width="13" height="11" rx="2.5"/><rect x="11.2" y="3.5" width="1.6" height="3.2"/><circle cx="12" cy="3.2" r="1.4"/><circle cx="9.3" cy="13" r="1.7" fill="#f97316"/><circle cx="14.7" cy="13" r="1.7" fill="#f97316"/>',
    baixar: '<path d="M11 3.5h2v9.2l3.2-3.2 1.4 1.4L12 16.5 6.4 10.9l1.4-1.4 3.2 3.2z"/><path d="M4.5 17.5h15v2.5h-15z"/>',
    subir: '<path d="M11 20.5h2v-9.2l3.2 3.2 1.4-1.4L12 7.5l-5.6 5.6 1.4 1.4 3.2-3.2z"/><path d="M4.5 3.5h15V6h-15z"/>',
    prancheta: '<rect x="5" y="4.5" width="14" height="16" rx="1.8"/><rect x="9" y="2.5" width="6" height="3.6" rx="1"/><path d="M8 10h8v1.6H8zM8 13.6h8v1.6H8zM8 17.2h5v1.6H8z" fill="#f97316"/>',
    disco: '<path d="M4 4h12v3H4zM4 9h16v11H4z" opacity=".0"/><rect x="4" y="5" width="16" height="14" rx="2.5"/><circle cx="12" cy="12" r="3.6" fill="#f97316"/>',
    roda: '<path d="M12 5a7 7 0 0 1 6.6 4.6l1.7-.6.6 1.9-2.4.9a7 7 0 0 1-.6 3.5l-.7.1-1.7.8a7 7 0 0 1-12-3.9l-2.3-.6.5-1.9 1.8.5A7 7 0 0 1 12 5zm0 2.6a4.4 4.4 0 1 0 0 8.8 4.4 4.4 0 0 0 0-8.8z"/>',
    salvar: '<path d="M5 3.5h11.5l3.5 3.5V20a.5.5 0 0 1-.5.5H5a1.5 1.5 0 0 1-1.5-1.5V5A1.5 1.5 0 0 1 5 3.5z"/><rect x="8" y="4.5" width="7" height="4.5" rx=".6" fill="#f97316"/><rect x="7" y="13" width="10" height="6.5" rx=".8" fill="#f97316"/>',
    diapasao: '<path d="M9 3.5h2v9.2a1 1 0 0 0 2 0V3.5h2v9.2a3 3 0 0 1-6 0z"/><path d="M11 13.5h2v7h-2z"/>',
    acorde: '<circle cx="8" cy="7" r="2.6"/><circle cx="16" cy="7" r="2.6"/><circle cx="12" cy="15.5" r="2.6"/><circle cx="6.5" cy="20" r="0" />',
    partitura: '<path d="M4 7.5h16M4 10.5h16M4 13.5h16M4 16.5h16" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="15.2" r="2.1"/><path d="M10 15.2V8.4l5-1.2v6.6" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="15" cy="13.8" r="2"/>',
    mudo: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.2 9.2l5.6 5.6M20.8 9.2l-5.6 5.6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
    alto: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15 9a4.2 4.2 0 0 1 0 6M17.6 6.8a7.6 7.6 0 0 1 0 10.4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    lapis: '<path d="M16.8 4.2a2.2 2.2 0 0 1 3.1 3.1L9.2 17.9l-4.1 1 1-4.1z"/>',
    olho: '<path d="M12 6.5c4.6 0 8.2 3.6 9.5 5.5-1.3 1.9-4.9 5.5-9.5 5.5S3.8 13.9 2.5 12C3.8 10.1 7.4 6.5 12 6.5zm0 2.4a3.1 3.1 0 1 0 0 6.2 3.1 3.1 0 0 0 0-6.2z"/>',
    controle: '<path d="M7.2 7.5h9.6c2.6 0 4.2 2.4 4.2 5.3 0 2.6-1.4 4.7-3.4 4.7-1.4 0-2-1-2.7-2H9.1c-.7 1-1.3 2-2.7 2-2 0-3.4-2.1-3.4-4.7 0-2.9 1.6-5.3 4.2-5.3zM8 10.2v1.4H6.6v1.2H8v1.4h1.2v-1.4h1.4v-1.2H9.2v-1.4zM15.4 10.8a.9.9 0 1 0 0 1.8.9.9 0 0 0 0-1.8zm1.8 2.4a.9.9 0 1 0 0 1.8.9.9 0 0 0 0-1.8z"/>',
    tesoura: '<circle cx="6.5" cy="7" r="2.6" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="6.5" cy="17" r="2.6" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8.5 8.5 19 18.5M8.5 15.5 19 5.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    desfazer: '<path d="M9 6.5 4.5 10.5 9 14.5V11.6c4.3 0 7.4 1.4 9.5 5.2-.6-5.6-3.6-8.6-9.5-9.1z"/>',
    estrela: '<path d="M12 3.8l2.5 5.2 5.7.8-4.1 4 1 5.7L12 16.8l-5.1 2.7 1-5.7-4.1-4 5.7-.8z"/>',
    brilho: '<path d="M12 3.5c.6 4.4 2.1 5.9 6.5 6.5-4.4.6-5.9 2.1-6.5 6.5-.6-4.4-2.1-5.9-6.5-6.5C9.9 9.4 11.4 7.9 12 3.5zM18.5 14.5c.3 2 1 2.7 3 3-2 .3-2.7 1-3 3-.3-2-1-2.7-3-3 2-.3 2.7-1 3-3z"/>',
    documento: '<path d="M6 3h8.5L19 7.5V20a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 20V4.5A1.5 1.5 0 0 1 6 3z"/><path d="M8 11h8v1.6H8zM8 14.5h8v1.6H8zM8 18h5v1.6H8z" fill="#f97316"/>',
    mais: '<path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z"/>',
    relogio: '<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7.2v5.2l3.4 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    trofeu: '<path d="M7.5 4h9v4.2a4.5 4.5 0 0 1-9 0zM4.5 5h2.5v2.2A3 3 0 0 1 4 4.5zM19.5 5H17v2.2a3 3 0 0 0 3 2.7zM10.5 13.5h3v3.2h2.8V19H7.7v-2.3h2.8z"/>',
    jornal: '<path d="M4 5.5h13.5V19a1.5 1.5 0 0 1-1.5 1.5H5.5A1.5 1.5 0 0 1 4 19z"/><path d="M18 9.5h2v9a1.5 1.5 0 0 1-3 0V9.5zM7 8.5h7v3H7zM7 13h7v1.5H7zM7 16h5v1.5H7z" fill="#f97316"/>',
    play: '<path d="M8 5.5v13c0 .7.8 1.1 1.4.7l10-6.5c.5-.3.5-1.1 0-1.4l-10-6.5C8.8 4.4 8 4.8 8 5.5z"/>',
    pausa: '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>',
    parar: '<rect x="6" y="6" width="12" height="12" rx="1.6"/>',
    diamante: '<path d="M12 3.5 20.5 12 12 20.5 3.5 12z"/>',
    coracao: '<path d="M12 20s-7.5-4.6-7.5-10A4.2 4.2 0 0 1 12 7.4 4.2 4.2 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z"/>',
    gamepad: '<path d="M7.2 7.5h9.6c2.6 0 4.2 2.4 4.2 5.3 0 2.6-1.4 4.7-3.4 4.7-1.4 0-2-1-2.7-2H9.1c-.7 1-1.3 2-2.7 2-2 0-3.4-2.1-3.4-4.7 0-2.9 1.6-5.3 4.2-5.3z"/>',
    laranja: '<circle cx="12" cy="13" r="7.5"/><path d="M12 5.5c0-1.6 1-2.6 2.6-2.6-.1 1.7-1 2.6-2.6 2.6z" fill="#f97316"/>',
  };
  // Emojis → nome do ícone
  const MAPA = {
    "🎙️": "mic", "🎤": "mic", "🎼": "nota", "🎵": "nota", "🎶": "nota", "🎸": "nota", "🎺": "nota",
    "🎯": "estrela", "📊": "chart", "📈": "chart", "🎛️": "mix", "🎚️": "mix", "🎧": "fone",
    "🗑️": "lixo", "📚": "livros", "📂": "pasta", "📁": "pasta", "🎹": "piano", "🤖": "robo",
    "🍊": "laranja", "⬇️": "baixar", "⬇": "baixar", "⬆️": "subir", "⬆": "subir", "📋": "prancheta",
    "🔄": "roda", "↻": "roda", "💾": "salvar", "🔊": "alto", "🔇": "mudo", "✏️": "lapis", "👁️": "olho",
    "🎮": "gamepad", "🎲": "diamante", "📄": "documento", "📰": "jornal", "✂️": "tesoura",
    "↩️": "desfazer", "⭐": "estrela", "🏆": "trofeu", "✨": "brilho", "➕": "mais", "⏱️": "relogio",
    "▶": "play", "⏸": "pausa", "■": "parar", "⏹": "parar", "🎓": "estrela", "❤️": "coracao",
  };
  const svg = (nome) => {
    const corpo = P[nome];
    if (!corpo) return "";
    return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${corpo}</svg>`;
  };
  // Usado no JS: ICONE("mic") → markup pronto para innerHTML
  window.ICONE = (nome) => `<i class="oh-ic" aria-hidden="true">${svg(nome)}</i>`;
  window.MAPA_EMOJI_ICONE = MAPA;
  function hidratar(raiz) {
    (raiz || document).querySelectorAll("i.oh-ic[data-ic]").forEach((el) => {
      el.innerHTML = svg(el.dataset.ic);
    });
  }
  window.hidratarIcones = hidratar;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => hidratar());
  else hidratar();
})();
