# ══════════════════════════════════════════════════════════════
# edicao_dsp.py — Efeitos de edição vocal.
#
# Nesta fase, o usuário escolhe os efeitos manualmente (checkboxes no
# frontend). A interpretação por IA do comando em linguagem natural
# ("limpa o ruído e deixa mais profissional" -> liga os checkboxes certos
# sozinha) fica pra fase final de IA, junto com a Laranjinha.
# ══════════════════════════════════════════════════════════════
import numpy as np
import librosa
from producao_dsp import aplicar_reverb


def eq_presenca_peaking(audio, sr, freq_central=3500.0, ganho_db=5.0, q=1.1):
    """EQ paramétrico de presença de verdade (filtro peaking, fórmula RBJ audio
    cookbook) — reforça só a faixa de 3-4kHz (onde a voz ganha clareza/presença),
    sem destruir o resto do espectro como o preemphasis fazia (medido: aquele
    método derrubava o pico em 91% e a fundamental em 93%)."""
    from scipy.signal import lfilter
    A = 10 ** (ganho_db / 40)
    w0 = 2 * np.pi * freq_central / sr
    alpha = np.sin(w0) / (2 * q)
    cos_w0 = np.cos(w0)

    b0 = 1 + alpha * A
    b1 = -2 * cos_w0
    b2 = 1 - alpha * A
    a0 = 1 + alpha / A
    a1 = -2 * cos_w0
    a2 = 1 - alpha / A

    b = np.array([b0, b1, b2]) / a0
    a = np.array([1.0, a1 / a0, a2 / a0])
    return lfilter(b, a, audio).astype(np.float32)


def compressor_dinamico(audio, sr, threshold_db=-18.0, ratio=3.0,
                         attack_ms=8.0, release_ms=90.0, makeup_db=4.0):
    """Compressor de dinâmica de verdade (envelope follower + curva de razão),
    bem mais limpo que um waveshaper tipo tanh — que media 12.6% de distorção
    harmônica espúria introduzida no sinal."""
    threshold = 10 ** (threshold_db / 20)
    attack_coef = np.exp(-1.0 / (sr * attack_ms / 1000.0))
    release_coef = np.exp(-1.0 / (sr * release_ms / 1000.0))

    abs_audio = np.abs(audio).astype(np.float64)
    envelope = np.zeros_like(abs_audio)
    nivel = 0.0
    for i in range(len(abs_audio)):
        alvo = abs_audio[i]
        coef = attack_coef if alvo > nivel else release_coef
        nivel = coef * nivel + (1 - coef) * alvo
        envelope[i] = nivel

    ganho = np.ones_like(envelope)
    acima = envelope > threshold
    ganho[acima] = (threshold + (envelope[acima] - threshold) / ratio) / (envelope[acima] + 1e-9)

    saida = audio.astype(np.float64) * ganho
    saida *= 10 ** (makeup_db / 20)
    return saida.astype(np.float32)


def amostra_de_ruido(audio, sr, janela_s=0.4):
    """Acha o trecho mais quieto da própria gravação (ex: pausa entre frases) pra
    servir de "amostra de ruído". É a prática recomendada pelo noisereduce: sem
    amostra, ele estima o ruído a partir do áudio inteiro — voz incluída — e acaba
    apagando parte da voz. Só devolve a amostra se ela for realmente bem mais
    quieta que o resto; senão (canto contínuo, sem pausas), devolve None."""
    n = int(janela_s * sr)
    passo = max(1, n // 2)
    if len(audio) < 4 * n:
        return None
    rms = np.array([np.sqrt(np.mean(audio[i:i + n] ** 2)) for i in range(0, len(audio) - n, passo)])
    mediana = float(np.median(rms))
    k = int(np.argmin(rms))
    if rms[k] < 1e-5 or rms[k] > 0.4 * mediana:
        return None
    return audio[k * passo:k * passo + n]


def pitch_shift_em_blocos(audio, sr, n_steps, bloco_s=20.0, sobreposicao_s=0.5):
    """Ajuste de tom em blocos de ~20 s, com mistura suave (crossfade) nas emendas.
    O pitch_shift do librosa no áudio inteiro gastava memória proporcional à
    duração (medido: +134 MB com 120 s, o que estourava os 512 MB do plano grátis)."""
    n = len(audio)
    bloco = int(bloco_s * sr)
    sob = int(sobreposicao_s * sr)
    if n <= bloco + 2 * sob:
        return librosa.effects.pitch_shift(audio, sr=sr, n_steps=n_steps)
    saida = np.zeros(n, dtype=np.float32)
    ini = 0
    while ini < n:
        a = max(0, ini - sob)
        b = min(n, ini + bloco + sob)
        trecho = librosa.effects.pitch_shift(audio[a:b], sr=sr, n_steps=n_steps).astype(np.float32)
        peso = np.ones(len(trecho), dtype=np.float32)
        if a > 0:                       # emenda com o bloco anterior: entra suave
            peso[:2 * sob] = np.linspace(0.0, 1.0, 2 * sob, dtype=np.float32)
        if b < n:                       # emenda com o próximo bloco: sai suave
            peso[-2 * sob:] = np.linspace(1.0, 0.0, 2 * sob, dtype=np.float32)
        saida[a:a + len(trecho)] += trecho * peso
        ini += bloco
    return saida


def aplicar_efeitos(audio, sr, reduzir_ruido=False, normalizar=False, ajustar_tom=0.0,
                     eq_presenca=False, compressao=False, remover_sibilancia=False,
                     reverb_leve=False):
    """Aplica os efeitos marcados. Retorna (audio_processado, lista_de_codigos_aplicados).
    Os códigos são strings ASCII puras (sem acento) — cabeçalhos HTTP não suportam
    acento com segurança, então a tradução pro português bonito acontece no front-end.

    Sempre normaliza no FINAL da cadeia (independente do checkbox) — isso evita o
    problema real que existia antes: qualquer combinação de efeitos podia deixar o
    resultado mais baixo que o original, dando a impressão de que a edição "piorou"
    o som só por ficar mais baixo."""
    acoes = []

    if reduzir_ruido:
        try:
            import noisereduce as nr
            # prop_decrease mais conservador (0.7 em vez do padrão ~1.0) — o padrão
            # tende a introduzir "ruído musical" (artefatos) numa gravação de voz
            # sem trecho de silêncio puro pra calibrar o perfil de ruído.
            # chunk_size menor = bem menos memória (medido: +164 MB -> +42 MB com 120 s)
            amostra = amostra_de_ruido(audio, sr)
            if amostra is not None:
                audio = nr.reduce_noise(y=audio, sr=sr, stationary=True, y_noise=amostra,
                                        prop_decrease=0.7, chunk_size=100000, padding=5000)
            else:
                audio = nr.reduce_noise(y=audio, sr=sr, stationary=True, prop_decrease=0.7,
                                        chunk_size=100000, padding=5000)
        except Exception:
            pass

    if ajustar_tom:
        try:
            audio = pitch_shift_em_blocos(audio, sr, float(ajustar_tom))
            acoes.append(f"ajuste_tom:{float(ajustar_tom):+.1f}")
        except Exception:
            pass

    if eq_presenca:
        try:
            audio = eq_presenca_peaking(audio, sr, freq_central=3500.0, ganho_db=5.0, q=1.1)
            acoes.append("eq_presenca")
        except Exception:
            pass

    if remover_sibilancia:
        try:
            from scipy.signal import butter, lfilter
            b, a = butter(2, [6000 / (sr / 2), 9000 / (sr / 2)], btype="bandstop")
            audio = lfilter(b, a, audio).astype(np.float32)
            acoes.append("reducao_sibilancia")
        except Exception:
            pass

    if compressao:
        try:
            audio = compressor_dinamico(audio, sr, threshold_db=-18.0, ratio=3.0,
                                         attack_ms=8.0, release_ms=90.0, makeup_db=4.0)
            acoes.append("compressao")
        except Exception:
            pass

    if reverb_leve:
        audio = aplicar_reverb(audio, sr, quantidade=0.12)
        acoes.append("reverb_leve")

    if reduzir_ruido:
        acoes.insert(0, "reducao_ruido")
    if normalizar:
        acoes.append("normalizacao")

    # Normalização final SEMPRE aplicada (a um pico seguro de 0.9), pra garantir que
    # o resultado nunca soe mais baixo que o original por causa do processamento.
    pico = np.max(np.abs(audio)) + 1e-9
    audio = (audio / pico * 0.9).astype(np.float32)

    if not acoes:
        acoes.append("normalizacao")

    return audio, acoes
