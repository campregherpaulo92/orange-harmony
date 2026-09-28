# ══════════════════════════════════════════════════════════════
# audio_analysis.py — Funções puras de análise vocal (Orange Harmony)
# Portado do app.py Streamlit: nenhuma dependência de UI aqui,
# só numpy/librosa. Pode ser testado e usado de qualquer front-end.
# ══════════════════════════════════════════════════════════════
import io
import tempfile
import os
import numpy as np
import librosa

# ── Constantes musicais ──
NOMES_NOTAS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
NOTAS_REFERENCIA = [f"{n}{o}" for o in range(2, 6) for n in NOMES_NOTAS]
ESCALA_MAIOR = [0, 2, 4, 5, 7, 9, 11, 12]


def f0_para_midi_calibrado(f0, calibracao=440.0):
    return 69 + 12 * np.log2(f0 / calibracao)


def f0_para_freq(nota, calibracao=440.0):
    """Converte um nome de nota (ex: 'C4') para frequência em Hz."""
    nome = nota[:-1]
    oitava = int(nota[-1])
    midi = 12 * (oitava + 1) + NOMES_NOTAS.index(nome)
    return calibracao * 2 ** ((midi - 69) / 12)


def carregar_audio_bytes(dados: bytes, nome_arquivo: str = "audio.wav"):
    """Lê bytes de áudio (upload) e devolve (audio, sr) em 22050 Hz mono.
    Aceita WAV, MP3, M4A, OGG, FLAC, AAC, WEBM — qualquer formato que o
    soundfile/librosa reconheçam."""
    if not dados:
        return None, None
    ext = os.path.splitext(nome_arquivo)[1] or ".wav"
    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
        tmp.write(dados)
        tmp_path = tmp.name
    try:
        import soundfile as sf
        audio, sr = sf.read(tmp_path, dtype="float32")
        if audio.ndim > 1:
            audio = audio.mean(axis=1)
        if sr != 22050:
            audio = librosa.resample(audio, orig_sr=sr, target_sr=22050)
            sr = 22050
    except Exception:
        try:
            audio, sr = librosa.load(tmp_path, sr=22050, mono=True)
        except Exception:
            os.unlink(tmp_path)
            return None, None
    os.unlink(tmp_path)
    return audio.astype(np.float32), int(sr)


# ══════════════════ PITCH ══════════════════
def extrair_pitch(audio, sr):
    f0, voiced, _ = librosa.pyin(audio, fmin=80, fmax=1000, sr=sr, frame_length=2048, hop_length=512)
    tempos = librosa.times_like(f0, sr=sr, hop_length=512)
    f0 = np.where(voiced & ~np.isnan(f0), f0, 0.0)
    return tempos, f0


def segmentar_notas(f0, tempos, duracao_min=0.4):
    mascara = f0 > 0
    if mascara.sum() == 0:
        return []
    mudancas = np.diff(mascara.astype(int))
    inicios = np.where(mudancas == 1)[0] + 1
    fins = np.where(mudancas == -1)[0] + 1
    if mascara[0]:
        inicios = np.concatenate(([0], inicios))
    if mascara[-1]:
        fins = np.concatenate((fins, [len(mascara)]))
    dt = tempos[1] - tempos[0] if len(tempos) > 1 else 0.01
    return [f0[i:f] for i, f in zip(inicios, fins) if (f - i) * dt >= duracao_min]


def analisar_afinacao(f0_limpo, tempos, calibracao=440.0, nota_ref=None):
    mascara = f0_limpo > 0
    vazio = {"nota_predominante": "—", "desvio_medio_cents": 0.0, "tendencia": "—",
             "desvio_sinal_cents": 0.0, "pct_afinado": 0.0, "num_frases": 0,
             "sustentacao_media": 0.0, "num_pausas": 0, "pausa_media": 0.0}
    if mascara.sum() == 0:
        return vazio
    f0_voz = f0_limpo[mascara]
    mediana_orig = float(np.median(f0_voz))
    f0_pred = mediana_orig
    for divisor in (2, 4):
        candidato = mediana_orig / divisor
        frac = float(np.mean(np.abs(f0_voz - candidato) / candidato < 0.08))
        if frac > 0.5:
            f0_pred = candidato
            break
    midi_pred = f0_para_midi_calibrado(f0_pred, calibracao)
    midi_arred_pred = int(round(midi_pred))
    nota_pred = f"{NOMES_NOTAS[midi_arred_pred % 12]}{midi_arred_pred // 12 - 1}"
    if nota_ref:
        f_ref = f0_para_freq(nota_ref, calibracao)
    else:
        f_ref = calibracao * 2 ** ((midi_arred_pred - 69) / 12)
    cents = 1200 * np.log2(f0_voz / f_ref)
    desvio_medio = float(np.mean(np.abs(cents)))
    desvio_sinal = float(np.mean(cents))
    pct_afinado = float(np.mean(np.abs(cents) <= 50) * 100)
    tendencia = ("neutra (bem centrada)" if abs(desvio_sinal) < 10
                 else ("aguda (sharp)" if desvio_sinal > 0 else "grave (flat)"))
    dt = tempos[1] - tempos[0] if len(tempos) > 1 else 0.01
    mudancas = np.diff(mascara.astype(int))
    inicios = np.where(mudancas == 1)[0] + 1
    fins = np.where(mudancas == -1)[0] + 1
    if mascara[0]:
        inicios = np.concatenate(([0], inicios))
    if mascara[-1]:
        fins = np.concatenate((fins, [len(mascara)]))
    frases = [(f - i) * dt for i, f in zip(inicios, fins) if (f - i) * dt >= 0.3]
    pausas = [(inicios[k + 1] - fins[k]) * dt for k in range(len(fins) - 1) if (inicios[k + 1] - fins[k]) * dt >= 0.3]
    return {"nota_predominante": nota_pred, "desvio_medio_cents": desvio_medio,
            "tendencia": tendencia, "desvio_sinal_cents": desvio_sinal,
            "pct_afinado": pct_afinado, "num_frases": len(frases),
            "sustentacao_media": float(np.mean(frases)) if frases else 0.0,
            "num_pausas": len(pausas), "pausa_media": float(np.mean(pausas)) if pausas else 0.0}


def extrair_sequencia_notas(f0, tempos, min_dur=0.15):
    """Detecta a sequência de notas sustentadas na performance (melodia cantada)."""
    notas = []
    atual, inicio = None, None
    for t, f in zip(tempos, f0):
        if f <= 0:
            if atual is not None and (t - inicio) >= min_dur:
                notas.append((atual, round(t - inicio, 2)))
            atual, inicio = None, None
            continue
        n = librosa.hz_to_note(f)
        if n != atual:
            if atual is not None and (t - inicio) >= min_dur:
                notas.append((atual, round(t - inicio, 2)))
            atual, inicio = n, t
    if atual is not None and (tempos[-1] - inicio) >= min_dur:
        notas.append((atual, round(tempos[-1] - inicio, 2)))
    return notas


# ══════════════════ VIBRATO ══════════════════
def detectar_vibrato_v4(f0, tempos, calibracao_a4=440.0, duracao_min=0.8):
    segmentos = segmentar_notas(f0, tempos, duracao_min=duracao_min)
    dt = tempos[1] - tempos[0] if len(tempos) > 1 else 0.01
    resultados = []
    for seg in segmentos:
        f0_nota = seg[seg > 0]
        if len(f0_nota) < 25:
            continue
        f0_mediana = float(np.median(f0_nota))
        cents_rel = 1200 * np.log2(f0_nota / f0_mediana)
        cents_rel = cents_rel - np.mean(cents_rel)
        n = len(cents_rel)
        t_axis = np.arange(n) * dt
        coef = np.polyfit(t_axis, cents_rel, 1)
        cents_detrended = cents_rel - np.polyval(coef, t_axis)
        deslize_cents = float(abs(coef[0]) * (n * dt))
        janela = np.hanning(n)
        espectro = np.abs(np.fft.rfft(cents_detrended * janela))
        freqs = np.fft.rfftfreq(n, d=dt)
        mascara = (freqs >= 3) & (freqs <= 8)
        if mascara.sum() == 0:
            continue
        idx_pico = np.argmax(espectro[mascara])
        taxa = float(freqs[mascara][idx_pico])
        energia_pico = espectro[mascara][idx_pico] ** 2
        energia_total = float(np.sum(espectro ** 2))
        periodicidade = energia_pico / energia_total if energia_total > 0 else 0.0
        fft_completo = np.fft.rfft(cents_detrended)
        faixa = (freqs >= taxa - 1.0) & (freqs <= taxa + 1.0)
        oscilacao = np.fft.irfft(fft_completo * faixa, n=n)
        extensao = float(2 * np.max(np.abs(oscilacao)))
        midi = f0_para_midi_calibrado(f0_mediana, calibracao_a4)
        midi_arredondado = int(np.round(midi))
        nome = NOMES_NOTAS[midi_arredondado % 12]
        oitava = midi_arredondado // 12 - 1
        resultados.append({"nota": f"{nome}{oitava}", "taxa_hz": taxa, "extensao_cents": extensao,
                            "deslize_cents": deslize_cents, "periodicidade": periodicidade,
                            "duracao_s": round(len(seg) * dt, 2)})
    return resultados


def classificar_vibrato_v4(taxa, extensao, deslize, periodicidade):
    if periodicidade < 0.15:
        return "deslize (pitch derrapou)" if deslize > 50 else "nota estável (sem vibrato)"
    if taxa < 3 or taxa > 8:
        return f"fora da faixa ({taxa:.1f} Hz)"
    if extensao < 15:
        return "fraco (pouca oscilação)"
    if extensao <= 60:
        return "saudável"
    if extensao <= 120:
        return "vibrato largo (expressivo)"
    return "vibrato muito largo"


# ══════════════════ BPM / TOM / COVER ══════════════════
def detectar_bpm_e_beats(audio, sr):
    try:
        tempo, beat_frames = librosa.beat.beat_track(y=audio, sr=sr)
        bpm = float(np.atleast_1d(tempo)[0])
        if bpm < 50 or bpm > 200 or np.isnan(bpm):
            bpm = 90.0
        beat_times = librosa.frames_to_time(beat_frames, sr=sr)
        return round(bpm, 1), np.asarray(beat_times, dtype=np.float64)
    except Exception:
        return 90.0, np.array([])


def detectar_tom(audio, sr):
    try:
        chroma = librosa.feature.chroma_cqt(y=audio, sr=sr, hop_length=1024)
        chroma_mean = chroma.mean(axis=1)
        idx = int(np.argmax(chroma_mean))
        return NOMES_NOTAS[idx]
    except Exception:
        return "C"


def analisar_cover(audio, sr, calibracao=440.0):
    resultado = {"tom": "—", "bpm": 0.0, "pct_na_escala": 0.0, "notas_fora": [],
                 "notas_principais": [], "veredito": "—", "duracao_s": 0.0}
    if audio is None or len(audio) < int(sr * 0.5):
        return resultado
    resultado["duracao_s"] = round(len(audio) / sr, 1)
    tom = detectar_tom(audio, sr)
    resultado["tom"] = tom
    bpm, _ = detectar_bpm_e_beats(audio, sr)
    resultado["bpm"] = bpm
    raiz = NOMES_NOTAS.index(tom)
    escala_pc = set((raiz + i) % 12 for i in ESCALA_MAIOR)
    tempos, f0 = extrair_pitch(audio, sr)
    f0_limpo = np.where((f0 >= 80) & (f0 <= 1000), f0, 0.0)
    mascara = f0_limpo > 0
    if mascara.sum() == 0:
        resultado["veredito"] = "Sem sinal de pitch detectado na gravação."
        return resultado
    f0_voz = f0_limpo[mascara]
    midi = f0_para_midi_calibrado(f0_voz, calibracao)
    pc = np.round(midi).astype(int) % 12
    dentro = np.isin(pc, list(escala_pc))
    pct = float(np.mean(dentro) * 100)
    resultado["pct_na_escala"] = round(pct, 1)
    contagem = {}
    for p in pc:
        contagem[p] = contagem.get(p, 0) + 1
    principais = sorted(contagem.items(), key=lambda x: -x[1])[:6]
    resultado["notas_principais"] = [NOMES_NOTAS[p] for p, _ in principais]
    fora = set(int(p) for p in pc[~dentro])
    resultado["notas_fora"] = [NOMES_NOTAS[p] for p in sorted(fora)]
    if pct >= 90:
        resultado["veredito"] = "Excelente — a gravação está casando com o tom"
    elif pct >= 75:
        resultado["veredito"] = "Bom — a maior parte está no tom, com alguns escapes"
    elif pct >= 60:
        resultado["veredito"] = "Regular — várias notas fora do tom detectado"
    else:
        resultado["veredito"] = "Fora do eixo — a gravação não está casando com o tom"
    return resultado


# ══════════════════ FUNÇÃO PRINCIPAL (usada pela rota /api/analyze) ══════════════════
def analisar_audio_completo(dados: bytes, nome_arquivo: str, modo: str = "completa",
                             calibracao: float = 440.0, nota_ref: str | None = None):
    """Roda a análise completa (ou de cover) e devolve um dicionário pronto pra virar JSON.
    Inclui a curva de pitch já decimada (no máx. 300 pontos) para o gráfico do front-end."""
    audio, sr = carregar_audio_bytes(dados, nome_arquivo)
    if audio is None:
        return {"erro": "Não foi possível ler o áudio. Tente outro formato (WAV ou MP3)."}

    tempos, f0 = extrair_pitch(audio, sr)
    f0_limpo = np.where((f0 >= 80) & (f0 <= 1000), f0, 0.0)

    # Curva de pitch decimada para o gráfico (evita mandar milhares de pontos pro navegador)
    mascara_voz = f0_limpo > 0
    tempos_voz = tempos[mascara_voz]
    f0_voz = f0_limpo[mascara_voz]
    passo = max(1, len(tempos_voz) // 300)
    curva_pitch = [
        {"t": round(float(t), 3), "hz": round(float(f), 2)}
        for t, f in zip(tempos_voz[::passo], f0_voz[::passo])
    ]

    if modo == "cover":
        cover = analisar_cover(audio, sr, calibracao)
        return {"modo": "cover", "resultado": cover, "curva_pitch": curva_pitch}

    resultado = analisar_afinacao(f0_limpo, tempos, calibracao, nota_ref=nota_ref)
    seq_notas = extrair_sequencia_notas(f0_limpo, tempos)
    vibratos = detectar_vibrato_v4(f0_limpo, tempos, calibracao_a4=calibracao)
    vibratos_json = [
        {**v, "classificacao": classificar_vibrato_v4(v["taxa_hz"], v["extensao_cents"], v["deslize_cents"], v["periodicidade"])}
        for v in vibratos
    ]
    return {
        "modo": "completa",
        "resultado": resultado,
        "sequencia_notas": [{"nota": n, "duracao_s": d} for n, d in seq_notas[:20]],
        "vibratos": vibratos_json,
        "curva_pitch": curva_pitch,
    }
