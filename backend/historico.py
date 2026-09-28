# ══════════════════════════════════════════════════════════════
# historico.py — Histórico de análises vocais (Firestore).
#
# O campo "devolutiva" (parecer do professor IA) fica vazio nesta fase —
# ele é preenchido quando a Laranjinha/Gemini entrarem na fase final de IA.
# ══════════════════════════════════════════════════════════════
from datetime import datetime, timezone
from firebase_config import get_db

COLECAO = "historico_web"


def registrar_analise(resultado, modo="completa", tom_ref=None, devolutiva=None):
    db = get_db()
    if db is None:
        return None
    agora = datetime.now(timezone.utc)
    doc_ref = db.collection(COLECAO).document()
    doc_ref.set({
        "data": agora.isoformat(),
        "nome": f"{agora.strftime('%d/%m/%Y')} — {agora.strftime('%H:%M:%S')}",
        "modo": modo,
        "devolutiva": devolutiva or "",
        "nota_predominante": resultado.get("nota_predominante", ""),
        "desvio_medio_cents": round(resultado.get("desvio_medio_cents", 0), 1),
        "tendencia": resultado.get("tendencia", ""),
        "pct_afinado": round(resultado.get("pct_afinado", 0), 1),
        "num_frases": resultado.get("num_frases", 0),
        "sustentacao_media": round(resultado.get("sustentacao_media", 0), 2),
        "num_pausas": resultado.get("num_pausas", 0),
        "tom_ref": tom_ref or "",
    })
    return doc_ref.id


def listar_historico():
    db = get_db()
    if db is None:
        return []
    docs = db.collection(COLECAO).order_by("data", direction="DESCENDING").limit(200).stream()
    resultado = []
    for d in docs:
        dados = d.to_dict()
        dados["id"] = d.id
        resultado.append(dados)
    return resultado


def renomear_analise(doc_id, novo_nome):
    db = get_db()
    if db is None:
        return False
    doc_ref = db.collection(COLECAO).document(doc_id)
    if not doc_ref.get().exists:
        return False
    doc_ref.update({"nome": novo_nome})
    return True


def excluir_analise(doc_id):
    db = get_db()
    if db is None:
        return False
    doc_ref = db.collection(COLECAO).document(doc_id)
    if not doc_ref.get().exists:
        return False
    doc_ref.delete()
    return True
