# ══════════════════════════════════════════════════════════════
# audio_analysis.py — Funções puras de análise vocal (Orange Harmony)
# Portado do app.py Streamlit: nenhuma dependência de UI aqui,
# só numpy/librosa. Pode ser testado e usado de qualquer front-end.
# ══════════════════════════════════════════════════════════════
import io
import gc
import shutil
import subprocess
import tempfile
import os
import threading
import numpy as np
import librosa

# ── Limites de recurso ──
# O plano grátis do Render tem só 512 MB de RAM e 0.1 CPU. Medido: sem esses
# limites, um áudio de 3 min pedia ~670 MB (o servidor era morto e reiniciava,
# derrubando até as mensagens de texto da Laranjinha).
LIMITE_ANALISE_S = 120      # analisa no máximo os primeiros 120 s do áudio
BLOCO_PITCH_S = 20          # o pyin roda em blocos de 20 s (memória constante)
JANELA_TOM_BPM_S = 60       # tom/BPM são estáveis: 60 s do meio bastam


def liberar_memoria():
    """Devolve memória ao sistema operacional depois de uma análise pesada.
    O Python solta os arrays, mas o alocador do Linux costuma ficar com a
    memória reservada — malloc_trim faz ela voltar (senão o pico vira permanente)."""
    gc.collect()
    try:
        import ctypes
        ctypes.CDLL("libc.so.6").malloc_trim(0)
    except Exception:
        pass


def limitar_duracao(audio, sr, max_s=LIMITE_ANALISE_S):
    """Corta o áudio em `max_s` segundos. Devolve (audio, aviso) — aviso em ASCII
    (vai em header HTTP) ou None."""
    if audio is not None and len(audio) > int(max_s * sr):
        return audio[: int(max_s * sr)], f"cortado_{max_s}s"
    return audio, None


def _trecho_central(audio, sr, segundos):
    """Devolve até `segundos` do meio do áudio (evita intro/silêncio no começo)."""
    n = int(segundos * sr)
    if len(audio) <= n:
        return audio
    ini = (len(audio) - n) // 2
    return audio[ini:ini + n]


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


def _caminho_ffmpeg():
    """ffmpeg embutido via pip (imageio-ffmpeg) — não depende de o servidor ter
    ffmpeg instalado. Se não houver, tenta o ffmpeg do sistema."""
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return shutil.which("ffmpeg")


def _decodificar_com_ffmpeg(caminho, sr_alvo=22050):
    """Decodifica QUALQUER formato (WebM/Opus do Chrome, MP4/AAC do Safari, M4A...)
    direto pro ffmpeg, já em mono e 22050 Hz. Devolve (audio, sr) ou (None, None)."""
    exe = _caminho_ffmpeg()
    if not exe:
        return None, None
    try:
        proc = subprocess.run(
            [exe, "-v", "error", "-i", caminho, "-vn", "-ac", "1", "-ar", str(sr_alvo), "-f", "f32le", "-"],
            capture_output=True, timeout=90,
        )
        if proc.returncode != 0 or len(proc.stdout) < 8:
            return None, None
        return np.frombuffer(proc.stdout, dtype="<f4").copy(), sr_alvo
    except Exception:
        return None, None


def carregar_audio_bytes(dados: bytes, nome_arquivo: str = "audio.wav"):
    """Lê bytes de áudio (upload) e devolve (audio, sr) em 22050 Hz mono.
    Cadeia de tentativas, da mais rápida pra mais abrangente:
      1) soundfile — WAV, FLAC, OGG, MP3 (rápido, sem processo externo)
      2) ffmpeg embutido — WebM/Opus (gravador do Chrome), MP4/AAC (Safari/iPhone), M4A
      3) librosa.load  4) pydub
    O gravador do navegador já manda WAV (ver recorder.js), então na prática o
    passo 1 resolve; os outros cobrem arquivos enviados em outros formatos."""
    if not dados:
        return None, None
    ext = os.path.splitext(nome_arquivo)[1] or ".wav"
    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
        tmp.write(dados)
        tmp_path = tmp.name

    audio, sr = None, None
    try:
        try:
            import soundfile as sf
            audio, sr = sf.read(tmp_path, dtype="float32")
            if audio.ndim > 1:
                audio = audio.mean(axis=1)
            if sr != 22050:
                audio = librosa.resample(audio, orig_sr=sr, target_sr=22050)
                sr = 22050
        except Exception:
            audio, sr = None, None

        if audio is None:
            audio, sr = _decodificar_com_ffmpeg(tmp_path)

        if audio is None:
            try:
                audio, sr = librosa.load(tmp_path, sr=22050, mono=True)
            except Exception:
                audio, sr = None, None

        if audio is None:
            try:
                from pydub import AudioSegment
                segmento = AudioSegment.from_file(tmp_path).set_frame_rate(22050).set_channels(1)
                amostras = np.array(segmento.get_array_of_samples(), dtype=np.float32)
                amostras /= float(1 << (8 * segmento.sample_width - 1))
                audio, sr = amostras, 22050
            except Exception:
                audio, sr = None, None
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass

    if audio is None or len(audio) == 0:
        return None, None
    return audio.astype(np.float32), int(sr)


# ══════════════════ PITCH ══════════════════
def extrair_pitch(audio, sr):
    """Pitch (F0) via pyin, processado em blocos de BLOCO_PITCH_S segundos.
    O pyin rodando no áudio inteiro gasta memória proporcional à duração
    (medido: 180 s -> 671 MB). Em blocos, o pico fica constante. Cada bloco tem
    um múltiplo exato do hop (512), então os tempos batem com a versão sem blocos;
    o último quadro de cada bloco (duplicado pelo `center=True`) é descartado."""
    hop = 512
    bloco = (int(BLOCO_PITCH_S * sr) // hop) * hop
    n = len(audio)

    limites = [(ini, min(ini + bloco, n)) for ini in range(0, n, bloco)]
    # um resto minúsculo no fim não dá pro pyin (precisa de > frame_length/2): funde no bloco anterior
    if len(limites) > 1 and (limites[-1][1] - limites[-1][0]) < 4096:
        ini_ult, fim_ult = limites.pop()
        ini_ant, _ = limites.pop()
        limites.append((ini_ant, fim_ult))

    f0_partes, voz_partes = [], []
    for i, (ini, fim) in enumerate(limites):
        f0_b, voiced_b, _ = librosa.pyin(audio[ini:fim], fmin=80, fmax=1000, sr=sr,
                                         frame_length=2048, hop_length=hop)
        if i < len(limites) - 1:          # quadro final = início do próximo bloco
            f0_b, voiced_b = f0_b[:-1], voiced_b[:-1]
        f0_partes.append(f0_b)
        voz_partes.append(voiced_b)

    f0 = np.concatenate(f0_partes)
    voiced = np.concatenate(voz_partes)
    tempos = librosa.times_like(f0, sr=sr, hop_length=hop)
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
    vazio = {"nota_predominante": "—", "desvio_medio_cents": 0.0, "tendencia": "—", "base_desvio": "", "metodo": 2, "limite_afinado_cents": 25,
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
        # modo REFERÊNCIA (o aluno escolheu cantar contra uma nota): régua única, a nota de referência
        f_ref = f0_para_freq(nota_ref, calibracao)
        cents = 1200 * np.log2(f0_voz / f_ref)
        base_desvio = f"referência {nota_ref}"
    else:
        # modo NOTA DETECTADA: cada instante é medido contra a nota (semitom) mais próxima, como um afinador.
        # Vale para uma nota sustentada, uma escala ou uma melodia — antes tudo era comparado a UMA nota só,
        # e uma escala perfeitamente afinada saía com ~350 cents de "erro".
        midi_voz = 69 + 12 * np.log2(f0_voz / calibracao)
        cents = 100 * (midi_voz - np.round(midi_voz))
        base_desvio = "nota mais próxima"
    desvio_medio = float(np.mean(np.abs(cents)))
    desvio_sinal = float(np.mean(cents))
    # Medindo contra a nota mais próxima, o erro máximo possível é 50¢ — então "dentro de ±50¢" seria sempre 100%.
    # Nesse modo o limite de "afinado" é ±25¢; no modo referência continua ±50¢ (régua única).
    limite_afinado = 50 if nota_ref else 25
    pct_afinado = float(np.mean(np.abs(cents) <= limite_afinado) * 100)
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
            "base_desvio": base_desvio, "metodo": 2, "limite_afinado_cents": limite_afinado,
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


def extrair_notas_detalhadas(f0, tempos, calibracao=440.0, min_dur=0.15):
    """Como extrair_sequencia_notas, mas devolve também o desvio TÍPICO (mediana, em cents) de cada nota
    em relação à própria nota: [{"nota": "G3", "duracao_s": 0.8, "desvio_cents": -8.0}, ...]."""
    notas, atual, inicio, freqs = [], None, None, []

    def fechar(fim):
        if atual is not None and (fim - inicio) >= min_dur and freqs:
            alvo = librosa.note_to_midi(atual)
            cents = [100 * (69 + 12 * np.log2(f / calibracao) - alvo) for f in freqs]
            notas.append({"nota": atual, "duracao_s": round(fim - inicio, 2), "desvio_cents": round(float(np.median(cents)), 1)})

    for t, f in zip(tempos, f0):
        if f <= 0:
            fechar(t)
            atual, inicio, freqs = None, None, []
            continue
        n = librosa.hz_to_note(f)
        if n != atual:
            fechar(t)
            atual, inicio, freqs = n, t, []
        freqs.append(f)
    if atual is not None:
        fechar(tempos[-1])
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
def _bpm_beats_beat_track(audio, sr):
    """Método original (librosa.beat_track). Funciona bem com percussão/violão marcado; com melodia suave pode não achar batida nenhuma."""
    try:
        # BPM é estável ao longo da música: analisa até JANELA_TOM_BPM_S*2 segundos
        # (as batidas depois disso são extrapoladas pela grade do BPM abaixo).
        trecho = audio[: int(JANELA_TOM_BPM_S * 2 * sr)]
        tempo, beat_frames = librosa.beat.beat_track(y=trecho, sr=sr)
        bpm = float(np.atleast_1d(tempo)[0])
        if bpm < 50 or bpm > 200 or np.isnan(bpm):
            bpm = 90.0
        beat_times = np.asarray(librosa.frames_to_time(beat_frames, sr=sr), dtype=np.float64)
        # Se o áudio é mais longo que a janela analisada, continua a grade de
        # batidas até o fim com o intervalo mediano (a Produção usa as batidas
        # pra posicionar baixo/bateria na música toda).
        duracao = len(audio) / sr
        if len(beat_times) >= 2 and duracao > len(trecho) / sr + 0.5:
            intervalo = float(np.median(np.diff(beat_times)))
            if intervalo > 0:
                extras = np.arange(beat_times[-1] + intervalo, duracao, intervalo)
                beat_times = np.concatenate([beat_times, extras])
        return round(bpm, 1), beat_times
    except Exception:
        return 90.0, np.array([])


def _beats_confiaveis(bpm, beat_times):
    """As batidas achadas são regulares e batem com o andamento? (senão o método original falhou e caiu no chute de 90 BPM)"""
    if beat_times is None or len(beat_times) < 8:
        return False
    d = np.diff(beat_times)
    med = float(np.median(d))
    return med > 0 and float(np.std(d)) / med < 0.2 and abs(med - 60.0 / bpm) / (60.0 / bpm) < 0.15


def _bpm_beats_por_onsets(audio, sr, bpm_forcado=None):
    """Andamento e batidas pelos ataques das notas (vale para voz/melodia sem percussão): estima o andamento pela
    periodicidade dos ataques, refina andamento e fase com um 'pente' sobre os ataques e põe a 1ª batida no 1º ataque
    (quem grava costuma começar a música no tempo 1). Devolve None se não há ataques suficientes."""
    try:
        x = np.asarray(audio[: int(JANELA_TOM_BPM_S * 2 * sr)], dtype=np.float32)
        hop = 512
        o = librosa.onset.onset_strength(y=x, sr=sr, hop_length=hop)
        if len(o) < 40 or float(np.max(o)) < 1e-6:
            return None
        fr = sr / hop
        if bpm_forcado:                                                   # o usuário disse o andamento: só acha a fase das batidas
            tempo = float(bpm_forcado)
        else:
            tempo = float(librosa.feature.rhythm.tempo(onset_envelope=o, sr=sr, hop_length=hop, aggregate=np.median, start_bpm=100)[0])
            if not np.isfinite(tempo) or tempo <= 0:
                return None
            while tempo < 70:
                tempo *= 2
            while tempo > 150:
                tempo /= 2
        t_o = np.arange(len(o)) / fr
        melhor = (-1.0, tempo, 0.0)
        faixa = 0.015 if bpm_forcado else 0.04
        for t2 in np.linspace(tempo * (1 - faixa), tempo * (1 + faixa), 33):
            bl = 60.0 / t2
            for fase in np.linspace(0, bl, 32, endpoint=False):
                tb = np.arange(fase, t_o[-1], bl)
                if len(tb) < 4:
                    continue
                pont = float(np.interp(tb, t_o, o).mean())
                if pont > melhor[0]:
                    melhor = (pont, t2, fase)
        _, tempo, fase = melhor
        bl = 60.0 / tempo
        duracao = len(audio) / sr
        batidas = np.arange(fase, duracao, bl)
        fortes = np.where(o > 0.3 * float(np.max(o)))[0]                    # 1º ataque forte = começo da música
        t_inicio = float(t_o[fortes[0]]) if len(fortes) else 0.0
        batidas = batidas[batidas >= t_inicio - 0.5 * bl]
        if len(batidas) < 4:
            return None
        return round(float(tempo), 1), batidas.astype(np.float64)
    except Exception:
        return None


def detectar_bpm_e_beats(audio, sr, bpm_forcado=None):
    """bpm_forcado: andamento informado pelo usuário (se houver); senão detecta sozinho."""
    if bpm_forcado:
        alt = _bpm_beats_por_onsets(audio, sr, bpm_forcado)
        return alt if alt is not None else (round(float(bpm_forcado), 1), np.arange(0.0, len(audio) / sr, 60.0 / float(bpm_forcado)))
    bpm, beat_times = _bpm_beats_beat_track(audio, sr)
    if _beats_confiaveis(bpm, beat_times):
        return bpm, beat_times                                              # o método original funcionou: mantém
    alternativo = _bpm_beats_por_onsets(audio, sr)
    return alternativo if alternativo is not None else (bpm, beat_times)


def detectar_tom(audio, sr):
    try:
        chroma = librosa.feature.chroma_cqt(y=_trecho_central(audio, sr, JANELA_TOM_BPM_S),
                                            sr=sr, hop_length=1024)
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
                             calibracao: float = 440.0, nota_ref: str | None = None,
                             escala: dict | None = None):
    """Roda a análise completa (ou de cover) e devolve um dicionário pronto pra virar JSON.
    `escala` = {"tonica": "G#", "tipo": "lidio"} (opcional): avalia também quantas notas cantadas
    caíram dentro dessa escala (bloco "avaliacao_escala" na resposta).
    Inclui a curva de pitch já decimada (no máx. 300 pontos) para o gráfico do front-end."""
    audio, sr = carregar_audio_bytes(dados, nome_arquivo)
    if audio is None:
        return {"erro": "Não foi possível ler o áudio. Tente outro formato (WAV ou MP3)."}

    aviso_duracao = None
    duracao_total = len(audio) / sr
    if duracao_total > LIMITE_ANALISE_S:
        audio = audio[: int(LIMITE_ANALISE_S * sr)]
        aviso_duracao = (f"Gravação de {duracao_total:.0f}s: analisei os primeiros "
                         f"{LIMITE_ANALISE_S}s (limite do servidor gratuito).")

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
        liberar_memoria()
        return {"modo": "cover", "resultado": cover, "curva_pitch": curva_pitch,
                "aviso_duracao": aviso_duracao}

    resultado = analisar_afinacao(f0_limpo, tempos, calibracao, nota_ref=nota_ref)
    seq_notas = extrair_notas_detalhadas(f0_limpo, tempos, calibracao)
    avaliacao_escala = None
    if escala and escala.get("tonica") and escala.get("tipo"):
        try:
            import escalas
            avaliacao_escala = escalas.avaliar_canto(seq_notas, escala["tonica"], escala["tipo"])
        except Exception as e:
            avaliacao_escala = {"erro": f"Não consegui avaliar na escala: {e}"}
    vibratos = detectar_vibrato_v4(f0_limpo, tempos, calibracao_a4=calibracao)
    vibratos_json = [
        {**v, "classificacao": classificar_vibrato_v4(v["taxa_hz"], v["extensao_cents"], v["deslize_cents"], v["periodicidade"])}
        for v in vibratos
    ]
    liberar_memoria()
    return {
        "modo": "completa",
        "resultado": resultado,
        "sequencia_notas": seq_notas[:24],
        "avaliacao_escala": avaliacao_escala,
        "vibratos": vibratos_json,
        "curva_pitch": curva_pitch,
        "aviso_duracao": aviso_duracao,
    }



# ══════════════════ AQUECIMENTO (só no Render) ══════════════════
def aquecer_bibliotecas():
    """A 1ª análise depois de o servidor ligar gasta a maior parte do tempo
    carregando/compilando numba, scipy e cia (medido: 18 s de 19 s). Rodando uma
    análise mínima em segundo plano logo na inicialização, quem chegar depois
    já encontra tudo pronto."""
    try:
        t = np.linspace(0, 1.5, int(22050 * 1.5), endpoint=False)
        tom = (0.3 * np.sin(2 * np.pi * 220 * t)).astype(np.float32)
        for passo in (lambda: extrair_pitch(tom, 22050),
                      lambda: detectar_tom(tom, 22050),
                      lambda: detectar_bpm_e_beats(tom, 22050)):
            try:
                passo()
            except Exception:
                pass
    finally:
        liberar_memoria()

