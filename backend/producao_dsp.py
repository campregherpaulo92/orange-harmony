# ══════════════════════════════════════════════════════════════
# producao_dsp.py — Geração de backing track (baixo, bateria, acordes),
# ducking e reverb de master. Portado 1:1 do app.py original do Streamlit
# (já validado em produção por meses) — só a UI mudou, a matemática é a mesma.
# ══════════════════════════════════════════════════════════════
import numpy as np
import librosa
from audio_analysis import NOMES_NOTAS, extrair_pitch

ESTILOS_MUSICAIS = {
    "Pop": "Leve e dançante — acordes a cada compasso, clima pop radiofônico.",
    "Rock": "Energético — acordes firmes e bateria marcada nos tempos 2 e 4.",
    "Balada": "Calmo e emotivo — acordes longos e suaves, clima intimista.",
    "Sertanejo": "Violão marcado — acordes abertos e andamento médio.",
    "Funk": "Ritmado — acordes curtos e groove constante.",
    "MPB": "Melódico e sofisticado — acordes abertos e clima brasileiro.",
    "Gospel": "Emocional e edificante — acordes longos e clima de adoração.",
    "Reggae": "Descontraído — batida no contratempo e acordes abertos.",
    "Blues": "Clima de bar — progressão de blues e swing leve.",
    "Jazz": "Sofisticado — acordes com tensão (7ª) e andamento médio.",
    "Forró": "Animado — baião/xote com acordes marcados.",
    "Eletrônica": "Dançante — acordes curtos e groove constante de club.",
    "Samba": "Suingado — cavaquinho/violão sincopado, clima de roda de samba.",
    "Pagode": "Suave e suingado — acordes abertos, clima de churrasco.",
    "Axé": "Empolgante — acordes curtos e batida forte, clima de carnaval.",
    "Bossa Nova": "Sofisticado e suave — acordes longos com tensão sutil.",
    "Country": "Direto e alegre — acordes abertos, clima de estrada.",
    "R&B": "Suave e groovado — acordes com 7ª, clima urbano noturno.",
    "Trap": "Denso e moderno — acordes curtos, graves marcados.",
    "Metal": "Pesado e intenso — acordes firmes, bateria marcada e agressiva.",
}


def nota_para_midi(nome, oitava):
    return 12 * (oitava + 1) + NOMES_NOTAS.index(nome)


def midi_para_freq(midi, calibracao=440.0):
    return calibracao * 2 ** ((midi - 69) / 12)


def gerar_kick(sr, volume=0.95):
    n = int(sr * 0.35)
    t = np.linspace(0, 0.35, n, endpoint=False)
    freq = 55 * np.exp(-18 * t) + 38
    fase = 2 * np.pi * np.cumsum(freq) / sr
    corpo = np.sin(fase)
    click = np.exp(-90 * t) * np.sin(2 * np.pi * 1000 * t) * 0.25
    thump = np.exp(-45 * t) * np.sin(2 * np.pi * 120 * t) * 0.35
    env = np.exp(-7 * t) * (1 - np.exp(-2000 * t))
    sinal = (corpo + click + thump) * env
    sinal = np.tanh(1.3 * sinal)
    return (sinal * volume).astype(np.float32)


def gerar_snare(sr, volume=0.7):
    n = int(sr * 0.28)
    t = np.linspace(0, 0.28, n, endpoint=False)
    rng = np.random.default_rng(42)
    ruido = rng.standard_normal(n)
    tom1 = np.sin(2 * np.pi * 185 * t) * np.exp(-28 * t) * 0.5
    tom2 = np.sin(2 * np.pi * 330 * t) * np.exp(-35 * t) * 0.3
    from scipy.signal import butter, lfilter
    b, a = butter(2, [800 / (sr / 2), 7000 / (sr / 2)], btype="band")
    esteira = lfilter(b, a, ruido)
    env_ruido = np.exp(-14 * t)
    snap = np.exp(-120 * t) * ruido * 0.4
    sinal = (0.55 * esteira * env_ruido + tom1 + tom2 + snap)
    env = (1 - np.exp(-3000 * t)) * np.exp(-9 * t)
    return (sinal * env * volume).astype(np.float32)


def gerar_hat(sr, volume=0.4):
    n = int(sr * 0.09)
    t = np.linspace(0, 0.09, n, endpoint=False)
    rng = np.random.default_rng(7)
    ruido = rng.standard_normal(n)
    from scipy.signal import butter, lfilter
    b, a = butter(2, 8000 / (sr / 2), btype="high")
    sinal = lfilter(b, a, ruido)
    sinal *= (1 + 0.3 * np.sin(2 * np.pi * 40 * t))
    env = np.exp(-45 * t) * (1 - np.exp(-5000 * t))
    return (sinal * env * volume).astype(np.float32)


def gerar_crash(sr, volume=0.5):
    n = int(sr * 1.5)
    t = np.linspace(0, 1.5, n, endpoint=False)
    rng = np.random.default_rng(99)
    ruido = rng.standard_normal(n)
    from scipy.signal import butter, lfilter
    b, a = butter(2, 3500 / (sr / 2), btype="high")
    sinal = lfilter(b, a, ruido)
    sinal *= (1 + 0.4 * np.sin(2 * np.pi * 6 * t))
    env = np.exp(-2.2 * t) * (1 - np.exp(-800 * t))
    return (sinal * env * volume).astype(np.float32)


def gerar_nota_baixo_encorpada(freq, duracao, sr, volume=0.55):
    n = int(sr * duracao)
    t = np.linspace(0, duracao, n, endpoint=False)
    sinal = (np.sin(2 * np.pi * freq * t)
             + 0.5 * np.sin(2 * np.pi * 2 * freq * t)
             + 0.25 * np.sin(2 * np.pi * 3 * freq * t)
             + 0.4 * np.sin(2 * np.pi * freq * 0.5 * t))
    vibrato = 1 + 0.003 * np.sin(2 * np.pi * 5 * t)
    sinal = sinal * vibrato
    ataque = int(0.008 * sr)
    env = np.ones(n)
    env[:ataque] = np.linspace(0, 1, ataque)
    release = int(min(0.08 * sr, n * 0.3))
    env[-release:] *= np.linspace(1, 0, release)
    env *= np.exp(-1.2 * t / duracao)
    sinal = np.tanh(1.4 * sinal * env)
    return (sinal * volume).astype(np.float32)


def gerar_baixo_melodico(audio, sr, tom, bpm, beat_times):
    """Linha de baixo com groove: notas nos tempos, pausas e dinâmica."""
    sr = int(sr)
    bpm = float(bpm)
    duracao_total = float(len(audio)) / sr
    if duracao_total <= 0:
        return np.zeros(1, dtype=np.float32)
    n_total = int(sr * duracao_total)
    trilha = np.zeros(n_total + sr, dtype=np.float32)
    raiz_midi = nota_para_midi(tom, 1)
    escala = [raiz_midi + i for i in [0, 2, 4, 5, 7, 9, 11]]
    # pitch em blocos (memória constante) — o pyin no áudio inteiro custava ~100 MB extras
    tempos_f0, f0 = extrair_pitch(audio, sr)

    if beat_times is None or len(beat_times) == 0:
        seg_compasso = 60.0 / bpm * 4
        n_compassos = max(1, int(np.ceil(duracao_total / seg_compasso)))
        colcheia = seg_compasso / 8
        beat_times = np.array([c * seg_compasso + i * colcheia
                               for c in range(n_compassos) for i in range(8)])
    seg_compasso = 60.0 / bpm * 4
    colcheia = seg_compasso / 8

    rng = np.random.default_rng(42)

    def melodia_em(t):
        masc = (tempos_f0 >= t - 0.25) & (tempos_f0 <= t + 0.25) & (f0 > 0)
        if masc.sum() == 0:
            return None
        return float(np.median(f0[masc]))

    def nota_baixo_para(freq_mel):
        if freq_mel is None:
            return escala[0]
        midi_mel = 69 + 12 * np.log2(freq_mel / 440.0)
        melhor = escala[0]
        melhor_dist = 1e9
        for nota in escala:
            for oit in range(-2, 1):
                midi_cand = nota + 12 * oit
                if midi_cand <= midi_mel:
                    dist = midi_mel - midi_cand
                    if dist < melhor_dist:
                        melhor_dist = dist
                        melhor = midi_cand
        return melhor

    padrao_groove = {
        0: (True, 1.8, 1.00),
        2: (True, 1.8, 0.75),
        4: (True, 1.8, 0.90),
        6: (True, 0.9, 0.70),
        7: (True, 0.9, 0.55),
    }

    for t in beat_times:
        if t >= duracao_total:
            break
        idx = int(t * sr)
        if idx >= n_total:
            break
        posicao = int(round((t % seg_compasso) / colcheia)) % 8
        cfg = padrao_groove.get(posicao)
        if cfg is None or not cfg[0]:
            continue
        _, dur_colcheias, volume = cfg
        freq_mel = melodia_em(t)
        midi_nota = nota_baixo_para(freq_mel)
        freq = midi_para_freq(midi_nota)
        jitter = rng.uniform(-0.012, 0.012)
        vol = volume * rng.uniform(0.92, 1.05)
        idx_nota = max(0, int((t + jitter) * sr))
        if idx_nota >= n_total:
            continue
        nota = gerar_nota_baixo_encorpada(freq, colcheia * dur_colcheias * 0.92, sr)
        nota = nota * vol
        fim = min(idx_nota + len(nota), n_total + sr)
        if fim > idx_nota:
            trilha[idx_nota:fim] += nota[:fim - idx_nota]
    return trilha[:n_total]


def gerar_bateria_ritmica(audio, sr, bpm, beat_times):
    """Bateria com dinâmica: acentos nos tempos fortes, sem chimbais duplicados."""
    sr = int(sr)
    bpm = float(bpm)
    duracao_total = float(len(audio)) / sr
    if duracao_total <= 0:
        return np.zeros(1, dtype=np.float32)
    n_total = int(sr * duracao_total)
    trilha = np.zeros(n_total + sr, dtype=np.float32)
    kick = gerar_kick(sr)
    snare = gerar_snare(sr)
    hat = gerar_hat(sr)
    crash = gerar_crash(sr)
    hop = 512
    rms = librosa.feature.rms(y=audio, frame_length=2048, hop_length=hop)[0]
    rms_times = librosa.frames_to_time(np.arange(len(rms)), sr=sr, hop_length=hop)
    rms_norm = rms / (np.max(rms) + 1e-9)

    if beat_times is None or len(beat_times) == 0:
        seg_compasso = 60.0 / bpm * 4
        n_compassos = max(1, int(np.ceil(duracao_total / seg_compasso)))
        colcheia = seg_compasso / 8
        beat_times = np.array([c * seg_compasso + i * colcheia
                               for c in range(n_compassos) for i in range(8)])
    seg_compasso = 60.0 / bpm * 4
    colcheia = seg_compasso / 8

    rng = np.random.default_rng(7)

    def energia_no_tempo(t):
        pos = int(np.searchsorted(rms_times, t))
        pos = min(max(pos, 0), len(rms_norm) - 1)
        return float(rms_norm[pos])

    def tocar(idx, amostra, volume=1.0):
        fim = min(idx + len(amostra), n_total + sr)
        if fim > idx:
            trilha[idx:fim] += amostra[:fim - idx] * volume

    for t in beat_times:
        if t >= duracao_total:
            break
        idx = int(t * sr)
        if idx >= n_total:
            break
        energia = energia_no_tempo(t)
        posicao = int(round((t % seg_compasso) / colcheia)) % 8
        vol_hat = 0.9 if posicao % 2 == 0 else 0.5
        tocar(idx, hat, vol_hat * rng.uniform(0.9, 1.05))
        if posicao in (0, 4):
            tocar(idx, kick, 1.0 if posicao == 0 else 0.85)
        if posicao in (2, 6) and energia > 0.18:
            tocar(idx, snare, 0.9 * rng.uniform(0.9, 1.05))
        if posicao == 0 and int(t // seg_compasso) % 2 == 0:
            tocar(idx, crash, 0.7)
        if energia > 0.55 and posicao in (6, 7):
            t_extra = t + colcheia / 2
            if t_extra < duracao_total:
                tocar(int(t_extra * sr), hat, 0.55)
    return trilha[:n_total]


def gerar_progressao(tom):
    """Progressão I–V–vi–IV no tom detectado (muito comum em músicas populares)."""
    raiz = NOMES_NOTAS.index(tom)
    graus = [0, 7, 9, 5]
    return [(raiz + g) % 12 for g in graus]


def gerar_acorde_encorpado(freqs, duracao, sr, volume=0.30):
    n = int(sr * duracao)
    t = np.linspace(0, duracao, n, endpoint=False)
    sinal = np.zeros(n)
    rng = np.random.default_rng(3)
    for f in freqs:
        detune = 1 + rng.uniform(-0.002, 0.002)
        voz = (np.sin(2 * np.pi * f * detune * t)
               + 0.25 * np.sin(2 * np.pi * 2 * f * detune * t)
               + 0.12 * np.sin(2 * np.pi * 3 * f * detune * t))
        sinal += voz
    ataque = int(0.05 * sr)
    env = np.ones(n)
    env[:ataque] = np.linspace(0, 1, ataque) ** 2
    release = int(min(0.25 * sr, n * 0.35))
    env[-release:] *= np.linspace(1, 0, release) ** 1.5
    env *= np.exp(-0.8 * t / duracao)
    sinal = np.tanh(1.1 * sinal * env)
    return (sinal * volume).astype(np.float32)


def gerar_acordes_musicais(audio, sr, tom, bpm, beat_times, estilo="Pop"):
    sr = int(sr)
    bpm = float(bpm)
    duracao_total = float(len(audio)) / sr
    if duracao_total <= 0:
        return np.zeros(1, dtype=np.float32)
    n_total = int(sr * duracao_total)
    trilha = np.zeros(n_total + sr, dtype=np.float32)
    progressao = gerar_progressao(tom)
    seg_compasso = 60.0 / bpm * 4
    n_compassos = max(1, int(np.ceil(duracao_total / seg_compasso)))
    duracao_acorde = seg_compasso * (2 if estilo in ("Balada", "Gospel") else 1)
    for c in range(n_compassos):
        t0 = c * seg_compasso
        if t0 >= duracao_total:
            break
        grau = progressao[c % len(progressao)]
        menor = (grau == 9)
        intervalos = [0, 3, 7] if menor else [0, 4, 7]
        freqs = []
        for oit in (3, 4):
            for intervalo in intervalos:
                midi = 12 * (oit + 1) + grau + intervalo
                freqs.append(midi_para_freq(midi))
        idx = int(t0 * sr)
        acorde = gerar_acorde_encorpado(freqs, duracao_acorde, sr, volume=0.30)
        fim = min(idx + len(acorde), n_total + sr)
        if fim > idx:
            trilha[idx:fim] += acorde[:fim - idx]
    return trilha[:n_total]


def iniciar_mix(audio):
    """Começa a mixagem com a voz normalizada. As trilhas são somadas uma a uma
    (somar_trilha) e liberadas logo depois — segurar todas ao mesmo tempo na
    memória custava ~50 MB a mais numa música de 2 min."""
    total = audio.astype(np.float32).copy()
    total *= 0.70 / (float(np.max(np.abs(total))) + 1e-9)
    return total


def somar_trilha(total, trilha, ganho):
    """Soma UMA trilha (normalizada pelo próprio pico) na mixagem, no lugar."""
    if trilha is None:
        return
    t = np.asarray(trilha, dtype=np.float32)
    pico_t = float(np.max(np.abs(t))) + 1e-9
    n = min(len(total), len(t))
    total[:n] += (ganho / pico_t) * t[:n]


def finalizar_mix(total):
    """Limitador suave (sem distorção) e trava final de segurança."""
    limite = 0.95
    acima = np.abs(total) > limite
    if np.any(acima):
        sinal = np.sign(total[acima])
        excesso = np.abs(total[acima]) - limite
        total[acima] = sinal * (limite + excesso * 0.15)
    pico_final = float(np.max(np.abs(total))) + 1e-9
    if pico_final > 1.0:
        total /= pico_final
    return total.astype(np.float32)


def mixar(audio, baixo, bateria, acordes=None, teclado=None, solo=None):
    """Mistura com níveis calibrados por trilha e limitador suave (sem distorção)."""
    total = iniciar_mix(audio)
    for trilha, ganho in ((baixo, 0.28), (bateria, 0.32), (acordes, 0.16), (teclado, 0.14), (solo, 0.12)):
        somar_trilha(total, trilha, ganho)
    return finalizar_mix(total)


def aplicar_ducking(trilha, audio_referencia, sr, intensidade=0.35):
    """Reduz o volume da trilha (baixo/acordes) quando a voz de referência está mais forte —
    simula o efeito de sidechain usado em produções profissionais.
    Envelope calculado em float32 e por blocos: a versão antiga criava ~4 arrays
    float64 do tamanho da música inteira a cada chamada (~84 MB para 2 min)."""
    if trilha is None:
        return None
    try:
        hop = 512
        rms = librosa.feature.rms(y=audio_referencia, frame_length=2048, hop_length=hop)[0]
        rms_norm = (rms / (np.max(rms) + 1e-9)).astype(np.float32)
        n = len(trilha)
        xp = np.arange(len(rms_norm), dtype=np.float32)
        escala = (len(rms_norm) - 1) / max(1, n - 1)
        saida = np.empty(n, dtype=np.float32)
        bloco = 1 << 19
        for i in range(0, n, bloco):
            j = min(n, i + bloco)
            x = np.arange(i, j, dtype=np.float32) * np.float32(escala)
            env = np.interp(x, xp, rms_norm).astype(np.float32)
            saida[i:j] = trilha[i:j] * (np.float32(1.0) - np.float32(intensidade) * env)
        return saida
    except Exception:
        return trilha


def gerar_reverb_ir(sr, duracao=1.2, decaimento=3.5):
    """Gera uma resposta ao impulso sintética (ruído com decaimento exponencial) para reverb algorítmico leve."""
    n = int(sr * duracao)
    rng = np.random.default_rng(11)
    ruido = rng.standard_normal(n)
    env = np.exp(-decaimento * np.linspace(0, duracao, n))
    ir = (ruido * env).astype(np.float32)
    return ir / (np.max(np.abs(ir)) + 1e-9)


def aplicar_reverb(sinal, sr, quantidade=0.12):
    """Aplica um reverb de master sutil por convolução (wet/dry), dando ar e coesão à mixagem.
    Usa oaconvolve (overlap-add): a convolução por FFT do sinal inteiro de uma vez
    alocava blocos enormes de memória."""
    if quantidade <= 0 or sinal is None:
        return sinal
    try:
        from scipy.signal import oaconvolve
        ir = gerar_reverb_ir(sr)
        molhado = oaconvolve(sinal, ir)[:len(sinal)].astype(np.float32)
        pico_molhado = float(np.max(np.abs(molhado))) + 1e-9
        pico_seco = float(np.max(np.abs(sinal))) + 1e-9
        molhado *= np.float32(pico_seco / pico_molhado * quantidade)
        molhado += sinal * np.float32(1 - quantidade)
        return molhado
    except Exception:
        return sinal


# ══════════════════════════════════════════════════════════════
# NOVO: TECLADO (acordes arpejados, timbre de piano) e SOLO (linha
# melódica simples num instrumento solista) — camadas extras de produção.
# ══════════════════════════════════════════════════════════════
def gerar_nota_teclado(freq, duracao, sr, volume=0.30):
    """Nota de teclado/piano — harmônicos com decaimento tipo martelada, mais
    brilhante e percussivo que o pad sustentado usado nos 'acordes'."""
    n = int(sr * duracao)
    if n <= 0:
        return np.zeros(1, dtype=np.float32)
    t = np.linspace(0, duracao, n, endpoint=False)
    amplitudes = [1.0, 0.5, 0.28, 0.14, 0.07]
    sinal = np.zeros(n)
    for i, amp in enumerate(amplitudes):
        h = i + 1
        if freq * h < sr / 2:
            sinal += amp * np.exp(-t * (1.2 + 0.8 * i)) * np.sin(2 * np.pi * freq * h * t)
    ataque = max(1, int(sr * 0.005))
    sinal[:ataque] *= np.linspace(0, 1, ataque)
    pico = np.max(np.abs(sinal)) + 1e-9
    return (sinal / pico * volume).astype(np.float32)


def gerar_teclado_musical(audio, sr, tom, bpm, beat_times, estilo="Pop"):
    """Camada de teclado: acordes ARPEJADOS (notas em sequência, não juntas),
    textura diferente e mais rítmica que os 'acordes' (pad sustentado)."""
    sr = int(sr)
    bpm = float(bpm)
    duracao_total = float(len(audio)) / sr
    if duracao_total <= 0:
        return np.zeros(1, dtype=np.float32)
    n_total = int(sr * duracao_total)
    trilha = np.zeros(n_total + sr, dtype=np.float32)
    progressao = gerar_progressao(tom)
    seg_compasso = 60.0 / bpm * 4
    n_compassos = max(1, int(np.ceil(duracao_total / seg_compasso)))
    subdivisao = seg_compasso / 8

    for c in range(n_compassos):
        t0 = c * seg_compasso
        if t0 >= duracao_total:
            break
        grau = progressao[c % len(progressao)]
        menor = (grau == 9)
        intervalos = ([0, 3, 7, 12] if menor else [0, 4, 7, 12]) * 2
        for i, intervalo in enumerate(intervalos):
            t_nota = t0 + i * subdivisao
            if t_nota >= duracao_total:
                break
            midi = 12 * (4 + 1) + grau + intervalo
            freq = midi_para_freq(midi)
            idx = int(t_nota * sr)
            nota = gerar_nota_teclado(freq, subdivisao * 0.9, sr, volume=0.28)
            fim = min(idx + len(nota), n_total + sr)
            if fim > idx:
                trilha[idx:fim] += nota[:fim - idx]
    return trilha[:n_total]


def gerar_nota_solo(freq, duracao, sr, volume=0.20):
    """Nota de instrumento solista (mais harmônicos, textura tipo sintetizador lead)."""
    n = int(sr * duracao)
    if n <= 0:
        return np.zeros(1, dtype=np.float32)
    t = np.linspace(0, duracao, n, endpoint=False)
    sinal = (np.sin(2 * np.pi * freq * t) + 0.4 * np.sin(2 * np.pi * 2 * freq * t)
             + 0.25 * np.sin(2 * np.pi * 3 * freq * t) + 0.15 * np.sin(2 * np.pi * 4 * freq * t))
    ataque = max(1, int(sr * 0.02))
    env = np.ones(n)
    env[:ataque] = np.linspace(0, 1, ataque)
    release = max(1, int(min(sr * 0.15, n * 0.4)))
    env[-release:] *= np.linspace(1, 0, release)
    sinal = np.tanh(1.1 * sinal * env)
    pico = np.max(np.abs(sinal)) + 1e-9
    return (sinal / pico * volume).astype(np.float32)


def gerar_solo_musical(audio, sr, tom, bpm, beat_times, estilo="Pop"):
    """Camada de solo: linha melódica simples, caminhando pela escala do tom
    detectado em passos pequenos (mais musical que saltos aleatórios), com
    timbre de instrumento solista."""
    sr = int(sr)
    bpm = float(bpm)
    duracao_total = float(len(audio)) / sr
    if duracao_total <= 0:
        return np.zeros(1, dtype=np.float32)
    n_total = int(sr * duracao_total)
    trilha = np.zeros(n_total + sr, dtype=np.float32)
    raiz_midi = nota_para_midi(tom, 4)
    escala = [raiz_midi + i for i in [0, 2, 4, 5, 7, 9, 11, 12]]
    seg_compasso = 60.0 / bpm * 4
    duracao_nota = seg_compasso / 4
    n_notas = int(duracao_total / duracao_nota)

    rng = np.random.default_rng(21)
    indice_atual = 3
    for i in range(n_notas):
        t_nota = i * duracao_nota
        if t_nota >= duracao_total:
            break
        passo = rng.choice([-2, -1, -1, 0, 1, 1, 2])
        indice_atual = max(0, min(len(escala) - 1, indice_atual + int(passo)))
        if rng.random() < 0.35:
            continue  # pausas — dão respiro à linha melódica
        midi = escala[indice_atual]
        freq = midi_para_freq(midi)
        idx = int(t_nota * sr)
        nota = gerar_nota_solo(freq, duracao_nota * 0.85, sr, volume=0.20)
        fim = min(idx + len(nota), n_total + sr)
        if fim > idx:
            trilha[idx:fim] += nota[:fim - idx]
    return trilha[:n_total]
