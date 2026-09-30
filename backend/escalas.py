# ══════════════════════════════════════════════════════════════
# escalas.py — Escalas para treino vocal.
#  • descrever(tonica, tipo)          → notas, graus, fórmula, acordes da escala, caráter e desafio de canto
#  • interpretar_escala(texto)        → entende "G# lídio", "Lá menor pentatônica", "C harmonic minor"…
#  • avaliar_canto(notas, tonica, tipo) → quantas notas cantadas caíram dentro da escala (e onde errou)
# Usado pela aba Estudo, pelo Professor e pelas ferramentas da Laranjinha (mesma fonte de verdade).
# ══════════════════════════════════════════════════════════════
import re
import unicodedata

import acordes as _ac

_MAIOR = (0, 2, 4, 5, 7, 9, 11)
_LETRAS = ["C", "D", "E", "F", "G", "A", "B"]
_ENARMONICO = {"C#": "Db", "Db": "C#", "D#": "Eb", "Eb": "D#", "F#": "Gb", "Gb": "F#",
               "G#": "Ab", "Ab": "G#", "A#": "Bb", "Bb": "A#"}

# chave, nome, fórmula (graus em relação à escala maior), caráter, desafio de canto
ESCALAS = [
    ("maior", "maior (jônio)", "1 2 3 4 5 6 7",
     "Som brilhante e estável — a base de tudo.",
     "Cantar o 4º e o 7º graus sem puxar pra nota vizinha."),
    ("menor", "menor natural (eólio)", "1 2 b3 4 5 b6 b7",
     "Som sério ou triste, comum em baladas e rock.",
     "Manter a 3ª, a 6ª e a 7ª menores, sem deixar subir pra maior."),
    ("menor_harmonica", "menor harmônica", "1 2 b3 4 5 b6 7",
     "Som dramático, clássico, com a 7ª maior pedindo pra resolver na tônica.",
     "O salto de 3 semitons entre o 6º e o 7º graus."),
    ("menor_melodica", "menor melódica", "1 2 b3 4 5 6 7",
     "Menor com 6ª e 7ª maiores: som suave e moderno (muito usada no jazz).",
     "Cantar a 3ª menor e depois a 6ª e a 7ª maiores sem confundir."),
    ("dorico", "dórico", "1 2 b3 4 5 6 b7",
     "Menor com 6ª maior: som de soul e funk, menos triste que o menor natural.",
     "A 6ª maior sobre uma base menor."),
    ("frigio", "frígio", "1 b2 b3 4 5 b6 b7",
     "Menor com 2ª menor: som tenso, espanhol/flamenco.",
     "O semitom logo no começo, entre o 1º e o 2º graus."),
    ("lidio", "lídio", "1 2 3 #4 5 6 7",
     "Maior com 4ª aumentada: som aberto, flutuante, de trilha de filme.",
     "O 4º grau aumentado tende a 'cair' pro 4º justo — segure o trítono."),
    ("mixolidio", "mixolídio", "1 2 3 4 5 6 b7",
     "Maior com 7ª menor: som de rock, blues e música folk.",
     "A 7ª menor, sem voltar pra 7ª maior."),
    ("locrio", "lócrio", "1 b2 b3 4 b5 b6 b7",
     "Instável, com 5ª diminuta: raro pra cantar, bom pra treinar o ouvido.",
     "A 5ª diminuta (trítono) e o semitom inicial."),
    ("pentatonica_maior", "pentatônica maior", "1 2 3 5 6",
     "Cinco notas, sem semitons: som aberto e fácil de cantar (pop, country, MPB).",
     "Os saltos de terça entre as notas, mantendo a afinação limpa."),
    ("pentatonica_menor", "pentatônica menor", "1 b3 4 5 b7",
     "Cinco notas, base do rock e do blues.",
     "O salto de terça menor entre o 1º e o 3º graus."),
    ("blues", "blues", "1 b3 4 b5 5 b7",
     "Pentatônica menor com a 'blue note' (5ª diminuta) — som de blues e rock.",
     "A blue note entre o 4º e o 5º graus: passar por ela sem se perder."),
]
_POR_CHAVE = {e[0]: e for e in ESCALAS}


# ─────────────────────────── utilidades ───────────────────────────
def _sem_acento(t):
    return "".join(c for c in unicodedata.normalize("NFD", t) if unicodedata.category(c) != "Mn").lower()


def _formula_para_graus(formula):
    """'1 2 b3 #4' → [(1, 0), (2, 0), (3, -1), (4, +1)] (número do grau, alteração)."""
    saida = []
    for tok in formula.split():
        alt = -1 if tok.startswith("b") else (1 if tok.startswith("#") else 0)
        saida.append((int(tok.lstrip("b#")), alt))
    return saida


def intervalos_da_escala(chave):
    graus = _formula_para_graus(_POR_CHAVE[chave][2])
    return tuple(_MAIOR[g - 1] + alt for g, alt in graus)


def tipos_disponiveis():
    """Lista pra montar o seletor da tela."""
    return [{"chave": c, "nome": n, "formula": f, "intervalos": list(intervalos_da_escala(c)), "carater": car}
            for c, n, f, car, _ in ESCALAS]


def _nome_tonica(texto):
    """'g#', 'Ab', 'G♯3' → ('G#', pc). Aceita só a letra + acidente (a oitava é ignorada)."""
    m = re.match(r"^\s*([A-Ga-g])\s*([#b♯♭]?)\s*-?\d*\s*$", texto or "")
    if not m:
        return None
    letra, acid = m.group(1).upper(), {"♯": "#", "♭": "b"}.get(m.group(2), m.group(2))
    pc = (_ac._PC_LETRA[letra] + (1 if acid == "#" else -1 if acid == "b" else 0)) % 12
    return letra + acid, pc


def _escrever(tonica_nome, tonica_pc, graus):
    """Nome das notas com a grafia correta (uma letra por grau). Devolve (notas, duplos)."""
    base = _LETRAS.index(tonica_nome[0])
    saida, duplos = [], 0
    for g, alt in graus:
        letra = _LETRAS[(base + g - 1) % 7]
        alvo = (tonica_pc + _MAIOR[g - 1] + alt) % 12
        dif = (alvo - _ac._PC_LETRA[letra] + 6) % 12 - 6
        duplos += abs(dif) >= 2
        saida.append(letra + {0: "", 1: "#", -1: "b", 2: "##", -2: "bb"}.get(dif, "?"))
    return saida, duplos


def _solfejo(nome):
    return _ac.SOLFEJO[nome[0]] + nome[1:].replace("##", "♯♯").replace("bb", "♭♭").replace("#", "♯").replace("b", "♭")


def _numeral(grau, alt, chave_acorde):
    base = ["I", "II", "III", "IV", "V", "VI", "VII"][grau - 1]
    base = base.lower() if chave_acorde in _ac._MENORES else base
    prefixo = "b" if alt < 0 else "#" if alt > 0 else ""
    return prefixo + base + _ac._SUF_NUMERAL.get(chave_acorde, "")


def _acorde_do_grau(notas_pc, indice, nomes, graus, quantas):
    """Empilha terças a partir do grau `indice` (3 = tríade, 4 = com sétima)."""
    pcs = [notas_pc[(indice + 2 * k) % len(notas_pc)] for k in range(quantas)]
    raiz = pcs[0]
    cands = [c for c in _ac._candidatos(set(pcs), raiz) if c["raiz"] == raiz]
    if not cands:
        return None
    melhor = cands[0]
    grau, alt = graus[indice]
    return {"grau": _numeral(grau, alt, melhor["chave"]), "acorde": nomes[indice] + _ac._TIPO[melhor["chave"]][2]}


# ─────────────────────────── descrever ───────────────────────────
def descrever(tonica, chave):
    t = _nome_tonica(tonica)
    if t is None:
        return {"erro": f"Não entendi a nota '{tonica}'. Exemplos: C, G#, Bb."}
    if chave not in _POR_CHAVE:
        return {"erro": f"Escala desconhecida: '{chave}'."}
    nome_t, pc = t
    _, nome_escala, formula, carater, desafio = _POR_CHAVE[chave]
    graus = _formula_para_graus(formula)

    notas, duplos = _escrever(nome_t, pc, graus)
    enarmonico, nome_pedido = None, f"{_solfejo(nome_t)} {nome_escala}"
    alt = _ENARMONICO.get(nome_t)
    if duplos and alt:                                   # ex: Sol♯ lídio pede 'dó dobrado-sustenido' → mostra como Lá♭ lídio
        notas2, duplos2 = _escrever(alt, pc, graus)
        if duplos2 < duplos:
            notas, enarmonico, nome_t = notas2, f"{_solfejo(alt)} {nome_escala}", alt

    intervalos = intervalos_da_escala(chave)
    pcs = [(pc + i) % 12 for i in intervalos]
    rotulo = {0: "1", 1: "b2", 2: "2", 3: "b3", 4: "3", 5: "4", 6: "b5", 7: "5", 8: "b6", 9: "6", 10: "b7", 11: "7"}
    tokens = formula.split()

    resp = {
        "nome": f"{_solfejo(nome_t)} {nome_escala}",
        "tonica": nome_t, "tipo": chave, "tipo_nome": nome_escala,
        "formula": formula, "carater": carater, "desafio_vocal": desafio,
        "notas": [{"letra": n, "solfejo": _solfejo(n), "grau": tokens[i]} for i, n in enumerate(notas)],
        "notas_texto": " ".join(notas),
        "semitons": "-".join(str(b - a) for a, b in zip(intervalos, list(intervalos[1:]) + [12])),
        "nome_pedido": nome_pedido, "enarmonico": enarmonico,
        "acordes_triades": None, "acordes_setimas": None,
    }
    if len(notas) == 7:                                  # só faz sentido "harmonizar" escalas de 7 notas
        resp["acordes_triades"] = [_acorde_do_grau(pcs, i, notas, graus, 3) for i in range(7)]
        resp["acordes_setimas"] = [_acorde_do_grau(pcs, i, notas, graus, 4) for i in range(7)]
    return resp


# ─────────────────────────── interpretar texto livre ───────────────────────────
_REGRAS_ESCALA = [
    (r"pentat.*(menor|minor)|(menor|minor).*pentat", "pentatonica_menor"),
    (r"pentat", "pentatonica_maior"),
    (r"blues", "blues"),
    (r"harmonic", "menor_harmonica"),
    (r"melodic", "menor_melodica"),
    (r"mixol", "mixolidio"),
    (r"dor(i|ic)", "dorico"),
    (r"frig|phryg", "frigio"),
    (r"lidi|lydi", "lidio"),
    (r"locri", "locrio"),
    (r"eoli|aeoli|natural|menor|minor", "menor"),
    (r"maior|major|jonio|ionian", "maior"),
]
_SOLFEJOS = [("sol", "G"), ("do", "C"), ("re", "D"), ("mi", "E"), ("fa", "F"), ("la", "A"), ("si", "B")]


def interpretar_escala(texto):
    """'G# lídio', 'Lá menor pentatônica', 'C harmonic minor' → (tonica, chave) ou None."""
    t = _sem_acento(texto or "").replace("♯", "#").replace("♭", "b").strip()
    t = re.sub(r"^(a\s+)?escala\s+(de\s+|da\s+|do\s+)?", "", t)           # "escala de dó maior" → "dó maior"
    letra, resto = None, t
    for nome, l in _SOLFEJOS:
        if t.startswith(nome) and not t[len(nome):len(nome) + 1].isalpha():
            letra, resto = l, t[len(nome):]
            break
    if letra is None:
        m = re.match(r"([a-g])(?=#|b(?![a-z])|\s|$)", t)                      # "bb menor" = si bemol; "dorico" NÃO é a nota ré
        if not m:
            return None
        letra, resto = m.group(1).upper(), t[1:]
    resto = resto.lstrip()
    acid = ""
    m = re.match(r"(#|b(?![a-z])|sustenido|bemol)", resto)
    if m:
        acid = {"#": "#", "b": "b", "sustenido": "#", "bemol": "b"}[m.group(1)]
        resto = resto[m.end():].lstrip()
    resto = re.sub(r"^(de|da|do|escala)\s+", "", resto).strip()
    for padrao, chave in _REGRAS_ESCALA:
        if re.search(padrao, resto):
            return letra + acid, chave
    return None


# ─────────────────────────── avaliar o canto ───────────────────────────
def _pc_da_nota(nome):
    """'G♯3', 'Db4', 'A2' → pitch class 0-11."""
    m = re.match(r"^([A-Ga-g])([#b♯♭]?)", nome or "")
    if not m:
        return None
    return (_ac._PC_LETRA[m.group(1).upper()] + (1 if m.group(2) in ("#", "♯") else -1 if m.group(2) in ("b", "♭") else 0)) % 12


def avaliar_canto(notas, tonica, chave):
    """`notas`: lista de (nome, duração) ou de {"nota": ..., "duracao_s": ...} como sai da análise."""
    desc = descrever(tonica, chave)
    if "erro" in desc:
        return desc
    t_nome, t_pc = _nome_tonica(desc["tonica"])
    intervalos = intervalos_da_escala(chave)
    pcs_escala = {(t_pc + i) % 12: k for k, i in enumerate(intervalos)}        # pc → índice do grau
    nomes = [n["letra"] for n in desc["notas"]]
    graus = [n["grau"] for n in desc["notas"]]

    itens = []
    for n in notas:
        nome, dur = (n["nota"], n["duracao_s"]) if isinstance(n, dict) else (n[0], n[1])
        pc = _pc_da_nota(nome)
        if pc is not None:
            itens.append((nome.replace("♯", "#").replace("♭", "b"), pc, float(dur)))
    if not itens:
        return {"escala": desc["nome"], "erro": "Não detectei notas sustentadas suficientes pra avaliar na escala."}

    dentro = [i for i in itens if i[1] in pcs_escala]
    tempo_total = sum(i[2] for i in itens) or 1.0
    fora = {}
    for nome, pc, dur in itens:
        if pc in pcs_escala:
            continue
        reg = fora.setdefault(nome[:-1] if nome[-1].isdigit() else nome, {"pc": pc, "vezes": 0, "tempo": 0.0})
        reg["vezes"] += 1
        reg["tempo"] += dur

    lista_fora = []
    for nome, reg in sorted(fora.items(), key=lambda kv: -kv[1]["vezes"]):
        dicas = []
        for delta, frase in ((1, "um semitom ABAIXO de"), (11, "um semitom ACIMA de")):
            alvo = (reg["pc"] + delta) % 12
            if alvo in pcs_escala:
                k = pcs_escala[alvo]
                dicas.append(f"{frase} {nomes[k]} (grau {graus[k]})")
        lista_fora.append({"nota": nome, "vezes": reg["vezes"], "tempo_s": round(reg["tempo"], 2),
                           "dica": " e ".join(dicas) if dicas else "distante das notas da escala"})

    cantados = {}
    for _, pc, _ in dentro:
        cantados[pcs_escala[pc]] = cantados.get(pcs_escala[pc], 0) + 1
    return {
        "escala": desc["nome"], "escala_pedida": desc["nome_pedido"], "notas_da_escala": desc["notas_texto"], "formula": desc["formula"],
        "total_notas": len(itens), "dentro": len(dentro),
        "pct_dentro": round(100 * len(dentro) / len(itens), 1),
        "pct_dentro_tempo": round(100 * sum(i[2] for i in dentro) / tempo_total, 1),
        "fora": lista_fora,
        "graus_cantados": [{"grau": graus[k], "nota": nomes[k], "vezes": v} for k, v in sorted(cantados.items())],
        "graus_nao_cantados": [f"{graus[k]} ({nomes[k]})" for k in range(len(nomes)) if k not in cantados],
        "carater": desc["carater"], "desafio_vocal": desc["desafio_vocal"],
    }
