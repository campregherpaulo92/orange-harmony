# Orange Harmony — VocalAI Coach (Streamlit)
import os, json, re, base64, tempfile, io
from datetime import datetime
import numpy as np
import librosa
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import streamlit as st
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
def detectar_bpm(audio, sr):
    try:
        tempo, _ = librosa.beat.beat_track(y=audio, sr=sr)
        bpm = float(np.atleast_1d(tempo)[0])
        if bpm < 50 or bpm > 200 or np.isnan(bpm):
            return 90.0
        return round(bpm, 1)
    except Exception:
        return 90.0
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
def gerar_nota_baixo(freq, duracao, sr, volume=0.5):
    n = int(sr * duracao)
    t = np.linspace(0, duracao, n, endpoint=False)
    sinal = (np.sin(2 * np.pi * freq * t)
             + 0.4 * np.sin(2 * np.pi * 2 * freq * t)
             + 0.2 * np.sin(2 * np.pi * 3 * freq * t))
    env = np.exp(-3.0 * t / duracao)
    return (sinal * env * volume).astype(np.float32)
def gerar_kick(sr, volume=0.9):
    n = int(sr * 0.25)
    t = np.linspace(0, 0.25, n, endpoint=False)
    freq = 55 * np.exp(-18 * t) + 45
    fase = 2 * np.pi * np.cumsum(freq) / sr
    sinal = np.sin(fase)
    env = np.exp(-12 * t)
    return (sinal * env * volume).astype(np.float32)
def gerar_snare(sr, volume=0.6):
    n = int(sr * 0.2)
    t = np.linspace(0, 0.2, n, endpoint=False)
    ruido = np.random.default_rng(42).standard_normal(n)
    tom = np.sin(2 * np.pi * 180 * t)
    sinal = 0.7 * ruido + 0.3 * tom
    env = np.exp(-18 * t)
    return (sinal * env * volume).astype(np.float32)
def gerar_hat(sr, volume=0.35):
    n = int(sr * 0.08)
    t = np.linspace(0, 0.08, n, endpoint=False)
    ruido = np.random.default_rng(7).standard_normal(n)
    sinal = np.diff(ruido, prepend=0)
    env = np.exp(-40 * t)
    return (sinal * env * volume).astype(np.float32)
def gerar_baixo(audio, sr, tom, bpm):
    sr = int(sr)
    bpm = float(bpm)
    duracao_total = float(len(audio)) / sr
    if duracao_total <= 0:
        return np.zeros(1, dtype=np.float32)
    seg_por_compasso = 60.0 / bpm * 4
    n_compassos = max(1, int(np.ceil(duracao_total / seg_por_compasso)))
    raiz_midi = nota_para_midi(tom, 1)
    notas_escala = [raiz_midi + i for i in [0, 2, 4, 5, 7, 9, 11]]
    padrao = [0, 4, 0, 7, 0, 4, 7, 4]  # graus da escala por colcheia
    colcheia = seg_por_compasso / 8
    n_total = int(sr * duracao_total)
    trilha = np.zeros(n_total + sr, dtype=np.float32)
    for c in range(n_compassos):
        for i, grau in enumerate(padrao):
            inicio = c * seg_por_compasso + i * colcheia
            if inicio >= duracao_total:
                break
            freq = midi_para_freq(notas_escala[grau % len(notas_escala)])
            nota = gerar_nota_baixo(freq, colcheia * 0.9, sr)
            idx = int(inicio * sr)
            if idx >= n_total:
                break
            fim = min(idx + len(nota), n_total + sr)
            if fim > idx:
                trilha[idx:fim] += nota[:fim - idx]
    return trilha[:n_total]
def gerar_bateria(audio, sr, bpm):
    sr = int(sr)
    bpm = float(bpm)
    duracao_total = float(len(audio)) / sr
    if duracao_total <= 0:
        return np.zeros(1, dtype=np.float32)
    seg_por_compasso = 60.0 / bpm * 4
    n_compassos = max(1, int(np.ceil(duracao_total / seg_por_compasso)))
    colcheia = seg_por_compasso / 8
    n_total = int(sr * duracao_total)
    trilha = np.zeros(n_total + sr, dtype=np.float32)
    kick = gerar_kick(sr)
    snare = gerar_snare(sr)
    hat = gerar_hat(sr)
    for c in range(n_compassos):
        for i in range(8):
            inicio = c * seg_por_compasso + i * colcheia
            if inicio >= duracao_total:
                break
            idx = int(inicio * sr)
            if idx >= n_total:
                break
            eventos = [hat]
            if i in (0, 4):
                eventos.append(kick)
            if i in (2, 6):
                eventos.append(snare)
            for amostra in eventos:
                fim = min(idx + len(amostra), n_total + sr)
                if fim > idx:
                    trilha[idx:fim] += amostra[:fim - idx]
    return trilha[:n_total]
def mixar(audio, baixo, bateria):
    total = audio.astype(np.float32)
    if baixo is not None:
        total = total + 0.45 * baixo
    if bateria is not None:
        total = total + 0.5 * bateria
    pico = np.max(np.abs(total)) + 1e-9
    return (total / pico).astype(np.float32)
def audio_para_bytes(audio, sr):
    import soundfile as sf
    buf = io.BytesIO()
    sf.write(buf, audio, sr, format="WAV")
    return buf.getvalue()
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
    return (f'<div style="background:#000000;color:#ffffff;padding:20px;border-radius:16px;'
            f'font-family:monospace;line-height:1.7;border:1px solid #333333;">{"".join(linhas)}</div>')
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
    return (f'<div style="background:#222;border-radius:10px;height:26px;position:relative;border:1px solid #333;margin-top:6px;">'
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
        # A gravação do navegador pode vir em webm/ogg — tenta decodificar direto
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
# ══════════════════ CSS / TEMA ══════════════════
st.markdown("""
<style>
    .stApp { background-color: #0d0d0d; }
    h1, h2, h3, h4 { color: #f97316 !important; }
    .block-container { padding-top: 1.5rem; }
    .stButton > button { background-color: #f97316; color: #000; border-radius: 12px; border: 1px solid #f97316; font-weight: 600; }
    .stButton > button:hover { background-color: #ff8c3a; color: #000; }
    .stTextInput input, .stTextArea textarea, .stSelectbox div[data-baseweb="select"] > div { background-color: #222222; color: #f2f2f2; border-radius: 10px; }
    label { color: #d9d9d9 !important; }
    .stDataFrame { background-color: #161616; border-radius: 12px; }
    .stTabs [data-baseweb="tab-list"] { gap: 8px; }
    .stTabs [data-baseweb="tab"] { background-color: #161616; border-radius: 12px 12px 0 0; color: #d9d9d9; padding: 0.5rem 1rem; }
    .stTabs [aria-selected="true"] { background-color: #f97316; color: #000 !important; font-weight: 600; }
</style>
""", unsafe_allow_html=True)
# ══════════════════ LOGO ══════════════════
LOGO_PATH = "logo_orange_harmony_transparente.png"
col_logo, _ = st.columns([1, 3])
if os.path.exists(LOGO_PATH):
    with open(LOGO_PATH, "rb") as f:
        logo_b64 = base64.b64encode(f.read()).decode()
    col_logo.markdown(f'<img src="data:image/png;base64,{logo_b64}" style="height:70px;width:auto;border-radius:12px;">', unsafe_allow_html=True)
else:
    col_logo.markdown("# 🍊 Orange Harmony")
st.markdown("### Seu professor de canto com IA — analise sua voz, afine e evolua.")
# ══════════════════ INTERFACE ══════════════════
tab_analise, tab_afinador, tab_historico, tab_composicoes, tab_edicao, tab_producao = st.tabs(
    ["🎵 Análise e Estudo", "🎸 Afinador", "📊 Histórico", "🎼 Composições", "✨ Edição Vocal (IA)", "🎛️ Produção"]
)
# ── ABA ANÁLISE E ESTUDO ──
with tab_analise:
    st.markdown("**1. Referência de tom** — ouça a nota ou a escala antes de cantar.")
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
    st.markdown("**2. Análise da voz** — envie sua gravação e veja o diagnóstico completo.")
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
            st.markdown(barra_cents_html(cents), unsafe_allow_html=True)
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
            st.markdown(f"**Nota predominante:** {resultado['nota_predominante']}")
            st.markdown(f"**Desvio médio absoluto:** {resultado['desvio_medio_cents']:.1f} cents")
            st.markdown(f"**Tendência:** {resultado['tendencia']} ({resultado['desvio_sinal_cents']:+.1f} cents)")
            st.markdown(f"**Notas afinadas (±50 cents):** {resultado['pct_afinado']:.1f}%")
            st.markdown(f"**Frases sustentadas:** {resultado['num_frases']} (média {resultado['sustentacao_media']:.2f} s)")
            st.markdown(f"**Pausas respiratórias:** {resultado['num_pausas']} (média {resultado['pausa_media']:.2f} s)")
            mascara_voz = f0_limpo > 0
            fig, ax = plt.subplots(figsize=(10, 4))
            ax.plot(tempos[mascara_voz], f0_limpo[mascara_voz], linewidth=1.5, color="#f97316")
            ax.set_xlabel("Tempo (s)")
            ax.set_ylabel("Frequência fundamental (Hz)")
            ax.set_title("Curva de Pitch")
            ax.grid(True, alpha=0.3)
            fig.tight_layout()
            st.pyplot(fig)
            st.markdown("**Devolutiva do Professor:**")
            st.markdown(devolutiva)
            st.markdown("---")
            st.markdown("**3. Vibrato** — detecte a oscilação da sua nota sustentada.")
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
    st.markdown("**Afinador — violão ou voz.** Escolha a afinação, toque/cante uma nota sustentada e veja o resultado.")
    c1, c2 = st.columns(2)
    afincao = c1.selectbox("Afinação", list(AFINACOES.keys()))
    calib_afinador = c2.radio("Calibração A4", [440, 442], horizontal=True)
    st.markdown(DESCRICOES_AFINACOES.get(afincao, ""))
    audio_afinador = st.file_uploader("Grave ou envie uma nota sustentada", type=["wav", "mp3", "m4a", "ogg", "flac"], key="afinador")
    if audio_afinador is not None:
        audio, sr = carregar_audio(audio_afinador)
        nota, cents, status = analisar_afinador(audio, sr, calib_afinador)
        st.success(f"Nota alvo: **{nota}** — {cents:+.1f} cents — {status}")
        st.markdown(barra_cents_html(cents), unsafe_allow_html=True)
# ── ABA HISTÓRICO ──
with tab_historico:
    st.markdown("**Evolução da sua performance — salva no Firebase, nunca se perde.**")
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
                ax1.plot(datas, desvios, marker="o", color="#f97316", label="Desvio médio (cents)")
                ax1.set_ylabel("Desvio médio (cents)")
                ax1.tick_params(axis="x", rotation=45)
                ax2 = ax1.twinx()
                ax2.plot(datas, pcts, marker="s", color="#22c55e", label="% afinado")
                ax2.set_ylabel("% afinado")
                ax1.set_title("Evolução da performance")
                fig.tight_layout()
                st.pyplot(fig)
# ── ABA COMPOSIÇÕES ──
with tab_composicoes:
    st.markdown("**Crie e salve suas composições — com cifras, seções e versionamento.**")
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
    st.markdown("**Composições salvas**")
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
    st.markdown("**Peça para a IA ajustar sua voz.** Ex: *'alinha minha voz no tom'*, *'limpa o ruído e deixa mais presente'*.")
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
    st.markdown("**Estúdio de Produção** — grave sua música (voz + violão) e gere baixo e bateria no tom e no BPM detectados da sua gravação.")
    st.markdown("**1. Captura** — suba o arquivo ou grave direto.")
    prod_in = st.file_uploader("📂 Subir gravação (voz + violão)", type=["wav", "mp3", "m4a", "ogg", "flac"], key="producao")
    st.markdown("**— ou —**")
    prod_grav = st.audio_input("🎤 Gravar música agora")
    st.markdown("**2. Geração**")
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
        with st.spinner("Analisando BPM e tom..."):
            bpm = detectar_bpm(audio, sr_audio)
            tom = detectar_tom(audio, sr_audio)
        st.success(f"Detectado: **{bpm:.1f} BPM** · Tom aproximado: **{tom}**")
        baixo = None
        bateria = None
        try:
            if com_baixo:
                with st.spinner("Gerando linha de baixo..."):
                    baixo = gerar_baixo(audio, sr_audio, tom, bpm)
            if com_bateria:
                with st.spinner("Gerando bateria..."):
                    bateria = gerar_bateria(audio, sr_audio, bpm)
        except Exception as e:
            st.error(f"Erro ao gerar produção: {e}")
            st.stop()
        with st.spinner("Mixando..."):
            mix = mixar(audio, baixo, bateria)
        st.markdown("**Resultado mixado (original + baixo + bateria):**")
        st.audio(mix, sample_rate=sr_audio)
        st.download_button(
            "⬇️ Baixar produção (WAV)",
            data=audio_para_bytes(mix, sr_audio),
            file_name="producao_orange_harmony.wav",
            mime="audio/wav",
        )
        st.info("💡 A separação de stems (voz/violão separados) exige GPU e roda no Colab — o link do notebook fica no README.")
