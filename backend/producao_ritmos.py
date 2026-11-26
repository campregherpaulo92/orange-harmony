# ══════════════════════════════════════════════════════════════
# producao_ritmos.py — Toca os padrões de ritmos.py: bateria, baixo, acordes, teclado e solo
# por ESTILO, sobre a grade de batidas detectada na gravação do usuário.
# Todos os sons são sintetizados aqui (percussão) ou em producao_dsp (kick, caixa, chimbal, baixo...).
# ══════════════════════════════════════════════════════════════
import re
import unicodedata
from typing import NamedTuple

import numpy as np
from scipy.signal import butter, lfilter

import producao_dsp as D
import ritmos as R

NOMES_NOTAS = R.NOMES_NOTAS
VEL = {"X": 1.0, "x": 0.78, "o": 0.42}
GANHO = {"kick": 1.0, "snare": 0.85, "hat": 0.45, "open": 0.5, "ride": 0.45, "crash": 0.55, "rim": 0.6, "clap": 0.6,
         "tom": 0.8, "shaker": 0.35, "pandeiro": 0.6, "tamborim": 0.55, "surdo": 1.0, "conga": 0.65, "agogo": 0.5,
         "cowbell": 0.45, "triangulo": 0.35, "zabumba": 0.95, "caixa": 0.45, "clave": 0.55}
_sons = {}


# ─────────────────────────── síntese dos sons de percussão ───────────────────────────
def _t(sr, dur):
    return np.linspace(0, dur, max(1, int(sr * dur)), endpoint=False)


def _soma(*partes):
    """Soma sons de durações diferentes (alinhados no começo)."""
    n = max(len(p) for p in partes)
    saida = np.zeros(n)
    for p in partes:
        saida[:len(p)] += p
    return saida


def _norm(x, pico=1.0):
    return (x / (np.max(np.abs(x)) + 1e-9) * pico).astype(np.float32)


def _ruido_banda(sr, dur, lo, hi, decay, seed):
    t = _t(sr, dur)
    ruido = np.random.default_rng(seed).standard_normal(len(t))
    nyq = sr / 2
    hi = min(hi, nyq * 0.97)
    lo = min(lo, hi * 0.8)
    b, a = butter(2, [lo / nyq, hi / nyq], btype="band")
    return lfilter(b, a, ruido) * np.exp(-decay * t) * (1 - np.exp(-5000 * t))


def _tom(sr, f0, f1, dur, decay, queda=30):
    t = _t(sr, dur)
    freq = f1 + (f0 - f1) * np.exp(-queda * t)
    return np.sin(2 * np.pi * np.cumsum(freq) / sr) * np.exp(-decay * t) * (1 - np.exp(-3000 * t))


def _metal(sr, freqs, dur, decay):
    t = _t(sr, dur)
    sinal = sum(np.sin(2 * np.pi * f * t + 0.7 * i) / (1 + 0.3 * i) for i, f in enumerate(freqs) if f < sr / 2.2)
    return sinal * np.exp(-decay * t) * (1 - np.exp(-4000 * t))


def _criar_som(nome, sr):
    if nome == "kick":
        return _norm(D.gerar_kick(sr))
    if nome in ("snare", "caixa"):
        return _norm(D.gerar_snare(sr))
    if nome == "hat":
        return _norm(D.gerar_hat(sr))
    if nome == "crash":
        return _norm(D.gerar_crash(sr))
    if nome == "open":
        return _norm(_ruido_banda(sr, 0.3, 6000, 12000, 10, 11))
    if nome == "ride":
        return _norm(_soma(0.5 * _ruido_banda(sr, 0.6, 4500, 11000, 5, 12), 0.4 * _metal(sr, [2900, 4350, 5800], 0.6, 6)))
    if nome == "rim":
        return _norm(_soma(_tom(sr, 1800, 1700, 0.06, 80), 0.5 * _ruido_banda(sr, 0.06, 2000, 9000, 110, 13)))
    if nome == "clap":
        x = np.zeros(int(sr * 0.2))
        for i, atraso in enumerate((0.0, 0.011, 0.023)):
            r = _ruido_banda(sr, 0.16, 900, 3500, 28 + 6 * i, 20 + i)
            x[int(atraso * sr):int(atraso * sr) + len(r)] += r[:len(x) - int(atraso * sr)]
        return _norm(x)
    if nome == "tom":
        return _norm(_tom(sr, 160, 95, 0.3, 11))
    if nome == "shaker":
        return _norm(_ruido_banda(sr, 0.07, 5500, 11000, 50, 31))
    if nome == "pandeiro":
        return _norm(_soma(0.7 * _tom(sr, 240, 150, 0.06, 45), _ruido_banda(sr, 0.12, 3000, 9500, 28, 32)))
    if nome == "tamborim":
        return _norm(_soma(_tom(sr, 1900, 1500, 0.07, 60), 0.6 * _ruido_banda(sr, 0.07, 3000, 9000, 60, 33)))
    if nome == "surdo":
        return _norm(_soma(_tom(sr, 90, 52, 0.6, 5.5, queda=20), 0.15 * _ruido_banda(sr, 0.6, 200, 900, 40, 34)))
    if nome == "conga":
        return _norm(_soma(_tom(sr, 340, 260, 0.22, 16), 0.4 * _ruido_banda(sr, 0.22, 1500, 6000, 70, 35)))
    if nome == "agogo":
        return _norm(_metal(sr, [880, 1250], 0.25, 13))
    if nome == "cowbell":
        return _norm(_metal(sr, [560, 845], 0.32, 11))
    if nome == "triangulo":
        return _norm(_metal(sr, [4200, 6300, 8100], 0.7, 6))
    if nome == "zabumba":
        return _norm(_soma(_tom(sr, 120, 70, 0.34, 8.5, queda=25), 0.25 * _ruido_banda(sr, 0.05, 800, 4000, 90, 36)))
    if nome == "clave":
        return _norm(_soma(_metal(sr, [2100], 0.08, 60), 0.3 * _ruido_banda(sr, 0.05, 2000, 8000, 100, 37)))
    raise KeyError(nome)


def som(nome, sr):
    chave = (nome, int(sr))
    if chave not in _sons:
        _sons[chave] = _criar_som(nome, int(sr))
    return _sons[chave]


def _somar(trilha, amostra, idx, volume):
    if idx < 0 or idx >= len(trilha):
        return
    fim = min(idx + len(amostra), len(trilha))
    trilha[idx:fim] += amostra[:fim - idx] * volume


# ─────────────────────────── grade e harmonia ───────────────────────────
class _Grade:
    """Os passos do ritmo no tempo da gravação, mais consultas por (compasso, passo)."""

    def __init__(self, audio, sr, bpm, beat_times, esp):
        self.sr, self.esp = int(sr), esp
        self.dur = len(audio) / self.sr
        self.spb = esp["passos"] // esp["batidas"]
        t, comp, passo = R.construir_grade(beat_times, bpm, self.dur, self.spb, esp["batidas"])
        self.dur_passo = 60.0 / max(float(bpm), 1.0) / self.spb
        if esp["swing"] > 0 and self.spb == 4:                        # atrasa as semicolcheias pares → suingue
            t = t + np.where(passo % 2 == 1, esp["swing"] * self.dur_passo, 0.0)
        self.t, self.comp, self.passo = t, comp, passo
        self.mapa = {(int(c), int(p)): float(x) for x, c, p in zip(t, comp, passo)}
        self.compassos = sorted(set(int(c) for c in comp))
        self.din = self._dinamica(audio)

    def _dinamica(self, audio):
        """Fator 0,55–1,0 por compasso: acompanha o volume da sua voz (canta forte → banda forte; pausa → banda suave)."""
        x = np.asarray(audio, dtype=np.float32)
        if len(x) == 0 or float(np.max(np.abs(x))) < 1e-4:
            return {}
        energia = {}
        for c in self.compassos:
            t0, t1 = self.mapa.get((c, 0)), self.fim_do_compasso(c)
            if t0 is None or t1 is None:
                continue
            seg = x[int(t0 * self.sr): int(t1 * self.sr)]
            energia[c] = float(np.sqrt(np.mean(seg ** 2))) if len(seg) else 0.0
        if not energia:
            return {}
        ref = float(np.percentile(list(energia.values()), 90)) + 1e-9
        cs = sorted(energia)
        bruto = {c: min(1.0, energia[c] / ref) for c in cs}
        suave = {c: float(np.mean([bruto[cs[j]] for j in range(max(0, i - 1), min(len(cs), i + 2))])) for i, c in enumerate(cs)}   # média de 3 compassos
        return {c: 0.55 + 0.45 * v for c, v in suave.items()}

    def tempo(self, c, p):
        return self.mapa.get((c, p))

    def fim_do_compasso(self, c):
        proximo = self.mapa.get((c + 1, 0))
        if proximo is not None:
            return proximo
        ult = self.mapa.get((c, self.esp["passos"] - 1))
        return None if ult is None else ult + self.dur_passo


def _acorde(esp, tonica, c, harmonia=None):
    """Acorde do compasso c: o que a harmonização escolheu a partir da sua melodia; sem ela, a sequência fixa do estilo."""
    if harmonia and c in harmonia:
        return harmonia[c]
    grau, qual = esp["prog"][(c // esp["acorde_compassos"]) % len(esp["prog"])]
    return (tonica + grau) % 12, qual


def _eventos(barra, validos):
    """[(passo, letra)] dos passos com som no compasso."""
    return [(i, ch) for i, ch in enumerate(barra) if ch in validos]


def _nova_trilha(audio, sr):
    return np.zeros(int(len(audio)) + int(sr), dtype=np.float32)


# ─────────────────────────── bateria ───────────────────────────
def sugerir_secoes(grade):
    """Sugestões por contraste sustentado. Não presume a função harmônica da seção."""
    compassos = grade.compassos
    niveis = [grade.din.get(c, 1.0) for c in compassos]
    if len(niveis) < 4:
        return []
    baixa, alta = np.percentile(niveis, [25, 75])
    if alta - baixa < 0.045:
        return []
    limiar = (baixa + alta) / 2
    classes = ["pausa" if n < 0.59 else "refrao" if n > limiar else "verso" for n in niveis]
    grupos = []
    for c, tipo in zip(compassos, classes):
        if grupos and grupos[-1][1] == tipo:
            grupos[-1][2] += 1
        else:
            grupos.append([c + 1, tipo, 1])
    sugestoes = []
    for compasso, tipo, duracao in grupos:
        if duracao < 2 or (sugestoes and sugestoes[-1][1] == tipo):
            continue
        sugestoes.append((compasso, tipo))
    return sugestoes[:120]


class CompassoArranjo(NamedTuple):
    secao: str
    virada: bool
    entrada: bool
    densidade: float
    intensidade: float
    intro_percussao: bool = False
    sem_bateria: bool = False


def plano_arranjo(grade, complexidade, liberdade, instrucoes, secoes=()):
    """Transforma as seções e os pedidos reconhecidos em decisões de execução."""
    texto = unicodedata.normalize("NFKD", instrucoes.lower()).encode("ascii", "ignore").decode()
    suave = bool(re.search(r"\b(suav\w*|discret\w*|leve\w*|acustic\w*)\b", texto))
    intro_silencio = bool(re.search(r"intro\w* sem acompanhamento", texto))
    intro_sem_bateria = bool(re.search(r"intro\w* sem bateria", texto))
    intro_percussao = bool(re.search(r"(?:so|apenas|somente) (?:uma )?percussao[^.!;]*intro|intro\w* (?:com )?(?:so|apenas|somente) percussao", texto))
    sem_viradas = bool(re.search(r"\bsem (?:as )?viradas?\b", texto))
    com_viradas = "virad" in texto and not sem_viradas

    # O mapa explícito define a forma. De outro modo, agrupa contrastes sustentados.
    marcas = dict(secoes or sugerir_secoes(grade))
    plano = {}
    tipos = []
    tipo = "base"
    for c in grade.compassos:
        tipo = marcas.get(c + 1, tipo)
        tipos.append(tipo)

    perfis = {
        "base": (0.75, 0.86), "introducao": (0.35, 0.58), "verso": (0.58, 0.76),
        "pre-refrao": (0.83, 0.88), "refrao": (1.0, 1.0), "ponte": (0.51, 0.73),
        "solo": (0.78, 0.86), "final": (0.4, 0.70), "pausa": (0.0, 0.0),
    }
    for i, c in enumerate(grade.compassos):
        tipo = tipos[i]
        anterior = tipos[i - 1] if i > 0 else None
        seguinte = tipos[i + 1] if i + 1 < len(tipos) else None
        pausa_intro = tipo == "introducao" and intro_silencio
        densidade, intensidade = perfis[tipo]
        if suave and tipo in ("introducao", "verso", "ponte", "base"):
            intensidade *= 0.85
            densidade *= 0.85
        virada = (not sem_viradas and seguinte in ("refrao", "solo", "final", "verso")
                  and seguinte != tipo and (com_viradas or liberdade >= 0.5))
        plano[c] = CompassoArranjo(
            "pausa" if pausa_intro else tipo,
            virada and not pausa_intro,
            anterior != tipo and tipo in ("refrao", "final"),
            densidade * (0.63 + 0.37 * complexidade),
            intensidade,
            tipo == "introducao" and intro_percussao,
            tipo == "introducao" and intro_sem_bateria,
        )
    return plano


def preparar_arranjo(audio, sr, bpm, beat_times, estilo, ajustes):
    grade = _Grade(audio, sr, bpm, beat_times, R.obter(estilo))
    return grade, plano_arranjo(grade, *ajustes)


def resumo_arranjo(plano):
    rotulos = {"introducao": "introdução", "pre-refrao": "pré-refrão", "refrao": "refrão"}
    secoes = []
    for c, barra in plano.items():
        nome = "percussão leve" if barra.intro_percussao and barra.secao != "pausa" else rotulos.get(barra.secao, barra.secao)
        if not secoes or secoes[-1][1] != nome:
            secoes.append((c + 1, nome))
    return " / ".join(f"{c} {nome}" for c, nome in secoes[:16]) + (" / …" if len(secoes) > 16 else "")


def _apoio(plano, compasso, eventos, instrumento):
    if plano is None:
        return eventos, 1.0
    barra = plano[compasso]
    if barra.secao == "pausa" or barra.intro_percussao:
        return [], 0.0
    if not eventos:
        return eventos, barra.intensidade
    if barra.secao in ("introducao", "final") and instrumento != "teclado":
        limite = 1
    else:
        limite = max(1, round(len(eventos) * barra.densidade))
    escolhidos = [eventos[i * len(eventos) // limite] for i in range(limite)]
    if barra.virada and eventos[-1] not in escolhidos:
        escolhidos.append(eventos[-1])
    return escolhidos, barra.intensidade


def _batida_contextual(inst, letra, p, g, barra):
    if barra.secao == "pausa" or barra.sem_bateria:
        return None
    if barra.intro_percussao:
        return ("shaker", "o") if inst == next(iter(g.esp["bateria"])) and p % g.spb == 0 else None

    metades = {0, (g.esp["batidas"] // 2) * g.spb}
    if barra.secao == "final":
        return (inst, "X") if barra.entrada and p == 0 and inst in ("kick", "surdo", "zabumba") else None
    if barra.virada and "snare" in g.esp["bateria"] and p >= g.esp["passos"] - g.spb and inst in ("snare", "rim", "clap", "hat", "open", "ride"):
        return None
    if barra.secao in ("introducao", "verso", "ponte"):
        if p % g.spb and (barra.densidade < 0.45 or p % g.spb != g.spb // 2):
            return None
        if barra.secao == "introducao" and p not in metades:
            return None
        if inst == "snare" and letra != ".":
            return ("rim", "x")
        if inst in ("open", "ride"):
            return None
    if barra.secao == "refrao":
        if inst == "kick" and p in metades and letra == ".":
            return (inst, "x")
        if inst == "hat" and letra != ".":
            # Abre o chimbal no contratempo que antecede a próxima metade da barra.
            if p in {m + g.spb - 1 for m in metades} or p == g.esp["passos"] - max(1, g.spb // 2):
                return ("open", "x")
    if letra == ".":
        return None
    if p % g.spb and barra.densidade < 0.6 and p % g.spb != g.spb // 2:
        return None
    return (inst, letra)


def gerar_bateria_estilo(audio, sr, bpm, beat_times, estilo, arranjo=None):
    esp = R.obter(estilo)
    sr = int(sr)
    g, plano = arranjo if arranjo is not None else (_Grade(audio, sr, bpm, beat_times, esp), None)
    trilha = _nova_trilha(audio, sr)
    rng = np.random.default_rng(7)
    for inst, padrao in esp["bateria"].items():
        barras = R.parse_padrao(padrao, esp["passos"])
        for ti, ci, pi in zip(g.t, g.comp, g.passo):
            c, p = int(ci), int(pi)
            letra = barras[c % len(barras)][p]
            barra = plano[c] if plano is not None else None
            evento = _batida_contextual(inst, letra, p, g, barra) if barra is not None else (inst, letra) if letra != "." else None
            if evento is None:
                continue
            instrumento, ataque = evento
            intensidade = barra.intensidade if barra is not None else 1.0
            idx = max(0, int((ti + rng.normal(0, 0.003)) * sr))
            volume = VEL[ataque] * GANHO[instrumento] * intensidade * g.din.get(c, 1.0) * rng.uniform(0.93, 1.05)
            _somar(trilha, som(instrumento, sr), idx, volume)
    crash = som("crash", sr) * GANHO["crash"]
    if plano is None and esp["crash"]:
        for ti, ci, pi in zip(g.t, g.comp, g.passo):
            if pi == 0 and int(ci) % esp["crash"] == 0:
                _somar(trilha, crash, int(ti * sr), 0.7 * g.din.get(int(ci), 1.0))
    kit_com_caixa = "snare" in esp["bateria"]
    for c, barra in (plano or {}).items():
        if barra.secao == "pausa" or barra.intro_percussao or barra.sem_bateria:
            continue
        inicio = g.tempo(c, 0)
        if barra.entrada and inicio is not None and kit_com_caixa:
            _somar(trilha, crash, int(inicio * sr), 0.58)
        if barra.virada and kit_com_caixa:
            ultimo_tempo = esp["passos"] - g.spb
            inicio_virada = ultimo_tempo + (g.spb // 2 if barra.densidade < 0.5 else 0)
            for p in range(inicio_virada, esp["passos"]):
                tempo = g.tempo(c, p)
                if tempo is not None:
                    instrumento = "tom" if p >= ultimo_tempo + max(1, g.spb // 2) else "snare"
                    ganho = GANHO[instrumento] * barra.intensidade * (0.55 + 0.4 * (p % g.spb) / g.spb)
                    _somar(trilha, som(instrumento, sr), int(tempo * sr), ganho)
    return trilha[:len(audio)]


# ─────────────────────────── baixo ───────────────────────────
def gerar_baixo_estilo(audio, sr, tom, bpm, beat_times, estilo, harmonia=None, arranjo=None):
    esp = R.obter(estilo)
    sr = int(sr)
    tonica = NOMES_NOTAS.index(tom) if tom in NOMES_NOTAS else 0
    g, plano = arranjo if arranjo is not None else (_Grade(audio, sr, bpm, beat_times, esp), None)
    trilha = _nova_trilha(audio, sr)
    barras = R.parse_padrao(esp["baixo"], esp["passos"])
    for c in g.compassos:
        raiz_pc, qual = _acorde(esp, tonica, c, harmonia)
        raiz = 36 + raiz_pc                                           # baixo elétrico: C2..B2
        prox_pc, _ = _acorde(esp, tonica, c + 1, harmonia)
        terca = 3 if qual in R.QUALIDADES_MENORES else 4
        notas = {"r": raiz, "5": raiz + 7, "8": raiz + 12, "3": raiz + terca, "6": raiz + 9, "7": raiz + 10, "a": 36 + prox_pc - 1}
        eventos, intensidade = _apoio(plano, c, _eventos(barras[c % len(barras)], notas), "baixo")
        if eventos and plano and plano[c].virada:
            passo_final = esp["passos"] - max(1, g.spb // 2)
            if eventos[-1][0] < passo_final and g.tempo(c, passo_final) is not None:
                eventos.append((passo_final, "a"))
        fim_barra = g.fim_do_compasso(c)
        for k, (passo, letra) in enumerate(eventos):
            t0 = g.tempo(c, passo)
            if t0 is None:
                continue
            t1 = g.tempo(c, eventos[k + 1][0]) if k + 1 < len(eventos) else fim_barra
            gap = (t1 - t0) if t1 is not None else g.dur_passo * 4
            dur = max(0.09, min(gap * esp["baixo_dur"], gap * 2.0))
            vol = (1.0 if k == 0 else 0.85) * (0.7 if letra == "a" else 1.0) * g.din.get(c, 1.0) * intensidade
            freq = D.midi_para_freq(notas[letra])
            _somar(trilha, D.gerar_nota_baixo_encorpada(freq, dur, sr), int(t0 * sr), vol)
    return trilha[:len(audio)]


# ─────────────────────────── acordes, teclado e solo ───────────────────────────
def _stab(freqs, dur, sr, volume=0.30):
    """Batida curta de acorde (violão/guitarra/cavaquinho/teclado): ataque rápido, decaimento natural e leve rasgueado."""
    n = int(sr * dur)
    extra = int(0.005 * sr * len(freqs))
    t = np.linspace(0, dur, n, endpoint=False)
    saida = np.zeros(n + extra)
    for i, f in enumerate(freqs):
        sinal = np.sin(2 * np.pi * f * t) + 0.35 * np.sin(4 * np.pi * f * t) + 0.12 * np.sin(6 * np.pi * f * t)
        env = np.exp(-t / (0.45 * dur)) * np.minimum(1.0, t / 0.003)
        fade = max(1, int(0.012 * sr))
        env[-fade:] *= np.linspace(1, 0, fade)
        inicio = i * int(0.005 * sr)                                  # rasgueado: cada corda 5 ms depois da anterior
        saida[inicio:inicio + n] += sinal * env
    return np.tanh(0.8 * saida / len(freqs) * 2.2).astype(np.float32) * volume


def _intervalos(qual):
    return R.QUALIDADES[qual]


def gerar_acordes_estilo(audio, sr, tom, bpm, beat_times, estilo, harmonia=None, arranjo=None):
    esp = R.obter(estilo)
    sr = int(sr)
    tonica = NOMES_NOTAS.index(tom) if tom in NOMES_NOTAS else 0
    g, plano = arranjo if arranjo is not None else (_Grade(audio, sr, bpm, beat_times, esp), None)
    trilha = _nova_trilha(audio, sr)
    barras = R.parse_padrao(esp["acordes"], esp["passos"])
    for c in g.compassos:
        raiz_pc, qual = _acorde(esp, tonica, c, harmonia)
        iv = _intervalos(qual)
        base = 48 + raiz_pc                                           # C3..B3
        barra = barras[c % len(barras)]
        eventos, intensidade = _apoio(plano, c, _eventos(barra, set("Xxo1234")), "acordes")
        din = g.din.get(c, 1.0) * intensidade
        fim_barra = g.fim_do_compasso(c)
        for k, (passo, letra) in enumerate(eventos):
            t0 = g.tempo(c, passo)
            if t0 is None:
                continue
            if letra in "1234":                                       # arpejo: nota solta, sustenta até o próximo evento
                t1 = g.tempo(c, eventos[k + 1][0]) if k + 1 < len(eventos) else fim_barra
                dur = max(0.1, ((t1 - t0) if t1 is not None else g.dur_passo * 4) * 1.15)
                semitom = {"1": iv[0], "2": iv[1], "3": iv[2], "4": iv[0] + 12}[letra]
                _somar(trilha, D.gerar_nota_teclado(D.midi_para_freq(base + 12 + semitom), dur, sr, volume=0.30), int(t0 * sr), din)
                continue
            passos_seguidos = 1
            while passo + passos_seguidos < esp["passos"] and barra[passo + passos_seguidos] == "_":
                passos_seguidos += 1
            dur = max(0.12, passos_seguidos * g.dur_passo * 0.97)
            freqs = [D.midi_para_freq(base + i) for i in iv]
            corpo = D.gerar_acorde_encorpado(freqs, dur, sr, volume=0.30) if dur >= 0.45 else _stab(freqs, dur, sr)
            _somar(trilha, corpo, int(t0 * sr), VEL[letra] * din)
    return trilha[:len(audio)]


def gerar_teclado_estilo(audio, sr, tom, bpm, beat_times, estilo, harmonia=None, arranjo=None):
    """Arpejo de teclado sobre os mesmos acordes do estilo (uma oitava acima dos acordes)."""
    esp = R.obter(estilo)
    sr = int(sr)
    tonica = NOMES_NOTAS.index(tom) if tom in NOMES_NOTAS else 0
    g, plano = arranjo if arranjo is not None else (_Grade(audio, sr, bpm, beat_times, esp), None)
    trilha = _nova_trilha(audio, sr)
    barras = R.parse_padrao(esp["teclado"], esp["passos"])
    for c in g.compassos:
        raiz_pc, qual = _acorde(esp, tonica, c, harmonia)
        iv = _intervalos(qual)
        eventos, intensidade = _apoio(plano, c, _eventos(barras[c % len(barras)], set("1234")), "teclado")
        fim_barra = g.fim_do_compasso(c)
        for k, (passo, letra) in enumerate(eventos):
            t0 = g.tempo(c, passo)
            if t0 is None:
                continue
            t1 = g.tempo(c, eventos[k + 1][0]) if k + 1 < len(eventos) else fim_barra
            dur = max(0.1, ((t1 - t0) if t1 is not None else g.dur_passo * 2) * 0.95)
            semitom = {"1": iv[0], "2": iv[1], "3": iv[2], "4": iv[0] + 12}[letra]
            _somar(trilha, D.gerar_nota_teclado(D.midi_para_freq(60 + raiz_pc + semitom), dur, sr, volume=0.28), int(t0 * sr), g.din.get(c, 1.0) * intensidade)
    return trilha[:len(audio)]


def _voz_por_quadro(audio, sr, hop=512):
    """Volume da sua gravação a cada ~12 ms, de 0 a 1 em relação aos trechos mais fortes. (None, 0) se for silêncio."""
    x = np.asarray(audio, dtype=np.float32)
    n = (len(x) // hop) * hop
    if n == 0:
        return None, 0.0
    r = np.sqrt(np.mean(x[:n].reshape(-1, hop) ** 2, axis=1))
    ref = float(np.percentile(r, 90))
    if ref < 1e-6:
        return None, 0.0
    return np.minimum(1.0, r / ref).astype(np.float32), hop / float(sr)


def _fracao_voz(quadros, dt, t0, t1):
    if quadros is None:
        return 0.0
    seg = quadros[int(t0 / dt): int(t1 / dt) + 1]
    return float(np.mean(seg)) if len(seg) else 0.0


def _escala_para_modo(nome, modo):
    """A escala do estilo, ajustada ao modo da música: música menor com escala maior (ou o contrário) cai na pentatônica certa."""
    if modo == "menor" and nome in ("maior", "pent_maior", "mixolidio"):
        return "pent_menor"
    if modo != "menor" and nome in ("dorico", "menor_natural"):
        return "pent_maior"
    return nome


def solo_eventos(audio, sr, tom, bpm, beat_times, estilo, harmonia=None, modo="maior", arranjo=None):
    """As notas do solo: [(tempo_s, duração_s, nota_midi, volume)].
    A linha caminha pela escala do estilo, mas RESPEITA a gravação: nos tempos fortes pousa numa nota do ACORDE daquele
    compasso (o mesmo que o baixo e o teclado tocam) e dá espaço à sua voz (mais pausas e volume menor quando você canta forte)."""
    esp = R.obter(estilo)
    sr = int(sr)
    tonica = NOMES_NOTAS.index(tom) if tom in NOMES_NOTAS else 0
    nome_escala, por_compasso = esp["solo"]
    escala = [60 + tonica + i for i in R.ESCALAS_SOLO[_escala_para_modo(nome_escala, modo)]]
    g, plano = arranjo if arranjo is not None else (_Grade(audio, sr, bpm, beat_times, esp), None)
    quadros, dt = _voz_por_quadro(audio, sr)
    rng = np.random.default_rng(21)
    espaco = esp["passos"] / por_compasso
    indice = len(escala) // 2
    eventos = []
    for c in g.compassos:
        raiz_pc, qual = _acorde(esp, tonica, c, harmonia)
        tons_do_acorde = {(raiz_pc + i) % 12 for i in R.QUALIDADES[qual]}
        candidatos_compasso, intensidade = _apoio(plano, c, list(range(por_compasso)), "solo")
        for i in candidatos_compasso:
            t0 = g.tempo(c, int(round(i * espaco)))
            if t0 is None:
                continue
            indice = max(0, min(len(escala) - 1, indice + int(rng.choice([-2, -1, -1, 0, 1, 1, 2]))))
            dur = max(0.1, espaco * g.dur_passo * 0.85)
            voz = _fracao_voz(quadros, dt, t0, t0 + dur)
            if rng.random() < 0.30 + 0.35 * voz:
                continue                                              # pausa: mais espaço onde você está cantando forte
            if i % 2 == 0:                                            # tempo forte: nota do acorde mais próxima
                candidatos = [k for k, n in enumerate(escala) if n % 12 in tons_do_acorde]
                if candidatos:
                    indice = min(candidatos, key=lambda k: abs(k - indice))
            eventos.append((t0, dur, escala[indice], 0.20 * (1.0 - 0.30 * voz) * g.din.get(c, 1.0) * intensidade))
    return eventos


def gerar_solo_estilo(audio, sr, tom, bpm, beat_times, estilo, harmonia=None, modo="maior", arranjo=None):
    """Linha melódica de solo (veja solo_eventos): escala do estilo + acordes do compasso + espaço para a sua voz."""
    sr = int(sr)
    trilha = _nova_trilha(audio, sr)
    for t0, dur, nota, vol in solo_eventos(audio, sr, tom, bpm, beat_times, estilo, harmonia, modo, arranjo):
        _somar(trilha, D.gerar_nota_solo(D.midi_para_freq(nota), dur, sr, volume=vol), int(t0 * sr), 1.0)
    return trilha[:len(audio)]


# ─────────────────────────── mixagem: nivelamento pelo volume médio (RMS) ───────────────────────────
# Antes cada camada era normalizada pelo PICO. Percussão tem picos altos e pouco corpo, então ficava 17–21 dB abaixo da voz
# (inaudível) e todos os estilos soavam iguais. Agora cada camada é nivelada pelo volume médio, relativo ao da voz.
NIVEL_DB = {"bateria": -5.0, "baixo": -6.0, "acordes": -10.0, "teclado": -11.0, "solo": -12.0}      # em relação à voz


def rms_voz(audio):
    """Volume médio da voz SÓ onde há voz (ignora pausas); sem voz nenhuma, usa um valor padrão."""
    x = np.asarray(audio, dtype=np.float32)
    n = (len(x) // 1024) * 1024
    if n == 0:
        return 0.3
    r = np.sqrt(np.mean(x[:n].reshape(-1, 1024) ** 2, axis=1))
    ativo = r > 0.15 * float(np.max(r)) if float(np.max(r)) > 1e-6 else None
    return float(np.sqrt(np.mean(r[ativo] ** 2))) if ativo is not None and np.any(ativo) else 0.3


def nivelar(trilha, rms_alvo, pico_max=0.85, saturacao=2.0):
    """Leva a camada ao volume médio pedido. Uma saturação suave (como o 'bus' de uma bateria) segura os picos
    e levanta o corpo; o ganho nunca passa do que mantém o pico em `pico_max`."""
    x = np.array(trilha, dtype=np.float32, copy=True)               # a ÚNICA cópia; o resto é feito no lugar (antes: 4 arrays temporários)
    pico = float(max(x.max(), -x.min())) + 1e-9
    x *= np.float32(saturacao / pico)
    np.tanh(x, out=x)
    x /= np.float32(np.tanh(saturacao))
    rms = float(np.sqrt(np.einsum("i,i->", x, x, dtype=np.float64) / len(x))) + 1e-9
    x *= np.float32(min(rms_alvo / rms, pico_max))
    return x


def camada_nivelada(trilha, ref, camada, estilo="Pop"):
    """Uma camada no volume certo em relação à voz (ref = volume médio da voz), SEM somar em lugar nenhum."""
    alvo = ref * 10 ** (NIVEL_DB[camada] / 20) * R.energia(estilo)
    return nivelar(trilha, alvo)


def somar_nivelado(mix, trilha, ref, camada, estilo="Pop"):
    """Soma UMA camada na mixagem, no volume certo em relação à voz (ref = volume médio da voz)."""
    x = camada_nivelada(trilha, ref, camada, estilo)
    n = min(len(mix), len(x))
    mix[:n] += x[:n]


def limitar(mix):
    """Limitador suave: o que passa de 0,8 é comprimido até 1,0 (não corta, não distorce o resto)."""
    a = np.abs(mix)
    acima = a > 0.8
    if np.any(acima):
        mix[acima] = np.sign(mix[acima]) * (0.8 + 0.2 * np.tanh((a[acima] - 0.8) / 0.2))
    return mix


def mixar_estilo(audio, estilo, baixo=None, bateria=None, acordes=None, teclado=None, solo=None):
    """Mixagem completa (usada pela Laranjinha e pelas prévias): voz + camadas niveladas pelo volume médio."""
    mix = D.iniciar_mix(audio)
    ref = rms_voz(mix)
    for nome, trilha in (("bateria", bateria), ("baixo", baixo), ("acordes", acordes), ("teclado", teclado), ("solo", solo)):
        if trilha is not None:
            somar_nivelado(mix, trilha, ref, nome, estilo)
    return D.finalizar_mix(limitar(mix))
