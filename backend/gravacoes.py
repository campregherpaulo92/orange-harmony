# ══════════════════════════════════════════════════════════════
# gravacoes.py — Gravações do usuário: arquivo real no Firebase Storage,
# índice leve (nome, data, caminho) no Firestore.
#
# Substitui o esquema antigo do Streamlit que picotava o áudio em pedaços
# de 800KB dentro do Firestore (limite de ~1MB por documento). Aqui o
# arquivo inteiro vai pro Storage, sem limite de tamanho relevante.
# ══════════════════════════════════════════════════════════════
import os
import uuid
from datetime import datetime, timezone

from firebase_config import get_db, get_bucket, get_erro

COLECAO = "gravacoes_web"


def _extensao(nome_arquivo: str) -> str:
    ext = os.path.splitext(nome_arquivo or "")[1]
    return ext if ext else ".webm"


def salvar_gravacao(nome: str, dados: bytes, nome_arquivo_original: str, content_type: str):
    """Sobe o áudio para o Storage e cria o registro no Firestore.
    Retorna (doc_id, None) em sucesso, ou (None, mensagem_de_erro) em falha."""
    db = get_db()
    bucket = get_bucket()
    if db is None or bucket is None:
        return None, get_erro() or "Firebase não configurado."

    doc_id = uuid.uuid4().hex
    ext = _extensao(nome_arquivo_original)
    caminho_storage = f"gravacoes/{doc_id}{ext}"

    try:
        blob = bucket.blob(caminho_storage)
        blob.upload_from_string(dados, content_type=content_type or "audio/webm")
    except Exception as e:
        return None, f"Falha ao subir o áudio para o Storage: {e}"

    try:
        db.collection(COLECAO).document(doc_id).set({
            "nome": (nome or "Gravação sem nome").strip(),
            "data": datetime.now(timezone.utc).isoformat(),
            "caminho_storage": caminho_storage,
            "content_type": content_type or "audio/webm",
            "tamanho_bytes": len(dados),
        })
    except Exception as e:
        # Tenta desfazer o upload se o índice falhar, para não deixar arquivo órfão
        try:
            bucket.blob(caminho_storage).delete()
        except Exception:
            pass
        return None, f"Falha ao registrar a gravação no Firestore: {e}"

    return doc_id, None


def listar_gravacoes():
    """Retorna a lista de gravações (mais recentes primeiro), sem o áudio em si."""
    db = get_db()
    if db is None:
        return []
    docs = (
        db.collection(COLECAO)
        .order_by("data", direction="DESCENDING")
        .limit(200)
        .stream()
    )
    resultado = []
    for d in docs:
        dados = d.to_dict()
        resultado.append({
            "id": d.id,
            "nome": dados.get("nome", "Gravação"),
            "data": dados.get("data", ""),
            "tamanho_bytes": dados.get("tamanho_bytes", 0),
        })
    return resultado


def baixar_gravacao(doc_id: str):
    """Retorna (bytes, content_type, nome) ou (None, None, None) se não achar."""
    db = get_db()
    bucket = get_bucket()
    if db is None or bucket is None:
        return None, None, None

    doc = db.collection(COLECAO).document(doc_id).get()
    if not doc.exists:
        return None, None, None
    dados = doc.to_dict()

    try:
        blob = bucket.blob(dados["caminho_storage"])
        conteudo = blob.download_as_bytes()
    except Exception:
        return None, None, None

    return conteudo, dados.get("content_type", "audio/webm"), dados.get("nome", "gravacao")


def excluir_gravacao(doc_id: str) -> bool:
    db = get_db()
    bucket = get_bucket()
    if db is None or bucket is None:
        return False

    doc_ref = db.collection(COLECAO).document(doc_id)
    doc = doc_ref.get()
    if not doc.exists:
        return False
    dados = doc.to_dict()

    try:
        bucket.blob(dados["caminho_storage"]).delete()
    except Exception:
        pass  # se o arquivo já não existir no Storage, seguimos e limpamos o índice mesmo assim

    doc_ref.delete()
    return True


def renomear_gravacao(doc_id: str, novo_nome: str) -> bool:
    db = get_db()
    if db is None:
        return False
    doc_ref = db.collection(COLECAO).document(doc_id)
    if not doc_ref.get().exists:
        return False
    doc_ref.update({"nome": (novo_nome or "Gravação").strip()[:120]})
    return True
