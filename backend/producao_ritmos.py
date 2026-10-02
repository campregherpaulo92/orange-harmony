# ══════════════════════════════════════════════════════════════
# producao_ritmos.py — Toca os padrões de ritmos.py: bateria, baixo, acordes, teclado e solo
# por ESTILO, sobre a grade de batidas detectada na gravação do usuário.
# Todos os sons são sintetizados aqui (percussão) ou em producao_dsp (kick, caixa, chimbal, baixo...).
# ══════════════════════════════════════════════════════════════
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
def gerar_bateria_estilo(audio, sr, bpm, beat_times, estilo):
    esp = R.obter(estilo)
    sr = int(sr)
    g = _Grade(audio, sr, bpm, beat_times, esp)
    trilha = _nova_trilha(audio, sr)
    rng = np.random.default_rng(7)
    for inst, padrao in esp["bateria"].items():
        barras = R.parse_padrao(padrao, esp["passos"])
        amostra, ganho = som(inst, sr), GANHO[inst]
        for ti, ci, pi in zip(g.t, g.comp, g.passo):
            letra = barras[int(ci) % len(barras)][int(pi)]
            if letra == ".":
                continue
            idx = int((ti + rng.normal(0, 0.003)) * sr)
            _somar(trilha, amostra, idx, VEL[letra] * ganho * g.din.get(int(ci), 1.0) * rng.uniform(0.93, 1.05))
    if esp["crash"]:                                                  # prato de condução a cada N compassos
        crash = som("crash", sr) * GANHO["crash"]
        for ti, ci, pi in zip(g.t, g.comp, g.passo):
            if pi == 0 and int(ci) % esp["crash"] == 0:
                _somar(trilha, crash, int(ti * sr), 0.7 * g.din.get(int(ci), 1.0))
    return trilha[:len(audio)]


# ─────────────────────────── baixo ───────────────────────────
def gerar_baixo_estilo(audio, sr, tom, bpm, beat_times, estilo, harmonia=None):
    esp = R.obter(estilo)
    sr = int(sr)
    tonica = NOMES_NOTAS.index(tom) if tom in NOMES_NOTAS else 0
    g = _Grade(audio, sr, bpm, beat_times, esp)
    trilha = _nova_trilha(audio, sr)
    barras = R.parse_padrao(esp["baixo"], esp["passos"])
    for c in g.compassos:
        raiz_pc, qual = _acorde(esp, tonica, c, harmonia)
        raiz = 36 + raiz_pc                                           # baixo elétrico: C2..B2
        prox_pc, _ = _acorde(esp, tonica, c + 1, harmonia)
        terca = 3 if qual in ("m", "m7", "dim", "m7b5") else 4
        notas = {"r": raiz, "5": raiz + 7, "8": raiz + 12, "3": raiz + terca, "6": raiz + 9, "7": raiz + 10, "a": 36 + prox_pc - 1}
        eventos = _eventos(barras[c % len(barras)], notas)
        fim_barra = g.fim_do_compasso(c)
        for k, (passo, letra) in enumerate(eventos):
            t0 = g.tempo(c, passo)
            if t0 is None:
                continue
            t1 = g.tempo(c, eventos[k + 1][0]) if k + 1 < len(eventos) else fim_barra
            gap = (t1 - t0) if t1 is not None else g.dur_passo * 4
            dur = max(0.09, min(gap * esp["baixo_dur"], gap * 2.0))
            vol = (1.0 if k == 0 else 0.85) * (0.7 if letra == "a" else 1.0) * g.din.get(c, 1.0)
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


def gerar_acordes_estilo(audio, sr, tom, bpm, beat_times, estilo, harmonia=None):
    esp = R.obter(estilo)
    sr = int(sr)
    tonica = NOMES_NOTAS.index(tom) if tom in NOMES_NOTAS else 0
    g = _Grade(audio, sr, bpm, beat_times, esp)
    trilha = _nova_trilha(audio, sr)
    barras = R.parse_padrao(esp["acordes"], esp["passos"])
    for c in g.compassos:
        raiz_pc, qual = _acorde(esp, tonica, c, harmonia)
        iv = _intervalos(qual)
        din = g.din.get(c, 1.0)
        base = 48 + raiz_pc                                           # C3..B3
        barra = barras[c % len(barras)]
        eventos = _eventos(barra, set("Xxo1234"))
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


def gerar_teclado_estilo(audio, sr, tom, bpm, beat_times, estilo, harmonia=None):
    """Arpejo de teclado sobre os mesmos acordes do estilo (uma oitava acima dos acordes)."""
    esp = R.obter(estilo)
    sr = int(sr)
    tonica = NOMES_NOTAS.index(tom) if tom in NOMES_NOTAS else 0
    g = _Grade(audio, sr, bpm, beat_times, esp)
    trilha = _nova_trilha(audio, sr)
    barras = R.parse_padrao(esp["teclado"], esp["passos"])
    for c in g.compassos:
        raiz_pc, qual = _acorde(esp, tonica, c, harmonia)
        iv = _intervalos(qual)
        eventos = _eventos(barras[c % len(barras)], set("1234"))
        fim_barra = g.fim_do_compasso(c)
        for k, (passo, letra) in enumerate(eventos):
            t0 = g.tempo(c, passo)
            if t0 is None:
                continue
            t1 = g.tempo(c, eventos[k + 1][0]) if k + 1 < len(eventos) else fim_barra
            dur = max(0.1, ((t1 - t0) if t1 is not None else g.dur_passo * 2) * 0.95)
            semitom = {"1": iv[0], "2": iv[1], "3": iv[2], "4": iv[0] + 12}[letra]
            _somar(trilha, D.gerar_nota_teclado(D.midi_para_freq(60 + raiz_pc + semitom), dur, sr, volume=0.28), int(t0 * sr), g.din.get(c, 1.0))
    return trilha[:len(audio)]


def gerar_solo_estilo(audio, sr, tom, bpm, beat_times, estilo, harmonia=None, modo="maior"):
    """Linha melódica que caminha pela escala do estilo (maior, pentatônica ou blues), com pausas."""
    esp = R.obter(estilo)
    sr = int(sr)
    tonica = NOMES_NOTAS.index(tom) if tom in NOMES_NOTAS else 0
    nome_escala, por_compasso = esp["solo"]
    if modo == "menor" and nome_escala in ("maior", "pent_maior"):
        nome_escala = "pent_menor"                                    # música em tom menor: o solo caminha pela pentatônica menor
    escala = [60 + tonica + i for i in R.ESCALAS_SOLO[nome_escala]]
    g = _Grade(audio, sr, bpm, beat_times, esp)
    trilha = _nova_trilha(audio, sr)
    rng = np.random.default_rng(21)
    espaco = esp["passos"] / por_compasso
    indice = len(escala) // 2
    for c in g.compassos:
        for i in range(por_compasso):
            passo = int(round(i * espaco))
            t0 = g.tempo(c, passo)
            if t0 is None:
                continue
            indice = max(0, min(len(escala) - 1, indice + int(rng.choice([-2, -1, -1, 0, 1, 1, 2]))))
            if rng.random() < 0.35:
                continue                                              # pausa: dá respiro à linha
            _somar(trilha, D.gerar_nota_solo(D.midi_para_freq(escala[indice]), max(0.1, espaco * g.dur_passo * 0.85), sr, volume=0.20), int(t0 * sr), g.din.get(c, 1.0))
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
    x = np.asarray(trilha, dtype=np.float32)
    pico = float(np.max(np.abs(x))) + 1e-9
    x = np.tanh(saturacao * x / pico) / np.tanh(saturacao)
    rms = float(np.sqrt(np.mean(x ** 2))) + 1e-9
    return (x * min(rms_alvo / rms, pico_max)).astype(np.float32)


def somar_nivelado(mix, trilha, ref, camada, estilo="Pop"):
    """Soma UMA camada na mixagem, no volume certo em relação à voz (ref = volume médio da voz)."""
    alvo = ref * 10 ** (NIVEL_DB[camada] / 20) * R.energia(estilo)
    x = nivelar(trilha, alvo)
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
