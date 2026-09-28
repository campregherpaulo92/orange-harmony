# ══════════════════════════════════════════════════════════════
# avaliacao.py — Avaliação Vocal Inicial: analisa os 5 exercícios
# gravados e gera o perfil vocal do usuário (extensão, tessitura,
# classificação). Portado do app.py original.
# ══════════════════════════════════════════════════════════════
import numpy as np
import librosa
from audio_analysis import carregar_audio_bytes, extrair_pitch
from firebase_config import get_db

COLECAO = "perfil_vocal_web"


def analisar_exercicio(dados: bytes, nome_arquivo: str):
    """Analisa um exercício da avaliação e retorna as frequências captadas,
    ou None se não detectar voz suficiente."""
    audio, sr = carregar_audio_bytes(dados, nome_arquivo)
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


def gerar_perfil(voz_tipo, resultados_exercicios):
    """resultados_exercicios: lista de dicts {f_min, f_max, f_med}."""
    f_min = min(r["f_min"] for r in resultados_exercicios)
    f_max = max(r["f_max"] for r in resultados_exercicios)
    f_med = float(np.mean([r["f_med"] for r in resultados_exercicios]))
    nota_grave = librosa.hz_to_note(f_min)
    nota_aguda = librosa.hz_to_note(f_max)
    extensao_st = int(round(librosa.hz_to_midi(f_max) - librosa.hz_to_midi(f_min)))
    return {
        "voz_tipo": voz_tipo,
        "nota_grave": nota_grave,
        "nota_aguda": nota_aguda,
        "extensao_semitons": extensao_st,
        "tessitura": librosa.hz_to_note(f_med),
        "classificacao": classificar_voz(f_min, voz_tipo),
        "exercicios_feitos": len(resultados_exercicios),
    }


def salvar_perfil(perfil):
    db = get_db()
    if db is None:
        return False
    docs = list(db.collection(COLECAO).limit(1).stream())
    if docs:
        db.collection(COLECAO).document(docs[0].id).set(perfil)
    else:
        db.collection(COLECAO).document().set(perfil)
    return True


def carregar_perfil():
    db = get_db()
    if db is None:
        return None
    docs = list(db.collection(COLECAO).limit(1).stream())
    if docs:
        return docs[0].to_dict()
    return None
