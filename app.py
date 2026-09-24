# Orange Harmony — VocalAI Coach (Streamlit)
import os, json, re, base64, tempfile, io, time
from datetime import datetime
import numpy as np
import librosa
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import streamlit as st
import streamlit.components.v1 as components
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
# ── Fontes: Poppins (títulos/abas) + Inter (corpo) + Montserrat (afinador) ──
st.markdown('<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@600;700;800&family=Inter:wght@400;600;700;800&family=Montserrat:wght@700;800&display=swap" rel="stylesheet">', unsafe_allow_html=True)
# ── Gemini ──
from google import genai
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
cliente = genai.Client(api_key=GEMINI_API_KEY) if GEMINI_API_KEY else None
# ── Modelos de IA disponíveis (seletor no app, sem editar código) ──
MODELOS_PADRAO = ["gemini-3.5-flash", "gemini-3-flash", "gemini-3.1-pro"]

def listar_modelos_ia():
    """Descobre os modelos de texto realmente disponíveis na sua chave."""
    if "modelos_cache" in st.session_state:
        return st.session_state["modelos_cache"]
    if cliente is None:
        return MODELOS_PADRAO
    try:
        encontrados = []
        for m in cliente.models.list():
            nome = (getattr(m, "name", "") or "").replace("models/", "")
            acoes = getattr(m, "supported_actions", None) or []
            if acoes and "generateContent" not in acoes:
                continue
            if not ("flash" in nome or "pro" in nome):
                continue
            if any(x in nome for x in ["image", "tts", "embedding", "live", "veo", "lyria", "nano-banana"]):
                continue
            encontrados.append(nome)
        if encontrados:
            ordem = ["gemini-3.8-flash", "gemini-3.5-flash", "gemini-3-flash",
                     "gemini-3.1-pro", "gemini-2.5-flash", "gemini-2.5-pro"]
            encontrados.sort(key=lambda n: ordem.index(n) if n in ordem else 99)
            st.session_state["modelos_cache"] = encontrados
            return encontrados
    except Exception:
        pass
    return MODELOS_PADRAO

MODELOS_DISPONIVEIS = listar_modelos_ia()

def modelo_atual():
    padrao = MODELOS_DISPONIVEIS[0] if MODELOS_DISPONIVEIS else "gemini-3.5-flash"
    return st.session_state.get("modelo_ia", padrao)
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
COL_GRAVACOES = "orange_harmony_gravacoes"
# ══════════════════ GRAVAÇÕES NO FIRESTORE (comprimidas em MP3, sem Storage) ══════════════════
CHUNK_MAX = 800_000  # Firestore limita ~1MB por documento; 800KB por pedaço é seguro
def _sanitizar_nome(nome):
    nome = nome.strip().replace("/", "_").replace("\\", "_")
    return nome[:120] or "gravacao"
def comprimir_audio_mp3(dados):
    """Decodifica bytes de áudio e re-encoda em MP3 64kbps mono (pequeno o suficiente p/ Firestore)."""
    try:
        audio, sr = carregar_audio(io.BytesIO(dados))
        if audio is None:
            return None
        import lameenc
        enc = lameenc.Encoder()
        enc.set_bit_rate(64)
        enc.set_in_sample_rate(sr)
        enc.set_channels(1)
        pcm = (audio * 32767).astype(np.int16).tobytes()
        return enc.encode(pcm) + enc.flush()
    except Exception:
        return None
def salvar_gravacao_firestore(nome, dados):
    """Salva a gravação no Firestore (MP3 comprimido, em pedaços). Retorna True se funcionou."""
    if db is None:
        return False
    try:
        mp3 = comprimir_audio_mp3(dados)
        if mp3 is None:
            return False
        doc_id = _sanitizar_nome(nome)
        ref = db.collection(COL_GRAVACOES).document(doc_id)
        for c in ref.collection("chunks").stream():
            c.reference.delete()
        ref.delete()
        n_chunks = 0
        for i in range(0, len(mp3), CHUNK_MAX):
            ref.collection("chunks").document(f"chunk_{n_chunks:03d}").set({"dados": mp3[i:i+CHUNK_MAX]})
            n_chunks += 1
        ref.set({"nome": nome.strip(), "data": datetime.now().isoformat(),
                 "num_chunks": n_chunks, "tamanho_bytes": len(mp3)})
        return True
    except Exception:
        return False
def listar_gravacoes_firestore():
    if db is None:
        return []
    try:
        docs = db.collection(COL_GRAVACOES).order_by("data", direction=firestore.Query.DESCENDING).limit(100).stream()
        return [d.to_dict().get("nome", d.id) for d in docs]
    except Exception:
        return []
def baixar_gravacao_firestore(nome):
    if db is None:
        return None
    try:
        doc_id = _sanitizar_nome(nome)
        ref = db.collection(COL_GRAVACOES).document(doc_id)
        meta = ref.get()
        if not meta.exists:
            return None
        n = meta.to_dict().get("num_chunks", 0)
        partes = []
        for i in range(n):
            c = ref.collection("chunks").document(f"chunk_{i:03d}").get()
            if c.exists:
                partes.append(c.to_dict().get("dados", b""))
        if not partes:
            return None
        return b"".join(partes)
    except Exception:
        return None
def excluir_gravacao_firestore(nome):
    if db is None:
        return False
    try:
        doc_id = _sanitizar_nome(nome)
        ref = db.collection(COL_GRAVACOES).document(doc_id)
        for c in ref.collection("chunks").stream():
            c.reference.delete()
        ref.delete()
        return True
    except Exception:
        return False
def get_gravacoes():
    nomes = listar_gravacoes_firestore()
    if nomes:
        return list(dict.fromkeys(nomes))
    return list(dict.fromkeys(g["nome"] for g in st.session_state.get("gravacoes", [])))
def get_gravacao_bytes(nome):
    dados = baixar_gravacao_firestore(nome)
    if dados is not None:
        return dados
    for g in st.session_state.get("gravacoes", []):
        if g["nome"] == nome:
            return g["bytes"]
    return None
# ══════════════════ CHATS DA LARANJINHA (memória persistente no Firestore) ══════════════════
COL_CHATS = "orange_harmony_chats"

def criar_chat_firestore(nome):
    """Cria um novo chat e retorna o id."""
    if db is None:
        return None
    try:
        doc = db.collection(COL_CHATS).add({
            "nome": (nome or "Novo chat").strip()[:80],
            "data": datetime.now().isoformat(),
            "mensagens": [],
        })
        return doc[1].id
    except Exception:
        return None

def listar_chats_firestore():
    """Retorna lista de (nome, chat_id), mais recentes primeiro."""
    if db is None:
        return []
    try:
        docs = db.collection(COL_CHATS).order_by("data", direction=firestore.Query.DESCENDING).limit(50).stream()
        return [(d.to_dict().get("nome", "Chat"), d.id) for d in docs]
    except Exception:
        return []

def carregar_chat_firestore(chat_id):
    """Retorna a lista de mensagens de um chat."""
    if db is None or not chat_id:
        return []
    try:
        doc = db.collection(COL_CHATS).document(chat_id).get()
        if not doc.exists:
            return []
        return doc.to_dict().get("mensagens", [])
    except Exception:
        return []

def salvar_chat_firestore(chat_id, mensagens):
    """Salva as mensagens de um chat (mantém as últimas 60)."""
    if db is None or not chat_id:
        return False
    try:
        db.collection(COL_CHATS).document(chat_id).update({
            "mensagens": mensagens[-60:],
            "data": datetime.now().isoformat(),
        })
        return True
    except Exception:
        return False

def excluir_chat_firestore(chat_id):
    if db is None or not chat_id:
        return False
    try:
        db.collection(COL_CHATS).document(chat_id).delete()
        return True
    except Exception:
        return False
# ── Constantes musicais ──
NOMES_NOTAS = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"]
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
    pausas = [(inicios[k+1] - fins[k]) * dt for k in range(len(fins)-1) if (inicios[k+1] - fins[k]) * dt >= 0.3]
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
    # ══════════════════ PRODUÇÃO (BPM, TOM, BAIXO, BATERIA E ACORDES) ══════════════════
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
}
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
# ── Acordes (backing mais musical) ──
def gerar_progressao(tom):
    """Progressão I–V–vi–IV no tom detectado (muito comum em músicas populares)."""
    raiz = NOMES_NOTAS.index(tom)
    graus = [0, 7, 9, 5]  # I, V, vi, IV
    return [(raiz + g) % 12 for g in graus]
def gerar_acorde_encorpado(freqs, duracao, sr, volume=0.30):
    n = int(sr * duracao)
    t = np.linspace(0, duracao, n, endpoint=False)
    sinal = np.zeros(n)
    for f in freqs:
        sinal += np.sin(2 * np.pi * f * t) + 0.3 * np.sin(2 * np.pi * 2 * f * t)
    env = np.exp(-1.2 * t / duracao)
    sinal = np.tanh(1.2 * sinal * env)
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
        menor = (grau == 9)  # vi é menor
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
def mixar(audio, baixo, bateria, acordes=None):
    total = audio.astype(np.float32)
    if baixo is not None:
        total = total + 0.6 * baixo
    if bateria is not None:
        total = total + 0.65 * bateria
    if acordes is not None:
        total = total + 0.30 * acordes
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
    return (f'<div class="oh-section-title">'
            f'<span class="oh-title-icon">{icone}</span>'
            f'<span class="oh-title-text">{texto}</span>'
            f'<span class="oh-title-line"></span></div>')
# ══════════════════ VELOCÍMETRO (arco mais fino + fonte Montserrat + ponteiro corrigido) ══════════════════
def velocimetro_html(cents, nota):
    cents_c = max(-50.0, min(50.0, float(cents)))
    angulo = (cents_c / 50.0) * 90.0
    cor = "#22c55e" if abs(cents_c) <= 10 else ("#eab308" if abs(cents_c) <= 25 else "#ef4444")
    status = "AFINADO" if abs(cents_c) <= 10 else ("PRÓXIMO" if abs(cents_c) <= 25 else "DESAFINADO")
    marcas = ""
    for v, rot in [(-50, "-50"), (-25, "-25"), (0, "0"), (25, "+25"), (50, "+50")]:
        a = (v / 50.0) * 90.0
        rad = np.deg2rad(a)
        x1 = 110 + 74 * np.sin(rad); y1 = 110 - 74 * np.cos(rad)
        x2 = 110 + 84 * np.sin(rad); y2 = 110 - 84 * np.cos(rad)
        marcas += f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" stroke="#555" stroke-width="2"/>'
        lx = 110 + 96 * np.sin(rad); ly = 110 - 96 * np.cos(rad)
        marcas += f'<text x="{lx:.1f}" y="{ly:.1f}" text-anchor="middle" fill="#888" font-size="10" font-family="Montserrat,Inter">{rot}</text>'
    return f'''<div style="display:flex;justify-content:center;">
<svg viewBox="0 0 220 134" width="360" style="background:linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.01));backdrop-filter:blur(12px);border-radius:20px;border:1px solid rgba(255,255,255,0.10);box-shadow:0 10px 40px rgba(0,0,0,0.45);">
  <defs>
    <linearGradient id="gg" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#ef4444"/>
      <stop offset="30%" stop-color="#eab308"/>
      <stop offset="50%" stop-color="#22c55e"/>
      <stop offset="70%" stop-color="#eab308"/>
      <stop offset="100%" stop-color="#ef4444"/>
    </linearGradient>
    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="3" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <path d="M 20 110 A 90 90 0 0 1 200 110" fill="none" stroke="url(#gg)" stroke-width="8" stroke-linecap="round" opacity="0.9"/>
  <path d="M 20 110 A 90 90 0 0 1 200 110" fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="2" stroke-linecap="round"/>
  {marcas}
  <g transform="rotate({angulo:.1f} 110 110)" filter="url(#glow)">
    <line x1="110" y1="110" x2="110" y2="40" stroke="{cor}" stroke-width="4" stroke-linecap="round"/>
  </g>
  <circle cx="110" cy="110" r="10" fill="{cor}" filter="url(#glow)"/>
  <circle cx="110" cy="110" r="4" fill="#fff"/>
  <text x="110" y="84" text-anchor="middle" fill="#ffffff" font-size="30" font-weight="800" font-family="Montserrat,Poppins,Inter">{nota}</text>
  <text x="110" y="120" text-anchor="middle" fill="#bbbbbb" font-size="13" font-family="Montserrat,Inter">{cents_c:+.0f} cents · {status}</text>
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
                   "calibracao": 440.0, "buffer": np.zeros(0, dtype=np.float32),
                   "hist_freq": [], "nota_estavel": "", "contador_estavel": 0,
                   "cents_suavizado": 0.0}
def _processar_frame_audio(frame):
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
            hist = estado_afinador["hist_freq"]
            hist.append(freq)
            if len(hist) > 8:
                hist.pop(0)
            freq_suave = float(np.median(hist))
            nota, cents = _freq_para_nota_cents(freq_suave, estado_afinador["calibracao"])
            if nota == estado_afinador["nota_estavel"]:
                estado_afinador["contador_estavel"] += 1
            else:
                estado_afinador["nota_estavel"] = nota
                estado_afinador["contador_estavel"] = 0
            if estado_afinador["contador_estavel"] >= 3:
                prev = estado_afinador["cents_suavizado"]
                estado_afinador["cents_suavizado"] = 0.4 * cents + 0.6 * prev
                estado_afinador["nota"] = nota
                estado_afinador["cents"] = estado_afinador["cents_suavizado"]
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
    return [(d.id, d.to_dict()) for d in docs]
def excluir_analise_firestore(doc_id):
    if db is None:
        return False
    try:
        db.collection(COL_ANALISES).document(doc_id).delete()
        return True
    except Exception:
        return False
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
# ══════════════════ FUNÇÕES DE ÁUDIO (aceita mais formatos) ══════════════════
def carregar_audio(uploaded):
    """Lê um arquivo enviado (upload, gravação ou biblioteca) e devolve (audio, sr) em 22050 Hz mono.
    Detecta o formato real pelo conteúdo, aceitando WAV, MP3, M4A, AMR, 3GP, AAC, OGG, FLAC, WebM."""
    if uploaded is None:
        return None, None
    dados = uploaded.getvalue()
    if not dados:
        return None, None
    nome_orig = getattr(uploaded, "name", "audio.wav") or "audio.wav"
    ext = os.path.splitext(nome_orig)[1] or ".wav"
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
# ══════════════════ CHAMADA GEMINI COM FALLBACK AUTOMÁTICO ══════════════════
MODELOS_COM_AUDIO = ["gemini-3.5-flash", "gemini-3-flash", "gemini-2.5-flash", "gemini-3.8-flash"]
FRASES_SEM_AUDIO = [
    "não consigo ouvir", "não consigo escutar", "não consigo acessar o áudio",
    "não recebi o áudio", "não tenho acesso ao áudio", "não consigo analisar o áudio",
    "não posso ouvir", "não consigo processar o áudio", "não consigo avaliar o áudio",
    "não consigo ouvir a gravação", "não consigo escutar a gravação",
    "não consigo avaliar a gravação", "não consigo analisar a gravação",
    "can't hear", "cannot hear", "cannot access the audio", "can't access the audio",
    "cannot process audio", "don't have access to the audio", "no audio file",
]
def _resposta_sem_audio(texto):
    t = (texto or "").lower()
    return any(f in t for f in FRASES_SEM_AUDIO)
def chamar_gemini_com_fallback(prompt, audio_anexo=None):
    if cliente is None:
        return None, "Gemini não configurado."
    if audio_anexo is not None:
        modelos_tentar = [m for m in MODELOS_COM_AUDIO if m in MODELOS_DISPONIVEIS]
        if not modelos_tentar:
            modelos_tentar = MODELOS_COM_AUDIO
    else:
        modelos_tentar = [modelo_atual()] + [m for m in MODELOS_DISPONIVEIS if m != modelo_atual()]
    arquivo = None
    if audio_anexo is not None:
        try:
            from google.genai import types
            nome, dados = audio_anexo
            arquivo = cliente.files.upload(
                file=io.BytesIO(dados),
                config=types.UploadFileConfig(mime_type="audio/mpeg", display_name=nome),
            )
            for _ in range(30):
                estado = cliente.files.get(name=arquivo.name)
                if estado.state.name == "ACTIVE":
                    break
                time.sleep(1)
        except Exception as e:
            return None, f"Falha ao enviar o áudio: {e}"
    ultimo_erro = ""
    for modelo in modelos_tentar:
        try:
            if arquivo is not None:
                from google.genai import types
                resposta = cliente.models.generate_content(
                    model=modelo,
                    contents=[prompt, types.Part.from_uri(file_uri=arquivo.uri, mime_type="audio/mpeg")],
                )
            else:
                resposta = cliente.models.generate_content(model=modelo, contents=prompt)
            texto = resposta.text
            if texto and texto.strip():
                if audio_anexo is not None and _resposta_sem_audio(texto):
                    ultimo_erro = f"{modelo} não conseguiu ouvir o áudio"
                    continue
                return texto, modelo
            ultimo_erro = "Resposta vazia"
        except Exception as e:
            ultimo_erro = str(e)
            continue
    return None, ultimo_erro
# ══════════════════ CONHECIMENTO DO APP (memória da Laranjinha) ══════════════════
CONHECIMENTO_APP = """
Você é a assistente oficial do Orange Harmony e conhece TODO o aplicativo. Guia completo:

## Abas do aplicativo
1. **🎵 Análise e Estudo**: Referência de tom (tocar nota ou escala maior antes de cantar), análise da voz (upload de áudio, gravação direta ou gravação salva). Modos: Análise completa (nota predominante, desvio em cents, tendência, % afinado, frases, pausas, curva de pitch e devolutiva do professor), Afinador (nota e cents) e Análise de Cover (tom, BPM, % de notas na escala, veredito). Também detecta vibrato.
2. **🎸 Afinador**: Afinador de violão/guitarra/voz com várias afinações (padrão, Drop D, Drop C, Drop B, meio tom abaixo, Open G, DADGAD, Open D, Open C, 7 cordas, ukulele), calibração A4 (440/442) e modo tempo real.
3. **🎙️ Gravador**: Grava ou sobe um áudio, nomeia e salva na nuvem (Firestore). As gravações aparecem na Análise, na Produção e você pode pedir para a Laranjinha avaliá-las pelo nome.
4. **📊 Histórico**: Evolução da performance salva no Firebase, com tabela e gráfico de desvio médio e % afinado ao longo do tempo. Dá para excluir análises.
5. **🎼 Composições**: Cria e salva composições com cifras [Am], seções (# Verso, # Refrão) e versionamento (v1, v2...). Dá para ver prévia, salvar e carregar.
6. **✨ Edição Vocal (IA)**: Ajusta a voz com comandos (ex: "alinha minha voz no tom", "limpa o ruído e deixa mais presente"). Aplica redução de ruído, normalização, ajuste de tom e EQ de presença.
7. **🔄 Conversor**: Converte áudio entre WAV e MP3.
8. **🎛️ Produção**: Estúdio que gera backing track (baixo, bateria e acordes) no tom e BPM detectados da gravação, em vários estilos (Pop, Rock, Balada, Sertanejo, Funk, MPB, Gospel, Reggae, Blues, Jazz, Forró, Eletrônica).

## Como você funciona
- Você avalia gravações salvas quando o usuário pede "avalia a gravação [nome]".
- Você dá dicas de canto, explicação técnica (pitch, afinação, vibrato, respiração, sustentação), gera letras e composições, e orienta sobre afinação e tom.
- Responda em português, de forma acolhedora, prática e específica. Seja encorajador.
"""
# ══════════════════ ASSISTENTE VIRTUAL (Gemini, com áudio, memória e conhecimento do app) ══════════════════
def assistente_resposta(prompt_usuario, chat_id=None, historico=None):
    if cliente is None:
        return "A Laranjinha está indisponível (configure a chave Gemini)."
    sistema = CONHECIMENTO_APP
    contexto = ""
    if historico:
        ultimas = historico[-8:]
        partes = []
        for m in ultimas:
            papel = "Usuário" if m.get("role") == "user" else "Laranjinha"
            partes.append(f"{papel}: {m.get('content', '')}")
        if partes:
            contexto = "\n\nHistórico recente da conversa:\n" + "\n".join(partes)
    audio_anexo = None
    texto = prompt_usuario.lower()
    for nome in get_gravacoes():
        if nome.lower() in texto:
            dados = get_gravacao_bytes(nome)
            if dados:
                audio_anexo = (nome, dados)
            else:
                return (f"Achei a gravação '{nome}' na lista, mas não consegui carregar o áudio do banco. "
                        f"Salve a gravação de novo na aba Gravador e tente outra vez.")
            break
    if audio_anexo is not None:
        nome, _ = audio_anexo
        prompt = (sistema + contexto + f"\n\nO usuário pediu: {prompt_usuario}\n\n"
                  f"Ouça a gravação '{nome}' e faça uma avaliação completa do canto: afinação, notas, "
                  f"técnica, pontos fortes e pontos a melhorar. Seja específico e encorajador.")
        texto_resp, modelo = chamar_gemini_com_fallback(prompt, audio_anexo)
        if texto_resp:
            return texto_resp
        return (f"Consegui achar a gravação '{nome}', mas nenhum modelo conseguiu analisá-la agora "
                f"({modelo}). Tente novamente em instantes.")
    prompt = sistema + contexto + "\n\nPergunta: " + prompt_usuario
    texto_resp, modelo = chamar_gemini_com_fallback(prompt)
    if texto_resp:
        return texto_resp
    return f"Erro ao chamar o assistente: {modelo}"
# ══════════════════ ANÁLISE DE COVER (gravação completa) ══════════════════
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
# ══════════════════ CONVERSOR DE FORMATO ══════════════════
def converter_audio(audio, sr, formato_destino):
    if formato_destino == "WAV":
        return audio_para_bytes(audio, sr), "audio/wav", "convertido.wav"
    import lameenc
    encoder = lameenc.Encoder()
    encoder.set_bit_rate(192)
    encoder.set_in_sample_rate(sr)
    encoder.set_channels(1)
    pcm = (audio * 32767).astype(np.int16).tobytes()
    mp3_bytes = encoder.encode(pcm) + encoder.flush()
    return mp3_bytes, "audio/mpeg", "convertido.mp3"
    # ══════════════════ CSS / TEMA (glassmorphism premium + Poppins/Inter) ══════════════════
st.markdown("""
<style>
    .stApp {
        font-family: 'Inter', sans-serif;
        background:
            radial-gradient(1200px 800px at 85% -10%, rgba(249,115,22,0.14), transparent 60%),
            radial-gradient(1000px 700px at -10% 110%, rgba(249,115,22,0.10), transparent 55%),
            radial-gradient(800px 600px at 50% 50%, rgba(255,255,255,0.02), transparent 70%),
            #0a0a0a;
    }
    h1, h2, h3, h4 {
        font-family: 'Poppins', sans-serif;
        color: #f97316 !important;
        font-weight: 800;
        letter-spacing: -0.02em;
    }
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
    .stButton > button[kind="secondary"] {
        background: rgba(255,255,255,0.06);
        color: #fff;
        border: 1px solid rgba(255,255,255,0.12);
        box-shadow: none;
    }

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

    .stTabs [data-baseweb="tab-list"] { gap: 10px; }
    .stTabs [data-baseweb="tab"] {
        font-family: 'Poppins', sans-serif;
        background: rgba(255,255,255,0.04);
        backdrop-filter: blur(10px);
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 999px;
        color: #d9d9d9;
        padding: 0.55rem 1.2rem;
        font-weight: 600;
        transition: all 0.25s ease;
    }
    .stTabs [data-baseweb="tab"]:hover {
        background: rgba(255,255,255,0.09);
        transform: translateY(-1px);
    }
    .stTabs [aria-selected="true"] {
        background: linear-gradient(135deg, #f97316, #ea580c);
        color: #fff !important;
        box-shadow: 0 4px 20px rgba(249,115,22,0.4);
    }

    .oh-section-title { display: flex; align-items: center; gap: 10px; margin: 18px 0 12px; }
    .oh-title-icon {
        display: inline-flex; align-items: center; justify-content: center;
        min-width: 34px; height: 34px; border-radius: 10px;
        background: linear-gradient(135deg, rgba(249,115,22,0.28), rgba(249,115,22,0.08));
        border: 1px solid rgba(249,115,22,0.35);
        box-shadow: 0 0 14px rgba(249,115,22,0.25);
        animation: ohPulse 2.5s infinite;
    }
    .oh-title-text {
        font-family: 'Poppins', sans-serif; font-size: 1.05rem; font-weight: 700;
        background: linear-gradient(90deg, #f97316, #ffb066, #f97316);
        background-size: 200% auto;
        -webkit-background-clip: text; -webkit-text-fill-color: transparent;
        background-clip: text;
        animation: ohGradient 4s linear infinite;
    }
    .oh-title-line { flex: 1; height: 2px; border-radius: 2px; background: linear-gradient(90deg, rgba(249,115,22,0.6), transparent); }

    .oh-metric-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 14px; margin: 16px 0; animation: ohFadeIn 0.5s ease; }
    .oh-metric {
        background: linear-gradient(150deg, rgba(249,115,22,0.14), rgba(255,255,255,0.03));
        border: 1px solid rgba(249,115,22,0.22); border-radius: 16px; padding: 18px 14px; text-align: center;
        backdrop-filter: blur(12px); box-shadow: 0 8px 24px rgba(0,0,0,0.3);
        transition: transform 0.25s ease, box-shadow 0.25s ease;
    }
    .oh-metric:hover { transform: translateY(-4px); box-shadow: 0 14px 34px rgba(249,115,22,0.25); }
    .oh-metric-label { font-size: 0.75rem; color: #f97316; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; }
    .oh-metric-value { font-size: 1.6rem; font-weight: 800; color: #fff; margin: 6px 0 2px; }
    .oh-metric-sub { font-size: 0.78rem; color: #aaa; }

    .oh-card {
        background: rgba(255,255,255,0.04); backdrop-filter: blur(14px);
        border: 1px solid rgba(255,255,255,0.09); border-radius: 18px; padding: 20px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.35); animation: ohFadeIn 0.5s ease;
    }

    @keyframes ohFadeIn { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
    @keyframes ohPulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(249,115,22,0.45); } 50% { box-shadow: 0 0 0 10px rgba(249,115,22,0); } }
    @keyframes ohGradient { 0% { background-position: 0% center; } 100% { background-position: 200% center; } }

    .stDataFrame { background: rgba(255,255,255,0.03); border-radius: 14px; border: 1px solid rgba(255,255,255,0.08); }
    .stAudio { border-radius: 14px; overflow: hidden; }

    [data-testid="stFileUploader"], [data-testid="stAudioInput"] {
        background: rgba(255,255,255,0.04);
        border: 1px dashed rgba(249,115,22,0.4);
        border-radius: 14px; padding: 8px; backdrop-filter: blur(8px);
    }
    [data-testid="stFileUploader"]:hover, [data-testid="stAudioInput"]:hover { border-color: #f97316; }

    .stSpinner > div { border-top-color: #f97316 !important; }
    [data-testid="stSuccess"] {
        background: linear-gradient(135deg, rgba(34,197,94,0.15), rgba(255,255,255,0.03));
        border: 1px solid rgba(34,197,94,0.3); border-radius: 12px; backdrop-filter: blur(8px);
    }
    [data-testid="stWarning"], [data-testid="stError"], [data-testid="stInfo"] { border-radius: 12px; backdrop-filter: blur(8px); }

    /* ═══ FONTE GLOBAL — força Poppins/Inter em TODOS os elementos ═══ */
    html, body, .stApp, .stApp * {
        font-family: 'Inter', sans-serif !important;
    }
    label, .stSelectbox label, .stRadio label, .stTextInput label,
    .stNumberInput label, .stTextArea label, .stFileUploader label {
        font-family: 'Poppins', sans-serif !important;
    }
    .stButton > button, .stDownloadButton > button {
        font-family: 'Poppins', sans-serif !important;
    }
    .stTabs [data-baseweb="tab"] {
        font-family: 'Poppins', sans-serif !important;
    }
    [data-testid="stFileUploader"], [data-testid="stFileUploader"] *,
    [data-testid="stAudioInput"], [data-testid="stAudioInput"] * {
        font-family: 'Poppins', sans-serif !important;
    }
    .stSelectbox div[data-baseweb="select"] *,
    .stRadio div[role="radiogroup"] *,
    .stNumberInput input, .stTextInput input, .stTextArea textarea {
        font-family: 'Inter', sans-serif !important;
    }

    /* ═══ LARANJINHA — diálogo fixo, laranja e animado ═══ */
    [role="dialog"], [data-testid="stDialog"] {
        background: linear-gradient(165deg, rgba(35,22,10,0.97), rgba(18,12,6,0.98)) !important;
        border: 1px solid rgba(249,115,22,0.35) !important;
        border-radius: 20px !important;
        box-shadow: 0 22px 70px rgba(249,115,22,0.28), 0 0 0 1px rgba(0,0,0,0.4) !important;
        backdrop-filter: blur(16px) !important;
        animation: ohPopIn 0.3s ease !important;
    }
    @keyframes ohPopIn {
        from { opacity: 0; transform: translateY(16px) scale(0.97); }
        to { opacity: 1; transform: none; }
    }
    [role="dialog"] .stChatMessage, [data-testid="stDialog"] .stChatMessage {
        background: rgba(255,255,255,0.04) !important;
        border-radius: 14px !important;
        border: 1px solid rgba(255,255,255,0.06) !important;
        margin-bottom: 8px !important;
    }
    [role="dialog"] .stChatMessage[data-testid="stChatMessageAssistant"],
    [data-testid="stDialog"] .stChatMessage[data-testid="stChatMessageAssistant"] {
        background: linear-gradient(135deg, rgba(249,115,22,0.16), rgba(255,255,255,0.03)) !important;
        border: 1px solid rgba(249,115,22,0.22) !important;
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
# ══════════════════ SUBTÍTULO + SELETOR DE MODELO (sutil, botão 🤖) ══════════════════
col_sub, col_sel = st.columns([4, 1])
with col_sub:
    st.markdown('<div class="oh-section-title"><span class="oh-title-icon">🎤</span><span class="oh-title-text">Seu professor de canto com IA — analise sua voz, afine e evolua.</span><span class="oh-title-line"></span></div>', unsafe_allow_html=True)
with col_sel:
    st.markdown("🤖 Modelo")
    modelo_escolhido = st.selectbox(
        "Modelo de IA",
        MODELOS_DISPONIVEIS,
        index=MODELOS_DISPONIVEIS.index(modelo_atual()) if modelo_atual() in MODELOS_DISPONIVEIS else 0,
        key="sel_modelo",
        label_visibility="collapsed",
    )
    st.session_state["modelo_ia"] = modelo_escolhido
    st.caption("auto")
# ══════════════════ INTERFACE ══════════════════
tab_analise, tab_afinador, tab_gravador, tab_historico, tab_composicoes, tab_edicao, tab_conversor, tab_producao = st.tabs(
    ["🎵 Análise e Estudo", "🎸 Afinador", "🎙️ Gravador", "📊 Histórico", "🎼 Composições", "✨ Edição Vocal (IA)", "🔄 Conversor", "🎛️ Produção"]
)
# ── ABA ANÁLISE E ESTUDO ──
with tab_analise:
    st.markdown(titulo_secao("🎯", "Referência do tom"), unsafe_allow_html=True)
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
    st.markdown(titulo_secao("🎤", "Análise de voz"), unsafe_allow_html=True)
    audio_in = st.file_uploader("📂 Subir mídia", type=["wav", "mp3", "m4a", "ogg", "flac", "aac", "amr", "3gp", "webm"])
    st.markdown("**— ou —**")
    audio_gravado = st.audio_input("🎤 Gravar")
    grav_salvas = get_gravacoes()
    opcoes_grav = ["—"] + grav_salvas
    usar_grav = st.selectbox("🎙️ Upload biblioteca", opcoes_grav, key="usar_grav_analise")
    modo = st.radio("Modo", ["Análise completa", "Afinador", "Análise de Cover"], horizontal=True)
    if st.button("Analisar", type="primary"):
        if usar_grav != "—":
            fonte = io.BytesIO(get_gravacao_bytes(usar_grav))
        else:
            fonte = audio_in if audio_in is not None else audio_gravado
        if fonte is None:
            st.warning("Envie um áudio, grave sua voz ou escolha uma gravação salva.")
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
        elif modo == "Análise de Cover":
            with st.spinner("Analisando a gravação completa (voz + instrumental)..."):
                cover = analisar_cover(audio, sr_audio, calibracao)
            st.markdown(titulo_secao("🎧", "Análise de Cover — a gravação inteira"), unsafe_allow_html=True)
            st.markdown(metricas_html([
                ("Tom detectado", cover["tom"], "tonalidade geral"),
                ("BPM", f"{cover['bpm']:.1f}", "andamento"),
                ("Notas na escala", f"{cover['pct_na_escala']:.1f}%", "casando com o tom"),
                ("Duração", f"{cover['duracao_s']}s", "áudio analisado"),
            ]), unsafe_allow_html=True)
            st.markdown(card_html(f"**Veredito:** {cover['veredito']}"), unsafe_allow_html=True)
            if cover["notas_principais"]:
                st.markdown(f"**Notas mais presentes:** {', '.join(cover['notas_principais'])}")
            if cover["notas_fora"]:
                st.markdown(f"⚠️ **Notas fora da escala de {cover['tom']}:** {', '.join(cover['notas_fora'])}")
            else:
                st.markdown(f"✅ Todas as notas detectadas estão dentro da escala de {cover['tom']}.")
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
            ax.set_title("Curva de Pitch — gravação completa")
            ax.grid(True, alpha=0.3)
            fig.tight_layout()
            st.pyplot(fig)
        else:
            resultado = analisar_afinacao(f0_limpo, tempos, calibracao, nota_ref=nota_ref)
            devolutiva = "[!] Professor indisponível (configure a chave Gemini)."
            if cliente is not None:
                texto_resp, modelo = chamar_gemini_com_fallback(montar_prompt_professor(resultado))
                if texto_resp:
                    devolutiva = texto_resp
                else:
                    devolutiva = f"[!] Professor indisponível. Detalhe do erro: {modelo}"
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
st.markdown(
    f'<div style="background:linear-gradient(135deg, rgba(16,185,129,0.20), rgba(16,185,129,0.05));'
    f'border:1px solid rgba(16,185,129,0.45);border-radius:16px;padding:20px;'
    f'backdrop-filter:blur(12px);box-shadow:0 8px 32px rgba(16,185,129,0.22);">'
    f'<div style="font-family:Poppins;font-weight:700;color:#34d399;margin-bottom:8px;">✨ Professor IA (Gemini)</div>'
    f'{devolutiva}</div>',
    unsafe_allow_html=True
)    
    st.markdown("---")
            st.markdown(titulo_secao("🎚️", "Vibrato"), unsafe_allow_html=True)
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
    st.markdown(titulo_secao("🎸", "Afinador"), unsafe_allow_html=True)
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
                time.sleep(0.15)
    else:
        st.warning(f"Modo tempo real indisponível. Detalhe: {ERRO_WEBRTC}")
    st.markdown(titulo_secao("🎤", "Subir uma nota"), unsafe_allow_html=True)
    audio_afinador = st.file_uploader("📂 Subir nota sustentada", type=["wav", "mp3", "m4a", "ogg", "flac", "aac", "amr", "3gp", "webm"], key="afinador")
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
# ── ABA GRAVADOR (persistente no Firestore, com upload) ──
with tab_gravador:
    st.markdown(titulo_secao("🎙️", "Gravador"), unsafe_allow_html=True)
    grav_nome = st.text_input("Nome da gravação", placeholder="Ex: Cover Snuff - 23/09")
    grav_audio = st.audio_input("🎤 Gravar agora")
    st.markdown("**— ou —**")
    grav_upload = st.file_uploader("📂 Subir arquivo de áudio para salvar", type=["wav", "mp3", "m4a", "ogg", "flac", "aac", "amr", "3gp", "webm"], key="grav_upload")
    if st.button("💾 Salvar gravação", type="primary"):
        fonte_grav = grav_audio if grav_audio is not None else grav_upload
        if fonte_grav is None:
            st.warning("Grave um áudio ou suba um arquivo primeiro.")
        else:
            nome_grav = grav_nome.strip()
            if not nome_grav:
                nome_arquivo = getattr(grav_upload, "name", "") if grav_upload is not None else ""
                nome_grav = os.path.splitext(nome_arquivo)[0].strip() if nome_arquivo else ""
            if not nome_grav:
                st.warning("Dê um nome para a gravação.")
            else:
                ok = salvar_gravacao_firestore(nome_grav, fonte_grav.getvalue())
                if ok:
                    st.success(f"✅ '{nome_grav}' salva na nuvem (Firestore).")
                else:
                    if "gravacoes" not in st.session_state:
                        st.session_state["gravacoes"] = []
                    lista = [g for g in st.session_state["gravacoes"] if g["nome"] != nome_grav]
                    lista.append({"nome": nome_grav, "bytes": fonte_grav.getvalue()})
                    st.session_state["gravacoes"] = lista
                    st.warning("Não foi possível salvar na nuvem — gravação salva temporariamente na sessão. Confira se 'lameenc' está no requirements.txt e se o Firebase está conectado.")
    st.markdown("---")
    st.markdown(titulo_secao("📚", "Minhas gravações"), unsafe_allow_html=True)
    gravacoes = get_gravacoes()
    if not gravacoes:
        st.info("Nenhuma gravação salva ainda. Grave ou suba um áudio acima e salve.")
    else:
        for i, nome in enumerate(gravacoes):
            dados = get_gravacao_bytes(nome)
            c1, c2, c3 = st.columns([4, 1, 1])
            c1.markdown(f"**{nome}**")
            if dados:
                c2.download_button("⬇️", data=dados, file_name=f"{nome}.mp3", mime="audio/mpeg", key=f"dl_{i}_{nome}")
            if c3.button("🗑️", key=f"delg_{i}_{nome}"):
                if excluir_gravacao_firestore(nome):
                    st.success(f"'{nome}' excluída da nuvem.")
                    st.rerun()
                else:
                    if "gravacoes" in st.session_state:
                        st.session_state["gravacoes"] = [g for g in st.session_state["gravacoes"] if g["nome"] != nome]
                    st.rerun()
        st.caption("💡 As gravações aparecem na Análise, na Produção e a Laranjinha pode avaliá-las pelo nome.")
# ── ABA HISTÓRICO ──
with tab_historico:
    st.markdown(titulo_secao("📊", "Evolução da sua performance"), unsafe_allow_html=True)
    analises = carregar_historico_firestore()
    if not analises:
        st.info("Nenhuma análise salva ainda.")
    else:
        linhas = [{
            "Data": a.get("data", "")[5:16], "Nota": a.get("nota_predominante", ""),
            "Desvio (cents)": a.get("desvio_medio_cents", 0), "Tendência": a.get("tendencia", ""),
            "% Afinado": a.get("pct_afinado", 0), "Frases": a.get("num_frases", 0),
            "Sustentação (s)": a.get("sustentacao_media", 0), "Tom ref.": a.get("tom_ref", "—") or "—",
        } for _, a in analises]
        st.dataframe(linhas, use_container_width=True)
        if len(analises) >= 2:
            rev = list(reversed(analises))
            datas = [a.get("data", "")[5:16] for _, a in rev]
            desvios = [a.get("desvio_medio_cents", 0) for _, a in rev]
            pcts = [a.get("pct_afinado", 0) for _, a in rev]
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
        st.markdown(titulo_secao("🗑️", "Excluir análises"), unsafe_allow_html=True)
        for doc_id, a in analises:
            data_curta = a.get("data", "")[5:16]
            nota_a = a.get("nota_predominante", "—")
            pct_a = a.get("pct_afinado", 0)
            c1, c2 = st.columns([5, 1])
            c1.markdown(f"**{data_curta}** — {nota_a} — **{pct_a:.0f}%** afinado", unsafe_allow_html=True)
            if c2.button("🗑️ Excluir", key=f"del_{doc_id}"):
                if excluir_analise_firestore(doc_id):
                    st.success("✅ Análise excluída do histórico e da curva.")
                    st.rerun()
                else:
                    st.error("Não foi possível excluir. Verifique o Firebase.")
# ── ABA COMPOSIÇÕES ──
with tab_composicoes:
    st.markdown(titulo_secao("🎼", "Crie e salve suas composições"), unsafe_allow_html=True)
    c1, c2 = st.columns(2)
    comp_titulo = c1.text_input("Título da música", placeholder="Ex: Minha canção",
                                value=st.session_state.get("comp_titulo", ""))
    comp_tom = c2.text_input("Tom (opcional)", placeholder="Ex: Am, C, G",
                             value=st.session_state.get("comp_tom", ""))
    comp_letra = st.text_area("Letra com cifras e seções", height=280,
        value=st.session_state.get("comp_letra", ""),
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
    letra_atual = st.session_state.get("comp_letra", "")
    if letra_atual.strip():
        st.markdown(titulo_secao("👁️", "Visualização da letra"), unsafe_allow_html=True)
        st.markdown(renderizar_composicao_html(letra_atual), unsafe_allow_html=True)
# ── ABA EDIÇÃO VOCAL (IA) ──
with tab_edicao:
    st.markdown(titulo_secao("✨", "Peça para a IA ajustar sua voz"), unsafe_allow_html=True)
    edicao_in = st.file_uploader("Voz para editar (use o áudio isolado)", type=["wav", "mp3", "m4a", "ogg", "flac", "aac", "amr", "3gp", "webm"], key="edicao")
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
# ── ABA CONVERSOR DE FORMATO ──
with tab_conversor:
    st.markdown(titulo_secao("🔄", "Conversor de formato"), unsafe_allow_html=True)
    conv_in = st.file_uploader("📂 Subir áudio para converter", type=["wav", "mp3", "m4a", "ogg", "flac", "aac", "amr", "3gp", "webm"], key="conversor")
    conv_formato = st.radio("Converter para", ["WAV", "MP3"], horizontal=True)
    if st.button("🔄 Converter", type="primary"):
        if conv_in is None:
            st.warning("Envie um áudio para converter.")
        else:
            with st.spinner("Convertendo..."):
                audio, sr = carregar_audio(conv_in)
                if audio is None:
                    st.error("Não foi possível ler o áudio. Tente outro formato.")
                else:
                    try:
                        out_bytes, mime, nome = converter_audio(audio, sr, conv_formato)
                        st.audio(out_bytes, format=mime)
                        st.download_button("⬇️ Baixar convertido", data=out_bytes, file_name=nome, mime=mime)
                    except Exception as e:
                        if conv_formato == "MP3":
                            st.warning("Conversão para MP3 requer o pacote 'lameenc' no requirements.txt. Adicione 'lameenc' e tente de novo. (WAV funciona normalmente.)")
                        else:
                            st.error(f"Erro na conversão: {e}")
# ── ABA PRODUÇÃO (backing track musical) ──
with tab_producao:
    st.markdown(titulo_secao("🎛️", "Estúdio de Produção"), unsafe_allow_html=True)
    st.markdown(titulo_secao("1️⃣", "Captura"), unsafe_allow_html=True)
    prod_in = st.file_uploader("📂 Subir gravação (voz + violão)", type=["wav", "mp3", "m4a", "ogg", "flac", "aac", "amr", "3gp", "webm"], key="producao")
    st.markdown("**— ou —**")
    prod_grav = st.audio_input("🎤 Gravar música agora")
    grav_salvas_prod = get_gravacoes()
    opcoes_grav_prod = ["—"] + grav_salvas_prod
    usar_grav_prod = st.selectbox("🎙️ Ou usar uma gravação salva", opcoes_grav_prod, key="usar_grav_prod")
    st.markdown(titulo_secao("2️⃣", "Estilo e geração"), unsafe_allow_html=True)
    c1, c2 = st.columns(2)
    estilo = c1.selectbox("🎵 Estilo musical", list(ESTILOS_MUSICAIS.keys()))
    c2.caption(ESTILOS_MUSICAIS[estilo])
    c3, c4 = st.columns(2)
    com_baixo = c3.checkbox("Gerar baixo", value=True)
    com_bateria = c4.checkbox("Gerar bateria", value=True)
    com_acordes = st.checkbox("🎹 Gerar acordes (backing mais musical)", value=True)
    if st.button("🎛️ Gerar produção", type="primary"):
        if usar_grav_prod != "—":
            fonte_prod = io.BytesIO(get_gravacao_bytes(usar_grav_prod))
        else:
            fonte_prod = prod_in if prod_in is not None else prod_grav
        if fonte_prod is None:
            st.warning("Suba um áudio, grave sua música ou escolha uma gravação salva.")
            st.stop()
        audio, sr_audio = carregar_audio(fonte_prod)
        if audio is None:
            st.error("Não foi possível ler o áudio. Tente outro formato (WAV ou MP3).")
            st.stop()
        with st.spinner("Analisando BPM, tom e ritmo..."):
            bpm, beat_times = detectar_bpm_e_beats(audio, sr_audio)
            tom = detectar_tom(audio, sr_audio)
        st.success(f"Detectado: **{bpm:.1f} BPM** · Tom: **{tom}** · Estilo: **{estilo}**")
        baixo = None
        bateria = None
        acordes = None
        try:
            if com_baixo:
                with st.spinner("Gerando linha de baixo..."):
                    baixo = gerar_baixo_melodico(audio, sr_audio, tom, bpm, beat_times)
            if com_bateria:
                with st.spinner("Gerando bateria..."):
                    bateria = gerar_bateria_ritmica(audio, sr_audio, bpm, beat_times)
            if com_acordes:
                with st.spinner(f"Gerando acordes ({estilo})..."):
                    acordes = gerar_acordes_musicais(audio, sr_audio, tom, bpm, beat_times, estilo)
        except Exception as e:
            st.error(f"Erro ao gerar produção: {e}")
            st.stop()
        with st.spinner("Mixando..."):
            mix = mixar(audio, baixo, bateria, acordes)
        st.markdown(titulo_secao("🎧", "Resultado mixado (original + baixo + bateria + acordes):"), unsafe_allow_html=True)
        st.audio(mix, sample_rate=sr_audio)
        st.download_button(
            "⬇️ Baixar produção (WAV)",
            data=audio_para_bytes(mix, sr_audio),
            file_name="producao_orange_harmony.wav",
            mime="audio/wav",
        )
        st.info("💡 A separação de stems (voz/violão separados) exige GPU e roda no Colab — o link do notebook fica no README.")
# ══════════════════ ASSISTENTE VIRTUAL (laranjinha com memória e chats) ══════════════════
def _encontrar_laranjinha():
    nomes = ["laranjinha.png", "laranjinha.PNG", "Laranjinha.png",
             "laranjinha_transparente.png", "laranjinha_transparente.PNG",
             "mascote.png", "mascote.PNG", "orange.png", "orange.PNG"]
    pastas = ["", "assets", "img", "images", "static", "media", "imagens", "logos", "logo"]
    for pasta in pastas:
        for nome in nomes:
            caminho = os.path.join(pasta, nome) if pasta else nome
            if os.path.exists(caminho):
                return caminho
    for raiz, _, arquivos in os.walk("."):
        if raiz.count(os.sep) > 2:
            continue
        for arq in arquivos:
            if arq.lower().endswith(".png") and any(
                p in arq.lower() for p in ["laranj", "orange", "mascote"]):
                return os.path.join(raiz, arq)
    for arq in os.listdir("."):
        if arq.lower().endswith(".png"):
            return arq
    return None

LARANJINHA_PATH = _encontrar_laranjinha()
laranjinha_b64 = ""
if LARANJINHA_PATH:
    with open(LARANJINHA_PATH, "rb") as f:
        laranjinha_b64 = base64.b64encode(f.read()).decode()

@st.dialog("🍊 Laranjinha", width="large")
def laranjinha_dialog():
    if "chat_atual_id" not in st.session_state:
        chats = listar_chats_firestore()
        if chats:
            st.session_state["chat_atual_id"] = chats[0][1]
            st.session_state["chat_atual_nome"] = chats[0][0]
        else:
            novo_id = criar_chat_firestore("Chat geral")
            if novo_id:
                st.session_state["chat_atual_id"] = novo_id
                st.session_state["chat_atual_nome"] = "Chat geral"
            else:
                st.session_state["chat_atual_id"] = None
                st.session_state["chat_atual_nome"] = "Chat geral"
        st.session_state["chat_hist"] = carregar_chat_firestore(st.session_state.get("chat_atual_id")) if st.session_state.get("chat_atual_id") else []

    col_t, col_l = st.columns([3, 1])
    col_t.markdown("**🍊 Laranjinha — Assistente do Orange Harmony**")
    if col_l.button("🗑️", key="limpar_chat_btn", help="Limpar conversa atual"):
        chat_atual = st.session_state.get("chat_atual_id")
        if chat_atual:
            salvar_chat_firestore(chat_atual, [])
        st.session_state["chat_hist"] = []

    chats = listar_chats_firestore()
    opcoes_chat = {f"{nome}": cid for nome, cid in chats}
    chat_atual_id = st.session_state.get("chat_atual_id")
    chat_atual_nome = st.session_state.get("chat_atual_nome", "")
    if chat_atual_id and chat_atual_id not in opcoes_chat.values():
        opcoes_chat[chat_atual_nome or "Chat atual"] = chat_atual_id
    nomes_opcoes = list(opcoes_chat.keys())
    if chat_atual_id:
        idx = nomes_opcoes.index(chat_atual_nome) if chat_atual_nome in nomes_opcoes else 0
    else:
        idx = 0
    sel_nome = st.selectbox("Chat (um por música)", nomes_opcoes, index=idx, key="sel_chat")
    if sel_nome:
        sel_id = opcoes_chat[sel_nome]
        if sel_id != chat_atual_id:
            st.session_state["chat_atual_id"] = sel_id
            st.session_state["chat_atual_nome"] = sel_nome
            st.session_state["chat_hist"] = carregar_chat_firestore(sel_id)

    c_nome, c_cria = st.columns([3, 1])
    novo_nome = c_nome.text_input("Novo chat (ex: nome da música)", key="novo_chat_nome")
    if c_cria.button("➕", key="criar_chat_btn", help="Criar novo chat"):
        nome_final = novo_nome.strip() or f"Chat {datetime.now().strftime('%d/%m %H:%M')}"
        novo_id = criar_chat_firestore(nome_final)
        if novo_id:
            st.session_state["chat_atual_id"] = novo_id
            st.session_state["chat_atual_nome"] = nome_final
            st.session_state["chat_hist"] = []
        else:
            st.warning("Não foi possível criar o chat no Firebase — usando sessão temporária.")
            st.session_state["chat_atual_id"] = None
            st.session_state["chat_atual_nome"] = nome_final
            st.session_state["chat_hist"] = []

    st.markdown("---")

    if "chat_hist" not in st.session_state:
        st.session_state["chat_hist"] = []
    for msg in st.session_state["chat_hist"][-20:]:
        with st.chat_message(msg["role"]):
            st.markdown(msg["content"])

    with st.form("laranjinha_form", clear_on_submit=True):
        pergunta = st.text_area(
            "Escreva sua mensagem...",
            height=120,
            label_visibility="collapsed",
            placeholder="Escreva sua mensagem ou cole a letra da música aqui...",
        )
        enviar = st.form_submit_button("Enviar", type="primary")
    if enviar and pergunta.strip():
        st.session_state["chat_hist"].append({"role": "user", "content": pergunta.strip()})
        with st.chat_message("user"):
            st.markdown(pergunta.strip())
        with st.chat_message("assistant"):
            with st.spinner("Pensando..."):
                resp = assistente_resposta(pergunta.strip(), chat_id=st.session_state.get("chat_atual_id"), historico=st.session_state["chat_hist"])
            st.markdown(resp)
        st.session_state["chat_hist"].append({"role": "assistant", "content": resp})
        chat_atual = st.session_state.get("chat_atual_id")
        if chat_atual:
            salvar_chat_firestore(chat_atual, st.session_state["chat_hist"])

# ── Botão flutuante da Laranjinha (st.button → abre o chat na hora, sem reload) ──
if st.button("🍊", key="abrir_laranjinha", help="Abrir Laranjinha"):
    st.session_state["laranjinha_aberta"] = True

if st.session_state.get("laranjinha_aberta"):
    laranjinha_dialog()

# ── CSS do botão flutuante (posição fixa, PNG do mascote no próprio botão) ──
if laranjinha_b64:
    st.markdown("""
    <style>
    div[data-testid="stButton"]:has(button[title="Abrir Laranjinha"]) {
        position: fixed !important;
        bottom: 28px !important;
        right: 24px !important;
        width: 120px !important;
        height: 120px !important;
        z-index: 10000 !important;
    }
    div[data-testid="stButton"] button[title="Abrir Laranjinha"] {
        width: 120px !important;
        height: 120px !important;
        border-radius: 50% !important;
        background: url("data:image/png;base64,""" + laranjinha_b64 + """) center/contain no-repeat !important;
        background-color: transparent !important;
        border: none !important;
        box-shadow: 0 8px 30px rgba(249,115,22,0.55) !important;
        font-size: 0 !important;
        color: transparent !important;
        text-indent: -9999px !important;
        overflow: hidden !important;
    }
    </style>
    """, unsafe_allow_html=True)

# ── CSS do balão do diálogo (via st.markdown, para valer sem iframe) ──
st.markdown("""
<style>
[data-testid="stDialog"] {
    position: fixed !important;
    bottom: 175px !important;
    right: 24px !important;
    left: auto !important;
    top: auto !important;
    width: 620px !important;
    max-width: calc(100vw - 32px) !important;
    max-height: 72vh !important;
    overflow-y: auto !important;
    background: linear-gradient(165deg, rgba(35,22,10,0.97), rgba(18,12,6,0.98)) !important;
    border: 1px solid rgba(249,115,22,0.35) !important;
    border-radius: 20px !important;
    box-shadow: 0 22px 70px rgba(249,115,22,0.28), 0 0 0 1px rgba(0,0,0,0.4) !important;
    backdrop-filter: blur(16px) !important;
    animation: ohPopIn 0.3s ease !important;
    z-index: 10001 !important;
}
[data-testid="stDialogBackdrop"], dialog::backdrop {
    background: transparent !important;
    backdrop-filter: none !important;
}
@keyframes ohPopIn {
    from { opacity: 0; transform: translateY(16px) scale(0.97); }
    to { opacity: 1; transform: none; }
}
[data-testid="stDialog"] textarea {
    min-height: 120px !important;
    font-size: 1.02rem !important;
    line-height: 1.5 !important;
    border-radius: 14px !important;
    background: rgba(255,255,255,0.06) !important;
    border: 1px solid rgba(249,115,22,0.4) !important;
    color: #fff !important;
    padding: 14px 16px !important;
    resize: vertical !important;
}
[data-testid="stDialog"] .stChatMessage {
    background: rgba(255,255,255,0.04) !important;
    border-radius: 14px !important;
    border: 1px solid rgba(255,255,255,0.06) !important;
    margin-bottom: 8px !important;
}
[data-testid="stDialog"] .stChatMessage[data-testid="stChatMessageAssistant"] {
    background: linear-gradient(135deg, rgba(249,115,22,0.16), rgba(255,255,255,0.03)) !important;
    border: 1px solid rgba(249,115,22,0.22) !important;
}
</style>
""", unsafe_allow_html=True)
