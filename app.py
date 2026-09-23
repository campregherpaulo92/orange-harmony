# Orange Harmony — VocalAI Coach (Streamlit)
import os, json, re, base64, tempfile, io, time
from datetime import datetime
import numpy as np
import librosa
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import streamlit as st
# ── WebRTC (tempo real) — protegido: se o pacote faltar, o app não quebra ──
try:
    from streamlit_webrtc import webrtc_streamer, WebRtcMode
    import av
    TEM_WEBRTC = True
    ERRO_WEBRTC = ""
except Exception as e:
    TEM_WEBRTC = False
    ERRO_WEBRTC = str(e)
# ── Configuração da página (deve ser o primeiro comando do Streamlit) ──
st.set_page_config(page_title="Orange Harmony", page_icon="🍊", layout="wide")
# ── Gemini ──
from google import genai
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
cliente = genai.Client(api_key=GEMINI_API_KEY) if GEMINI_API_KEY else None
# ── Firebase ──
import firebase_admin
from firebase_admin import credentials, firestore
SERVICE_ACCOUNT_PATH = "firebase_service_account.json"
if not firebase_admin._apps:
    try:
        if os.environ.get("GOOGLE_APPLICATION_CREDENTIALS_JSON"):
            cred = credentials.Certificate(json.loads(os.environ["GOOGLE_APPLICATION_CREDENTIALS_JSON"]))
            firebase_admin.initialize_app(cred)
        elif os.path.exists(SERVICE_ACCOUNT_PATH):
            cred = credentials.Certificate(SERVICE_ACCOUNT_PATH)
            firebase_admin.initialize_app(cred)
    except Exception as e:
        st.warning(f"Firebase não conectado: {e}")
db = firestore.client() if firebase_admin._apps else None
COL_ANALISES = "orange_harmony_analises"
COL_COMPOSICOES = "orange_harmony_composicoes"
# ── Constantes musicais ──
NOMES_NOTAS = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"]
NOTAS_REFERENCIA = [f"{n}{o}" for o in range(2, 6) for n in NOMES_NOTAS]
ESCALA_MAIOR = [0, 2, 4, 5, 7, 9, 11, 12]
def f0_para_midi_calibrado(f0, calibracao=440.0):
    return 69 + 12 * np.log2(f0 / calibracao)
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
def analisar_afinacao(f0_limpo, tempos, calibracao=440.0):
    mascara = f0_limpo > 0
    vazio = {"nota_predominante": "—", "desvio_medio_cents": 0.0, "tendencia": "—",
             "desvio_sinal_cents": 0.0, "pct_afinado": 0.0, "num_frases": 0,
             "sustentacao_media": 0.0, "num_pausas": 0, "pausa_media": 0.0}
    if mascara.sum() == 0:
        return vazio
    f0_voz = f0_limpo[mascara]
    midi = f0_para_midi_calibrado(f0_voz, calibracao)
    midi_arred = np.round(midi)
    cents = 1200 * np.log2(f0_voz / (calibracao * 2 ** ((midi_arred - 69) / 12)))
    desvio_medio = float(np.mean(np.abs(cents)))
    desvio_sinal = float(np.mean(cents))
    pct_afinado = float(np.mean(np.abs(cents) <= 50) * 100)
    segmentos = segmentar_notas(f0_limpo, tempos)
    f0_pred = float(np.median([np.median(s[s > 0]) for s in segmentos])) if segmentos else float(np.median(f0_voz))
    midi_pred = f0_para_midi_calibrado(f0_pred, calibracao)
    midi_arred_pred = int(round(midi_pred))
    nota_pred = f"{NOMES_NOTAS[midi_arred_pred % 12]}{midi_arred_pred // 12 - 1}"
    tendencia = "neutra (bem centrada)" if abs(desvio_sinal) < 10 else ("agudo (sharp)" if desvio_sinal > 0 else "grave (flat)")
    dt = tempos[1] - tempos[0] if len(tempos) > 1 else 0.01
    mudancas = np.diff(mascara.astype(int))
    inicios = np.where(mudancas == 1)[0] + 1
    fins = np.where(mudancas == -1)[0] + 1
    if mascara[0]:
        inicios = np.concatenate(([0], inicios))
    if mascara[-1]:
        fins = np.concatenate((fins, [len(mascara)]))
    frases = [(f - i) * dt for i, f in zip(inicios, fins) if (f - i) * dt >= 0.3]
    pausas = [ (inicios[k+1] - fins[k]) * dt for k in range(len(fins)-1) if (inicios[k+1] - fins[k]) * dt >= 0.3 ]
    return {"nota_predominante": nota_pred, "desvio_medio_cents": desvio_medio,
            "tendencia": tendencia, "desvio_sinal_cents": desvio_sinal,
            "pct_afinado": pct_afinado, "num_frases": len(frases),
            "sustentacao_media": float(np.mean(frases)) if frases else 0.0,
            "num_pausas": len(pausas), "pausa_media": float(np.mean(pausas)) if pausas else 0.0}
def analisar_afinador(audio, sr, calibracao=440.0):
    f0, voiced, _ = librosa.pyin(audio, fmin=60, fmax=1000, sr=sr, frame_length=2048, hop_length=512)
    f0_validos = f0[voiced & ~np.isnan(f0)]
    if len(f0_validos) == 0:
        return "—", 0.0, "sem sinal"
    freq = float(np.median(f0_validos))
    midi = f0_para_midi_calibrado(freq, calibracao)
    midi_arred = int(round(midi))
    nota = f"{NOMES_NOTAS[midi_arred % 12]}{midi_arred // 12 - 1}"
    cents = 1200 * np.log2(freq / (calibracao * 2 ** ((midi_arred - 69) / 12)))
    return nota, cents, ("AFINADO" if abs(cents) <= 10 else ("PRÓXIMO" if abs(cents) <= 25 else "DESAFINADO"))
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
# ══════════════════ PRODUÇÃO (BPM, TOM, BAIXO E BATERIA) ══════════════════
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
def nota_para_midi(nome, oitava):
    return 12 * (oitava + 1) + NOMES_NOTAS.index(nome)
def midi_para_freq(midi, calibracao=440.0):
    return calibracao * 2 ** ((midi - 69) / 12)
def gerar_kick(sr, volume=0.95):
    n = int(sr * 0.3)
    t = np.linspace(0, 0.3, n, endpoint=False)
    freq = 50 * np.exp(-20 * t) + 40
    fase = 2 * np.pi * np.cumsum(freq) / sr
    sinal = np.sin(fase)
    click = np.exp(-60 * t) * np.sin(2 * np.pi * 800 * t) * 0.3
    env = np.exp(-10 * t)
    return ((sinal + click) * env * volume).astype(np.float32)
def gerar_snare(sr, volume=0.7):
    n = int(sr * 0.25)
    t = np.linspace(0, 0.25, n, endpoint=False)
    ruido = np.random.default_rng(42).standard_normal(n)
    ruido_f = np.diff(ruido, prepend=0)
    tom = np.sin(2 * np.pi * 180 * t) * 0.4
    corpo = np.sin(2 * np.pi * 320 * t) * np.exp(-30 * t) * 0.3
    env = np.exp(-16 * t)
    return ((0.6 * ruido_f + tom + corpo) * env * volume).astype(np.float32)
def gerar_hat(sr, volume=0.4):
    n = int(sr * 0.1)
    t = np.linspace(0, 0.1, n, endpoint=False)
    ruido = np.random.default_rng(7).standard_normal(n)
    sinal = np.diff(ruido, prepend=0)
    env = np.exp(-35 * t)
    return (sinal * env * volume).astype(np.float32)
def gerar_crash(sr, volume=0.5):
    n = int(sr * 1.2)
    t = np.linspace(0, 1.2, n, endpoint=False)
    ruido = np.random.default_rng(99).standard_normal(n)
    sinal = np.diff(ruido, prepend=0)
    env = np.exp(-2.5 * t)
    return (sinal * env * volume).astype(np.float32)
def gerar_nota_baixo_encorpada(freq, duracao, sr, volume=0.55):
    n = int(sr * duracao)
    t = np.linspace(0, duracao, n, endpoint=False)
    sinal = (np.sin(2 * np.pi * freq * t)
             + 0.5 * np.sin(2 * np.pi * 2 * freq * t)
             + 0.3 * np.sin(2 * np.pi * 3 * freq * t)
             + 0.15 * np.sin(2 * np.pi * 4 * freq * t))
    env = np.exp(-2.0 * t / duracao)
    sinal = np.tanh(1.5 * sinal * env)
    return (sinal * volume).astype(np.float32)
def gerar_baixo_melodico(audio, sr, tom, bpm, beat_times):
    sr = int(sr)
    bpm = float(bpm)
    duracao_total = float(len(audio)) / sr
    if duracao_total <= 0:
        return np.zeros(1, dtype=np.float32)
    n_total = int(sr * duracao_total)
    trilha = np.zeros(n_total + sr, dtype=np.float32)
    raiz_midi = nota_para_midi(tom, 1)
    escala = [raiz_midi + i for i in [0, 2, 4, 5, 7, 9, 11]]
    f0, voiced, _ = librosa.pyin(audio, fmin=80, fmax=1000, sr=sr, frame_length=2048, hop_length=512)
    tempos_f0 = librosa.times_like(f0, sr=sr, hop_length=512)
    if beat_times is None or len(beat_times) == 0:
        seg_compasso = 60.0 / bpm * 4
        n_compassos = max(1, int(np.ceil(duracao_total / seg_compasso)))
        colcheia = seg_compasso / 8
        beat_times = np.array([c * seg_compasso + i * colcheia
                               for c in range(n_compassos) for i in range(8)])
    seg_compasso = 60.0 / bpm * 4
    colcheia = seg_compasso / 8
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
    for t in beat_times:
        if t >= duracao_total:
            break
        idx = int(t * sr)
        if idx >= n_total:
            break
        freq_mel = melodia_em(t)
        midi_nota = nota_baixo_para(freq_mel)
        freq = midi_para_freq(midi_nota)
        nota = gerar_nota_baixo_encorpada(freq, colcheia * 0.9, sr)
        fim = min(idx + len(nota), n_total + sr)
        if fim > idx:
            trilha[idx:fim] += nota[:fim - idx]
    return trilha[:n_total]
def gerar_bateria_ritmica(audio, sr, bpm, beat_times):
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
    onsets = librosa.onset.onset_detect(y=audio, sr=sr, hop_length=hop)
    onset_times = librosa.frames_to_time(onsets, sr=sr, hop_length=hop)
    if beat_times is None or len(beat_times) == 0:
        seg_compasso = 60.0 / bpm * 4
        n_compassos = max(1, int(np.ceil(duracao_total / seg_compasso)))
        colcheia = seg_compasso / 8
        beat_times = np.array([c * seg_compasso + i * colcheia
                               for c in range(n_compassos) for i in range(8)])
    seg_compasso = 60.0 / bpm * 4
    colcheia = seg_compasso / 8
    def energia_no_tempo(t):
        pos = int(np.searchsorted(rms_times, t))
        pos = min(max(pos, 0), len(rms_norm) - 1)
        return float(rms_norm[pos])
    def tocar(idx, amostra):
        fim = min(idx + len(amostra), n_total + sr)
        if fim > idx:
            trilha[idx:fim] += amostra[:fim - idx]
    for t in beat_times:
        if t >= duracao_total:
            break
        idx = int(t * sr)
        if idx >= n_total:
            break
        energia = energia_no_tempo(t)
        posicao = int(round((t % seg_compasso) / colcheia)) % 8
        tocar(idx, hat)
        if posicao in (0, 4):
            tocar(idx, kick)
        if posicao in (2, 6) and energia > 0.18:
            tocar(idx, snare)
        if posicao == 0 and int(t // seg_compasso) % 2 == 0:
            tocar(idx, crash)
        if energia > 0.55:
            t_extra = t + colcheia / 2
            if t_extra < duracao_total:
                tocar(int(t_extra * sr), hat)
    for t_onset in onset_times:
        if t_onset >= duracao_total:
            break
        idx = int(t_onset * sr)
        if idx >= n_total:
            break
        proximo = beat_times[beat_times >= t_onset - 0.05] if len(beat_times) else np.array([])
        if len(proximo) == 0 or (proximo[0] - t_onset) > 0.12:
            tocar(idx, hat)
    return trilha[:n_total]
def mixar(audio, baixo, bateria):
    total = audio.astype(np.float32)
    if baixo is not None:
        total = total + 0.6 * baixo
    if bateria is not None:
        total = total + 0.65 * bateria
    total = np.tanh(1.2 * total)
    pico = np.max(np.abs(total)) + 1e-9
    return (total / pico * 0.95).astype(np.float32)
def audio_para_bytes(audio, sr):
    import soundfile as sf
    buf = io.BytesIO()
    sf.write(buf, audio, sr, format="WAV")
    return buf.getvalue()
    # ══════════════════ COMPONENTES VISUAIS (glassmorphism) ══════════════════
def card_html(conteudo, classe="oh-card"):
    return f'<div class="{classe}">{conteudo}</div>'
def metricas_html(lista):
    cards = ""
    for rotulo, valor, sub in lista:
        cards += f'''
        <div class="oh-metric">
            <div class="oh-metric-label">{rotulo}</div>
            <div class="oh-metric-value">{valor}</div>
            <div class="oh-metric-sub">{sub}</div>
        </div>'''
    return f'<div class="oh-metric-grid">{cards}</div>'
def titulo_secao(icone, texto):
    return f'<div class="oh-section-title">{icone} {texto}</div>'
# ══════════════════ VELOCÍMETRO (agulha estilo velocímetro de carro) ══════════════════
def velocimetro_html(cents, nota):
    cents_c = max(-50.0, min(50.0, float(cents)))
    angulo = (cents_c / 50.0) * 90.0
    cor = "#22c55e" if abs(cents_c) <= 10 else ("#eab308" if abs(cents_c) <= 25 else "#ef4444")
    marcas = ""
    for v in [-50, -25, 0, 25, 50]:
        a = (v / 50.0) * 90.0
        rad = np.deg2rad(a)
        x1 = 110 + 78 * np.sin(rad)
        y1 = 110 - 78 * np.cos(rad)
        x2 = 110 + 88 * np.sin(rad)
        y2 = 110 - 88 * np.cos(rad)
        marcas += f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" stroke="#666" stroke-width="2"/>'
    return f'''<div style="display:flex;justify-content:center;">
<svg viewBox="0 0 220 130" width="340" style="background:rgba(255,255,255,0.03);backdrop-filter:blur(10px);border-radius:16px;border:1px solid rgba(255,255,255,0.08);box-shadow:0 8px 32px rgba(0,0,0,0.35);">
  <defs>
    <linearGradient id="gg" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#ef4444"/>
      <stop offset="30%" stop-color="#eab308"/>
      <stop offset="50%" stop-color="#22c55e"/>
      <stop offset="70%" stop-color="#eab308"/>
      <stop offset="100%" stop-color="#ef4444"/>
    </linearGradient>
  </defs>
  <path d="M 20 110 A 90 90 0 0 1 200 110" fill="none" stroke="url(#gg)" stroke-width="16" stroke-linecap="round"/>
  {marcas}
  <g transform="rotate({angulo:.1f} 110 110)">
    <line x1="110" y1="110" x2="110" y2="34" stroke="{cor}" stroke-width="5" stroke-linecap="round"/>
  </g>
  <circle cx="110" cy="110" r="9" fill="{cor}"/>
  <text x="110" y="92" text-anchor="middle" fill="#ffffff" font-size="26" font-weight="bold">{nota}</text>
  <text x="110" y="122" text-anchor="middle" fill="#bbbbbb" font-size="13">{cents_c:+.0f} cents</text>
</svg></div>'''
# ══════════════════ AFINADOR TEMPO REAL (WebRTC) ══════════════════
def _detectar_pitch_autocorr(amostras, sr):
    n = len(amostras)
    if n < 256:
        return None
    x = amostras - np.mean(amostras)
    corr = np.correlate(x, x, mode="full")[n - 1:]
    lag_min = max(1, int(sr / 1000))
    lag_max = int(sr / 55)
    if lag_max >= len(corr):
        lag_max = len(corr) - 1
    if lag_max <= lag_min:
        return None
    faixa = corr[lag_min:lag_max + 1]
    pico = int(np.argmax(faixa)) + lag_min
    if corr[pico] <= 0 or pico <= 0:
        return None
    return sr / pico
def _freq_para_nota_cents(freq, calibracao=440.0):
    midi = 69 + 12 * np.log2(freq / calibracao)
    midi_arred = int(round(midi))
    nota = f"{NOMES_NOTAS[midi_arred % 12]}{midi_arred // 12 - 1}"
    cents = 1200 * np.log2(freq / (calibracao * 2 ** ((midi_arred - 69) / 12)))
    return nota, cents
estado_afinador = {"nota": "—", "cents": 0.0, "ativo": False,
                   "calibracao": 440.0, "buffer": np.zeros(0, dtype=np.float32)}
def _processar_frame_audio(frame):
    """Callback chamado a cada frame de áudio recebido do microfone."""
    arr = frame.to_ndarray()
    if arr.ndim == 2:
        arr = arr.mean(axis=0)
    arr = arr.astype(np.float32)
    fmt = getattr(frame.format, "name", "fltp")
    if fmt.startswith("s"):
        arr = arr / 32768.0
    buf = np.concatenate([estado_afinador["buffer"], arr])
    max_len = int(frame.rate * 0.6)
    if len(buf) > max_len:
        buf = buf[-max_len:]
    estado_afinador["buffer"] = buf
    if len(buf) >= 2048:
        freq = _detectar_pitch_autocorr(buf[-2048:], frame.rate)
        if freq is not None:
            nota, cents = _freq_para_nota_cents(freq, estado_afinador["calibracao"])
            estado_afinador["nota"] = nota
            estado_afinador["cents"] = cents
            estado_afinador["ativo"] = True
    return frame
# ══════════════════ PROFESSOR (Gemini) ══════════════════
def montar_prompt_professor(resultado):
    return (
        "Você é um professor de canto experiente e acolhedor. Analise os dados técnicos "
        "de uma gravação vocal e dê um parecer em 3 seções: PONTOS FORTES, PONTOS A MELHORAR "
        "e UM EXERCÍCIO PRÁTICO. Seja específico e encorajador.\n\n"
        f"Dados da análise:\n"
        f"- Nota predominante: {resultado['nota_predominante']}\n"
        f"- Desvio médio absoluto: {resultado['desvio_medio_cents']:.1f} cents\n"
        f"- Tendência: {resultado['tendencia']} ({resultado['desvio_sinal_cents']:+.1f} cents)\n"
        f"- Percentual afinado (±50 cents): {resultado['pct_afinado']:.1f}%\n"
        f"- Frases sustentadas: {resultado['num_frases']} (média {resultado['sustentacao_media']:.2f} s)\n"
        f"- Pausas respiratórias: {resultado['num_pausas']} (média {resultado['pausa_media']:.2f} s)"
    )
# ══════════════════ HISTÓRICO (Firestore) ══════════════════
def registrar_analise_firestore(resultado, modo="Análise completa", tom_ref=None):
    if db is None:
        return None
    doc = {"data": datetime.now().isoformat(), "modo": modo,
           "nota_predominante": resultado.get("nota_predominante", ""),
           "desvio_medio_cents": round(resultado.get("desvio_medio_cents", 0), 1),
           "tendencia": resultado.get("tendencia", ""),
           "pct_afinado": round(resultado.get("pct_afinado", 0), 1),
           "num_frases": resultado.get("num_frases", 0),
           "sustentacao_media": round(resultado.get("sustentacao_media", 0), 2),
           "num_pausas": resultado.get("num_pausas", 0), "tom_ref": tom_ref or ""}
    db.collection(COL_ANALISES).add(doc)
    return doc
def carregar_historico_firestore():
    if db is None:
        return []
    docs = db.collection(COL_ANALISES).order_by("data", direction=firestore.Query.DESCENDING).limit(100).stream()
    return [d.to_dict() for d in docs]
# ══════════════════ COMPOSIÇÕES ══════════════════
def classificar_secoes(letra):
    tipos = {"verso": 0, "pré-refrão": 0, "refrão": 0, "ponte": 0, "intro": 0, "solo": 0, "final": 0}
    for linha in letra.splitlines():
        s = linha.strip().lstrip("#").strip().lower()
        for t in tipos:
            if s.startswith(t):
                tipos[t] += 1
                break
    return {k: v for k, v in tipos.items() if v > 0}
def salvar_composicao_firestore(titulo, tom, letra):
    if db is None:
        return "⚠️ Firebase não conectado."
    if not titulo.strip():
        return "⚠️ Digite um título para a composição."
    if not letra.strip():
        return "⚠️ Digite a letra da composição."
    docs = db.collection(COL_COMPOSICOES).where("titulo", "==", titulo.strip()).stream()
    versoes = [d.to_dict().get("versao", 0) for d in docs]
    nova_versao = max(versoes) + 1 if versoes else 1
    secoes = classificar_secoes(letra)
    doc = {"titulo": titulo.strip(), "tom": (tom or "").strip(), "letra": letra,
           "versao": nova_versao, "data": datetime.now().isoformat(), "secoes": secoes}
    db.collection(COL_COMPOSICOES).add(doc)
    resumo = ", ".join(f"{v} {k}(s)" for k, v in secoes.items()) if secoes else "sem seções marcadas"
    return f"✅ '{titulo.strip()}' v{nova_versao} salva! Seções: {resumo}"
def listar_composicoes():
    if db is None:
        return []
    docs = db.collection(COL_COMPOSICOES).order_by("data", direction=firestore.Query.DESCENDING).limit(100).stream()
    return [(d.to_dict().get("titulo", "?"), d.to_dict().get("versao", 1), d.id) for d in docs]
def carregar_composicao(doc_id):
    if not doc_id:
        return "", "", ""
    doc = db.collection(COL_COMPOSICOES).document(doc_id).get()
    if not doc.exists:
        return "", "", ""
    dados = doc.to_dict()
    return dados.get("titulo", ""), dados.get("tom", ""), dados.get("letra", "")
def renderizar_composicao_html(letra):
    import html as html_mod
    letra_esc = html_mod.escape(letra)
    letra_html = re.sub(r"\[([A-G](#|b)?[a-z0-9/]*)\]",
                        r'<span style="color:#f97316;font-weight:700;">[\1]</span>', letra_esc)
    linhas = []
    for linha in letra_html.split("\n"):
        if linha.strip().startswith("#"):
            linhas.append(f'<div style="color:#f97316;font-weight:800;font-size:1.15em;margin-top:14px;">{linha.strip().lstrip("#").strip()}</div>')
        elif linha.strip() == "":
            linhas.append('<div style="height:10px;"></div>')
        else:
            linhas.append(f'<div style="color:#ffffff;">{linha}</div>')
    return (f'<div style="background:rgba(255,255,255,0.03);backdrop-filter:blur(10px);color:#ffffff;padding:20px;border-radius:16px;'
            f'font-family:monospace;line-height:1.7;border:1px solid rgba(255,255,255,0.08);box-shadow:0 8px 32px rgba(0,0,0,0.35);">{"".join(linhas)}</div>')
# ══════════════════ AFINADOR ══════════════════
AFINACOES = {
    "Padrão (EADGBE)": ["E2", "A2", "D3", "G3", "B3", "E4"],
    "Drop D (DADGBE)": ["D2", "A2", "D3", "G3", "B3", "E4"],
    "Drop C (CGCFAD)": ["C2", "G2", "C3", "F3", "A3", "D4"],
    "Drop B (BEADF#B)": ["B1", "E2", "A2", "D3", "F#3", "B3"],
    "Meio tom abaixo (Eb)": ["Eb2", "Ab2", "Db3", "Gb3", "Bb3", "Eb4"],
    "Open G (DGDGBD)": ["D2", "G2", "D3", "G3", "B3", "D4"],
    "DADGAD": ["D2", "A2", "D3", "G3", "A3", "D4"],
    "Open D (DADF#AD)": ["D2", "A2", "D3", "F#3", "A3", "D4"],
    "Open C (CGCGCE)": ["C2", "G2", "C3", "G3", "C4", "E4"],
    "Padrão 7 cordas (BEADGBE)": ["B1", "E2", "A2", "D3", "G3", "B3", "E4"],
    "Ukulele (GCEA)": ["G4", "C4", "E4", "A4"],
}
DESCRICOES_AFINACOES = {
    "Padrão (EADGBE)": "Afinação clássica do violão — a base de tudo.",
    "Drop D (DADGBE)": "6ª corda desce para D. Poderosa para riffs e acordes com pestana grave. Muito usada em rock e metal.",
    "Drop C (CGCFAD)": "Versão mais grave do Drop D. Tom pesado, comum em metal moderno.",
    "Drop B (BEADF#B)": "Ainda mais grave que o Drop C. Metal extremo e sonoridade densa.",
    "Meio tom abaixo (Eb)": "Todas as cordas meio tom abaixo. Tom mais encorpado, clássico do rock (Guns, Van Halen).",
    "Open G (DGDGBD)": "Acorde de G solto. Perfeita para blues, slide e violão de dedo.",
    "DADGAD": "Afinação modal, dedilhados abertos e sonoridade celta/folk. Ótima para violão solo.",
    "Open D (DADF#AD)": "Acorde de D solto. Muito usada em folk, blues e slide.",
    "Open C (CGCGCE)": "Acorde de C solto. Rica para fingerstyle e composições com cordas soltas.",
    "Padrão 7 cordas (BEADGBE)": "Violão/guitarra de 7 cordas — adiciona o grave B1 na 7ª corda.",
    "Ukulele (GCEA)": "Afinação padrão do ukulele (soprano/concert).",
}
NOME_PARA_MIDI = {n: i for i, n in enumerate(NOMES_NOTAS)}
def nota_para_freq(nota, calibracao=440.0):
    nome = nota[:-1]
    oitava = int(nota[-1])
    midi = 12 * (oitava + 1) + NOME_PARA_MIDI[nome]
    return calibracao * 2 ** ((midi - 69) / 12)
def extrair_pitch_rapido(audio, sr):
    if audio is None or len(audio) < int(sr * 0.1):
        return None
    f0, voiced, _ = librosa.pyin(audio, fmin=60, fmax=1000, sr=sr, frame_length=2048, hop_length=512)
    f0_validos = f0[voiced & ~np.isnan(f0)]
    if len(f0_validos) == 0:
        return None
    return float(np.median(f0_validos))
def barra_cents_html(cents):
    pos = max(0.0, min(100.0, (cents + 50) / 100 * 100))
    cor = "#22c55e" if abs(cents) <= 10 else ("#eab308" if abs(cents) <= 25 else "#ef4444")
    return (f'<div style="background:rgba(255,255,255,0.04);border-radius:10px;height:26px;position:relative;border:1px solid rgba(255,255,255,0.1);margin-top:6px;">'
            f'<div style="position:absolute;left:50%;top:0;bottom:0;width:2px;background:#666;"></div>'
            f'<div style="position:absolute;left:{pos}%;top:0;bottom:0;width:6px;background:{cor};border-radius:3px;transform:translateX(-50%);"></div>'
            f'<div style="position:absolute;left:0;top:0;bottom:0;width:50%;border-right:1px solid #444;"></div></div>')
def afinar_stream(audio, afincao, calibracao):
    if audio is None:
        return "—", "—", "Aguardando áudio...", barra_cents_html(0)
    if isinstance(audio, tuple):
        sr, dados = audio[0], audio[1]
    else:
        sr, dados = 22050, audio
    dados = np.asarray(dados, dtype=np.float32)
    freq = extrair_pitch_rapido(dados, sr)
    if freq is None:
        return "—", "—", "Toque ou cante uma nota...", barra_cents_html(0)
    melhor = None
    for nota_alvo in AFINACOES[afincao]:
        f_alvo = nota_para_freq(nota_alvo, calibracao)
        cents = 1200 * np.log2(freq / f_alvo)
        if melhor is None or abs(cents) < abs(melhor[1]):
            melhor = (nota_alvo, cents)
    nota_alvo, cents = melhor
    if abs(cents) <= 10:
        status = "✅ AFINADO"
    elif abs(cents) <= 25:
        status = "🟡 PRÓXIMO"
    else:
        status = "🔴 DESAFINADO"
    direcao = "↑ agudo (afrouxe)" if cents > 0 else "↓ grave (aperte)"
    return nota_alvo, f"{cents:+.1f}", f"{nota_alvo} — {cents:+.1f} cents — {direcao} — {status}", barra_cents_html(cents)
    # ══════════════════ FUNÇÕES DE ÁUDIO ══════════════════
def carregar_audio(uploaded):
    """Lê um arquivo enviado (upload ou gravação) e devolve (audio, sr) em 22050 Hz mono."""
    if uploaded is None:
        return None, None
    dados = uploaded.getvalue()
    if not dados:
        return None, None
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        tmp.write(dados)
        tmp_path = tmp.name
    try:
        audio, sr = librosa.load(tmp_path, sr=22050, mono=True)
    except Exception:
        try:
            import soundfile as sf
            audio, sr = sf.read(tmp_path, dtype="float32")
            if audio.ndim > 1:
                audio = audio.mean(axis=1)
            if sr != 22050:
                audio = librosa.resample(audio, orig_sr=sr, target_sr=22050)
                sr = 22050
        except Exception:
            return None, None
    return audio.astype(np.float32), int(sr)
def gerar_tom_referencia(nota, calibracao):
    nome, oitava = nota[:-1], int(nota[-1])
    midi = 12 * (oitava + 1) + NOMES_NOTAS.index(nome)
    freq = calibracao * 2 ** ((midi - 69) / 12)
    sr = 22050
    duracao = 1.5
    t = np.linspace(0, duracao, int(sr * duracao), endpoint=False)
    sinal = (np.sin(2 * np.pi * freq * t) + 0.3 * np.sin(2 * np.pi * 2 * freq * t) + 0.1 * np.sin(2 * np.pi * 3 * freq * t))
    ataque, release = int(sr * 0.05), int(sr * 0.2)
    env = np.ones_like(sinal)
    env[:ataque] = np.linspace(0, 1, ataque)
    env[-release:] = np.linspace(1, 0, release)
    return (sr, (sinal * env).astype(np.float32))
def gerar_escala(nota, calibracao):
    nome, oitava = nota[:-1], int(nota[-1])
    midi_raiz = 12 * (oitava + 1) + NOMES_NOTAS.index(nome)
    sr = 22050
    duracao_nota, pausa = 0.8, 0.15
    silencio = np.zeros(int(sr * pausa))
    trechos = []
    for intervalo in ESCALA_MAIOR:
        midi = midi_raiz + intervalo
        freq = calibracao * 2 ** ((midi - 69) / 12)
        t = np.linspace(0, duracao_nota, int(sr * duracao_nota), endpoint=False)
        sinal = (np.sin(2 * np.pi * freq * t) + 0.3 * np.sin(2 * np.pi * 2 * freq * t) + 0.1 * np.sin(2 * np.pi * 3 * freq * t))
        ataque, release = int(sr * 0.03), int(sr * 0.1)
        env = np.ones_like(sinal)
        env[:ataque] = np.linspace(0, 1, ataque)
        env[-release:] = np.linspace(1, 0, release)
        trechos.append(sinal * env)
        trechos.append(silencio)
    return (sr, np.concatenate(trechos).astype(np.float32))
# ══════════════════ CSS / TEMA (glassmorphism premium) ══════════════════
st.markdown("""
<style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap');
    .stApp {
        font-family: 'Inter', sans-serif;
        background:
            radial-gradient(1200px 800px at 85% -10%, rgba(249,115,22,0.14), transparent 60%),
            radial-gradient(1000px 700px at -10% 110%, rgba(249,115,22,0.10), transparent 55%),
            radial-gradient(800px 600px at 50% 50%, rgba(255,255,255,0.02), transparent 70%),
            #0a0a0a;
    }
    h1, h2, h3, h4 { color: #f97316 !important; font-weight: 800; letter-spacing: -0.02em; }
    .block-container { padding-top: 1.5rem; max-width: 1200px; }

    .stButton > button {
        background: linear-gradient(135deg, #f97316, #ea580c);
        color: #fff;
        border: none;
        border-radius: 12px;
        font-weight: 700;
        box-shadow: 0 4px 18px rgba(249,115,22,0.35);
        transition: all 0.25s ease;
    }
    .stButton > button:hover {
        transform: translateY(-2px);
        box-shadow: 0 8px 28px rgba(249,115,22,0.5);
    }
    .stButton > button:active { transform: translateY(0); }

    .stTextInput input, .stTextArea textarea,
    .stSelectbox div[data-baseweb="select"] > div,
    .stNumberInput input {
        background: rgba(255,255,255,0.05);
        color: #f2f2f2;
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 12px;
        backdrop-filter: blur(8px);
    }
    label { color: #d9d9d9 !important; font-weight: 600; }

    .stTabs [data-baseweb="tab-list"] { gap: 8px; }
    .stTabs [data-baseweb="tab"] {
        background: rgba(255,255,255,0.04);
        backdrop-filter: blur(10px);
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 14px 14px 0 0;
        color: #d9d9d9;
        padding: 0.6rem 1.1rem;
        font-weight: 600;
        transition: all 0.2s ease;
    }
    .stTabs [data-baseweb="tab"]:hover { background: rgba(255,255,255,0.08); }
    .stTabs [aria-selected="true"] {
        background: linear-gradient(135deg, #f97316, #ea580c);
        color: #fff !important;
        box-shadow: 0 4px 18px rgba(249,115,22,0.35);
    }

    .oh-metric-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
        gap: 14px;
        margin: 16px 0;
        animation: ohFadeIn 0.5s ease;
    }
    .oh-metric {
        background: linear-gradient(150deg, rgba(249,115,22,0.14), rgba(255,255,255,0.03));
        border: 1px solid rgba(249,115,22,0.22);
        border-radius: 16px;
        padding: 18px 14px;
        text-align: center;
        backdrop-filter: blur(12px);
        box-shadow: 0 8px 24px rgba(0,0,0,0.3);
        transition: transform 0.25s ease, box-shadow 0.25s ease;
    }
    .oh-metric:hover { transform: translateY(-4px); box-shadow: 0 14px 34px rgba(249,115,22,0.25); }
    .oh-metric-label { font-size: 0.75rem; color: #f97316; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; }
    .oh-metric-value { font-size: 1.6rem; font-weight: 800; color: #fff; margin: 6px 0 2px; }
    .oh-metric-sub { font-size: 0.78rem; color: #aaa; }

    .oh-card {
        background: rgba(255,255,255,0.04);
        backdrop-filter: blur(14px);
        border: 1px solid rgba(255,255,255,0.09);
        border-radius: 18px;
        padding: 20px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.35);
        animation: ohFadeIn 0.5s ease;
    }
    .oh-section-title {
        font-size: 1.05rem;
        font-weight: 800;
        color: #f97316;
        margin: 18px 0 10px;
        letter-spacing: -0.01em;
    }

    @keyframes ohFadeIn {
        from { opacity: 0; transform: translateY(14px); }
        to { opacity: 1; transform: none; }
    }
    @keyframes ohPulse {
        0%, 100% { box-shadow: 0 0 0 0 rgba(249,115,22,0.45); }
        50% { box-shadow: 0 0 0 14px rgba(249,115,22,0); }
    }
    .oh-pulse { animation: ohPulse 2s infinite; }

    .stDataFrame { background: rgba(255,255,255,0.03); border-radius: 14px; border: 1px solid rgba(255,255,255,0.08); }
    .stAudio { border-radius: 14px; overflow: hidden; }

    [data-testid="stFileUploader"], [data-testid="stAudioInput"] {
        background: rgba(255,255,255,0.04);
        border: 1px dashed rgba(249,115,22,0.4);
        border-radius: 14px;
        padding: 8px;
        backdrop-filter: blur(8px);
    }
    [data-testid="stFileUploader"]:hover, [data-testid="stAudioInput"]:hover {
        border-color: #f97316;
    }

    .stSpinner > div { border-top-color: #f97316 !important; }
    [data-testid="stSuccess"] {
        background: linear-gradient(135deg, rgba(34,197,94,0.15), rgba(255,255,255,0.03));
        border: 1px solid rgba(34,197,94,0.3);
        border-radius: 12px;
        backdrop-filter: blur(8px);
    }
    [data-testid="stWarning"], [data-testid="stError"], [data-testid="stInfo"] {
        border-radius: 12px;
        backdrop-filter: blur(8px);
    }
</style>
""", unsafe_allow_html=True)
# ══════════════════ LOGO ══════════════════
LOGO_PATH = "logo_orange_harmony_transparente.png"
col_logo, _ = st.columns([1, 3])
if os.path.exists(LOGO_PATH):
    with open(LOGO_PATH, "rb") as f:
        logo_b64 = base64.b64encode(f.read()).decode()
    col_logo.markdown(f'<img src="data:image/png;base64,{logo_b64}" style="height:70px;width:auto;border-radius:12px;box-shadow:0 8px 28px rgba(249,115,22,0.3);">', unsafe_allow_html=True)
else:
    col_logo.markdown("# 🍊 Orange Harmony")
st.markdown('<div class="oh-section-title" style="font-size:1.15rem;margin-top:4px;">Seu professor de canto com IA — analise sua voz, afine e evolua.</div>', unsafe_allow_html=True)
# ══════════════════ INTERFACE ══════════════════
tab_analise, tab_afinador, tab_historico, tab_composicoes, tab_edicao, tab_producao = st.tabs(
    ["🎵 Análise e Estudo", "🎸 Afinador", "📊 Histórico", "🎼 Composições", "✨ Edição Vocal (IA)", "🎛️ Produção"]
)
# ── ABA ANÁLISE E ESTUDO ──
with tab_analise:
    st.markdown(titulo_secao("🎯", "1. Referência de tom — ouça a nota ou a escala antes de cantar."), unsafe_allow_html=True)
    c1, c2 = st.columns(2)
    nota_ref = c1.selectbox("Nota de referência", NOTAS_REFERENCIA, index=NOTAS_REFERENCIA.index("C4"))
    calibracao = c2.radio("Calibração A4 (Hz)", [440, 442], horizontal=True)
    c3, c4 = st.columns(2)
    if c3.button("▶ Tocar nota"):
        sr, sinal = gerar_tom_referencia(nota_ref, calibracao)
        st.audio(sinal, sample_rate=sr)
    if c4.button("🎵 Tocar escala maior"):
        sr, sinal = gerar_escala(nota_ref, calibracao)
        st.audio(sinal, sample_rate=sr)
    st.markdown("---")
    st.markdown(titulo_secao("🎤", "2. Análise da voz — envie sua gravação e veja o diagnóstico completo."), unsafe_allow_html=True)
    audio_in = st.file_uploader("📂 Subir arquivo de áudio", type=["wav", "mp3", "m4a", "ogg", "flac"])
    st.markdown("**— ou —**")
    audio_gravado = st.audio_input("🎤 Gravar voz agora")
    modo = st.radio("Modo", ["Análise completa", "Afinador"], horizontal=True)
    if st.button("Analisar", type="primary"):
        fonte = audio_in if audio_in is not None else audio_gravado
        if fonte is None:
            st.warning("Envie um áudio ou grave sua voz.")
            st.stop()
        audio, sr_audio = carregar_audio(fonte)
        if audio is None:
            st.error("Não foi possível ler o áudio. Tente outro formato (WAV ou MP3).")
            st.stop()
        tempos, f0 = extrair_pitch(audio, sr_audio)
        f0_limpo = np.where((f0 >= 80) & (f0 <= 1000), f0, 0.0)
        if modo == "Afinador":
            nota, cents, status = analisar_afinador(audio, sr_audio, calibracao)
            st.success(f"Nota detectada: **{nota}** — {cents:+.1f} cents — {status}")
            st.markdown(velocimetro_html(cents, nota), unsafe_allow_html=True)
        else:
            resultado = analisar_afinacao(f0_limpo, tempos, calibracao)
            devolutiva = "[!] Professor indisponível (configure a chave Gemini)."
            if cliente is not None:
                ultimo_erro = ""
                for modelo in ["gemini-3.5-flash-lite", "gemini-3.5-flash", "gemini-3-flash-preview", "gemini-2.5-flash"]:
                    try:
                        interaction = cliente.interactions.create(model=modelo, input=montar_prompt_professor(resultado))
                        devolutiva = interaction.output_text
                        break
                    except Exception as e:
                        ultimo_erro = str(e)
                        continue
                if devolutiva.startswith("[!]"):
                    devolutiva = f"[!] Professor indisponível. Detalhe do erro: {ultimo_erro}"
            try:
                registrar_analise_firestore(resultado, modo)
            except Exception as e:
                st.warning(f"Não foi possível salvar no Firestore: {e}")
            st.markdown(titulo_secao("📊", "Diagnóstico da sua voz"), unsafe_allow_html=True)
            st.markdown(metricas_html([
                ("Nota predominante", resultado['nota_predominante'], "nota mais cantada"),
                ("Desvio médio", f"{resultado['desvio_medio_cents']:.1f} cents", "quanto sai do tom"),
                ("Tendência", resultado['tendencia'], f"{resultado['desvio_sinal_cents']:+.1f} cents"),
                ("Afinado (±50c)", f"{resultado['pct_afinado']:.1f}%", "das notas no tom"),
                ("Frases", str(resultado['num_frases']), f"média {resultado['sustentacao_media']:.2f}s"),
                ("Pausas", str(resultado['num_pausas']), f"média {resultado['pausa_media']:.2f}s"),
            ]), unsafe_allow_html=True)
            mascara_voz = f0_limpo > 0
            fig, ax = plt.subplots(figsize=(10, 4))
            ax.plot(tempos[mascara_voz], f0_limpo[mascara_voz], linewidth=1.5, color="#f97316")
            ax.set_facecolor("#0d0d0d")
            fig.patch.set_facecolor("#0d0d0d")
            ax.tick_params(colors="#ccc")
            ax.xaxis.label.set_color("#ccc")
            ax.yaxis.label.set_color("#ccc")
            ax.title.set_color("#f97316")
            ax.set_xlabel("Tempo (s)")
            ax.set_ylabel("Frequência fundamental (Hz)")
            ax.set_title("Curva de Pitch")
            ax.grid(True, alpha=0.3)
            fig.tight_layout()
            st.pyplot(fig)
            st.markdown(titulo_secao("💬", "Devolutiva do Professor"), unsafe_allow_html=True)
            st.markdown(card_html(devolutiva), unsafe_allow_html=True)
            st.markdown("---")
            st.markdown(titulo_secao("🎚️", "3. Vibrato — detecte a oscilação da sua nota sustentada."), unsafe_allow_html=True)
            vibratos = detectar_vibrato_v4(f0_limpo, tempos, calibracao_a4=calibracao)
            if vibratos:
                linhas = []
                for v in vibratos:
                    linhas.append({
                        "Nota": v["nota"], "Taxa (Hz)": round(v["taxa_hz"], 2),
                        "Extensão (cents)": round(v["extensao_cents"], 1),
                        "Deslize (cents)": round(v["deslize_cents"], 1),
                        "Periodicidade": round(v["periodicidade"], 3),
                        "Classificação": classificar_vibrato_v4(v["taxa_hz"], v["extensao_cents"], v["deslize_cents"], v["periodicidade"]),
                        "Dur. (s)": v["duracao_s"],
                    })
                st.dataframe(linhas, use_container_width=True)
            else:
                st.info("Nenhuma nota sustentada (>= 0.8s). Sustente uma nota firme por 3-4s.")
# ── ABA AFINADOR ──
with tab_afinador:
    st.markdown(titulo_secao("🎸", "Afinador — violão ou voz. Escolha a afinação, toque/cante uma nota sustentada e veja o resultado."), unsafe_allow_html=True)
    c1, c2 = st.columns(2)
    afincao = c1.selectbox("Afinação", list(AFINACOES.keys()))
    calib_afinador = c2.radio("Calibração A4", [440, 442], horizontal=True)
    st.markdown(DESCRICOES_AFINACOES.get(afincao, ""))

    if TEM_WEBRTC:
        st.markdown(titulo_secao("⚡", "Modo tempo real — agulha contínua:"), unsafe_allow_html=True)
        estado_afinador["calibracao"] = calib_afinador
        webrtc_ctx = webrtc_streamer(
            key="afinador_tempo_real",
            mode=WebRtcMode.SENDONLY,
            audio_frame_callback=_processar_frame_audio,
            frontend_rtc_configuration={"iceServers": [{"urls": ["stun:stun.l.google.com:19302"]}]},
            media_stream_constraints={"video": False, "audio": True},
        )
        if webrtc_ctx.state.playing:
            placeholder = st.empty()
            while webrtc_ctx.state.playing:
                if estado_afinador["ativo"]:
                    placeholder.markdown(velocimetro_html(estado_afinador["cents"], estado_afinador["nota"]), unsafe_allow_html=True)
                time.sleep(0.1)
    else:
        st.warning(f"Modo tempo real indisponível. Detalhe: {ERRO_WEBRTC}")

    st.markdown(titulo_secao("🎤", "— ou — grave/subir uma nota:"), unsafe_allow_html=True)
    audio_afinador = st.file_uploader("📂 Subir nota sustentada", type=["wav", "mp3", "m4a", "ogg", "flac"], key="afinador")
    st.markdown("**— ou —**")
    audio_afinador_grav = st.audio_input("🎤 Gravar nota agora", key="afinador_rec")
    fonte_afinador = audio_afinador if audio_afinador is not None else audio_afinador_grav
    if fonte_afinador is not None:
        audio, sr = carregar_audio(fonte_afinador)
        if audio is None:
            st.error("Não foi possível ler o áudio. Tente outro formato (WAV ou MP3).")
        else:
            nota, cents, status = analisar_afinador(audio, sr, calib_afinador)
            st.success(f"Nota alvo: **{nota}** — {cents:+.1f} cents — {status}")
            st.markdown(velocimetro_html(cents, nota), unsafe_allow_html=True)
# ── ABA HISTÓRICO ──
with tab_historico:
    st.markdown(titulo_secao("📊", "Evolução da sua performance — salva no Firebase, nunca se perde."), unsafe_allow_html=True)
    if st.button("Atualizar Histórico"):
        analises = carregar_historico_firestore()
        if not analises:
            st.info("Nenhuma análise salva ainda.")
        else:
            linhas = [{
                "Data": a.get("data", "")[5:16], "Nota": a.get("nota_predominante", ""),
                "Desvio (cents)": a.get("desvio_medio_cents", 0), "Tendência": a.get("tendencia", ""),
                "% Afinado": a.get("pct_afinado", 0), "Frases": a.get("num_frases", 0),
                "Sustentação (s)": a.get("sustentacao_media", 0), "Tom ref.": a.get("tom_ref", "—") or "—",
            } for a in analises]
            st.dataframe(linhas, use_container_width=True)
            if len(analises) >= 2:
                rev = list(reversed(analises))
                datas = [a.get("data", "")[5:16] for a in rev]
                desvios = [a.get("desvio_medio_cents", 0) for a in rev]
                pcts = [a.get("pct_afinado", 0) for a in rev]
                fig, ax1 = plt.subplots(figsize=(10, 4))
                ax1.set_facecolor("#0d0d0d")
                fig.patch.set_facecolor("#0d0d0d")
                ax1.plot(datas, desvios, marker="o", color="#f97316", label="Desvio médio (cents)")
                ax1.set_ylabel("Desvio médio (cents)")
                ax1.tick_params(axis="x", rotation=45, colors="#ccc")
                ax1.xaxis.label.set_color("#ccc")
                ax1.yaxis.label.set_color("#ccc")
                ax1.title.set_color("#f97316")
                ax2 = ax1.twinx()
                ax2.plot(datas, pcts, marker="s", color="#22c55e", label="% afinado")
                ax2.set_ylabel("% afinado")
                ax2.tick_params(colors="#ccc")
                ax2.yaxis.label.set_color("#ccc")
                ax1.set_title("Evolução da performance")
                fig.tight_layout()
                st.pyplot(fig)
# ── ABA COMPOSIÇÕES ──
with tab_composicoes:
    st.markdown(titulo_secao("🎼", "Crie e salve suas composições — com cifras, seções e versionamento."), unsafe_allow_html=True)
    c1, c2 = st.columns(2)
    comp_titulo = c1.text_input("Título da música", placeholder="Ex: Minha canção")
    comp_tom = c2.text_input("Tom (opcional)", placeholder="Ex: Am, C, G")
    comp_letra = st.text_area("Letra com cifras e seções", height=280,
        placeholder="# Verso 1\n[Am] [F] [C] [G]\nSua letra aqui...\n\n# Refrão\n[F] [G] [Am]\nRefrão aqui...")
    c3, c4 = st.columns(2)
    if c3.button("👁️ Ver prévia"):
        if comp_letra.strip():
            st.markdown(renderizar_composicao_html(comp_letra), unsafe_allow_html=True)
        else:
            st.info("Digite a letra para ver a prévia.")
    if c4.button("💾 Salvar composição", type="primary"):
        st.success(salvar_composicao_firestore(comp_titulo, comp_tom, comp_letra))
    st.markdown("---")
    st.markdown(titulo_secao("📚", "Composições salvas"), unsafe_allow_html=True)
    comps = listar_composicoes()
    if comps:
        opcoes = {f"{t} — v{v}": doc_id for t, v, doc_id in comps}
        escolha = st.selectbox("Selecione para carregar", list(opcoes.keys()))
        if st.button("📂 Carregar composição"):
            titulo, tom, letra = carregar_composicao(opcoes[escolha])
            st.session_state["comp_titulo"] = titulo
            st.session_state["comp_tom"] = tom
            st.session_state["comp_letra"] = letra
            st.rerun()
    else:
        st.info("Nenhuma composição salva ainda.")
# ── ABA EDIÇÃO VOCAL (IA) ──
with tab_edicao:
    st.markdown(titulo_secao("✨", "Peça para a IA ajustar sua voz. Ex: *'alinha minha voz no tom'*, *'limpa o ruído e deixa mais presente'*."), unsafe_allow_html=True)
    edicao_in = st.file_uploader("Voz para editar (use o áudio isolado)", type=["wav", "mp3", "m4a", "ogg", "flac"], key="edicao")
    comando = st.text_input("Comando para a IA", placeholder="Ex: alinha minha voz no tom e limpa o ruído")
    if st.button("✨ Aplicar edição com IA", type="primary"):
        if edicao_in is None:
            st.warning("Envie um áudio para editar.")
        else:
            audio, sr = carregar_audio(edicao_in)
            if audio is None:
                st.error("Não foi possível ler o áudio. Tente outro formato (WAV ou MP3).")
                st.stop()
            cmd = (comando or "").lower()
            acoes = []
            try:
                import noisereduce as nr
                if any(p in cmd for p in ["ruído", "ruido", "limpa", "limpe", "barulho"]):
                    audio = nr.reduce_noise(y=audio, sr=sr, stationary=True)
                    acoes.append("redução de ruído")
            except Exception:
                pass
            if any(p in cmd for p in ["normaliz", "volume", "alto", "baixo"]):
                audio = audio / (np.max(np.abs(audio)) + 1e-9)
                acoes.append("normalização de volume")
            if any(p in cmd for p in ["tom", "afin", "pitch", "alinha"]):
                audio = librosa.effects.pitch_shift(audio, sr=sr, n_steps=0.5)
                acoes.append("ajuste sutil de tom")
            if any(p in cmd for p in ["presente", "eq", "clareza", "brilho"]):
                audio = librosa.effects.preemphasis(audio)
                acoes.append("EQ de presença")
            if not acoes:
                audio = audio / (np.max(np.abs(audio)) + 1e-9)
                acoes.append("normalização de volume")
            import soundfile as sf
            out = tempfile.mktemp(suffix=".wav")
            sf.write(out, audio, sr)
            st.audio(out, sample_rate=sr)
            st.success("Edição aplicada: " + ", ".join(acoes) + ".")
# ── ABA PRODUÇÃO ──
with tab_producao:
    st.markdown(titulo_secao("🎛️", "Estúdio de Produção — grave sua música (voz + violão) e gere baixo e bateria no tom e no BPM detectados da sua gravação."), unsafe_allow_html=True)
    st.markdown(titulo_secao("1️⃣", "Captura — suba o arquivo ou grave direto."), unsafe_allow_html=True)
    prod_in = st.file_uploader("📂 Subir gravação (voz + violão)", type=["wav", "mp3", "m4a", "ogg", "flac"], key="producao")
    st.markdown("**— ou —**")
    prod_grav = st.audio_input("🎤 Gravar música agora")
    st.markdown(titulo_secao("2️⃣", "Geração"), unsafe_allow_html=True)
    c1, c2 = st.columns(2)
    com_baixo = c1.checkbox("Gerar linha de baixo", value=True)
    com_bateria = c2.checkbox("Gerar bateria", value=True)
    if st.button("🎛️ Gerar produção", type="primary"):
        fonte_prod = prod_in if prod_in is not None else prod_grav
        if fonte_prod is None:
            st.warning("Suba um áudio ou grave sua música primeiro.")
            st.stop()
        audio, sr_audio = carregar_audio(fonte_prod)
        if audio is None:
            st.error("Não foi possível ler o áudio. Tente outro formato (WAV ou MP3).")
            st.stop()
        with st.spinner("Analisando BPM, tom e ritmo..."):
            bpm, beat_times = detectar_bpm_e_beats(audio, sr_audio)
            tom = detectar_tom(audio, sr_audio)
        st.success(f"Detectado: **{bpm:.1f} BPM** · Tom aproximado: **{tom}**")
        baixo = None
        bateria = None
        try:
            if com_baixo:
                with st.spinner("Gerando linha de baixo..."):
                    baixo = gerar_baixo_melodico(audio, sr_audio, tom, bpm, beat_times)
            if com_bateria:
                with st.spinner("Gerando bateria..."):
                    bateria = gerar_bateria_ritmica(audio, sr_audio, bpm, beat_times)
        except Exception as e:
            st.error(f"Erro ao gerar produção: {e}")
            st.stop()
        with st.spinner("Mixando..."):
            mix = mixar(audio, baixo, bateria)
        st.markdown(titulo_secao("🎧", "Resultado mixado (original + baixo + bateria):"), unsafe_allow_html=True)
        st.audio(mix, sample_rate=sr_audio)
        st.download_button(
            "⬇️ Baixar produção (WAV)",
            data=audio_para_bytes(mix, sr_audio),
            file_name="producao_orange_harmony.wav",
            mime="audio/wav",
        )
        st.info("💡 A separação de stems (voz/violão separados) exige GPU e roda no Colab — o link do notebook fica no README.")
