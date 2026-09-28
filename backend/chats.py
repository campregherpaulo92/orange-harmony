# ══════════════════════════════════════════════════════════════
# chats.py — Conversas nomeadas da Laranjinha, persistidas no Firestore.
# Cada chat guarda seu histórico completo de mensagens, e a Laranjinha
# consegue ler outras conversas quando perguntada (via listar_conversas /
# ler_conversa em laranjinha.py) — não só a atual.
# ══════════════════════════════════════════════════════════════
from datetime import datetime, timezone
from firebase_config import get_db

COLECAO_CHATS = "laranjinha_chats"
COLECAO_MENSAGENS = "laranjinha_mensagens"


def criar_chat(nome):
    db = get_db()
    if db is None:
        return None, "Firebase não configurado."
    agora = datetime.now(timezone.utc).isoformat()
    doc_ref = db.collection(COLECAO_CHATS).document()
    doc_ref.set({
        "nome": (nome or "Nova conversa").strip()[:120],
        "criado_em": agora,
        "atualizado_em": agora,
    })
    return doc_ref.id, None


def listar_chats():
    db = get_db()
    if db is None:
        return []
    docs = db.collection(COLECAO_CHATS).stream()
    chats = [{"id": d.id, **d.to_dict()} for d in docs]
    chats.sort(key=lambda c: c.get("atualizado_em", ""), reverse=True)
    return chats


def renomear_chat(chat_id, novo_nome):
    db = get_db()
    if db is None:
        return False
    doc_ref = db.collection(COLECAO_CHATS).document(chat_id)
    if not doc_ref.get().exists:
        return False
    doc_ref.update({"nome": (novo_nome or "Conversa").strip()[:120]})
    return True


def excluir_chat(chat_id):
    db = get_db()
    if db is None:
        return False
    doc_ref = db.collection(COLECAO_CHATS).document(chat_id)
    if not doc_ref.get().exists:
        return False
    for m in db.collection(COLECAO_MENSAGENS).where("chat_id", "==", chat_id).stream():
        m.reference.delete()
    doc_ref.delete()
    return True


def salvar_mensagem(chat_id, role, content):
    db = get_db()
    if db is None:
        return
    agora = datetime.now(timezone.utc).isoformat()
    db.collection(COLECAO_MENSAGENS).document().set({
        "chat_id": chat_id, "role": role, "content": content, "data": agora,
    })
    db.collection(COLECAO_CHATS).document(chat_id).update({"atualizado_em": agora})


def carregar_mensagens(chat_id, limite=300):
    db = get_db()
    if db is None:
        return []
    # Sem order_by no Firestore de propósito (evita exigir índice composto) —
    # ordena em Python pela data, que é uma string ISO (ordena certinho).
    docs = db.collection(COLECAO_MENSAGENS).where("chat_id", "==", chat_id).stream()
    mensagens = [d.to_dict() for d in docs]
    mensagens.sort(key=lambda m: m.get("data", ""))
    return mensagens[-limite:]


def ler_outras_conversas_resumo(chat_id_atual, limite_mensagens_por_chat=6):
    """Resumo textual das últimas mensagens de cada OUTRO chat — usado pra
    dar à Laranjinha memória cruzada entre conversas diferentes."""
    chats_existentes = listar_chats()
    resultado = []
    for c in chats_existentes:
        if c["id"] == chat_id_atual:
            continue
        msgs = carregar_mensagens(c["id"], limite=limite_mensagens_por_chat)
        if not msgs:
            continue
        resultado.append({
            "chat": c.get("nome", "Conversa"),
            "ultimas_mensagens": [f"{m.get('role')}: {(m.get('content') or '')[:200]}" for m in msgs],
        })
    return resultado
