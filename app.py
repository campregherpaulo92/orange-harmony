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
# ── aubio (pitch tempo real) — protegido: se o pacote faltar, o app não quebra ──
try:
    import aubio
    TEM_AUBIO = True
except Exception:
    TEM_AUBIO = False
# ═══ STEMS: gradio_client (import protegido) ═══
try:
    from gradio_client import Client, handle_file
    GRADIO_CLIENT_OK = True
except Exception:
    GRADIO_CLIENT_OK = False    
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
COL_PERFIL = "perfis_vocais"
COL_COMPOSICOES = "orange_harmony_composicoes"
COL_GRAVACOES = "orange_harmony_gravacoes"
# ══════════════════ HELPER GENÉRICO DE IMAGENS (mascotes/ícones do app) ══════════════════
def _encontrar_imagem(nomes, pastas=("", "assets", "img", "images", "static", "media", "imagens", "logos", "logo")):
    """Procura um arquivo de imagem por nome exato em várias pastas comuns do repositório."""
    for pasta in pastas:
        for nome in nomes:
            caminho = os.path.join(pasta, nome) if pasta else nome
            if os.path.exists(caminho):
                return caminho
    return None

def _busca_fallback_png(padroes):
    """Varre os 2 primeiros níveis de pastas atrás de um PNG cujo nome contenha um dos padrões."""
    for raiz, _, arquivos in os.walk("."):
        if raiz.count(os.sep) > 2:
            continue
        for arq in arquivos:
            if arq.lower().endswith(".png") and any(p in arq.lower() for p in padroes):
                return os.path.join(raiz, arq)
    return None
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
        
def renomear_chat_firestore(chat_id, novo_nome):
    """Renomeia um chat existente."""
    if db is None or not chat_id:
        return False
    try:
        db.collection(COL_CHATS).document(chat_id).update({
            "nome": (novo_nome or "Chat").strip()[:80],
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
        
        # ── LARANJINHA: acesso a dados de leitura (Firestore + session_state) ──
def ler_gravacoes_firestore(limite=20):
    """Lê os chats/históricos salvos no Firestore (coleção orange_harmony_chats)."""
    if db is None:
        return []
    resultados = []
    try:
        docs = db.collection(COL_CHATS).order_by("data", direction=firestore.Query.DESCENDING).limit(limite).stream()
        for d in docs:
            dados = d.to_dict()
            resultados.append({
                "id": d.id,
                "nome": dados.get("nome", ""),
                "data": dados.get("data", ""),
                "num_mensagens": len(dados.get("mensagens", [])),
            })
    except Exception:
        pass
    return resultados

def ler_ultima_analise():
    """Pega os dados da última análise completa do session_state."""
    for chave in ("ultima_analise", "analise", "ultima_analise_completa", "resultado_analise"):
        if chave in st.session_state and st.session_state[chave]:
            return st.session_state[chave]
    return None

def ler_aba_ativa():
    """Lê os dados atuais da aba ativa de forma genérica."""
    dados = {}
    for chave in ("tom", "bpm", "cifra", "acordes", "notas", "afinacao",
                  "parametro_edicao", "edicao_vocal", "ultimo_tom", "ultimo_bpm",
                  "ultima_cifra", "gravacao_atual", "audio_atual"):
        if chave in st.session_state:
            dados[chave] = st.session_state[chave]
    return dados
    
def ler_perfil_vocal():
    """Lê o perfil vocal salvo (voz, extensão, tessitura, classificação)."""
    return carregar_perfil_firestore()

def ler_composicoes_resumo(limite=10):
    """Lista as composições salvas (título, tom, versão)."""
    comps = listar_composicoes()[:limite]
    return [{"titulo": t, "versao": v} for t, v, _ in comps]

def ler_evolucao_resumo():
    """Retorna o resumo textual das últimas análises (mesmo texto usado no prompt do professor)."""
    return resumo_evolucao_firestore()

def ler_stems_estudio():
    """Diz se já existem stems (voz/instrumental) separados no Estúdio nesta sessão."""
    return {
        "tem_voz": bool(st.session_state.get("stems_voz")),
        "tem_instrumental": bool(st.session_state.get("stems_inst")),
    }    

# ── Ferramentas (Function Calling) que a Laranjinha pode usar ──
def executar_ferramenta(nome, argumentos):
    """Executa a ferramenta pedida pela IA e devolve o resultado."""
    if nome == "ler_gravacoes":
        return ler_gravacoes_firestore(limite=argumentos.get("limite", 20))
    if nome == "ler_ultima_analise":
        return ler_ultima_analise()
    if nome == "ler_aba_ativa":
        return ler_aba_ativa()
    if nome == "ler_perfil_vocal":
        return ler_perfil_vocal()
    if nome == "ler_composicoes_resumo":
        return ler_composicoes_resumo(limite=argumentos.get("limite", 10))
    if nome == "ler_evolucao_resumo":
        return ler_evolucao_resumo()
    if nome == "ler_stems_estudio":
        return ler_stems_estudio()
    return {"erro": f"Ferramenta desconhecida: {nome}"}
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
def classificar_voz(f_min_hz, voz_tipo):
    """Classifica a voz pela nota mais grave (aproximação prática)."""
    midi = int(round(librosa.hz_to_midi(f_min_hz)))
    if voz_tipo == "Masculina":
        if midi <= 41:
            return "Baixo"
        if midi <= 47:
            return "Barítono"
        return "Tenor"
    else:
        if midi <= 55:
            return "Contralto"
        if midi <= 59:
            return "Mezzo-soprano"
        return "Soprano"

def analisar_exercicio_avaliacao(grav, calibracao):
    """Analisa um exercício da avaliação e retorna as frequências captadas."""
    audio, sr = carregar_audio(grav)
    if audio is None:
        return None
    tempos, f0 = extrair_pitch(audio, sr)
    f0_limpo = np.where((f0 >= 70) & (f0 <= 1200), f0, 0.0)
    voz = f0_limpo[f0_limpo > 0]
    if len(voz) < 10:
        return None
    return {
        "f_min": float(np.percentile(voz, 5)),
        "f_max": float(np.percentile(voz, 95)),
        "f_med": float(np.median(voz)),
    }    
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
# ── Acordes (backing mais musical) ──
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
def mixar(audio, baixo, bateria, acordes=None):
    """Mistura com níveis calibrados por trilha e limitador suave (sem distorção)."""
    total = audio.astype(np.float32).copy()
    pico = np.max(np.abs(total)) + 1e-9
    total *= 0.70 / pico

    def adicionar(trilha, ganho):
        if trilha is None:
            return
        t = np.asarray(trilha, dtype=np.float32)
        pico_t = np.max(np.abs(t)) + 1e-9
        t = t / pico_t
        n = min(len(total), len(t))
        total[:n] += ganho * t[:n]

    adicionar(baixo, 0.28)
    adicionar(bateria, 0.32)
    adicionar(acordes, 0.16)

    limite = 0.95
    acima = np.abs(total) > limite
    if np.any(acima):
        sinal = np.sign(total[acima])
        excesso = np.abs(total[acima]) - limite
        total[acima] = sinal * (limite + excesso * 0.15)

    pico_final = np.max(np.abs(total)) + 1e-9
    if pico_final > 1.0:
        total = total / pico_final
    return total.astype(np.float32)

# ══════════════════ NOVO: DUCKING E REVERB DE MASTER (qualidade profissional) ══════════════════
def aplicar_ducking(trilha, audio_referencia, sr, intensidade=0.35):
    """Reduz o volume da trilha (baixo/acordes) quando a voz de referência está mais forte —
    simula o efeito de sidechain usado em produções profissionais."""
    if trilha is None:
        return None
    try:
        hop = 512
        rms = librosa.feature.rms(y=audio_referencia, frame_length=2048, hop_length=hop)[0]
        rms_norm = rms / (np.max(rms) + 1e-9)
        n = len(trilha)
        env = np.interp(np.linspace(0, len(rms_norm) - 1, n), np.arange(len(rms_norm)), rms_norm)
        ganho = 1.0 - intensidade * env
        return (trilha * ganho).astype(np.float32)
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
    """Aplica um reverb de master sutil por convolução (wet/dry), dando ar e coesão à mixagem."""
    if quantidade <= 0 or sinal is None:
        return sinal
    try:
        from scipy.signal import fftconvolve
        ir = gerar_reverb_ir(sr)
        molhado = fftconvolve(sinal, ir)[:len(sinal)]
        pico_molhado = np.max(np.abs(molhado)) + 1e-9
        pico_seco = np.max(np.abs(sinal)) + 1e-9
        molhado = molhado / pico_molhado * pico_seco
        return (sinal * (1 - quantidade) + molhado * quantidade).astype(np.float32)
    except Exception:
        return sinal

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
# ══════════════════ VELOCÍMETRO ══════════════════
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
def afinador_simples_html(cents, nota):
    """Afinador simplificado: nota grande + barra de cents + status colorido."""
    cents_c = max(-50.0, min(50.0, float(cents)))
    pos = (cents_c + 50) / 100 * 100
    if abs(cents_c) <= 10:
        cor = "#22c55e"
        status = "AFINADO"
    elif abs(cents_c) <= 25:
        cor = "#eab308"
        status = "PRÓXIMO"
    else:
        cor = "#ef4444"
        status = "DESAFINADO"
    return f'''
    <div style="display:flex;flex-direction:column;align-items:center;gap:8px;
                background:linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.01));
                backdrop-filter:blur(12px);border-radius:20px;padding:26px 20px;
                border:1px solid rgba(255,255,255,0.10);box-shadow:0 10px 40px rgba(0,0,0,0.45);">
        <div style="font-size:58px;font-weight:800;font-family:Montserrat,Poppins,Inter;color:#ffffff;line-height:1;">{nota}</div>
        <div style="font-size:14px;font-family:Inter;color:#bbbbbb;">{cents_c:+.0f} cents</div>
        <div style="width:100%;max-width:420px;height:14px;border-radius:7px;
                    background:linear-gradient(90deg,#ef4444,#eab308,#22c55e,#eab308,#ef4444);
                    position:relative;margin:8px 0;">
            <div style="position:absolute;left:50%;top:-4px;bottom:-4px;width:2px;background:rgba(255,255,255,0.7);"></div>
            <div style="position:absolute;left:{pos}%;top:-6px;width:8px;height:26px;border-radius:4px;
                        background:{cor};transform:translateX(-50%);box-shadow:0 0 12px {cor};"></div>
        </div>
        <div style="font-size:15px;font-weight:700;font-family:Montserrat,Poppins,Inter;color:{cor};letter-spacing:0.05em;">{status}</div>
    </div>'''
# ══════════════════ AFINADOR TEMPO REAL (WebRTC) ══════════════════
def _detectar_pitch_aubio(amostras, sr):
    if not TEM_AUBIO:
        return _detectar_pitch_autocorr(amostras, sr)
    if len(amostras) < 512:
        return None
    det = estado_afinador.get("detector_aubio")
    if det is None:
        det = aubio.pitch("yin", 2048, 512, sr)
        det.set_unit("Hz")
        det.set_tolerance(0.8)
        estado_afinador["detector_aubio"] = det
    freq = det(amostras.astype(np.float32))[0]
    if freq and 55 <= freq <= 1000:
        return float(freq)
    return None

def _detectar_pitch_autocorr(amostras, sr):
    """Detecção de pitch por autocorrelação (FFT) — sem dependências externas."""
    if len(amostras) < 256:
        return None
    x = amostras - np.mean(amostras)
    n = len(x)
    lag_min = max(2, int(sr / 1000))
    lag_max = min(n // 2, int(sr / 55))
    if lag_max <= lag_min:
        return None
    fft = np.fft.rfft(x, n=2 * n)
    corr = np.fft.irfft(fft * np.conj(fft))[:n]
    energia = np.sum(x ** 2)
    if energia < 1e-6:
        return None
    corr_norm = corr / (energia + 1e-10)
    janela = corr_norm[lag_min:lag_max]
    if len(janela) == 0:
        return None
    pico = int(np.argmax(janela)) + lag_min
    if corr_norm[pico] < 0.3:
        return None
    for mult in (2, 3):
        lag_mult = pico * mult
        if lag_mult < lag_max and corr_norm[lag_mult] > 0.85 * corr_norm[pico]:
            pico = lag_mult
    if 1 <= pico < len(corr_norm) - 1:
        y0, y1, y2 = corr_norm[pico - 1], corr_norm[pico], corr_norm[pico + 1]
        denom = y0 - 2 * y1 + y2
        if abs(denom) > 1e-12:
            pico += 0.5 * (y0 - y2) / denom
    if pico <= 0:
        return None
    freq = sr / pico
    if 55 <= freq <= 1000:
        return float(freq)
    return None
def _freq_para_nota_cents(freq, calibracao=440.0):
    midi = 69 + 12 * np.log2(freq / calibracao)
    midi_arred = int(round(midi))
    nota = f"{NOMES_NOTAS[midi_arred % 12]}{midi_arred // 12 - 1}"
    cents = 1200 * np.log2(freq / (calibracao * 2 ** ((midi_arred - 69) / 12)))
    return nota, cents
estado_afinador = {"nota": "—", "cents": 0.0, "ativo": False,
                   "calibracao": 440.0, "buffer": np.zeros(0, dtype=np.float32),
                   "hist_freq": [], "nota_estavel": "", "contador_estavel": 0,
                   "cents_suavizado": 0.0, "contador_sem_sinal": 0}
_FLAT_PARA_SHARP = {"Eb": "D#", "Ab": "G#", "Db": "C#", "Gb": "A#", "Bb": "A#"}

def _julgar_afinacao(freq, calibracao, afinacao, nota_detectada):
    """Verifica se a nota detectada pertence à afinação selecionada.
    Retorna (nota_alvo_mais_próxima, cents_até_ela, pertence)."""
    notas_afinacao = AFINACOES.get(afinacao, AFINACOES["Padrão (EADGBE)"])
    notas_norm = {_FLAT_PARA_SHARP.get(n[:-1], n[:-1]) + n[-1] for n in notas_afinacao}
    if nota_detectada in notas_norm:
        return nota_detectada, 0.0, True
    melhor = None
    for nota_alvo in notas_norm:
        try:
            f_alvo = nota_para_freq(nota_alvo, calibracao)
        except KeyError:
            continue
        cents = 1200 * np.log2(freq / f_alvo)
        if melhor is None or abs(cents) < abs(melhor[1]):
            melhor = (nota_alvo, cents)
    if melhor is None:
        return nota_detectada, 0.0, True
    return melhor[0], melhor[1], False
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
        janela = buf[-4096:] if len(buf) >= 4096 else buf[-2048:]
        freq = _detectar_pitch_autocorr(janela, frame.rate)
        if freq is not None:
            estado_afinador["contador_sem_sinal"] = 0
            hist = estado_afinador["hist_freq"]
            hist.append(freq)
            if len(hist) > 12:
                hist.pop(0)
            freq_suave = float(np.median(hist))
            nota, cents = _freq_para_nota_cents(freq_suave, estado_afinador["calibracao"])
            afinacao_ativa = estado_afinador.get("afinacao", "Padrão (EADGBE)")
            alvo_af, _, na_afinacao = _julgar_afinacao(freq_suave, estado_afinador["calibracao"], afinacao_ativa, nota)
            estado_afinador["alvo_afinacao"] = alvo_af
            estado_afinador["na_afinacao"] = na_afinacao
            if nota == estado_afinador["nota_estavel"]:
                estado_afinador["contador_estavel"] += 1
            else:
                estado_afinador["nota_estavel"] = nota
                estado_afinador["contador_estavel"] = 0
                estado_afinador["cents_suavizado"] = 0.0
            if estado_afinador["contador_estavel"] >= 3:
                prev = estado_afinador["cents_suavizado"]
                estado_afinador["cents_suavizado"] = 0.3 * cents + 0.7 * prev
                estado_afinador["nota"] = nota
                estado_afinador["cents"] = estado_afinador["cents_suavizado"]
                estado_afinador["ativo"] = True
        else:
            estado_afinador["contador_sem_sinal"] += 1
            if estado_afinador["contador_sem_sinal"] > 8:
                estado_afinador["ativo"] = False
    else:
        estado_afinador["contador_sem_sinal"] += 1
    return frame
# ══════════════════ PROFESSOR (Gemini) ══════════════════
def montar_prompt_professor(resultado):
    return (
        "Você é um professor de canto experiente, com mentalidade de produtor musical. "
        "Domina afinação, tessitura, respiração, ressonância, interpretação e produção vocal, "
        "e conhece os conceitos deste aplicativo (desvio em cents, % afinado ±50c, frases "
        "sustentadas, pausas respiratórias, vibrato).\n\n"
        "ESTILO: encorajador, mas exigente. Reconheça com sinceridade o que foi bom e aponte "
        "com clareza o que ficou ruim (oscilação entre notas, desafinação, emissão fraca, falta "
        "de apoio respiratório), sem amenizar. Elogie apenas o que realmente foi bom. Cada "
        "apontamento deve citar um dado da análise — nunca seja genérico.\n\n"
        "FORMATO: parecer em 3 seções — PONTOS FORTES, PONTOS A MELHORAR e UM EXERCÍCIO PRÁTICO — "
        "terminando com 1 desafio concreto para a próxima gravação.\n\n"
        f"Dados da análise:\n"
        f"- Nota predominante: {resultado['nota_predominante']}\n"
        f"- Desvio médio absoluto: {resultado['desvio_medio_cents']:.1f} cents\n"
        f"- Tendência: {resultado['tendencia']} ({resultado['desvio_sinal_cents']:+.1f} cents)\n"
        f"- Percentual afinado (±50 cents): {resultado['pct_afinado']:.1f}%\n"
        f"- Frases sustentadas: {resultado['num_frases']} (média {resultado['sustentacao_media']:.2f} s)\n"
        f"- Pausas respiratórias: {resultado['num_pausas']} (média {resultado['pausa_media']:.2f} s)"
    )
# ══════════════════ HISTÓRICO (Firestore) ══════════════════
def registrar_analise_firestore(resultado, modo="Análise completa", tom_ref=None, devolutiva=None):
    if db is None:
        return None
    from zoneinfo import ZoneInfo
    data_brasil = datetime.now(ZoneInfo("America/Sao_Paulo")).strftime("%d/%m/%Y")
    try:
        existentes = db.collection(COL_ANALISES).where("data_brasil", "==", data_brasil).stream()
        num_dia = len(list(existentes)) + 1
    except Exception:
        num_dia = 1
    doc = {"data": datetime.now().isoformat(),
           "data_brasil": data_brasil,
           "nome": f"{data_brasil} — Análise {num_dia}",
           "modo": modo,
           "devolutiva": devolutiva or "",
           "nota_predominante": resultado.get("nota_predominante", ""),
           "desvio_medio_cents": round(resultado.get("desvio_medio_cents", 0), 1),
           "tendencia": resultado.get("tendencia", ""),
           "pct_afinado": round(resultado.get("pct_afinado", 0), 1),
           "num_frases": resultado.get("num_frases", 0),
           "sustentacao_media": round(resultado.get("sustentacao_media", 0), 2),
           "num_pausas": resultado.get("num_pausas", 0), "tom_ref": tom_ref or ""}
    db.collection(COL_ANALISES).add(doc)
    return doc
def resumo_evolucao_firestore(max_analises=5):
    """Retorna um resumo textual das últimas análises para o professor comparar a evolução."""
    if db is None:
        return ""
    try:
        docs = db.collection(COL_ANALISES).order_by("data", direction=firestore.Query.DESCENDING).limit(max_analises).stream()
        linhas = []
        for d in docs:
            a = d.to_dict()
            linhas.append(
                f"- {a.get('data_brasil') or a.get('data', '')[:10]}: nota {a.get('nota_predominante', '—')}, "
                f"desvio {a.get('desvio_medio_cents', 0)} cents, {a.get('pct_afinado', 0)}% afinado, "
                f"tendência {a.get('tendencia', '—')}"
            )
        return "\n".join(linhas)
    except Exception:
        return ""
def salvar_perfil_firestore(perfil):
    if db is None:
        return False
    try:
        docs = list(db.collection(COL_PERFIL).limit(1).stream())
        perfil["data"] = datetime.now().isoformat()
        if docs:
            db.collection(COL_PERFIL).document(docs[0].id).set(perfil)
        else:
            db.collection(COL_PERFIL).add(perfil)
        return True
    except Exception:
        return False

def carregar_perfil_firestore():
    if db is None:
        return None
    try:
        docs = list(db.collection(COL_PERFIL).limit(1).stream())
        if docs:
            return docs[0].to_dict()
        return None
    except Exception:
        return None
def perfil_para_laranjinha():
    """Retorna o perfil vocal do aluno em texto para o contexto da Laranjinha."""
    p = carregar_perfil_firestore()
    if not p:
        return ""
    return (
        f"PERFIL VOCAL DO USUÁRIO (da avaliação inicial): voz {p.get('voz_tipo', '—')}, "
        f"classificação {p.get('classificacao', '—')}, extensão {p.get('nota_grave', '—')} a "
        f"{p.get('nota_aguda', '—')} ({p.get('extensao_semitons', '—')} semitons), "
        f"tessitura confortável {p.get('tessitura', '—')}. "
        "Use esses dados ao comentar gravações e covers: respeite a extensão nas sugestões "
        "e considere a classificação vocal ao falar da região da voz."
    )        
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

def renomear_analise_firestore(doc_id, novo_nome):
    if db is None:
        return False
    try:
        db.collection(COL_ANALISES).document(doc_id).update({"nome": novo_nome})
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
def excluir_composicao_firestore(doc_id):
    """Exclui uma composição do Firestore pelo ID do documento."""
    if db is None:
        return "⚠️ Firebase não conectado."
    if not doc_id:
        return "⚠️ Nenhuma composição selecionada para excluir."
    db.collection(COL_COMPOSICOES).document(doc_id).delete()
    return "✅ Composição excluída."
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
    """Lê um arquivo enviado (upload, gravação ou biblioteca) e devolve (audio, sr) em 22050 Hz mono."""
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
def _sinal_piano(freq, duracao, sr=22050):
    t = np.linspace(0, duracao, int(sr * duracao), endpoint=False)
    amplitudes = [1.0, 0.45, 0.22, 0.10, 0.05]
    sinal = np.zeros_like(t)
    for i, amp in enumerate(amplitudes):
        h = i + 1
        if freq * h < sr / 2:
            sinal += amp * np.exp(-t * (1.5 + 1.2 * i)) * np.sin(2 * np.pi * freq * h * t)
    ataque = int(sr * 0.008)
    sinal[:ataque] *= np.linspace(0, 1, ataque)
    pico = np.max(np.abs(sinal))
    if pico > 0:
        sinal = sinal / pico * 0.8
    return sinal.astype(np.float32)
def gerar_tom_referencia(nota, calibracao):
    nome, oitava = nota[:-1], int(nota[-1])
    midi = 12 * (oitava + 1) + NOMES_NOTAS.index(nome)
    freq = calibracao * 2 ** ((midi - 69) / 12)
    return (22050, _sinal_piano(freq, 1.5))
def gerar_escala(nota, calibracao):
    nome, oitava = nota[:-1], int(nota[-1])
    midi_raiz = 12 * (oitava + 1) + NOMES_NOTAS.index(nome)
    sr = 22050
    duracao_nota, pausa = 0.8, 0.15
    silencio = np.zeros(int(sr * pausa), dtype=np.float32)
    trechos = []
    for intervalo in ESCALA_MAIOR:
        midi = midi_raiz + intervalo
        freq = calibracao * 2 ** ((midi - 69) / 12)
        trechos.append(_sinal_piano(freq, duracao_nota, sr))
        trechos.append(silencio)
    return (sr, np.concatenate(trechos))
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
    
    # ── LARANJINHA: conversa com Function Calling (lê dados do app) ──
def converter_historico(mensagens):
    from google.genai import types
    conteudos = []
    for m in mensagens:
        papel = m.get("role") or m.get("papel") or m.get("autor") or "user"
        papel = "model" if papel in ("model", "assistant", "laranjinha", "ia") else "user"
        texto = m.get("content") or m.get("texto") or m.get("mensagem") or ""
        if texto:
            conteudos.append(types.Content(role=papel, parts=[types.Part(text=texto)]))
    return conteudos

def conversar_laranjinha(mensagem, historico):
    if cliente is None:
        return "Gemini não configurado."
    from google.genai import types
    declaracoes = [
        types.FunctionDeclaration(
            name="ler_gravacoes",
            description="Lê a lista de chats e históricos salvos do usuário no Firestore.",
            parameters={"type": "object", "properties": {"limite": {"type": "integer"}}, "required": []},
        ),
        types.FunctionDeclaration(
            name="ler_ultima_analise",
            description="Lê os dados estruturados da última Análise Completa ou do Histórico.",
        ),
        types.FunctionDeclaration(
            name="ler_aba_ativa",
            description="Lê os dados atuais da aba ativa (afinador, cifra, edição vocal etc.).",
        ),
                types.FunctionDeclaration(
            name="ler_perfil_vocal",
            description="Lê o perfil vocal do usuário: tipo de voz, classificação, extensão e tessitura.",
        ),
        types.FunctionDeclaration(
            name="ler_composicoes_resumo",
            description="Lista as composições salvas do usuário (título, tom, versão).",
            parameters={"type": "object", "properties": {"limite": {"type": "integer"}}, "required": []},
        ),
        types.FunctionDeclaration(
            name="ler_evolucao_resumo",
            description="Lê o resumo da evolução vocal do usuário nas últimas análises salvas.",
        ),
        types.FunctionDeclaration(
            name="ler_stems_estudio",
            description="Verifica se o usuário já separou stems (voz/instrumental) no Orange Studio nesta sessão.",
        ),
    ]
    instrucao_sistema = (
        "Você é a Laranjinha, assistente do Orange Harmony. "
        "Você PODE ler os dados do usuário (gravações, análises, aba ativa) "
        "usando as ferramentas quando precisar. Responda sempre em português, "
        "com base nos dados reais, não em suposições."
    )
    perfil_txt = perfil_para_laranjinha()
    if perfil_txt:
        instrucao_sistema += "\n\n" + perfil_txt    
    config = types.GenerateContentConfig(
        tools=[types.Tool(function_declarations=declaracoes)],
                system_instruction=instrucao_sistema,
    )
    conteudos = converter_historico(historico)
    conteudos.append(types.Content(role="user", parts=[types.Part(text=mensagem)]))
    modelos_tentar = [modelo_atual()] + [m for m in MODELOS_DISPONIVEIS if m != modelo_atual()]
    ultimo_erro = ""
    for modelo in modelos_tentar:
        for _ in range(5):
            try:
                resposta = cliente.models.generate_content(
                    model=modelo, contents=conteudos, config=config,
                )
            except Exception as e:
                ultimo_erro = str(e)
                break
            chamadas = resposta.function_calls or []
            if not chamadas:
                return resposta.text or "Não consegui gerar uma resposta."
            conteudos.append(resposta.candidates[0].content)
            for fc in chamadas:
                resultado = executar_ferramenta(fc.name, dict(fc.args or {}))
                conteudos.append(types.Content(
                    role="user",
                    parts=[types.Part(function_response=types.FunctionResponse(
                        name=fc.name, response={"resultado": resultado}))],
                ))
        else:
            continue
        continue
    return f"Erro ao chamar o assistente: {ultimo_erro[:200]}"

# ══════════════════ NOVO: INTERPRETAÇÃO IA DO COMANDO DE EDIÇÃO VOCAL ══════════════════
def interpretar_comando_edicao_ia(comando):
    """Interpreta o comando em ações estruturadas. Usa palavras-chave como piso mínimo e,
    quando o Gemini está disponível, enriquece a interpretação via prompt estruturado (JSON)."""
    padrao = {
        "reduzir_ruido": False, "normalizar": False, "ajustar_tom": 0.0,
        "eq_presenca": False, "compressao": False, "remover_sibilancia": False,
        "reverb_leve": False,
    }
    cmd = (comando or "").lower()
    if any(p in cmd for p in ["ruído", "ruido", "limpa", "limpe", "barulho"]):
        padrao["reduzir_ruido"] = True
    if any(p in cmd for p in ["normaliz", "volume", "alto", "baixo"]):
        padrao["normalizar"] = True
    if any(p in cmd for p in ["tom", "afin", "pitch", "alinha"]):
        padrao["ajustar_tom"] = 0.5
    if any(p in cmd for p in ["presente", "eq", "clareza", "brilho"]):
        padrao["eq_presenca"] = True
    if any(p in cmd for p in ["compress", "dinamica", "dinâmica", "punch"]):
        padrao["compressao"] = True
    if any(p in cmd for p in ["sibil", "assobio", "chiado agudo"]):
        padrao["remover_sibilancia"] = True
    if any(p in cmd for p in ["reverb", "ambiente", "espaço", "espaco", "sala"]):
        padrao["reverb_leve"] = True
    if cliente is None:
        return padrao
    prompt = (
        "Você é um engenheiro de mixagem vocal especialista em produções profissionais. "
        "Interprete o pedido do usuário e devolva APENAS um JSON válido (sem markdown, sem texto "
        "explicativo antes ou depois), com estas chaves:\n"
        '{"reduzir_ruido": bool, "normalizar": bool, "ajustar_tom": number (semitons, 0 se não pedido, '
        'pode ser negativo para descer), "eq_presenca": bool, "compressao": bool, '
        '"remover_sibilancia": bool, "reverb_leve": bool}\n\n'
        f'Comando do usuário: "{comando}"\n\n'
        "Se o comando for vago (ex: 'deixa melhor', 'limpa tudo', 'deixa profissional'), ative "
        "reduzir_ruido, normalizar, eq_presenca e compressao. Se mencionar 'grave' ou 'engolida', "
        "considere ajustar_tom levemente negativo; se mencionar 'fina' ou 'esganiçada', considere "
        "remover_sibilancia. Responda só o JSON."
    )
    texto_resp, _ = chamar_gemini_com_fallback(prompt)
    if not texto_resp:
        return padrao
    try:
        limpo = texto_resp.strip().strip("`")
        if limpo.lower().startswith("json"):
            limpo = limpo[4:].strip()
        dados = json.loads(limpo)
        for k in padrao:
            if k in dados:
                padrao[k] = dados[k]
    except Exception:
        pass
    return padrao

# ══════════════════ CONHECIMENTO DO APP (memória da Laranjinha) ══════════════════
CONHECIMENTO_APP = """
Você é a Laranjinha, assistente oficial do Orange Harmony, e conhece TODO o aplicativo em detalhe. Guia completo:

## Abas do aplicativo
1. **🎵 Análise e Estudo**: toca nota/escala de referência; analisa voz via upload, gravação ou biblioteca.
   Modo "Análise completa" dá nota predominante, desvio em cents, tendência, % afinado, frases sustentadas,
   pausas, curva de pitch, vibrato (taxa, extensão, deslize) e devolutiva do professor IA — que considera o
   perfil vocal do aluno e o histórico recente de evolução. Modo "Análise de Cover" avalia a gravação inteira
   (voz + instrumental): tom, BPM, % de notas na escala e veredito.
2. **📋 Avaliação Vocal**: 5 exercícios guiados (grave, aguda, confortável, glissando, frase natural) que geram
   o perfil vocal do usuário (classificação: Baixo/Barítono/Tenor ou Contralto/Mezzo/Soprano, extensão em
   semitons, tessitura confortável). Esse perfil alimenta todas as devolutivas do professor.
3. **🎸 Afinador**: afinações de violão/guitarra/ukulele (padrão, Drop D/C/B, meio tom abaixo, Open G/D/C,
   DADGAD, 7 cordas, ukulele), calibração A4 (440/442) e modo tempo real via microfone (agulha visual).
4. **🎙️ Gravador**: grava ou sobe áudio, nomeia e salva na nuvem (Firestore, comprimido em MP3). As gravações
   salvas aparecem na Análise, na Produção, e você pode avaliá-las pelo nome quando o usuário pedir.
5. **📊 Histórico**: tabela e gráfico de evolução (desvio médio em cents e % afinado ao longo do tempo),
   relatório detalhado por análise (com a devolutiva salva), renomear e excluir análises.
6. **🎼 Composições**: cria e salva letras com cifras (ex: [Am]) e seções marcadas com # (Verso, Refrão, Ponte),
   com versionamento automático (v1, v2...) e prévia colorida.
7. **✨ Edição Vocal (IA)**: o usuário escreve um comando em linguagem natural (ex: "limpa o ruído e deixa mais
   profissional") e a IA interpreta esse comando em ações estruturadas: redução de ruído, normalização, ajuste
   fino de tom em semitons, EQ de presença, compressão suave, remoção de sibilância e reverb leve.
8. **🔄 Conversor**: aceita WAV, MP3, M4A, OGG, FLAC, AAC, AMR, 3GP, WebM, OPUS e WMA como entrada, e converte
   para múltiplos formatos de saída ao mesmo tempo (WAV, MP3, FLAC, OGG, M4A).
9. **🎛️ Produção**: gera backing track completo (baixo melódico com groove, bateria dinâmica com kick/snare/
   hat/crash sintetizados, acordes na progressão I-V-vi-IV) no tom e BPM detectados da gravação, em 12 estilos
   musicais. Tem opção de "qualidade profissional": ducking dinâmico (o baixo e os acordes abaixam de volume
   quando a voz está mais forte, como um sidechain de estúdio) e reverb de master para dar coesão à mixagem.
10. **🤖 Songwriter**: gera uma música instrumental+vocal a partir de uma descrição livre (estilo,
    instrumentos, clima, BPM); o prompt é automaticamente enriquecido com descritores de produção profissional
    (mixagem limpa, masterização coerente, dinâmica natural) antes de ir para o modelo gerador.
11. **🎛️ Orange Studio (botão flutuante, ícone laranja)**: separação de voz/instrumental (stems) via Demucs
    rodando num notebook do Google Colab. O painel cobre quase a tela toda; tem um botão que abre o notebook
    do Colab diretamente, um campo para colar a URL gradio.live gerada (que muda a cada execução da célula),
    gravação/upload do áudio a separar, e depois de separado mostra as faixas "Vocals" e "Instrumental" com
    um player de espectro animado (canvas + Web Audio API), download de cada faixa, e as faixas continuam
    visíveis no rodapé da página mesmo com o Estúdio fechado.

## Ferramentas que você pode usar (function calling)
Você pode ler dados reais do usuário via ferramentas: gravações salvas, última análise, aba ativa, perfil
vocal, lista de composições, resumo da evolução vocal, e se já existem stems separados no Estúdio. SEMPRE
prefira usar essas ferramentas a supor informações quando o usuário perguntar sobre o próprio progresso,
perfil ou histórico.

## Como você funciona
- Avalia gravações salvas quando o usuário pede "avalia a gravação [nome]" (ouve o áudio de verdade).
- Dá dicas de canto, explica pitch/afinação/vibrato/respiração/sustentação, ajuda com letras e composições,
  orienta sobre produção musical e sobre como usar o Orange Studio.
- Sempre responde em português, de forma acolhedora, prática, específica e encorajadora — nunca genérica.
"""
# ══════════════════ ASSISTENTE VIRTUAL (Gemini) ══════════════════
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
    texto_resp = conversar_laranjinha(prompt, st.session_state["chat_hist"])
    if texto_resp:
        return texto_resp
    return "Erro ao chamar o assistente."
# ══════════════════ ANÁLISE DE COVER ══════════════════
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
# ══════════════════ CONVERSOR MULTI-FORMATO ══════════════════
FORMATOS_CONVERSOR = ["WAV", "MP3", "FLAC", "OGG", "M4A"]

def converter_audio(audio, sr, formato_destino):
    """Converte para o formato pedido. WAV/FLAC/OGG via soundfile, MP3 via lameenc,
    M4A via pydub+ffmpeg (se disponível no ambiente)."""
    import soundfile as sf
    formato_destino = (formato_destino or "").upper()
    if formato_destino == "WAV":
        return audio_para_bytes(audio, sr), "audio/wav", "convertido.wav"
    if formato_destino == "FLAC":
        buf = io.BytesIO()
        sf.write(buf, audio, sr, format="FLAC")
        return buf.getvalue(), "audio/flac", "convertido.flac"
    if formato_destino == "OGG":
        buf = io.BytesIO()
        sf.write(buf, audio, sr, format="OGG", subtype="VORBIS")
        return buf.getvalue(), "audio/ogg", "convertido.ogg"
    if formato_destino == "MP3":
        import lameenc
        encoder = lameenc.Encoder()
        encoder.set_bit_rate(192)
        encoder.set_in_sample_rate(sr)
        encoder.set_channels(1)
        pcm = (audio * 32767).astype(np.int16).tobytes()
        mp3_bytes = encoder.encode(pcm) + encoder.flush()
        return mp3_bytes, "audio/mpeg", "convertido.mp3"
    if formato_destino == "M4A":
        try:
            from pydub import AudioSegment
        except Exception:
            raise RuntimeError("Conversão para M4A requer 'pydub' + ffmpeg no ambiente (adicione ao requirements.txt/packages.txt).")
        wav_bytes = audio_para_bytes(audio, sr)
        seg = AudioSegment.from_wav(io.BytesIO(wav_bytes))
        buf = io.BytesIO()
        seg.export(buf, format="ipod")
        return buf.getvalue(), "audio/mp4", "convertido.m4a"
    raise RuntimeError(f"Formato de destino não suportado: {formato_destino}")
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

    .stSpinner > div { border-top-color: #f97316 !important; }
    [data-testid="stSuccess"] {
        background: linear-gradient(135deg, rgba(34,197,94,0.15), rgba(255,255,255,0.03));
        border: 1px solid rgba(34,197,94,0.3); border-radius: 12px; backdrop-filter: blur(8px);
    }
    [data-testid="stWarning"], [data-testid="stError"], [data-testid="stInfo"] { border-radius: 12px; backdrop-filter: blur(8px); }

    html, body, .stApp, .stApp * {
        font-family: 'Inter', sans-serif !important;
    }
    label, .stSelectbox label, .stRadio label, .stTextInput label,
    .stNumberInput label, .stTextArea label {
        font-family: 'Poppins', sans-serif !important;
    }
    .stButton > button, .stDownloadButton > button {
        font-family: 'Poppins', sans-serif !important;
    }
    .stTabs [data-baseweb="tab"] {
        font-family: 'Poppins', sans-serif !important;
    }
    .stSelectbox div[data-baseweb="select"] *,
    .stRadio div[role="radiogroup"] *,
    .stNumberInput input, .stTextInput input, .stTextArea textarea {
        font-family: 'Inter', sans-serif !important;
    }

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
        /* ═══ Correção do botão "Browse files" sobreposto em colunas estreitas ═══ */
    [data-testid="stFileUploaderDropzone"] {
        flex-wrap: wrap !important;
    }
    [data-testid="stFileUploaderDropzone"] button {
        white-space: nowrap !important;
        min-width: 132px !important;
        flex-shrink: 0 !important;
        margin-top: 6px !important;
    }
    [data-testid="stFileUploaderDropzoneInstructions"] {
        overflow: hidden !important;
        min-width: 0 !important;
    }
    [data-testid="stFileUploaderDropzoneInstructions"] span {
        white-space: normal !important;
    }
</style>
""", unsafe_allow_html=True)
# ══════════════════ LOGO ══════════════════
LOGO_PATH = "logo_orange_harmony_transparente.png"
if os.path.exists(LOGO_PATH):
    with open(LOGO_PATH, "rb") as f:
        logo_b64 = base64.b64encode(f.read()).decode()
    st.markdown(f'''
    <div style="text-align:center;padding:12px 0 6px 0;">
        <img src="data:image/png;base64,{logo_b64}"
             style="height:200px;width:auto;max-width:92%;object-fit:contain;
                    border-radius:16px;box-shadow:0 10px 40px rgba(249,115,22,0.35);">
    </div>
    ''', unsafe_allow_html=True)
else:
    st.markdown('<h1 style="text-align:center;">🍊 Orange Harmony</h1>', unsafe_allow_html=True)
st.markdown(
    '<div style="text-align:center;font-family:Poppins,sans-serif;font-weight:700;'
    'font-size:1.05rem;background:linear-gradient(90deg,#f97316,#ffb066,#f97316,#ffb066,#f97316);'
    'background-size:300% auto;-webkit-background-clip:text;-webkit-text-fill-color:transparent;'
    'background-clip:text;animation:ohGradient 4s linear infinite;margin:12px 0 18px;">'
    'AI Powered Vocal Analisys & Coaching</div>',
    unsafe_allow_html=True,
)

if "modelo_ia" not in st.session_state:
    st.session_state["modelo_ia"] = MODELOS_DISPONIVEIS[0]
    
# ══════════════════ NAVEGAÇÃO LATERAL (sidebar estilo Claude) ══════════════════
PAGINAS_APP = [
    ("avaliacao",   "📋", "Avaliação"),
    ("analise",     "🎵", "Estudo"),
    ("afinador",    "🎸", "Afinador"),
    ("gravador",    "🎙️", "Gravador"),
    ("historico",   "📊", "Histórico"),
    ("composicoes", "🎼", "Composições"),
    ("conversor",   "🔄", "Conversor"),
    ("producao",    "🎛️", "Produtor"),
    ("edicao",      "✨", "Edição Vocal Inteligente"),
    ("songwriter",  "🤖", "Songwriter"),
]

if "pagina_ativa" not in st.session_state:
    st.session_state["pagina_ativa"] = PAGINAS_APP[0][0]

st.markdown("""
<style>
    /* ═══ Sidebar estilo Claude: fundo escuro, item ativo destacado, fonte Poppins ═══ */
    section[data-testid="stSidebar"] {
        background: linear-gradient(180deg, #14100c, #0a0806) !important;
        border-right: 1px solid rgba(249,115,22,0.18) !important;
    }
    section[data-testid="stSidebar"] .stButton > button {
        width: 100% !important;
        text-align: left !important;
        justify-content: flex-start !important;
        background: transparent !important;
        color: #d9d9d9 !important;
        border: 1px solid transparent !important;
        border-radius: 10px !important;
        font-family: 'Poppins', sans-serif !important;
        font-weight: 600 !important;
        font-size: 0.92rem !important;
        padding: 0.55rem 0.9rem !important;
        box-shadow: none !important;
        margin-bottom: 2px !important;
        transition: all 0.15s ease !important;
    }
    section[data-testid="stSidebar"] .stButton > button:hover {
        background: rgba(249,115,22,0.10) !important;
        color: #fff !important;
        transform: none !important;
        box-shadow: none !important;
    }
    section[data-testid="stSidebar"] .stButton > button[kind="primary"] {
        background: linear-gradient(135deg, rgba(249,115,22,0.22), rgba(249,115,22,0.08)) !important;
        color: #f97316 !important;
        border: 1px solid rgba(249,115,22,0.35) !important;
        box-shadow: 0 0 12px rgba(249,115,22,0.15) !important;
    }
    section[data-testid="stSidebar"] .oh-sidebar-titulo {
        font-family: 'Poppins', sans-serif;
        font-weight: 800;
        font-size: 1.7rem;
        text-align: center;
        padding: 10px 0 20px 0;
        background: linear-gradient(90deg, #f97316, #ffb066, #f97316, #ffb066, #f97316);
        background-size: 300% auto;
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
        animation: ohGradient 4s linear infinite;
    }
    /* ═══ Deixa os itens do menu lateral com fonte maior de fato ═══ */
    section[data-testid="stSidebar"] .stButton > button p,
    section[data-testid="stSidebar"] .stButton > button span,
    section[data-testid="stSidebar"] .stButton > button div {
        font-family: 'Poppins', sans-serif !important;
        font-size: 1.05rem !important;
        font-weight: 600 !important;
    }
</style>
""", unsafe_allow_html=True)

with st.sidebar:
    st.markdown(
        '<div style="text-align:center;font-size:2rem;margin-bottom:-6px;"></div>'
        '<div class="oh-sidebar-titulo">ORANGE HARMONY</div>',
        unsafe_allow_html=True,
    )
    for chave, icone, rotulo in PAGINAS_APP:
        ativo = st.session_state["pagina_ativa"] == chave
        if st.button(
            f"{icone}  {rotulo}",
            key=f"nav_{chave}",
            type="primary" if ativo else "secondary",
            use_container_width=True,
        ):
            st.session_state["pagina_ativa"] = chave
            st.rerun()

pagina_ativa = st.session_state["pagina_ativa"]
# ── ABA ANÁLISE E ESTUDO ──
if pagina_ativa == "analise":
    st.markdown(titulo_secao("🎯", "Tom de Referência"), unsafe_allow_html=True)
    c1, c2 = st.columns(2)
    nota_ref = c1.selectbox("Nota de referência", NOTAS_REFERENCIA, index=NOTAS_REFERENCIA.index("C4"), key="nota_ref_sel")
    calibracao = c2.radio("Calibração A4 (Hz)", [440, 442], horizontal=True, key="calibracao_radio")
    c3, c4 = st.columns(2)
    if c3.button("▶ Tocar nota", key="btn_tocar_nota"):
        sr, sinal = gerar_tom_referencia(nota_ref, calibracao)
        wav = audio_para_bytes(sinal, sr)
        b64 = base64.b64encode(wav).decode()
        components.html(
            f'<audio id="oh_tom" src="data:audio/wav;base64,{b64}"></audio>'
            '<script>document.getElementById("oh_tom").play();</script>',
            height=0
        )
    if c4.button("🎵 Tocar escala maior", key="btn_tocar_escala"):
        sr, sinal = gerar_escala(nota_ref, calibracao)
        wav = audio_para_bytes(sinal, sr)
        b64 = base64.b64encode(wav).decode()
        components.html(
            f'<audio id="oh_escala" src="data:audio/wav;base64,{b64}"></audio>'
            '<script>document.getElementById("oh_escala").play();</script>',
            height=0
        )
    st.markdown("---")
    st.markdown(titulo_secao("🎤", "Análise Vocal"), unsafe_allow_html=True)
    audio_in = st.file_uploader("📂 Subir mídia", type=["wav", "mp3", "m4a", "ogg", "flac", "aac", "amr", "3gp", "webm"], key="analise_upload")
    st.markdown("****")
    audio_gravado = st.audio_input("🎤 Gravar", key="analise_gravar")
    grav_salvas = get_gravacoes()
    opcoes_grav = ["—"] + grav_salvas
    usar_grav = st.selectbox("🎙️ Upload biblioteca", opcoes_grav, key="usar_grav_analise")
    modo = st.radio("Modo", ["Análise completa", "Análise de Cover"], horizontal=True, key="modo_analise_radio")
    base_devolutiva = st.radio(
        "🎯 Base da devolutiva",
        ["Nota detectada (voz natural)", "Nota de referência"],
        horizontal=True,
        key="base_devolutiva_radio",
    )    
    if st.button("Analisar", type="primary", key="btn_analisar"):
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
        if modo == "Análise de Cover":
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
            if cliente is not None:
                prompt_cover = (
                    "Você é um professor de canto. Dê uma devolutiva curta e prática em português sobre esta performance de cover. "
                    f"Dados: tom {cover['tom']}, BPM {cover['bpm']:.1f}, {cover['pct_na_escala']:.1f}% das notas dentro da escala. "
                    f"Notas mais presentes: {', '.join(cover['notas_principais']) or '—'}. "
                    f"Notas fora da escala: {', '.join(cover['notas_fora']) or 'nenhuma'}. "
                    "Comente se a voz está casando com o tom, destaque pontos fortes e dê 2 dicas práticas."
                )
                with st.spinner("Professor analisando o cover..."):
                    texto_cover, modelo_cover = chamar_gemini_com_fallback(prompt_cover)
                if texto_cover:
                    st.markdown(
                        f'<div style="background:linear-gradient(135deg, rgba(16,185,129,0.20), rgba(16,185,129,0.05));'
                        f'border:1px solid rgba(16,185,129,0.45);border-radius:16px;padding:20px;'
                        f'backdrop-filter:blur(12px);box-shadow:0 8px 32px rgba(16,185,129,0.22);">'
                        f'<div style="font-family:Poppins;font-weight:700;color:#34d399;margin-bottom:8px;">✨ Devolutiva do Professor IA</div>'
                        f'{texto_cover}</div>',
                        unsafe_allow_html=True
                    )                
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
            seq_notas = extrair_sequencia_notas(f0_limpo, tempos)
            notas_unicas = sorted({n for n, _ in seq_notas})
            historico_recente = resumo_evolucao_firestore()
            perfil_aluno = carregar_perfil_firestore()            
            devolutiva = "[!] Professor indisponível (configure a chave Gemini)."
            if cliente is not None:
                prompt_prof = montar_prompt_professor(resultado)
                if base_devolutiva == "Nota detectada (voz natural)":
                    prompt_prof += (
                        f"\n\nIMPORTANTE: o cantor cantou com a voz natural, sem seguir a nota de referência "
                        f"({nota_ref}). Baseie a devolutiva na nota detectada ({resultado['nota_predominante']}): "
                        "avalie a estabilidade e a afinação em relação à própria nota cantada, comente a região da voz "
                        "(tessitura aparente) e NÃO trate a diferença para a nota de referência como erro."
                    )
                else:
                    prompt_prof += (
                        f"\n\nIMPORTANTE: o cantor tentou seguir a nota de referência ({nota_ref}). "
                        "Compare a nota detectada com a referência e dê orientações práticas de ajuste para chegar nela."
                    )
                if seq_notas:
                    prompt_prof += (
                        f"\n\nSEQUÊNCIA MELÓDICA DETECTADA ({len(seq_notas)} notas sustentadas): "
                        + " → ".join(f"{n} ({d}s)" for n, d in seq_notas[:15])
                        + f". Notas distintas: {', '.join(notas_unicas)}. "
                        "Analise a oscilação entre essas notas: as transições foram limpas ou arrastadas? "
                        "Houve notas fora da linha melódica esperada? Comente o percurso melódico cantado."
                    )
                if historico_recente:
                    prompt_prof += (
                        "\n\nHISTÓRICO RECENTE DO ALUNO (últimas análises, mais recente primeiro):\n"
                        + historico_recente
                        + "\nCompare o desempenho atual com esse histórico. Se um problema persiste "
                        "(mesma tendência, desvio alto repetido), cobre diretamente: 'a gente já trabalhou "
                        "isso e não houve melhora — treine X'. Se houve melhora, reconheça o avanço citando os números."
                    )                    
                texto_resp, modelo = chamar_gemini_com_fallback(prompt_prof)
                if perfil_aluno:
                    prompt_prof += (
                        "\n\nPERFIL VOCAL DO ALUNO (da avaliação inicial):\n"
                        f"- Voz: {perfil_aluno.get('voz_tipo', '—')} — classificação: {perfil_aluno.get('classificacao', '—')}\n"
                        f"- Extensão: {perfil_aluno.get('nota_grave', '—')} a {perfil_aluno.get('nota_aguda', '—')} "
                        f"({perfil_aluno.get('extensao_semitons', '—')} semitons)\n"
                        f"- Tessitura confortável: {perfil_aluno.get('tessitura', '—')}\n"
                        "Use este perfil como base: avalie se as notas cantadas estão dentro da extensão, "
                        "respeite a tessitura nas sugestões de exercícios e considere a classificação vocal "
                        "ao comentar a região da voz."
                    )                
                if texto_resp:
                    devolutiva = (f"🎯 Afinação detectada: nota {resultado['nota_predominante']} — "
                                  f"{resultado['desvio_sinal_cents']:+.1f} cents ({resultado['tendencia']}).\n\n" + texto_resp)
                else:
                    devolutiva = f"[!] Professor indisponível. Detalhe do erro: {modelo}"
            try:
                registrar_analise_firestore(resultado, modo, devolutiva=devolutiva)
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
if pagina_ativa == "afinador":
    st.markdown(titulo_secao("🎸", "Afinador"), unsafe_allow_html=True)
    c1, c2 = st.columns(2)
    afincao = c1.selectbox("Afinação", list(AFINACOES.keys()), key="afinador_sel")
    calib_afinador = c2.radio("Calibração A4", [440, 442], horizontal=True, key="afinador_calib_radio")
    st.markdown(DESCRICOES_AFINACOES.get(afincao, ""))
    if TEM_WEBRTC:
        st.markdown(titulo_secao("⚡", "Modo agulha"), unsafe_allow_html=True)
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
            inicio = time.time()
            while webrtc_ctx.state.playing:
                nota_v = estado_afinador["nota"] if estado_afinador["ativo"] else "—"
                cents_v = estado_afinador["cents"] if estado_afinador["ativo"] else 0.0
                html_afinador = afinador_simples_html(cents_v, nota_v)
                if estado_afinador.get("ativo") and not estado_afinador.get("na_afinacao", True):
                    html_afinador += (f'<div style="text-align:center;color:#f59e0b;font-weight:600;'
                                      f'margin-top:6px;">🎯 Fora da afinação «{afincao}» — alvo mais próximo: {estado_afinador.get("alvo_afinacao", "—")}</div>')
                placeholder.markdown(html_afinador, unsafe_allow_html=True)
                time.sleep(0.15)
                if time.time() - inicio > 60:
                    break
        else:
            st.info("Clique em 'Iniciar' para ativar")
    else:
        st.warning(f"Modo tempo real indisponível. Detalhe: {ERRO_WEBRTC}")

# ── ABA GRAVADOR ──
if pagina_ativa == "gravador":
    st.markdown(titulo_secao("🎙️", "Gravador"), unsafe_allow_html=True)
    grav_nome = st.text_input("Nome da gravação", placeholder="Ex: Cover Snuff - 23/09", key="grav_nome_input")
    grav_audio = st.audio_input("Gravar", key="grav_audio_input")
    st.markdown("****")
    grav_upload = st.file_uploader("📂 Upload na nuvem", type=["wav", "mp3", "m4a", "ogg", "flac", "aac", "amr", "3gp", "webm"], key="grav_upload")
    if st.button("💾 Salvar gravação", type="primary", key="btn_salvar_gravacao"):
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
# ── ABA AVALIAÇÃO VOCAL ──
if pagina_ativa == "avaliacao":
    st.markdown(titulo_secao("📋", "Avaliação Vocal Inicial"), unsafe_allow_html=True)
    perfil_salvo = carregar_perfil_firestore()
    if perfil_salvo:
        st.info(f"Você já tem uma avaliação salva. Refazer os exercícios atualiza o seu perfil.")
    st.markdown(
        "Esta avaliação mapeia sua voz: extensão, tessitura e classificação vocal. "
        "O professor vai usar esse perfil em **todas** as análises da aba de estudo."
    )
    voz_tipo = st.radio("Sua voz é", ["Masculina", "Feminina"], horizontal=True, key="voz_tipo_av")
    exercicios = [
        ("Nota mais GRAVE", "Cante a nota mais grave que conseguir, sustentando por 3 segundos."),
        ("Nota mais AGUDA", "Cante a nota mais aguda confortável, sustentando por 3 segundos."),
        ("Nota confortável", "Cante uma nota no seu tom confortável e sustente por 5 segundos."),
        ("Glissando", "Deslize a voz do grave ao agudo e volte, sem pausas."),
        ("Frase natural", "Cante uma frase de uma música que você gosta, com voz natural."),
    ]
    resultados_av = {}
    for titulo_ex, instrucao in exercicios:
        st.markdown(f"**{titulo_ex}** — {instrucao}")
        grav_ex = st.audio_input(f"🎤 Gravar: {titulo_ex}", key=f"av_{titulo_ex}")
        if grav_ex is not None:
            res_ex = analisar_exercicio_avaliacao(grav_ex, calibracao)
            if res_ex:
                resultados_av[titulo_ex] = res_ex
                st.success(f"✅ Capturado: {librosa.hz_to_note(res_ex['f_min'])} a {librosa.hz_to_note(res_ex['f_max'])}")
            else:
                st.warning("Não detectei voz. Tente de novo, mais perto do microfone.")
    if len(resultados_av) >= 3 and st.button("📊 Gerar minha avaliação", type="primary", key="btn_gerar_avaliacao"):
        f_min = min(r["f_min"] for r in resultados_av.values())
        f_max = max(r["f_max"] for r in resultados_av.values())
        f_med = float(np.mean([r["f_med"] for r in resultados_av.values()]))
        nota_grave = librosa.hz_to_note(f_min)
        nota_aguda = librosa.hz_to_note(f_max)
        extensao_st = int(round(librosa.hz_to_midi(f_max) - librosa.hz_to_midi(f_min)))
        perfil = {
            "voz_tipo": voz_tipo,
            "nota_grave": nota_grave,
            "nota_aguda": nota_aguda,
            "extensao_semitons": extensao_st,
            "tessitura": librosa.hz_to_note(f_med),
            "classificacao": classificar_voz(f_min, voz_tipo),
            "exercicios_feitos": len(resultados_av),
        }
        if salvar_perfil_firestore(perfil):
            st.markdown(titulo_secao("🎓", "Seu Perfil Vocal"), unsafe_allow_html=True)
            st.markdown(metricas_html([
                ("Classificação", perfil["classificacao"], f"voz {voz_tipo.lower()}"),
                ("Extensão", f"{nota_grave} → {nota_aguda}", f"{extensao_st} semitons"),
                ("Tessitura confortável", perfil["tessitura"], "onde sua voz mora"),
                ("Exercícios", f"{len(resultados_av)}/5", "capturados nesta avaliação"),
            ]), unsafe_allow_html=True)
            st.success("Perfil salvo! O professor já vai usar esses dados nas próximas análises.")
        else:
            st.error("Não foi possível salvar o perfil no Firestore.")        
# ── ABA HISTÓRICO ──
if pagina_ativa == "historico":
    st.markdown(titulo_secao("📊", "Tabela de Evolução/Performance"), unsafe_allow_html=True)
    analises = carregar_historico_firestore()

    def _data_curta(a):
        return a.get("data_brasil") or a.get("data", "")[5:16]

    def _rotulo(a):
        return a.get("nome") or _data_curta(a)

    if not analises:
        st.info("Nenhuma análise salva ainda.")
    else:
        datas_disp = ["Todas"] + sorted({_data_curta(a) for _, a in analises}, reverse=True)
        filtro_data = st.selectbox("📅 Filtrar por data", datas_disp, key="filtro_data_hist")
        filtradas = [(i, a) for i, a in analises if filtro_data == "Todas" or _data_curta(a) == filtro_data]
        if not filtradas:
            st.info("Nenhuma análise nessa data.")
        else:
            linhas = [{
                "Análise": _rotulo(a), "Data": _data_curta(a), "Nota": a.get("nota_predominante", ""),
                "Desvio (cents)": a.get("desvio_medio_cents", 0), "Tendência": a.get("tendencia", ""),
                "% Afinado": a.get("pct_afinado", 0), "Frases": a.get("num_frases", 0),
                "Sustentação (s)": a.get("sustentacao_media", 0), "Tom ref.": a.get("tom_ref", "—") or "—",
            } for _, a in filtradas]
            st.dataframe(linhas, use_container_width=True)
            if len(filtradas) >= 2:
                rev = list(reversed(filtradas))
                datas = [_data_curta(a) for _, a in rev]
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
            st.markdown(titulo_secao("📄", "Relatório Detalhado"), unsafe_allow_html=True)
            opcoes = [_rotulo(a) for _, a in filtradas]
            idx_det = st.selectbox("Escolha a análise", range(len(filtradas)), format_func=lambda i: opcoes[i], key="det_sel")
            det_id, det = filtradas[idx_det]
            st.markdown(metricas_html([
                ("Análise", det.get("modo", "Análise completa"), _data_curta(det)),
                ("Nota predominante", det.get("nota_predominante", "—"), "nota mais cantada"),
                ("Desvio médio", f"{det.get('desvio_medio_cents', 0):.1f} cents", "quanto sai do tom"),
                ("Tendência", det.get("tendencia", "—"), "aguda / grave / neutra"),
                ("Afinado (±50c)", f"{det.get('pct_afinado', 0):.1f}%", "das notas no tom"),
                ("Frases", str(det.get("num_frases", 0)), f"média {det.get('sustentacao_media', 0):.2f}s"),
                ("Pausas", str(det.get("num_pausas", 0)), "respirações detectadas"),
                ("Tom ref.", det.get("tom_ref", "—") or "—", "referência usada"),
            ]), unsafe_allow_html=True)
            dev = det.get("devolutiva") or ""
            if dev:
                st.markdown(
                    f'<div style="background:linear-gradient(135deg, rgba(16,185,129,0.20), rgba(16,185,129,0.05));'
                    f'border:1px solid rgba(16,185,129,0.45);border-radius:16px;padding:20px;'
                    f'backdrop-filter:blur(12px);box-shadow:0 8px 32px rgba(16,185,129,0.22);">'
                    f'<div style="font-family:Poppins;font-weight:700;color:#34d399;margin-bottom:8px;">✨ Devolutiva do Professor IA</div>'
                    f'{dev}</div>',
                    unsafe_allow_html=True
                )
            else:
                st.info("Devolutiva não salva nesta análise (as análises novas já gravam o texto do professor).")
            st.markdown(titulo_secao("✏️", "Renomear Análise"), unsafe_allow_html=True)
            idx_ren = st.selectbox("Análise", range(len(filtradas)), format_func=lambda i: opcoes[i], key="ren_sel")
            novo_nome = st.text_input("Novo nome", value=opcoes[idx_ren], key="ren_nome")
            if st.button("✏️ Salvar novo nome", key="btn_salvar_renomeacao"):
                if renomear_analise_firestore(filtradas[idx_ren][0], novo_nome.strip()):
                    st.success("Renomeada com sucesso!")
                    st.rerun()
                else:
                    st.error("Não foi possível renomear.")
        st.markdown(titulo_secao("🗑️", "Excluir Análises"), unsafe_allow_html=True)
        with st.container(height=380):
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
if pagina_ativa == "composicoes":
    st.markdown(titulo_secao("🎼", "Crie e salve suas composições"), unsafe_allow_html=True)
    c1, c2 = st.columns(2)
    comp_titulo = c1.text_input("Título da música", placeholder="Ex: Minha canção",
                                value=st.session_state.get("comp_titulo", ""), key="comp_titulo_input")
    comp_tom = c2.text_input("Tom (opcional)", placeholder="Ex: Am, C, G",
                             value=st.session_state.get("comp_tom", ""), key="comp_tom_input")
    # Guia do formato mostrado FORA da caixa (acima), texto dentro do campo fica limpo
    st.markdown(
        "<div style='font-family:Poppins,sans-serif;font-weight:600;color:#d9d9d9;margin-bottom:4px;'>"
        "Letra com cifras e seções</div>"
        "<div style='font-size:0.8rem;color:#9a9a9a;margin-bottom:8px;'>"
        "Use <code>#</code> para marcar seções (Verso, Refrão, Ponte...) e <code>[Am]</code> para cifras. "
        "Ex.: <code># Verso 1</code>, <code>[Am] [F] [C] [G]</code>."
        "</div>",
        unsafe_allow_html=True,
    )
    comp_letra = st.text_area(
        "Letra com cifras e seções",
        height=280,
        value=st.session_state.get("comp_letra", ""),
        placeholder="Escreva sua letra aqui...",
        label_visibility="collapsed",
        key="comp_letra_input",
    )
    c3, c4 = st.columns(2)
    if c3.button("👁️ Ver prévia", key="btn_preview_comp"):
        if comp_letra.strip():
            st.markdown(renderizar_composicao_html(comp_letra), unsafe_allow_html=True)
        else:
            st.info("Digite a letra para ver a prévia.")
    if c4.button("💾 Salvar composição", type="primary", key="btn_salvar_comp"):
        st.success(salvar_composicao_firestore(comp_titulo, comp_tom, comp_letra))
    st.markdown("---")
    st.markdown(titulo_secao("📚", "Composições salvas"), unsafe_allow_html=True)
    comps = listar_composicoes()
    if comps:
        opcoes = {f"{t} — v{v}": doc_id for t, v, doc_id in comps}
        escolha = st.selectbox("Selecione para carregar", list(opcoes.keys()), key="comp_escolha_sel")
        c5, c6 = st.columns(2)
        if c5.button("📂 Carregar composição", key="btn_carregar_comp"):
            titulo, tom, letra = carregar_composicao(opcoes[escolha])
            st.session_state["comp_titulo"] = titulo
            st.session_state["comp_tom"] = tom
            st.session_state["comp_letra"] = letra
            st.rerun()
        if c6.button("🗑️ Excluir composição", key="btn_excluir_comp"):
            st.session_state["comp_excluir"] = escolha
        if st.session_state.get("comp_excluir") == escolha:
            st.warning(f"Excluir **{escolha}**? Essa ação não pode ser desfeita.")
            c7, c8 = st.columns(2)
            if c7.button("✅ Sim, excluir", type="primary", key="btn_confirmar_excluir_comp"):
                msg = excluir_composicao_firestore(opcoes[escolha])
                st.session_state.pop("comp_excluir", None)
                st.session_state["comp_titulo"] = ""
                st.session_state["comp_tom"] = ""
                st.session_state["comp_letra"] = ""
                st.success(msg)
                st.rerun()
            if c8.button("❌ Cancelar", key="btn_cancelar_excluir_comp"):
                st.session_state.pop("comp_excluir", None)
                st.rerun()
    else:
        st.info("Nenhuma composição salva ainda.")
    letra_atual = st.session_state.get("comp_letra", "")
    if letra_atual.strip():
        st.markdown(titulo_secao("👁️", "Visualização da letra"), unsafe_allow_html=True)
        st.markdown(renderizar_composicao_html(letra_atual), unsafe_allow_html=True)
# ── ABA EDIÇÃO VOCAL (IA) ──
if pagina_ativa == "edicao":
    st.markdown(titulo_secao("✨", "Edição Inteligente"), unsafe_allow_html=True)
    edicao_in = st.file_uploader("Voz para editar (use o áudio isolado)", type=["wav", "mp3", "m4a", "ogg", "flac", "aac", "amr", "3gp", "webm"], key="edicao_upload")
    comando = st.text_input("Comando para a IA", placeholder="Ex: alinha minha voz no tom, remove a sibilância e deixa mais profissional", key="edicao_comando")
    if st.button("✨ Aplicar edição com IA", type="primary", key="btn_aplicar_edicao"):
        if edicao_in is None:
            st.warning("Envie um áudio para editar.")
        else:
            audio, sr = carregar_audio(edicao_in)
            if audio is None:
                st.error("Não foi possível ler o áudio. Tente outro formato (WAV ou MP3).")
                st.stop()
            with st.spinner("Interpretando o comando..."):
                acoes_ia = interpretar_comando_edicao_ia(comando)
            acoes = []
            try:
                import noisereduce as nr
                if acoes_ia.get("reduzir_ruido"):
                    audio = nr.reduce_noise(y=audio, sr=sr, stationary=True)
                    acoes.append("redução de ruído")
            except Exception:
                pass
            if acoes_ia.get("normalizar"):
                audio = audio / (np.max(np.abs(audio)) + 1e-9)
                acoes.append("normalização de volume")
            if acoes_ia.get("ajustar_tom"):
                try:
                    audio = librosa.effects.pitch_shift(audio, sr=sr, n_steps=float(acoes_ia["ajustar_tom"]))
                    acoes.append(f"ajuste de tom ({float(acoes_ia['ajustar_tom']):+.1f} semitons)")
                except Exception:
                    pass
            if acoes_ia.get("eq_presenca"):
                audio = librosa.effects.preemphasis(audio)
                acoes.append("EQ de presença")
            if acoes_ia.get("compressao"):
                audio = (np.tanh(audio * 2.2) / 1.4).astype(np.float32)
                acoes.append("compressão suave")
            if acoes_ia.get("remover_sibilancia"):
                try:
                    from scipy.signal import butter, lfilter
                    b, a = butter(2, [6000 / (sr / 2), 9000 / (sr / 2)], btype="bandstop")
                    audio = lfilter(b, a, audio).astype(np.float32)
                    acoes.append("redução de sibilância")
                except Exception:
                    pass
            if acoes_ia.get("reverb_leve"):
                audio = aplicar_reverb(audio, sr, quantidade=0.12)
                acoes.append("reverb leve")
            if not acoes:
                audio = audio / (np.max(np.abs(audio)) + 1e-9)
                acoes.append("normalização de volume")
            import soundfile as sf
            out = tempfile.mktemp(suffix=".wav")
            sf.write(out, audio, sr)
            st.audio(out, sample_rate=sr)
            st.success("Edição aplicada: " + ", ".join(acoes) + ".")
# ── ABA CONVERSOR DE FORMATO (múltiplas entradas e múltiplas saídas) ──
if pagina_ativa == "conversor":
    st.markdown(titulo_secao("🔄", "Conversor de formato"), unsafe_allow_html=True)
    conv_in = st.file_uploader(
        "📂 Subir mídia",
        type=["wav", "mp3", "m4a", "ogg", "flac", "aac", "amr", "3gp", "webm", "opus", "wma"],
        key="conversor_upload",
    )
    conv_formatos = st.multiselect(
        "Converter para (pode marcar mais de um)",
        FORMATOS_CONVERSOR,
        default=["WAV", "MP3"],
        key="conversor_formatos",
    )
    if st.button("🔄 Converter", type="primary", key="btn_converter"):
        if conv_in is None:
            st.warning("Envie um áudio para converter.")
        elif not conv_formatos:
            st.warning("Escolha ao menos um formato de destino.")
        else:
            with st.spinner("Lendo o áudio..."):
                audio, sr = carregar_audio(conv_in)
            if audio is None:
                st.error("Não foi possível ler o áudio. Tente outro formato.")
            else:
                for fmt in conv_formatos:
                    try:
                        out_bytes, mime, nome = converter_audio(audio, sr, fmt)
                        st.markdown(f"**{fmt}**")
                        st.audio(out_bytes, format=mime)
                        st.download_button(
                            f"⬇️ Baixar {fmt}", data=out_bytes, file_name=nome, mime=mime,
                            key=f"dl_conv_{fmt}",
                        )
                    except Exception as e:
                        st.warning(f"Não foi possível gerar {fmt}: {e}")
# ── ABA PRODUÇÃO (backing track musical, com opção de qualidade profissional) ──
if pagina_ativa == "producao":
    st.markdown(titulo_secao("🎛️", "Studio Produção"), unsafe_allow_html=True)
    prod_in = st.file_uploader("📂 Upload", type=["wav", "mp3", "m4a", "ogg", "flac", "aac", "amr", "3gp", "webm"], key="producao_upload")
    st.markdown("****")
    prod_grav = st.audio_input("🎤 Gravar", key="producao_gravar")
    grav_salvas_prod = get_gravacoes()
    opcoes_grav_prod = ["—"] + grav_salvas_prod
    usar_grav_prod = st.selectbox("🎙️ Upload Biblioteca", opcoes_grav_prod, key="usar_grav_prod")
    st.markdown(titulo_secao("2️⃣", "Estilo e geração"), unsafe_allow_html=True)
    c1, c2 = st.columns(2)
    estilo = c1.selectbox("🎵 Estilo musical", list(ESTILOS_MUSICAIS.keys()), key="producao_estilo_sel")
    c2.caption(ESTILOS_MUSICAIS[estilo])
    c3, c4 = st.columns(2)
    com_baixo = c3.checkbox("Gerar Linha de ContraBaixo", value=True, key="producao_com_baixo")
    com_bateria = c4.checkbox("Gerar Percurssão", value=True, key="producao_com_bateria")
    com_acordes = st.checkbox("🎹 Gerar Backing Track", value=True, key="producao_com_acordes")
    qualidade_pro = st.checkbox(
        "✨ Qualidade profissional (ducking dinâmico do baixo/acordes na voz + reverb de master)",
        value=True,
        key="producao_qualidade_pro",
    )
    if st.button("🎛️ Gerar produção", type="primary", key="btn_gerar_producao"):
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
            if qualidade_pro:
                if baixo is not None:
                    baixo = aplicar_ducking(baixo, audio, sr_audio, intensidade=0.30)
                if acordes is not None:
                    acordes = aplicar_ducking(acordes, audio, sr_audio, intensidade=0.40)
            mix = mixar(audio, baixo, bateria, acordes)
            if qualidade_pro:
                mix = aplicar_reverb(mix, sr_audio, quantidade=0.08)
        st.markdown(titulo_secao("🎧", "Resultado mixado (original + baixo + bateria + acordes):"), unsafe_allow_html=True)
        st.audio(mix, sample_rate=sr_audio)
        st.download_button(
            "⬇️ Baixar produção (WAV)",
            data=audio_para_bytes(mix, sr_audio),
            file_name="producao_orange_harmony.wav",
            mime="audio/wav",
            key="dl_producao_wav",
        )
        st.info("💡 A separação de stems (voz/violão separados) fica no botão flutuante 🎛️ Estúdio.")
        # ══════════════════ ASSISTENTE VIRTUAL (laranjinha com memória e chats) ══════════════════
LARANJINHA_PATH = _encontrar_imagem([
    "laranjinha.png", "laranjinha.PNG", "Laranjinha.png",
    "laranjinha_transparente.png", "laranjinha_transparente.PNG",
    "mascote.png", "mascote.PNG", "orange.png", "orange.PNG",
]) or _busca_fallback_png(["laranj", "orange", "mascote"])
laranjinha_b64 = ""
if LARANJINHA_PATH:
    with open(LARANJINHA_PATH, "rb") as f:
        laranjinha_b64 = base64.b64encode(f.read()).decode()

STUDIO_PATH = _encontrar_imagem([
    "studio.png", "Studio.png", "STUDIO.png",
    "orange_studio.png", "estudio.png", "Estudio.png",
]) or _busca_fallback_png(["studio", "estudio"])
studio_b64 = ""
if STUDIO_PATH:
    with open(STUDIO_PATH, "rb") as f:
        studio_b64 = base64.b64encode(f.read()).decode()
        
def _enviar_msg_laranjinha():
    """Callback do Enviar: processa a mensagem ANTES da tela redesenhar (o chat não fecha)."""
    texto = (st.session_state.get("laranjinha_input") or "").strip()
    if not texto:
        return
    st.session_state["chat_hist"].append({"role": "user", "content": texto})
    resp = assistente_resposta(texto, chat_id=st.session_state.get("chat_atual_id"), historico=st.session_state["chat_hist"])
    st.session_state["chat_hist"].append({"role": "assistant", "content": resp})
    chat_atual = st.session_state.get("chat_atual_id")
    if chat_atual:
        salvar_chat_firestore(chat_atual, st.session_state["chat_hist"])

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
        
    st.markdown("""
    <style>
    div[data-testid="stDialog"] div[data-testid="stElementContainer"]:has(div#laranjinha-topo) {
        position: sticky !important; top: 0 !important; z-index: 999 !important;
        background: #0d0d0d !important;
    }
    div[data-testid="stDialog"] div[data-testid="stElementContainer"]:has(div#laranjinha-entrada) {
        position: sticky !important; bottom: 0 !important; z-index: 999 !important;
        background: #0d0d0d !important;
    }
    /* Esconde o letreiro nativo, pequeno, do st.dialog — usamos nosso próprio avatar+nome abaixo */
    div[data-testid="stDialog"] [data-testid="stDialogTitle"],
    div[data-testid="stDialog"] h1[data-testid="stMarkdownContainer"],
    div[data-testid="stDialog"] div[data-testid="stModal"] h1 {
        display: none !important;
    }
    div[data-testid="stDialog"] > div:first-child > div:first-child {
        padding-top: 0 !important;
    }
    </style>
    """, unsafe_allow_html=True)
        
    with st.container():
        st.markdown('<div id="laranjinha-topo"></div>', unsafe_allow_html=True)
        col_img, col_t, col_li = st.columns([1, 5, 1])
        
    with st.container():
        st.markdown('<div id="laranjinha-topo"></div>', unsafe_allow_html=True)
        col_img, col_t, col_li = st.columns([1, 5, 1])
        if laranjinha_b64:
            col_img.markdown(
                f'<img src="data:image/png;base64,{laranjinha_b64}" '
                'style="width:68px;height:68px;border-radius:50%;'
                'box-shadow:0 4px 14px rgba(249,115,22,0.45);" />',
                unsafe_allow_html=True,
            )
        else:
            col_img.markdown("🍊")
        col_t.markdown(
            '<div style="padding-top:18px;font-weight:700;">Laranjinha — Assistente do Orange Harmony</div>',
            unsafe_allow_html=True,
        )
        st.markdown('<div class="oh-title-line"></div>', unsafe_allow_html=True)
        if col_li.button("🗑️", key="limpar_chat_btn", help="Limpar conversa atual (mantém o chat)"):
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
        sel_nome = st.selectbox("Qual o chat?", nomes_opcoes, index=idx, key="sel_chat")
        if sel_nome and sel_nome in opcoes_chat:
            sel_id = opcoes_chat[sel_nome]
            if sel_id != chat_atual_id:
                st.session_state["chat_atual_id"] = sel_id
                st.session_state["chat_atual_nome"] = sel_nome
                st.session_state["chat_hist"] = carregar_chat_firestore(sel_id)

        c_ren, c_del = st.columns(2)
        if c_ren.button("✏️ Renomear", key="renomear_chat_btn"):
            st.session_state["renomeando"] = not st.session_state.get("renomeando", False)
            st.session_state["confirmando_exclusao"] = False
        if c_del.button("🗑️ Excluir chat", key="excluir_chat_btn"):
            st.session_state["confirmando_exclusao"] = not st.session_state.get("confirmando_exclusao", False)
            st.session_state["renomeando"] = False

        if st.session_state.get("renomeando"):
            nome_para_salvar = st.text_input("Novo nome do chat", value=chat_atual_nome, key="renomear_nome_input")
            if st.button("💾 Salvar novo nome", key="salvar_nome_btn"):
                nome_limpo = (nome_para_salvar or "").strip()[:80]
                if not chat_atual_id:
                    st.warning("Este chat é temporário (Firebase off) — não pode ser renomeado.")
                elif nome_limpo and renomear_chat_firestore(chat_atual_id, nome_limpo):
                    st.session_state["chat_atual_nome"] = nome_limpo
                    st.session_state["renomeando"] = False
                else:
                    st.error("Não foi possível renomear no Firebase.")

        if st.session_state.get("confirmando_exclusao"):
            st.warning(f"Excluir o chat «{chat_atual_nome}» e todas as mensagens dele? Não tem volta.")
            c_sim, c_nao = st.columns(2)
            if c_sim.button("Sim, excluir", key="confirmar_exclusao_btn", type="primary"):
                if not chat_atual_id:
                    st.warning("Este chat é temporário — ele desaparece ao fechar o app.")
                    st.session_state["confirmando_exclusao"] = False
                elif excluir_chat_firestore(chat_atual_id):
                    restantes = [(n, cid) for n, cid in listar_chats_firestore() if cid != chat_atual_id]
                    if restantes:
                        st.session_state["chat_atual_id"] = restantes[0][1]
                        st.session_state["chat_atual_nome"] = restantes[0][0]
                    else:
                        novo_id = criar_chat_firestore("Chat geral")
                        if novo_id:
                            st.session_state["chat_atual_id"] = novo_id
                            st.session_state["chat_atual_nome"] = "Chat geral"
                        else:
                            st.session_state["chat_atual_id"] = None
                            st.session_state["chat_atual_nome"] = "Chat geral"
                    st.session_state["chat_hist"] = carregar_chat_firestore(st.session_state.get("chat_atual_id")) if st.session_state.get("chat_atual_id") else []
                    st.session_state["confirmando_exclusao"] = False
                else:
                    st.error("Não foi possível excluir no Firebase.")
            if c_nao.button("Cancelar", key="cancelar_exclusao_btn"):
                st.session_state["confirmando_exclusao"] = False

        c_nome, c_cria = st.columns([3, 1])
        novo_nome = c_nome.text_input("Novo chat/música", key="novo_chat_nome")
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
    with st.container(height=300):
        if not st.session_state["chat_hist"]:
            st.info("Comece a conversa aí embaixo! 🍊")
        for msg in st.session_state["chat_hist"]:
            with st.chat_message(msg["role"]):
                st.markdown(msg["content"])
        st.markdown('<div id="laranjinha-fim"></div>', unsafe_allow_html=True)

    from streamlit.components.v1 import html as componente_html
    componente_html("""
    <script>
    (function(){
      try {
        var fim = window.parent.document.getElementById('laranjinha-fim');
        if (!fim) return;
        var el = fim.parentElement;
        while (el) {
          if (el.scrollHeight > el.clientHeight + 10) { el.scrollTop = el.scrollHeight; break; }
          el = el.parentElement;
        }
      } catch (e) {}
    })();
    </script>
    """, height=0)

    with st.container():
        st.markdown('<div id="laranjinha-entrada"></div>', unsafe_allow_html=True)

    with st.form("laranjinha_form", clear_on_submit=True):
        pergunta = st.text_area(
            "Escreva sua mensagem...",
            height=120,
            label_visibility="collapsed",
            placeholder="Escreva sua mensagem ou cole a letra da música aqui...",
            key="laranjinha_input",
        )
        enviar = st.form_submit_button("Enviar", type="primary", on_click=_enviar_msg_laranjinha)
    
# ── Botão flutuante da Laranjinha ──
st.markdown('<div id="fab-laranjinha"></div>', unsafe_allow_html=True)
if st.button("", key="abrir_laranjinha", help="Abrir Laranjinha"):
    laranjinha_dialog()
if st.session_state.get("reabrir_laranjinha"):
    st.session_state["reabrir_laranjinha"] = False
    laranjinha_dialog()    

if laranjinha_b64:
    st.markdown("""
    <style>
    #fab-laranjinha { display: none; }
    div[data-testid="stElementContainer"]:has(#fab-laranjinha) + div[data-testid="stElementContainer"] > div[data-testid="stButton"] {
        position: fixed !important;
        bottom: 28px !important;
        right: 24px !important;
        width: 120px !important;
        height: 120px !important;
        z-index: 10000 !important;
    }
    div[data-testid="stElementContainer"]:has(#fab-laranjinha) + div[data-testid="stElementContainer"] > div[data-testid="stButton"] button {
        width: 120px !important;
        height: 120px !important;
        border-radius: 50% !important;
        background-color: transparent !important;
        border: none !important;
        box-shadow: 0 8px 30px rgba(249,115,22,0.55) !important;
    }
    #fab-laranjinha-img {
        position: fixed !important;
        bottom: 28px !important;
        right: 24px !important;
        width: 120px !important;
        height: 120px !important;
        z-index: 10001 !important;
        pointer-events: none !important;
        border-radius: 50% !important;
        background: rgba(249,115,22,0.35) !important;
    }
    </style>
    """, unsafe_allow_html=True)
    st.markdown(
        '<img id="fab-laranjinha-img" src="data:image/png;base64,' + laranjinha_b64 + '" />',
        unsafe_allow_html=True,
    )
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
    
st.markdown("""
<style>
header[data-testid="stHeader"] {
    background: transparent !important;
}
header[data-testid="stHeader"] div[data-testid="stToolbar"] {
    opacity: 0 !important;
    transition: opacity 0.25s ease !important;
}
header[data-testid="stHeader"]:hover div[data-testid="stToolbar"] {
    opacity: 1 !important;
}
</style>
""", unsafe_allow_html=True)

st.markdown("""
<style>
[data-testid="stDialog"] {
    position: fixed !important;
    bottom: 175px !important;
    right: 24px !important;
    left: auto !important;
    top: auto !important;
    width: 1500px !important;
    max-width: calc(100vw - 32px) !important;
    max-height: 88vh !important;
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
# ── ABA IA COMPOSITORA (geração de música por IA) ──
def analisar_referencia_sonora(audio, sr):
    """Analisa um áudio de referência (cantado/tocado) e devolve uma descrição textual
    rica (BPM, tom, gênero, clima, instrumentação, estilo vocal) para enriquecer o prompt
    do Songwriter. O modelo gerador de música trabalha só com texto, então aqui traduzimos
    o áudio de referência em uma descrição detalhada."""
    bpm, _ = detectar_bpm_e_beats(audio, sr)
    tom = detectar_tom(audio, sr)
    descricao_tecnica = f"aproximadamente {bpm:.0f} BPM, tom de {tom}"
    if cliente is None:
        return descricao_tecnica
    wav_bytes = audio_para_bytes(audio, sr)
    prompt = (
        "Você é um produtor musical experiente. Ouça este trecho de referência (pode ser cantado, "
        "tocado num instrumento, ou os dois) e descreva em português, em uma única frase corrida "
        "e objetiva (sem markdown, sem listas), características úteis para recriar o estilo: "
        "gênero musical, clima/emoção, tipo de melodia (ex: ascendente, repetitiva, com saltos), "
        "instrumentação sugerida, e estilo vocal se houver voz (ex: rouca, suave, potente). "
        "Seja específico e sucinto — no máximo 2 frases."
    )
    texto_resp, _ = chamar_gemini_com_fallback(prompt, audio_anexo=("referencia.wav", wav_bytes))
    if texto_resp:
        return f"{descricao_tecnica}. {texto_resp.strip()}"
    return descricao_tecnica
    
def enriquecer_prompt_estilo(prompt_usuario):
    """Adiciona descritores de qualidade de produção ao prompt do usuário, mantendo a ideia original."""
    base = (prompt_usuario or "").strip()
    extras = (
        "produção profissional, mixagem limpa e balanceada, masterização coerente, "
        "instrumentação bem definida, dinâmica natural"
    )
    if not base:
        return extras
    return f"{base}, {extras}"

def gerar_musica_ia(prompt, duracao_segundos=20, letra=None):
    """Gera música completa (com voz e letra) via estúdio YuE2-3B (Hugging Face)."""
    try:
        from gradio_client import Client
    except ImportError:
        return None, "Biblioteca ausente. Adicione 'gradio_client' ao requirements.txt."
    token = st.secrets.get("HF_TOKEN", "")
    try:
        try:
            client = Client("mrfakename/yue2-3b", hf_token=token or None)
        except TypeError:
            client = Client("mrfakename/yue2-3b")
    except Exception as e:
        return None, f"Não consegui conectar ao estúdio da IA: {str(e)[:300]}"
    prompt_enriquecido = enriquecer_prompt_estilo(prompt)
    if not letra or not letra.strip():
        try:
            letra = client.predict(
                prompt_enriquecido,
                prompt_enriquecido,
                "Portuguese",
                "Verse – Chorus – Verse – Chorus – Bridge – Chorus – Outro",
                42,
                api_name="/write_lyrics",
            )
        except Exception as e:
            return None, f"Erro ao criar a letra: {str(e)[:300]}"
    try:
        resultado = client.predict(
            prompt_enriquecido,
            letra,
            "full",
            16,
            42,
            api_name="/generate_song",
        )
    except Exception as e:
        return None, f"Erro na geração: {str(e)[:300]}"
    try:
        caminho = resultado
        if isinstance(caminho, (list, tuple)):
            caminho = caminho[0]
        if isinstance(caminho, dict):
            caminho = caminho.get("path") or caminho.get("value") or list(caminho.values())[0]
        try:
            import soundfile as sf
            audio_ia, sr_ia = sf.read(caminho)
        except Exception:
            audio_ia, sr_ia = librosa.load(caminho, sr=None)
        if audio_ia.ndim > 1:
            audio_ia = audio_ia.mean(axis=1)
        return (audio_ia.astype(np.float32), int(sr_ia)), None
    except Exception as e:
        return None, f"Resposta inesperada da IA: {str(e)[:300]}"
        
if pagina_ativa == "songwriter":
    st.markdown(titulo_secao("🤖", "Songwriter"), unsafe_allow_html=True)
    st.caption("Descreva a música que você quer e a IA gera um trecho instrumental pronto. "
               "Use estilo, instrumentos, clima e BPM (ex.: 'samba suave, violão e percussão, 80 BPM'). "
               "O pedido é automaticamente enriquecido com descritores de produção profissional.")
    prompt_ia = st.text_area(
        "🎼 Descreva a música que você quer",
        placeholder="Ex.: Acústico no violão, piano suave e ritmo leve, 90 BPM",
        key="prompt_ia",
    )
    letra_ia = st.text_area("📝 Letra (opcional)", key="letra_ia", placeholder="Escreva sua letra aqui...")

    st.markdown(titulo_secao("🎤", "Referência sonora (opcional)"), unsafe_allow_html=True)
    st.caption(
        "Grave ou suba um trecho cantado, tocado, ou os dois — a IA analisa BPM, tom, gênero, "
        "clima e estilo, e usa isso para enriquecer o prompt de geração."
    )
    col_ref_grav, col_ref_upload = st.columns(2)
    with col_ref_grav:
        ref_gravada = st.audio_input("🎙️ Gravar referência", key="songwriter_ref_gravar")
    with col_ref_upload:
        ref_upload = st.file_uploader(
            "📂 Upload",
            type=["wav", "mp3", "m4a", "ogg", "flac", "aac", "webm"],
            key="songwriter_ref_upload",
        )
    ref_fonte = ref_gravada if ref_gravada is not None else ref_upload
    if ref_fonte is not None:
        st.audio(ref_fonte)

    c_ia1, c_ia2 = st.columns(2)
    duracao_ia = c_ia1.slider("⏱️ Duração (segundos)", 10, 30, 20, key="duracao_ia_slider")
    usar_contexto = c_ia2.checkbox("🎵 Usar tom/BPM da última análise", value=False, key="usar_contexto_ia")
    if st.button("🤖 Gerar música com IA", type="primary", key="btn_gerar_musica_ia"):
        if not prompt_ia.strip():
            st.warning("Descrição da música.")
            st.stop()
        prompt_final = prompt_ia.strip()
        if usar_contexto and "ultimo_bpm" in st.session_state and "ultimo_tom" in st.session_state:
            prompt_final += f", {st.session_state.ultimo_bpm:.0f} BPM, key of {st.session_state.ultimo_tom}"
        if ref_fonte is not None:
            with st.spinner("🎧 Analisando a referência sonora..."):
                audio_ref, sr_ref = carregar_audio(ref_fonte)
                if audio_ref is not None:
                    descricao_ref = analisar_referencia_sonora(audio_ref, sr_ref)
                    prompt_final += f". Referência sonora enviada pelo usuário: {descricao_ref}"
                    st.caption(f"🎧 Referência interpretada como: {descricao_ref}")
        with st.spinner("🤖 A IA está compondo... (pode levar 1-2 minutos na primeira vez)"):
            resultado, erro = gerar_musica_ia(prompt_final, duracao_ia, letra_ia)
        if erro:
            st.error(erro)
            st.stop()
        audio_ia, sr_ia = resultado
        st.markdown(titulo_secao("🎧", "Sua música gerada:"), unsafe_allow_html=True)
        st.audio(audio_ia, sample_rate=sr_ia)
        st.download_button(
            "⬇️ Baixar música (WAV)",
            data=audio_para_bytes(audio_ia, sr_ia),
            file_name="musica_ia_orange_harmony.wav",
            mime="audio/wav",
            key="dl_musica_ia",
        )
        st.info("💡 Dica: quanto mais específico o prompt (estilo, instrumentos, clima, BPM), melhor o resultado.")

# ══════════════════════════════════════════════════════════════
# ESTÚDIO DE STEMS — funções (espectro animado, base64, faixas)
# ══════════════════════════════════════════════════════════════
import base64 as _b64_mod
try:
    import requests as _requests
except Exception:
    _requests = None
import streamlit.components.v1 as _components

URL_NOTEBOOK_COLAB = "https://colab.research.google.com/drive/1qOzZls0EyhESEb004Zyc238uRoKEw4Kz#scrollTo=zKGzCLHG8pb5"

def _audio_para_b64(src):
    """Converte URL do Colab ou caminho local em base64 pro player."""
    if isinstance(src, str) and src.startswith("http"):
        if _requests is None:
            return None
        r = _requests.get(src, timeout=60)
        r.raise_for_status()
        dados = r.content
    else:
        with open(src, "rb") as f:
            dados = f.read()
    return _b64_mod.b64encode(dados).decode()

def _player_espectro(src_audio, cor, uid):
    """Player com espectro animado em tempo real (Web Audio API + canvas), via base64.
    Retorna (True, "") em sucesso, ou (False, motivo) quando cai no fallback — o motivo
    é mostrado ao usuário em vez de ser escondido, para facilitar diagnóstico."""
    try:
        b64 = _audio_para_b64(src_audio)
    except Exception as e:
        return False, f"não consegui converter o áudio para base64 ({e})"
    if not b64:
        return False, "a conversão para base64 retornou vazia"
    if len(b64) > 6000000:
        tamanho_mb = len(b64) / 1_000_000
        return False, f"áudio grande demais para o player com espectro ({tamanho_mb:.1f} MB em base64)"
    html = f"""
    <div style="background:#0d0d0d;border:1px solid #2a2a2a;border-radius:12px;padding:10px 12px;">
      <canvas id="cv_{uid}" height="70" style="width:100%;display:block;border-radius:8px;background:#0a0a0a;"></canvas>
      <audio id="au_{uid}" src="data:audio/mpeg;base64,{b64}" preload="auto"></audio>
      <div style="display:flex;align-items:center;gap:10px;margin-top:8px;">
        <button id="pp_{uid}" style="background:{cor};border:none;border-radius:50%;width:38px;height:38px;color:#0d0d0d;font-size:16px;cursor:pointer;font-weight:700;">▶</button>
        <button id="mu_{uid}" style="background:#1f1f1f;border:1px solid #3a3a3a;border-radius:6px;color:#d4d4d4;padding:5px 12px;font-size:0.75rem;font-weight:700;cursor:pointer;">M</button>
        <input id="vl_{uid}" type="range" min="0" max="100" value="80" style="flex:1;accent-color:{cor};">
        <span id="tm_{uid}" style="color:#a3a3a3;font-size:0.72rem;font-family:monospace;">0:00</span>
      </div>
    </div>
    <script>
    (function() {{
      const au = document.getElementById('au_{uid}');
      const cv = document.getElementById('cv_{uid}');
      const pp = document.getElementById('pp_{uid}');
      const mu = document.getElementById('mu_{uid}');
      const vl = document.getElementById('vl_{uid}');
      const tm = document.getElementById('tm_{uid}');
      const cor = '{cor}';
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const fonte = ctx.createMediaElementSource(au);
      const an = ctx.createAnalyser();
      an.fftSize = 128;
      fonte.connect(an);
      an.connect(ctx.destination);
      const dados = new Uint8Array(an.frequencyBinCount);
      let rodando = false;
      function desenhar() {{
        if (!rodando) return;
        requestAnimationFrame(desenhar);
        an.getByteFrequencyData(dados);
        const w = cv.width = cv.clientWidth;
        const h = cv.height;
        const c = cv.getContext('2d');
        c.clearRect(0, 0, w, h);
        const n = 40;
        const largura = w / n;
        for (let i = 0; i < n; i++) {{
          const v = dados[Math.floor(i * dados.length / n)] / 255;
          const altura = Math.max(2, v * h);
          c.fillStyle = cor;
          c.globalAlpha = 0.35 + v * 0.65;
          c.fillRect(i * largura + 1, h - altura, largura - 2, altura);
        }}
        c.globalAlpha = 1;
        const m = Math.floor(au.currentTime);
        const s = Math.floor(au.currentTime % 60);
        tm.textContent = m + ':' + (s < 10 ? '0' : '') + s;
      }}
      pp.addEventListener('click', () => {{
        if (au.paused) {{
          ctx.resume();
          au.play();
          pp.textContent = '⏸';
          rodando = true;
          desenhar();
        }} else {{
          au.pause();
          pp.textContent = '▶';
          rodando = false;
          const c = cv.getContext('2d');
          c.clearRect(0, 0, cv.width, cv.height);
        }}
      }});
      mu.addEventListener('click', () => {{
        au.muted = !au.muted;
        mu.style.borderColor = au.muted ? '#ef4444' : '#3a3a3a';
        mu.style.color = au.muted ? '#ef4444' : '#d4d4d4';
      }});
      vl.addEventListener('input', () => {{ au.volume = vl.value / 100; }});
      au.addEventListener('ended', () => {{ pp.textContent = '▶'; rodando = false; }});
      au.addEventListener('error', () => {{
        const c = cv.getContext('2d');
        c.fillStyle = '#ef4444';
        c.font = '12px sans-serif';
        c.fillText('⚠️ Não consegui carregar este áudio', 8, 40);
      }});
    }})();
    </script>
    """
    _components.html(html, height=180)
    return True, ""

_CSS_FAIXAS = """
<style>
.oh-studio-top {
    background: linear-gradient(90deg, #1a1a1a, #0d0d0d);
    border: 1px solid #2a2a2a;
    border-radius: 14px;
    padding: 14px 18px;
    margin-bottom: 14px;
    display: flex;
    align-items: center;
    gap: 16px;
    flex-wrap: wrap;
}
.oh-studio-top .st-title {
    font-family: 'Poppins', sans-serif;
    font-weight: 700;
    font-size: 1.1rem;
    color: #f97316;
}
.oh-studio-chip {
    background: #171717;
    border: 1px solid #2a2a2a;
    border-radius: 999px;
    padding: 4px 14px;
    font-size: 0.78rem;
    color: #e5e5e5;
}
.oh-track-name {
    font-family: 'Poppins', sans-serif;
    font-weight: 600;
    font-size: 0.95rem;
    margin-bottom: 6px;
}
.oh-track-name.voz { color: #f97316; }
.oh-track-name.inst { color: #22d3ee; }
</style>
"""

def _renderizar_faixas_estudio():
    """Mostra as faixas Vocals/Instrumental com player de espectro, se existirem."""
    voz = st.session_state.get("stems_voz")
    inst = st.session_state.get("stems_inst")
    if not (voz or inst):
        return
    st.markdown(_CSS_FAIXAS, unsafe_allow_html=True)
    st.markdown("""
    <div class="oh-studio-top">
        <span class="st-title">🎧 Faixas separadas</span>
        <span class="oh-studio-chip">▶ aperte o play de cada faixa</span>
        <span class="oh-studio-chip">espectro em tempo real</span>
    </div>
    """, unsafe_allow_html=True)

    if voz:
        st.markdown('<div class="oh-track-name voz">🎙️ Vocals</div>', unsafe_allow_html=True)
        try:
            ok, motivo = _player_espectro(voz, "#f97316", "voz")
            if not ok:
                st.caption(f"🎵 Player simples (espectro indisponível: {motivo}).")
                st.audio(voz)
        except Exception as e:
            st.caption(f"⚠️ Player indisponível ({e}) — usando player simples.")
            st.audio(voz)
        try:
            dados_voz = _audio_para_b64(voz)
            st.download_button(
                "📥 Baixar voz",
                data=base64.b64decode(dados_voz),
                file_name="voz_isolada.mp3",
                mime="audio/mpeg",
                key="dl_voz_studio",
            )
        except Exception:
            pass

    if inst:
        st.markdown('<div class="oh-track-name inst">🎼 Instrumental</div>', unsafe_allow_html=True)
        try:
            ok, motivo = _player_espectro(inst, "#22d3ee", "inst")
            if not ok:
                st.caption(f"🎵 Player simples (espectro indisponível: {motivo}).")
                st.audio(inst)
        except Exception as e:
            st.caption(f"⚠️ Player indisponível ({e}) — usando player simples.")
            st.audio(inst)
        try:
            dados_inst = _audio_para_b64(inst)
            st.download_button(
                "📥 Baixar instrumental",
                data=base64.b64decode(dados_inst),
                file_name="instrumental.mp3",
                mime="audio/mpeg",
                key="dl_inst_studio",
            )
        except Exception:
            pass
def _renderizar_secao_estudio():
    """Renderiza o Orange Studio como um painel que cobre quase a tela toda,
    usando um st.container(key=...) posicionado via CSS — sem st.dialog, então o
    espectro (Web Audio API) funciona normalmente."""
    st.markdown(_CSS_FAIXAS, unsafe_allow_html=True)

    # Camada de fundo escurecida (dá a sensação de "modal" cobrindo a página)
    with st.container(key="estudio_backdrop"):
        st.markdown("", unsafe_allow_html=True)

    with st.container(key="estudio_fullscreen_box"):
        col_img, col_t, col_fechar = st.columns([1, 8, 1])
        with col_img:
            if studio_b64:
                st.markdown(
                    f'<img src="data:image/png;base64,{studio_b64}" '
                    'style="width:44px;height:44px;border-radius:50%;'
                    'box-shadow:0 4px 14px rgba(249,115,22,0.45);" />',
                    unsafe_allow_html=True,
                )
            else:
                st.markdown("🎛️")
        with col_t:
            st.markdown(
                '<div style="font-family:Poppins,sans-serif;font-weight:700;font-size:1.05rem;'
                'color:#fff;padding-top:8px;">Orange Studio — Separação de Stems (Demucs)</div>',
                unsafe_allow_html=True,
            )
        with col_fechar:
            if st.button("✕", key="fechar_estudio_btn", help="Fechar Estúdio"):
                st.session_state["estudio_aberto"] = False
                st.rerun()

        st.markdown('<div class="oh-title-line"></div>', unsafe_allow_html=True)

        st.markdown("""
        <div class="oh-studio-top">
            <span class="oh-studio-chip">🎙️ Stems · Demucs</span>
            <span class="oh-studio-chip">Voz + Instrumental</span>
            <span class="oh-studio-chip">htdemucs</span>
        </div>
        """, unsafe_allow_html=True)
        col_link, col_dica = st.columns([1, 2])
        with col_link:
            if URL_NOTEBOOK_COLAB.startswith("http"):
                st.link_button("🔗 Abrir notebook no Colab", URL_NOTEBOOK_COLAB, use_container_width=True)
            else:
                st.info("Defina o link do notebook em URL_NOTEBOOK_COLAB.")
        with col_dica:
            st.caption(
                "1️⃣ Abra o Colab e rode a célula do servidor Demucs · "
                "2️⃣ Copie a URL gradio.live gerada · 3️⃣ Cole abaixo e separe."
            )

        url_demucs = st.text_input(
            "URL do servidor Demucs (gradio.live do Colab)",
            value=st.session_state.get("url_demucs", ""),
            key="input_url_demucs_studio",
        )
        if url_demucs:
            st.session_state["url_demucs"] = url_demucs

        gravacao_studio = st.audio_input("🎙️ Gravar agora", key="rec_studio")
        arquivo_studio = st.file_uploader(
            "📁 Subir gravação",
            type=["mp3", "wav", "mp4", "m4a", "ogg"],
            key="up_studio",
        )
        arquivo_final_studio = gravacao_studio if gravacao_studio is not None else arquivo_studio
        if arquivo_final_studio is not None:
            st.audio(arquivo_final_studio)

        if st.button("🎵 Separar stems", type="primary", key="btn_separar_studio"):
            if not GRADIO_CLIENT_OK:
                st.error("O pacote gradio_client não está instalado.")
            elif not url_demucs:
                st.warning("Cole primeiro a URL gradio.live do Colab.")
            elif arquivo_final_studio is None:
                st.warning("Grave ou suba uma gravação primeiro.")
            else:
                caminho_temp = None
                with st.spinner("🎙️ Separando voz e instrumental..."):
                    try:
                        if gravacao_studio is not None:
                            sufixo = ".wav"
                            conteudo = gravacao_studio.getbuffer()
                        else:
                            sufixo = os.path.splitext(arquivo_studio.name)[1] or ".mp3"
                            conteudo = arquivo_studio.getbuffer()
                        fd, caminho_temp = tempfile.mkstemp(suffix=sufixo)
                        with os.fdopen(fd, "wb") as f:
                            f.write(conteudo)
                        cliente_stems = Client(url_demucs)
                        mapa = cliente_stems.view_api(return_format="dict")
                        endpoints = list((mapa or {}).get("named_endpoints", {}).keys())
                        if not endpoints:
                            raise RuntimeError("O servidor não expõe nenhum endpoint. Rode a célula do Colab de novo.")
                        api = "/predict" if "/predict" in endpoints else endpoints[0]
                        resultado = cliente_stems.predict(handle_file(caminho_temp), api_name=api)
                        st.session_state["stems_voz"] = resultado[0]
                        st.session_state["stems_inst"] = resultado[1]
                        st.success("Separação concluída! As faixas com espectro aparecem logo abaixo.")
                    except Exception as e:
                        st.error(f"Não foi possível separar os stems: {e}")
                        st.caption(
                            "Causas comuns: o Colab desconectou (rode a célula do servidor de novo e cole a URL nova), "
                            "a URL está errada ou o servidor ainda está processando."
                        )
                    finally:
                        if caminho_temp and os.path.exists(caminho_temp):
                            os.remove(caminho_temp)

        st.markdown("---")
        _renderizar_faixas_estudio()


# ── Renderização condicional: Estúdio em tela cheia OU só as faixas no rodapé ──
if st.session_state.get("estudio_aberto"):
    _renderizar_secao_estudio()
else:
    _renderizar_faixas_estudio()

# ── CSS: painel do Estúdio cobrindo quase a tela toda + fundo escurecido ──
st.markdown("""
<style>
.st-key-estudio_backdrop {
    position: fixed !important;
    inset: 0 !important;
    background: rgba(0,0,0,0.62) !important;
    backdrop-filter: blur(2px) !important;
    z-index: 999998 !important;
}
.st-key-estudio_fullscreen_box {
    position: fixed !important;
    top: 2vh !important;
    left: 2vw !important;
    width: 96vw !important;
    height: 96vh !important;
    overflow-y: auto !important;
    z-index: 999999 !important;
    background: linear-gradient(165deg, rgba(20,14,8,0.98), rgba(10,8,5,0.99)) !important;
    border: 1px solid rgba(249,115,22,0.35) !important;
    border-radius: 20px !important;
    box-shadow: 0 30px 90px rgba(0,0,0,0.6) !important;
    padding: 24px 28px !important;
}
/* Enquanto o Studio está aberto, garante que a sidebar fique atrás dele */
section[data-testid="stSidebar"] {
    z-index: 1 !important;
}
</style>
""", unsafe_allow_html=True)

# ── Botão flutuante do Estúdio, usando studio.png (já no repositório) ──

st.markdown('<div id="fab-estudio"></div>', unsafe_allow_html=True)
if st.button("", key="abrir_estudio", help="Abrir Estúdio"):
    st.session_state["estudio_aberto"] = True
    st.rerun()

if studio_b64:
    st.markdown(
        '<img id="fab-estudio-img" src="data:image/png;base64,' + studio_b64 + '" />',
        unsafe_allow_html=True,
    )

st.markdown(f"""
<style>
#fab-estudio {{ display: none; }}
div[data-testid="stElementContainer"]:has(#fab-estudio) + div[data-testid="stElementContainer"] > div[data-testid="stButton"] {{
    position: fixed !important;
    bottom: 160px !important;
    right: 24px !important;
    width: 120px !important;
    height: 120px !important;
    z-index: 10000 !important;
}}
div[data-testid="stElementContainer"]:has(#fab-estudio) + div[data-testid="stElementContainer"] > div[data-testid="stButton"] button {{
    width: 120px !important;
    height: 120px !important;
    border-radius: 50% !important;
    background-color: transparent !important;
    border: none !important;
    box-shadow: 0 8px 30px rgba(249,115,22,0.55) !important;
    font-size: 0 !important;
    color: transparent !important;
    {"" if studio_b64 else "background: linear-gradient(135deg, #f97316, #ea580c) !important; font-size: 0.95rem !important; color: white !important; font-family: 'Poppins', sans-serif !important; font-weight: 700 !important;"}
}}
{"" if studio_b64 else '''
div[data-testid="stElementContainer"]:has(#fab-estudio) + div[data-testid="stElementContainer"] > div[data-testid="stButton"] button::before {
    content: "🎛️ Estúdio";
}
'''}
#fab-estudio-img {{
    position: fixed !important;
    bottom: 160px !important;
    right: 24px !important;
    width: 120px !important;
    height: 120px !important;
    z-index: 10001 !important;
    pointer-events: none !important;
    border-radius: 50% !important;
    background: rgba(249,115,22,0.35) !important;
    object-fit: contain !important;
}}
</style>
""", unsafe_allow_html=True)            
# ══════════════════════════════════════════════════════════════
# BOTÕES FLUTUANTES ARRASTÁVEIS (drag) — Laranjinha e Estúdio
# ══════════════════════════════════════════════════════════════
_components.html("""
<script>
(function() {
  const doc = window.parent.document;
  const STORAGE_PREFIX = 'oh_fab_pos_';

  function aplicarPosicaoSalva(anchorId, wrapper, img) {
    const saved = doc.defaultView.localStorage.getItem(STORAGE_PREFIX + anchorId);
    if (!saved) return;
    try {
      const pos = JSON.parse(saved);
      wrapper.style.left = pos.left + 'px';
      wrapper.style.top = pos.top + 'px';
      wrapper.style.right = 'auto';
      wrapper.style.bottom = 'auto';
      if (img) {
        img.style.left = pos.left + 'px';
        img.style.top = pos.top + 'px';
        img.style.right = 'auto';
        img.style.bottom = 'auto';
      }
    } catch (e) {}
  }

  function conectar(anchorId, imgId) {
    const anchor = doc.getElementById(anchorId);
    if (!anchor) return;
    const markerContainer = anchor.closest('div[data-testid="stElementContainer"]');
    if (!markerContainer) return;
    const buttonContainer = markerContainer.nextElementSibling;
    if (!buttonContainer) return;
    const wrapper = buttonContainer.querySelector('div[data-testid="stButton"]');
    if (!wrapper) return;
    const btn = wrapper.querySelector('button');
    if (!btn) return;
    const img = imgId ? doc.getElementById(imgId) : null;

    // Se este exato botão já foi conectado (o Streamlit não recriou), não faz nada.
    if (btn.dataset.ohDragBound === '1') return;
    btn.dataset.ohDragBound = '1';

    wrapper.style.position = 'fixed';
    if (img) img.style.position = 'fixed';

    aplicarPosicaoSalva(anchorId, wrapper, img);

    let dragging = false;
    let moved = false;
    let startX = 0, startY = 0, origLeft = 0, origTop = 0;

    function onDown(e) {
      const point = e.touches ? e.touches[0] : e;
      dragging = true;
      moved = false;
      const rect = wrapper.getBoundingClientRect();
      origLeft = rect.left;
      origTop = rect.top;
      startX = point.clientX;
      startY = point.clientY;
      doc.addEventListener('mousemove', onMove);
      doc.addEventListener('mouseup', onUp);
      doc.addEventListener('touchmove', onMove, {passive: false});
      doc.addEventListener('touchend', onUp);
    }

    function onMove(e) {
      if (!dragging) return;
      const point = e.touches ? e.touches[0] : e;
      const dx = point.clientX - startX;
      const dy = point.clientY - startY;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true;
      if (!moved) return;
      e.preventDefault();
      let newLeft = origLeft + dx;
      let newTop = origTop + dy;
      const maxLeft = doc.defaultView.innerWidth - wrapper.offsetWidth - 4;
      const maxTop = doc.defaultView.innerHeight - wrapper.offsetHeight - 4;
      newLeft = Math.max(4, Math.min(newLeft, maxLeft));
      newTop = Math.max(4, Math.min(newTop, maxTop));
      wrapper.style.left = newLeft + 'px';
      wrapper.style.top = newTop + 'px';
      wrapper.style.right = 'auto';
      wrapper.style.bottom = 'auto';
      if (img) {
        img.style.left = newLeft + 'px';
        img.style.top = newTop + 'px';
        img.style.right = 'auto';
        img.style.bottom = 'auto';
      }
    }

    function onUp() {
      if (!dragging) return;
      dragging = false;
      doc.removeEventListener('mousemove', onMove);
      doc.removeEventListener('mouseup', onUp);
      doc.removeEventListener('touchmove', onMove);
      doc.removeEventListener('touchend', onUp);
      if (moved) {
        const suppressClick = function(ce) {
          ce.stopPropagation();
          ce.preventDefault();
          btn.removeEventListener('click', suppressClick, true);
        };
        btn.addEventListener('click', suppressClick, true);
        const rect = wrapper.getBoundingClientRect();
        doc.defaultView.localStorage.setItem(
          STORAGE_PREFIX + anchorId,
          JSON.stringify({left: rect.left, top: rect.top})
        );
      }
    }

    btn.style.cursor = 'grab';
    btn.addEventListener('mousedown', onDown);
    btn.addEventListener('touchstart', onDown, {passive: true});
  }

  // Roda continuamente: a cada rerun do Streamlit os botões são recriados,
  // então precisamos reconectar o listener e reaplicar a posição salva sempre
  // que detectarmos um botão "novo" (sem o marcador ohDragBound).
  setInterval(function() {
    conectar('fab-laranjinha', 'fab-laranjinha-img');
    conectar('fab-estudio', 'fab-estudio-img');
  }, 500);
})();
</script>
""", height=0)
