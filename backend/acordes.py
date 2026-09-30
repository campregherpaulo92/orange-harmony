# ══════════════════════════════════════════════════════════════
# acordes.py — Motor de teoria musical de acordes de violão.
#  • identificar(cordas)      → nome do acorde a partir das casas marcadas no braço
#  • procurar(nome)           → notas + posições no braço + onde se encaixa
#  • onde_encaixa(...)        → tonalidades (com o grau) e escalas que contêm o acorde
# Usado pela aba "Acordes" e pelas ferramentas da Laranjinha (mesma fonte de verdade).
# Convenção das cordas: lista de 6 números, da corda mais GRAVE (Mi) à mais AGUDA (mi):
#   -1 = corda muda (não toca) | 0 = solta | n = casa n.
# ══════════════════════════════════════════════════════════════
import itertools
import re

NOMES_SUST = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
NOMES_BEMOL = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"]
SOLFEJO = {"C": "Dó", "D": "Ré", "E": "Mi", "F": "Fá", "G": "Sol", "A": "Lá", "B": "Si"}
AFINACAO = [40, 45, 50, 55, 59, 64]            # Mi2 Lá2 Ré3 Sol3 Si3 mi4 (MIDI)

# (chave interna, intervalos em semitons, sufixo estilo Cifra Club, descrição)
TIPOS = [
    ("",      (0, 4, 7),           "",       "maior"),
    ("m",     (0, 3, 7),           "m",      "menor"),
    ("5",     (0, 7),              "5",      "power chord (fundamental + quinta)"),
    ("dim",   (0, 3, 6),           "dim",    "diminuto"),
    ("aug",   (0, 4, 8),           "aug",    "aumentado"),
    ("sus2",  (0, 2, 7),           "sus2",   "com segunda suspensa"),
    ("sus4",  (0, 5, 7),           "sus4",   "com quarta suspensa"),
    ("6",     (0, 4, 7, 9),        "6",      "com sexta"),
    ("m6",    (0, 3, 7, 9),        "m6",     "menor com sexta"),
    ("7",     (0, 4, 7, 10),       "7",      "com sétima (dominante)"),
    ("maj7",  (0, 4, 7, 11),       "7M",     "com sétima maior"),
    ("m7",    (0, 3, 7, 10),       "m7",     "menor com sétima"),
    ("maj7#5", (0, 4, 8, 11),      "7M(#5)", "com sétima maior e quinta aumentada"),
    ("m7b5",  (0, 3, 6, 10),       "m7(b5)", "meio-diminuto"),
    ("dim7",  (0, 3, 6, 9),        "dim7",   "diminuto com sétima"),
    ("mmaj7", (0, 3, 7, 11),       "m(7M)",  "menor com sétima maior"),
    ("7sus4", (0, 5, 7, 10),       "7sus4",  "dominante com quarta suspensa"),
    ("add9",  (0, 2, 4, 7),        "add9",   "com nona adicionada"),
    ("madd9", (0, 2, 3, 7),        "m(add9)", "menor com nona adicionada"),
    ("69",    (0, 2, 4, 7, 9),     "6/9",    "com sexta e nona"),
    ("9",     (0, 2, 4, 7, 10),    "9",      "dominante com nona"),
    ("maj9",  (0, 2, 4, 7, 11),    "7M(9)",  "com sétima maior e nona"),
    ("m9",    (0, 2, 3, 7, 10),    "m9",     "menor com nona"),
    ("7b9",   (0, 1, 4, 7, 10),    "7(b9)",  "dominante com nona menor"),
    ("7#9",   (0, 3, 4, 7, 10),    "7(#9)",  "dominante com nona aumentada"),
    ("7b5",   (0, 4, 6, 10),       "7(b5)",  "dominante com quinta diminuta"),
    ("7#5",   (0, 4, 8, 10),       "7(#5)",  "dominante com quinta aumentada"),
    ("11",    (0, 2, 4, 5, 7, 10), "11",     "com décima primeira"),
    ("m11",   (0, 2, 3, 5, 7, 10), "m11",    "menor com décima primeira"),
    ("13",    (0, 2, 4, 7, 9, 10), "13",     "com décima terceira"),
]
_TIPO = {t[0]: t for t in TIPOS}
_MENORES = {"m", "dim", "m6", "m7", "m7b5", "dim7", "mmaj7", "madd9", "m9", "m11"}

FUNCAO = {0: "fundamental", 1: "b9", 2: "9ª / 2ª", 3: "3ª menor", 4: "3ª maior", 5: "4ª / 11ª",
          6: "b5 / #11", 7: "5ª", 8: "#5 / b13", 9: "6ª / 13ª", 10: "7ª menor", 11: "7ª maior"}

ESCALAS = [
    ("jônio (maior)",          (0, 2, 4, 5, 7, 9, 11)),
    ("dórico",                 (0, 2, 3, 5, 7, 9, 10)),
    ("frígio",                 (0, 1, 3, 5, 7, 8, 10)),
    ("lídio",                  (0, 2, 4, 6, 7, 9, 11)),
    ("mixolídio",              (0, 2, 4, 5, 7, 9, 10)),
    ("eólio (menor natural)",  (0, 2, 3, 5, 7, 8, 10)),
    ("lócrio",                 (0, 1, 3, 5, 6, 8, 10)),
    ("menor harmônica",        (0, 2, 3, 5, 7, 8, 11)),
    ("menor melódica",         (0, 2, 3, 5, 7, 9, 11)),
    ("pentatônica maior",      (0, 2, 4, 7, 9)),
    ("pentatônica menor",      (0, 3, 5, 7, 10)),
    ("blues",                  (0, 3, 5, 6, 7, 10)),
    ("tons inteiros",          (0, 2, 4, 6, 8, 10)),
    ("diminuta (tom-semitom)", (0, 2, 3, 5, 6, 8, 9, 11)),
    ("lídio dominante",        (0, 2, 4, 6, 7, 9, 10)),
    ("mixolídio b6",           (0, 2, 4, 5, 7, 8, 10)),
    ("dominante diminuta (semitom-tom)", (0, 1, 3, 4, 6, 7, 9, 10)),
    ("alterada (super lócria)", (0, 1, 3, 4, 6, 8, 10)),
]

_SO_DOMINANTE = {"lídio dominante", "mixolídio b6", "dominante diminuta (semitom-tom)", "alterada (super lócria)"}
_MAIOR = (0, 2, 4, 5, 7, 9, 11)
_MENOR_HARM = (0, 2, 3, 5, 7, 8, 11)
_ROMANOS = ["I", "II", "III", "IV", "V", "VI", "VII"]
_SUF_NUMERAL = {"": "", "m": "", "5": "5", "dim": "°", "aug": "+", "sus2": "sus2", "sus4": "sus4", "6": "6", "m6": "6",
                "7": "7", "maj7": "7M", "m7": "7", "maj7#5": "7M(#5)", "m7b5": "ø", "dim7": "°7", "mmaj7": "(7M)", "7sus4": "7sus4",
                "add9": "(add9)", "madd9": "(add9)", "69": "6/9", "9": "9", "maj9": "7M(9)", "m9": "9",
                "7b9": "7(b9)", "7#9": "7(#9)", "7b5": "7(b5)", "7#5": "7(#5)", "11": "11", "m11": "11", "13": "13"}
_TONICAS_MAIOR = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]
_TONICAS_MENOR = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "G#", "A", "Bb", "B"]
_PRIORIDADE_GRAU_MAIOR = {0: 0, 4: 1, 3: 2, 5: 3, 1: 4, 2: 5, 6: 6}


# ─────────────────────────── nomes de notas ───────────────────────────
def _bemol(pc, menor=False):
    """Escolhe bemol (Bb, Eb, Ab, Db) ou sustenido (A#, D#…), como se escreve na cifra."""
    if pc in (3, 10):
        return True
    if pc in (1, 8):
        return not menor          # Db e Ab (maiores) / C#m e G#m (menores)
    return False


def nome_nota(pc, bemol=False):
    return (NOMES_BEMOL if bemol else NOMES_SUST)[pc % 12]


def solfejo(nome):
    return SOLFEJO[nome[0]] + nome[1:].replace("#", "♯").replace("b", "♭")


def _lista_notas(pcs_ordenados, raiz, bemol):
    return [{"letra": nome_nota(p, bemol), "solfejo": solfejo(nome_nota(p, bemol)),
             "funcao": FUNCAO[(p - raiz) % 12]} for p in pcs_ordenados]


# ─────────────────────────── identificar ───────────────────────────
def _candidatos(pcs, baixo):
    saida = []
    for r in pcs:
        rel = frozenset((p - r) % 12 for p in pcs)
        for chave, intervalos, suf_br, descricao in TIPOS:
            T = frozenset(intervalos)
            exato = rel == T
            sem_quinta = 7 in T and len(T) >= 4 and rel == (T - {7})
            if not (exato or sem_quinta):
                continue
            pontos = 100 - len(T) - (0 if exato else 12) + (25 if r == baixo else 0)
            menor = chave in _MENORES
            b = _bemol(r, menor)
            nome = nome_nota(r, b) + suf_br + ("" if baixo == r else "/" + nome_nota(baixo, b))
            saida.append({"pontos": pontos, "raiz": r, "chave": chave, "nome": nome, "bemol": b,
                          "descricao": descricao + ("" if exato else " (sem a quinta)")})
    saida.sort(key=lambda c: -c["pontos"])
    return saida


def _montar_resposta(pcs, baixo, notas_midi_ordenadas=None):
    cands = _candidatos(pcs, baixo)
    if not cands:
        return None
    melhor = cands[0]
    vistos, alternativas = {melhor["nome"]}, []
    for c in cands[1:]:
        if c["nome"] not in vistos and len(alternativas) < 3:
            vistos.add(c["nome"]); alternativas.append(c["nome"])
    ordem = sorted(pcs, key=lambda p: (p - baixo) % 12)
    return {
        "nome": melhor["nome"],
        "tipo": melhor["descricao"],
        "alternativas": alternativas,
        "baixo": nome_nota(baixo, melhor["bemol"]),
        "notas": _lista_notas(ordem, melhor["raiz"], melhor["bemol"]),
        "encaixe": onde_encaixa(pcs, melhor["raiz"], melhor["chave"]),
        "_raiz": melhor["raiz"], "_chave": melhor["chave"],
    }


def identificar(cordas):
    """cordas: 6 números (-1 muda, 0 solta, n casa). Devolve dict ou {"erro": ...}."""
    try:
        cordas = [int(c) for c in cordas]
    except Exception:
        return {"erro": "Formato inválido. Envie 6 números (-1 = muda, 0 = solta, n = casa)."}
    if len(cordas) != 6:
        return {"erro": "São 6 cordas: envie 6 números."}
    if any(c < -1 or c > 24 for c in cordas):
        return {"erro": "Casas devem ir de 0 a 24 (ou -1 para corda muda)."}

    midis = [AFINACAO[s] + f for s, f in enumerate(cordas) if f >= 0]
    if len(midis) < 2:
        return {"erro": "Marque pelo menos 2 notas para formar um acorde."}
    pcs = {m % 12 for m in midis}
    baixo = min(midis) % 12
    if len(pcs) == 1:
        n = nome_nota(baixo)
        return {"erro": f"Só existe a nota {n} ({solfejo(n)}) — marque notas diferentes para formar um acorde."}
    resp = _montar_resposta(pcs, baixo)
    if resp is None:
        nomes = ", ".join(nome_nota(p) for p in sorted(pcs, key=lambda p: (p - baixo) % 12))
        return {"erro": f"Não reconheci um acorde comum com as notas {nomes}.", "notas_soltas": nomes}
    resp.pop("_raiz"); resp.pop("_chave")
    resp["cordas"] = cordas
    return resp


# ─────────────────────────── onde se encaixa ───────────────────────────
def _notas_da_escala(raiz, intervalos):
    """Escreve as notas da escala do jeito certo: escalas de 7 notas usam cada letra uma vez
    (Lá frígio = A Bb C D E F G, e não A A# C…); as demais usam sustenido/bemol pela fundamental."""
    plano = raiz in (1, 3, 5, 8, 10) or (raiz in (0, 2, 7) and 3 in intervalos and 4 not in intervalos)
    nome_raiz = nome_nota(raiz, plano)
    if len(intervalos) == 7:
        letras = ["C", "D", "E", "F", "G", "A", "B"]
        base = letras.index(nome_raiz[0])
        saida = []
        for k, iv in enumerate(intervalos):
            letra = letras[(base + k) % 7]
            dif = ((raiz + iv) % 12 - _PC_LETRA[letra] + 6) % 12 - 6
            if dif not in (-1, 0, 1):
                saida = None
                break
            saida.append(letra + {-1: "b", 0: "", 1: "#"}[dif])
        if saida:
            return " ".join(saida)
    return " ".join(nome_nota((raiz + i) % 12, plano) for i in intervalos)


def onde_encaixa(pcs, raiz, chave):
    """Tonalidades onde o acorde é diatônico (com o grau) e escalas sobre a fundamental."""
    pcs = set(pcs)
    menor_like = chave in _MENORES
    tonalidades = []
    for k in range(12):
        for tipo, intervalos, nomes in (("maior", _MAIOR, _TONICAS_MAIOR), ("menor harmônica", _MENOR_HARM, _TONICAS_MENOR)):
            escala = {(k + i) % 12 for i in intervalos}
            if not pcs <= escala:
                continue
            grau = list(intervalos).index((raiz - k) % 12)
            num = _ROMANOS[grau].lower() if menor_like else _ROMANOS[grau]
            item = {"tonalidade": f"{solfejo(nomes[k])} {tipo}", "grau": num + _SUF_NUMERAL.get(chave, ""),
                    "_ord": (0 if tipo == "maior" else 1, _PRIORIDADE_GRAU_MAIOR.get(grau, 9) if tipo == "maior" else grau)}
            if tipo == "maior":
                item["relativa"] = f"{solfejo(_TONICAS_MENOR[(k + 9) % 12])} menor natural"
            tonalidades.append(item)
    tonalidades.sort(key=lambda t: t["_ord"])
    for t in tonalidades:
        t.pop("_ord")

    rel = {(p - raiz) % 12 for p in pcs}
    b = _bemol(raiz, menor_like)
    dominante = 4 in rel and 10 in rel                 # terça maior + sétima menor
    escalas = [{"nome": f"{solfejo(nome_nota(raiz, b))} {nome}", "notas": _notas_da_escala(raiz, iv)}
               for nome, iv in ESCALAS
               if rel <= set(iv) and (nome not in _SO_DOMINANTE or dominante)]
    resumo = None
    if not tonalidades:
        resumo = ("Não é diatônico em nenhuma tonalidade maior ou menor harmônica — costuma ser empréstimo modal, "
                  "dominante secundário ou acorde de tensão.")
    return {"tonalidades": tonalidades[:8], "escalas": escalas, "observacao": resumo}


# ─────────────────────────── procurar por nome ───────────────────────────
_ALIAS = {
    "": "", "M": "", "maj": "", "major": "",
    "m": "m", "min": "m", "mi": "m", "-": "m", "minor": "m",
    "5": "5",
    "dim": "dim", "°": "dim", "o": "dim", "º": "dim",
    "aug": "aug", "+": "aug", "5+": "aug", "#5": "aug",
    "sus2": "sus2", "2": "sus2", "sus4": "sus4", "sus": "sus4", "4": "sus4",
    "6": "6", "m6": "m6", "min6": "m6", "-6": "m6",
    "7": "7", "7m": "7", "dom7": "7",
    "7M": "maj7", "maj7": "maj7", "M7": "maj7", "Maj7": "maj7", "Δ": "maj7", "△": "maj7", "7+": "maj7", "maj": "",
    "m7": "m7", "min7": "m7", "-7": "m7", "mi7": "m7",
    "m7(b5)": "m7b5", "m7b5": "m7b5", "ø": "m7b5", "ø7": "m7b5", "m7(5-)": "m7b5", "min7b5": "m7b5",
    "dim7": "dim7", "°7": "dim7", "o7": "dim7",
    "m(7M)": "mmaj7", "m7M": "mmaj7", "mMaj7": "mmaj7", "m(maj7)": "mmaj7", "mM7": "mmaj7", "mmaj7": "mmaj7",
    "7sus4": "7sus4", "7sus": "7sus4",
    "add9": "add9", "(add9)": "add9", "add2": "add9", "2(9)": "add9",
    "m(add9)": "madd9", "madd9": "madd9",
    "6/9": "69", "69": "69", "6(9)": "69",
    "9": "9", "7(9)": "9",
    "7M(#5)": "maj7#5", "maj7#5": "maj7#5", "7M#5": "maj7#5", "maj7(#5)": "maj7#5", "7M(9)": "maj9", "maj9": "maj9", "M9": "maj9", "7M9": "maj9",
    "m9": "m9", "min9": "m9", "m7(9)": "m9",
    "7(b9)": "7b9", "7b9": "7b9", "7(#9)": "7#9", "7#9": "7#9",
    "7(b5)": "7b5", "7b5": "7b5", "7(#5)": "7#5", "7#5": "7#5", "7+5": "7#5",
    "11": "11", "m11": "m11", "13": "13",
}
_RE_ACORDE = re.compile(r"^\s*([A-Ga-g])\s*([#b♯♭]?)\s*(.*?)\s*(?:/\s*([A-Ga-g])\s*([#b♯♭]?))?\s*$")
_PC_LETRA = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def _pc(letra, acid):
    v = _PC_LETRA[letra.upper()]
    if acid in ("#", "♯"):
        v += 1
    elif acid in ("b", "♭"):
        v -= 1
    return v % 12


def interpretar_nome(texto):
    """'Am7', 'C7M', 'F#m', 'Bb7(b9)', 'G/B'… → (raiz_pc, chave, baixo_pc) ou None."""
    m = _RE_ACORDE.match((texto or "").strip())
    if not m:
        return None
    letra, acid, suf, bl, bacid = m.groups()
    suf = suf.replace(" ", "")
    chave = _ALIAS.get(suf)
    if chave is None:
        chave = _ALIAS.get(suf.lower())
    if chave is None:
        return None
    raiz = _pc(letra, acid)
    baixo = _pc(bl, bacid) if bl else raiz
    return raiz, chave, baixo


def _pcs_do_acorde(raiz, chave, baixo):
    pcs = {(raiz + i) % 12 for i in _TIPO[chave][1]}
    pcs.add(baixo)
    return pcs


def _dedos(cordas):
    tocadas = [(s, f) for s, f in enumerate(cordas) if f > 0]
    if not tocadas:
        return 0
    menor = min(f for _, f in tocadas)
    no_pestana = [s for s, f in tocadas if f == menor]
    if len(no_pestana) >= 2:
        return 1 + sum(1 for _, f in tocadas if f > menor)
    return len(tocadas)


def gerar_posicoes(raiz, chave, baixo=None, maximo=6):
    """Posições tocáveis (fundamental no baixo, ≤ 4 casas de abertura, ≤ 4 dedos)."""
    baixo = raiz if baixo is None else baixo
    T = {(raiz + i) % 12 for i in _TIPO[chave][1]}
    obrigatorias = (T - {(raiz + 7) % 12}) if len(T) >= 4 else set(T)      # em acordes de 4+ notas a quinta pode ficar de fora
    if len(T) >= 6:                                   # 11 e 13: só fundamental, terça e sétima são obrigatórias
        obrigatorias = {raiz % 12} | {p for p in T if (p - raiz) % 12 in (3, 4, 10)}
    minimo_sons = 3 if len(T) <= 3 else 4
    achados = {}
    for base in range(1, 13):
        opcoes = []
        for s, afin in enumerate(AFINACAO):
            trastes = ([0] if base == 1 else []) + list(range(base, base + 4))
            opcoes.append([-1] + [f for f in trastes if (afin + f) % 12 in T])
        for cordas in itertools.product(*opcoes):
            sons = [s for s, f in enumerate(cordas) if f >= 0]
            if len(sons) < minimo_sons or sons != list(range(sons[0], sons[-1] + 1)):
                continue                               # sem cordas mudas no meio
            if (AFINACAO[sons[0]] + cordas[sons[0]]) % 12 != baixo:
                continue
            if not obrigatorias <= {(AFINACAO[s] + cordas[s]) % 12 for s in sons}:
                continue
            if _dedos(cordas) > 4:
                continue
            fretadas = [f for f in cordas if f > 0]
            base_real = min(fretadas) if fretadas else 1
            chave_ord = (base_real if base_real > 1 else 0, -len(sons), _dedos(cordas), sum(fretadas))
            achados[tuple(cordas)] = (chave_ord, base_real)
    ordenadas = sorted(achados.items(), key=lambda kv: kv[1][0])
    return [{"cordas": list(c), "base": info[1]} for c, info in ordenadas[:maximo]]


def procurar(nome):
    """Por nome: notas, posições no braço e onde se encaixa."""
    it = interpretar_nome(nome)
    if it is None:
        return {"erro": f"Não entendi o acorde '{nome}'. Exemplos: Am7, C7M, F#m, Bb, G/B, Dsus4."}
    raiz, chave, baixo = it
    _, intervalos, suf_br, descricao = _TIPO[chave]
    b = _bemol(raiz, chave in _MENORES)
    pcs = _pcs_do_acorde(raiz, chave, baixo)
    nome_canonico = nome_nota(raiz, b) + suf_br + ("" if baixo == raiz else "/" + nome_nota(baixo, b))
    ordem = sorted(pcs, key=lambda p: (p - baixo) % 12)
    posicoes = gerar_posicoes(raiz, chave, baixo)
    for p in posicoes:
        p["nome"] = nome_canonico
    return {
        "nome": nome_canonico, "tipo": descricao,
        "notas": _lista_notas(ordem, raiz, b),
        "posicoes": posicoes,
        "encaixe": onde_encaixa(pcs, raiz, chave),
    }
