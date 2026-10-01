# ══════════════════════════════════════════════════════════════
# singergame.py — Placar do Singergame. Guarda só o essencial: recorde por
# modo/dificuldade, igual um "high score" local — não é um ranking entre
# usuários (o app não tem login), é o seu recorde pessoal salvo entre sessões.
# ══════════════════════════════════════════════════════════════
from datetime import datetime, timezone

from firebase_config import get_db

COLECAO = "singergame_placar"
MODOS_VALIDOS = {"livre", "escala"}


def _doc_id(modo, dificuldade):
    return f"{modo}_{dificuldade}"


def salvar_pontuacao(modo, dificuldade, pontos, acertos, total, combo_maximo, escala_nome=None):
    """Salva só se `pontos` superar o recorde atual desse modo/dificuldade.
    Devolve (recorde_atual, bateu_recorde)."""
    if modo not in MODOS_VALIDOS:
        return None, False
    db = get_db()
    if db is None:
        return int(pontos), True  # sem Firebase: o jogo funciona, só não persiste entre sessões

    ref = db.collection(COLECAO).document(_doc_id(modo, dificuldade))
    atual = ref.get()
    recorde_antigo = int((atual.to_dict() or {}).get("pontos", 0)) if atual.exists else 0
    bateu = int(pontos) > recorde_antigo
    if bateu:
        ref.set({
            "modo": modo, "dificuldade": dificuldade, "pontos": int(pontos),
            "acertos": int(acertos), "total": int(total), "combo_maximo": int(combo_maximo),
            "escala_nome": escala_nome or "", "atualizado_em": datetime.now(timezone.utc).isoformat(),
        })
    return (int(pontos) if bateu else recorde_antigo), bateu


def listar_recordes():
    """{"livre_facil": {...}, "escala_dificil": {...}, ...} — um por modo/dificuldade já jogado."""
    db = get_db()
    if db is None:
        return {}
    try:
        return {doc.id: doc.to_dict() for doc in db.collection(COLECAO).stream()}
    except Exception:
        return {}
