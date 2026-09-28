# ══════════════════════════════════════════════════════════════
# composicoes.py — CRUD de composições (letra + cifras + versionamento).
# ══════════════════════════════════════════════════════════════
from datetime import datetime, timezone
from firebase_config import get_db, get_erro

COLECAO = "composicoes_web"


def classificar_secoes(letra):
    tipos = {"verso": 0, "pré-refrão": 0, "refrão": 0, "ponte": 0, "intro": 0, "solo": 0, "final": 0}
    for linha in letra.splitlines():
        s = linha.strip().lstrip("#").strip().lower()
        for t in tipos:
            if s.startswith(t):
                tipos[t] += 1
                break
    return {k: v for k, v in tipos.items() if v > 0}


def salvar_composicao(titulo, tom, letra):
    """Retorna (doc_id, None) em sucesso, ou (None, mensagem_de_erro)."""
    db = get_db()
    if db is None:
        return None, get_erro() or "Firebase não configurado."
    if not titulo or not titulo.strip():
        return None, "Digite um título para a composição."
    if not letra or not letra.strip():
        return None, "Digite a letra da composição."

    docs = db.collection(COLECAO).where("titulo", "==", titulo.strip()).stream()
    versoes = [d.to_dict().get("versao", 0) for d in docs]
    nova_versao = max(versoes) + 1 if versoes else 1
    secoes = classificar_secoes(letra)

    doc_ref = db.collection(COLECAO).document()
    doc_ref.set({
        "titulo": titulo.strip(),
        "tom": (tom or "").strip(),
        "letra": letra,
        "versao": nova_versao,
        "data": datetime.now(timezone.utc).isoformat(),
        "secoes": secoes,
    })
    return doc_ref.id, None


def listar_composicoes():
    db = get_db()
    if db is None:
        return []
    docs = db.collection(COLECAO).order_by("data", direction="DESCENDING").limit(200).stream()
    resultado = []
    for d in docs:
        dados = d.to_dict()
        resultado.append({
            "id": d.id,
            "titulo": dados.get("titulo", "?"),
            "versao": dados.get("versao", 1),
            "tom": dados.get("tom", ""),
            "data": dados.get("data", ""),
        })
    return resultado


def carregar_composicao(doc_id):
    db = get_db()
    if db is None:
        return None
    doc = db.collection(COLECAO).document(doc_id).get()
    if not doc.exists:
        return None
    dados = doc.to_dict()
    return {"titulo": dados.get("titulo", ""), "tom": dados.get("tom", ""), "letra": dados.get("letra", "")}


def excluir_composicao(doc_id):
    db = get_db()
    if db is None:
        return False
    doc_ref = db.collection(COLECAO).document(doc_id)
    if not doc_ref.get().exists:
        return False
    doc_ref.delete()
    return True
