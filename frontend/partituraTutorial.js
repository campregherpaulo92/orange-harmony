// ══════════════════════════════════════════════════════════════════════════
// partituraTutorial.js — Tutorial rápido e ilustrado da aba Partitura.
// Para quem nunca leu partitura: o essencial de leitura musical + como usar cada recurso da aba.
// Os exemplos de partitura são desenhados de verdade (abcjs), um por tela.
// ══════════════════════════════════════════════════════════════════════════
(function () {
  const K_VISTO = "oh-tutorial-partitura-visto";
  const cab = (extra) => "X:1\nM:4/4\nL:1/4\nK:C\n" + (extra || "");

  const SLIDES = [
    {
      titulo: "Bem-vindo à aba Partitura",
      texto: [
        "Aqui você vê, ouve e corrige a melodia que o Songwriter tirou da sua gravação, sem precisar saber ler partitura.",
        "São 3 passos: OUÇA (clique numa nota), ENTENDA (números, cores e o assistente) e CORRIJA (mexa nas notas).",
      ],
      dica: "Leva uns 2 minutos. Use as setas ← → do teclado ou os botões. Esc fecha.",
    },
    {
      titulo: "A pauta e as notas",
      texto: [
        "A pauta tem 5 linhas. Quanto mais alta a nota está desenhada, mais aguda ela soa. Quanto mais baixa, mais grave.",
        "As notas têm nome: Dó, Ré, Mi, Fá, Sol, Lá, Si. Depois do Si volta o Dó, uma oitava acima: é a mesma nota, só mais aguda.",
      ],
      abcs: [cab("C D E F | G A B c |]\nw: Dó Ré Mi Fá Sol Lá Si Dó")],
      dica: "No app: clique numa nota. Ela fica vermelha e a música toca a partir dela.",
    },
    {
      titulo: "Duração: quanto tempo a nota dura",
      texto: [
        "A forma da nota diz quanto ela dura. Em 4/4, a semínima vale 1 tempo. Semibreve = 4 tempos · mínima = 2 · semínima = 1 · colcheia = meio tempo · semicolcheia = um quarto de tempo.",
        "Pausa é um silêncio com duração marcada: conta tempo como uma nota, mas sem som.",
      ],
      abcs: [
        cab("c4 | c2 c2 | c c c c | c/2c/2c/2c/2 c c |]\nw: semibreve | mínima mínima | semínima semínima semínima semínima | colcheia colcheia colcheia colcheia semínima semínima"),
        cab("c z d z | e z2 f |]\nw: nota nota nota nota"),
      ],
    },
    {
      titulo: "Compasso (medida)",
      texto: [
        "As barras verticais dividem a música em compassos, também chamados de medidas. Todos duram o mesmo.",
        "A fórmula do começo (4/4, 3/4...) diz quantos tempos cabem em cada medida. Em 4/4 cabem 4 semínimas.",
        "O app escreve um número pequeno em cima de cada medida. É por ele que você diz \"medida 25\" para o assistente. Dá para ligar e desligar em \"Números dos compassos\".",
      ],
      abcs: [cab("C D E F | G A B c | c B A G |]")],
    },
    {
      titulo: "Tonalidade, sustenido, bemol e bequadro",
      texto: [
        "A tonalidade é a \"casa\" da música. Os sustenidos (♯) ou bemóis (♭) no começo da pauta formam a armadura e valem para a música toda. Aqui são 2 sustenidos (Fá e Dó): Ré maior.",
        "Sustenido (♯) sobe a nota meio tom. Bemol (♭) desce meio tom. Bequadro (♮) cancela. No meio da música, eles valem até o fim da medida.",
        "Meio tom (semitom) é o menor passo entre duas notas. Um tom são dois semitons.",
      ],
      abcs: ["X:1\nM:4/4\nL:1/4\nK:D\nD E F G | A B c d |]", "X:1\nM:2/2\nL:1/2\nK:C\n^C =C | _D D |]\nw: sustenido bequadro | bemol normal"],
    },
    {
      titulo: "Ligadura, ponto e cifra",
      texto: [
        "Ligadura (a curva entre duas notas iguais) junta as duas: elas viram uma nota só, mais longa.",
        "O ponto depois da nota soma metade do valor dela. A cifra, escrita em cima (C, G, Am...), é o nome do acorde que o violão toca naquele ponto.",
      ],
      abcs: [cab("\"C\"c2- c2 | \"G\"d3/2 e/2 d2 |]")],
    },
    {
      titulo: "As cores do app",
      texto: ["Cada cor tem um significado. Assim você sabe o que está acontecendo sem ler nada:"],
      cores: [
        ["#e11d48", "Vermelho: a nota que você selecionou"],
        ["#16a34a", "Verde: o trecho que você marcou (Selecionar trecho ou Shift + clique)"],
        ["#0ea5e9", "Azul: nota que você já ajustou"],
        ["#f97316", "Laranja: a nota que está tocando agora (aparece sempre, até nas notas ajustadas)"],
        ["#a855f7", "Roxo: o alvo que o assistente propôs"],
        ["#ec4899", "Rosa: você mexeu, mas ainda não está no alvo"],
        ["#14b8a6", "Turquesa: acertou, está no alvo"],
      ],
    },
    {
      titulo: "Ouvir e navegar",
      lista: [
        "Clique numa nota: ela toca dali em diante.",
        "Barra de espaço: toca e pausa (o botão redondo no canto faz o mesmo).",
        "Selecionar trecho (ou Shift + clique em duas notas): o botão redondo toca só o trecho.",
        "A barra de tempo no topo toca a música inteira. Ela acompanha a nota ou o trecho que você selecionou.",
        "\"Tocar ao clicar\" desligado: o app só toca quando você mandar.",
      ],
    },
    {
      titulo: "Corrigir as notas",
      lista: [
        "Com uma nota selecionada, clique na linha ou no espaço da pauta onde ela deve ficar.",
        "Setas ↑ ↓ mudam meio tom. Shift + ↑ ↓ mudam uma linha da pauta.",
        "Delete transforma a nota em pausa (o ritmo continua). Delete de novo remove a pausa; Shift + Delete remove de vez.",
        "Ctrl+C copia, Ctrl+X recorta, Ctrl+V cola no lugar da seleção.",
        "Ctrl+Z desfaz, Ctrl+Y refaz. A partitura original fica guardada: nada a apaga sozinho.",
        "O app protege as outras notas: se um sustenido ia mudar a vizinha, ele ajusta e avisa.",
      ],
    },
    {
      titulo: "As partes da música (seções)",
      texto: [
        "Marque as partes da música para se localizar: selecione o trecho, escolha o tipo ao lado de \"Marcar seção\" e clique nele. O app numera (Verso 1, Verso 2...), pinta uma faixa colorida e o assistente passa a entender \"o refrão\".",
      ],
      cores: [
        ["#94a3b8", "Introdução: o começo, antes de cantar"],
        ["#f59e0b", "Verso (estrofe): a parte que conta a história; a letra muda a cada vez"],
        ["#84cc16", "Pré-refrão: prepara a chegada do refrão, aumenta a expectativa"],
        ["#06b6d4", "Refrão: a parte principal, que se repete e fica na cabeça"],
        ["#818cf8", "Pós-refrão: um respiro curto logo depois do refrão"],
        ["#fb7185", "Ponte: uma parte diferente, geralmente perto do fim, que quebra a repetição"],
        ["#facc15", "Solo · Interlúdio: trechos instrumentais"],
        ["#78716c", "Final: o encerramento"],
      ],
    },
    {
      titulo: "O assistente musical",
      texto: [
        "Abra o Assistente musical e escreva ou fale. Ele sabe o que está na partitura e compara com a original.",
      ],
      lista: [
        "\"Explica a medida 25\" · \"explica essa nota\" · \"explica o refrão\"",
        "\"O que eu mudei?\" · \"Tem algum erro?\"",
        "\"Na medida 25, segunda nota, sobe meio tom\" · \"desce o verso 2 um tom\"",
        "Ele propõe, deixa a nota em roxo e você escolhe: ajustar sozinho (rosa até acertar, turquesa quando acerta) ou \"Aplicar por mim\", ouvindo a prévia antes.",
        "\"O que é semitom?\": ele ensina com exemplos da sua partitura.",
      ],
    },
    {
      titulo: "Pronto! Cola rápida",
      lista: [
        "Clique na nota = ouvir · Espaço = tocar/pausar",
        "↑ ↓ = meio tom · Shift + ↑ ↓ = uma linha · Delete = pausa",
        "Ctrl+C / X / V = copiar, recortar, colar · Ctrl+Z / Y = desfazer, refazer",
        "Marcar seção = verso, refrão... · Assistente = pergunte ou peça",
      ],
      dica: "Você pode rever este tutorial quando quiser no botão \"Tutorial rápido\".",
    },
  ];

  let painel = null, indice = 0;
  const el = (tag, cls, texto) => { const e = document.createElement(tag); if (cls) e.className = cls; if (texto != null) e.textContent = texto; return e; };

  function montar() {
    if (painel) return;
    painel = el("div", "pt-tut");
    painel.hidden = true;
    painel.setAttribute("role", "dialog");
    painel.setAttribute("aria-modal", "true");
    painel.setAttribute("aria-label", "Tutorial rápido da aba Partitura");
    painel.innerHTML = '<div class="pt-tut-cartao"><div class="pt-tut-topo"><span class="pt-tut-passo"></span><button type="button" class="pt-tut-x" aria-label="Fechar tutorial">×</button></div><div class="pt-tut-pontos"></div><h3 class="pt-tut-titulo"></h3><div class="pt-tut-corpo"></div><div class="pt-tut-nav"><button type="button" class="oh-btn oh-btn-secundario pt-tut-ant">Anterior</button><button type="button" class="oh-btn oh-btn-secundario pt-tut-pular">Pular</button><button type="button" class="oh-btn pt-tut-prox">Próximo</button></div></div>';
    document.body.appendChild(painel);
    painel.querySelector(".pt-tut-x").addEventListener("click", () => fechar());
    painel.querySelector(".pt-tut-pular").addEventListener("click", () => fechar());
    painel.querySelector(".pt-tut-ant").addEventListener("click", () => ir(indice - 1));
    painel.querySelector(".pt-tut-prox").addEventListener("click", () => { if (indice >= SLIDES.length - 1) fechar(); else ir(indice + 1); });
    painel.addEventListener("click", (e) => { if (e.target === painel) fechar(); });
    const pontos = painel.querySelector(".pt-tut-pontos");
    SLIDES.forEach((s, i) => { const b = el("button", "pt-tut-ponto"); b.type = "button"; b.setAttribute("aria-label", "Ir para: " + s.titulo); b.addEventListener("click", () => ir(i)); pontos.appendChild(b); });
    document.addEventListener("keydown", (e) => {
      if (!painel || painel.hidden) return;
      if (e.key === "Escape") { e.preventDefault(); fechar(); }
      else if (e.key === "ArrowRight") { e.preventDefault(); if (indice < SLIDES.length - 1) ir(indice + 1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); ir(indice - 1); }
      e.stopPropagation();
    }, true);
  }

  function ir(n) {
    indice = Math.max(0, Math.min(SLIDES.length - 1, n));
    const s = SLIDES[indice];
    painel.querySelector(".pt-tut-passo").textContent = "Passo " + (indice + 1) + " de " + SLIDES.length;
    painel.querySelector(".pt-tut-titulo").textContent = s.titulo;
    painel.querySelectorAll(".pt-tut-ponto").forEach((b, i) => { b.classList.toggle("ativo", i === indice); b.classList.toggle("feito", i < indice); });
    const corpo = painel.querySelector(".pt-tut-corpo");
    corpo.innerHTML = "";
    (s.texto || []).forEach((t) => corpo.appendChild(el("p", "pt-tut-p", t)));
    (s.abcs || []).forEach((abc) => {
      const caixa = el("div", "pt-tut-pauta");
      corpo.appendChild(caixa);
      try { if (window.ABCJS) window.ABCJS.renderAbc(caixa, abc, { responsive: "resize", staffwidth: 560, scale: 0.95, paddingtop: 4, paddingbottom: 4, paddingleft: 6, paddingright: 6 }); } catch (e) { /* sem desenho: o texto explica */ }
    });
    if (s.lista) { const ul = el("ul", "pt-tut-lista"); s.lista.forEach((t) => ul.appendChild(el("li", "", t))); corpo.appendChild(ul); }
    if (s.cores) {
      const ul = el("ul", "pt-tut-cores");
      s.cores.forEach(([cor, t]) => { const li = el("li"); const bola = el("i", "pt-tut-cor"); bola.style.background = cor; li.appendChild(bola); li.appendChild(document.createTextNode(t)); ul.appendChild(li); });
      corpo.appendChild(ul);
    }
    if (s.dica) corpo.appendChild(el("p", "pt-tut-dica", s.dica));
    painel.querySelector(".pt-tut-ant").disabled = indice === 0;
    painel.querySelector(".pt-tut-prox").textContent = indice >= SLIDES.length - 1 ? "Começar" : "Próximo";
    painel.querySelector(".pt-tut-pular").hidden = indice >= SLIDES.length - 1;
    corpo.scrollTop = 0;
  }

  function abrir() {
    montar();
    painel.hidden = false;
    ir(0);
    const btn = document.getElementById("partituraTutorialBtn");
    if (btn) btn.classList.remove("pulsando");
    try { localStorage.setItem(K_VISTO, "1"); } catch (e) { /* sem armazenamento */ }
    setTimeout(() => { const p = painel && painel.querySelector(".pt-tut-prox"); if (p) p.focus(); }, 30);
  }
  function fechar() {
    if (painel) painel.hidden = true;
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  }

  function iniciar() {
    const btn = document.getElementById("partituraTutorialBtn");
    if (!btn) return;
    btn.addEventListener("click", abrir);
    let visto = false;
    try { visto = localStorage.getItem(K_VISTO) === "1"; } catch (e) { /* ok */ }
    if (!visto) btn.classList.add("pulsando");        // primeira vez: o botão pulsa chamando para o tutorial (não abre sozinho)
  }

  window.PartituraTutorial = { abrir, fechar, total: SLIDES.length, _teste: { ir, slides: SLIDES } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar); else iniciar();
})();
