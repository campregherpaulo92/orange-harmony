# ══════════════════════════════════════════════════════════════
# news_enquete.py — Enquete do dia do Orange News.
#  • A enquete do dia sai de news_conteudo.ENQUETES (troca todo dia, no horário de Brasília).
#  • Os votos ficam no Firestore (coleção news_enquetes, um documento por enquete); se o Firestore não responder,
#    usa a memória do servidor (some quando ele reinicia) — a enquete nunca fica fora do ar.
#  • Um voto por cliente: o navegador manda um identificador anônimo guardado nele mesmo.
# ══════════════════════════════════════════════════════════════
import re
import threading
from datetime import datetime, timedelta, timezone

import firebase_config
import news_conteudo as C

COLECAO = "news_enquetes"
MAX_CLIENTES = 5000                                     # limite de identificadores guardados por enquete (os votos continuam contando)
_RE_CLIENTE = re.compile(r"^[A-Za-z0-9_-]{8,64}$")
_mem = {}                                               # id da enquete -> {"votos": [..], "clientes": {cliente: opcao}}
_trava = threading.Lock()


def _hoje():
    return datetime.now(timezone(timedelta(hours=-3))).date()          # horário de Brasília


def _por_id(enquete_id):
    return next((e for e in C.ENQUETES if e["id"] == enquete_id), None)


def enquete_do_dia(hoje=None):
    hoje = hoje or _hoje()
    return C.ENQUETES[hoje.toordinal() % len(C.ENQUETES)]


def _referencia(enquete_id):
    try:
        db = firebase_config.get_db()
        return db.collection(COLECAO).document(enquete_id) if db is not None else None
    except Exception:
        return None


def _carregar(enquete_id, n):
    """(votos, clientes) do Firestore, ou da memória se ele não responder."""
    ref = _referencia(enquete_id)
    if ref is not None:
        try:
            snap = ref.get()
            dados = (snap.to_dict() or {}) if snap.exists else {}
            votos = [int((dados.get("votos") or {}).get(str(i), 0)) for i in range(n)]
            clientes = {str(k): int(v) for k, v in (dados.get("clientes") or {}).items()}
            return votos, clientes
        except Exception:
            pass
    m = _mem.setdefault(enquete_id, {"votos": [0] * n, "clientes": {}})
    return list(m["votos"]), dict(m["clientes"])


def _salvar(enquete_id, votos, clientes):
    _mem[enquete_id] = {"votos": list(votos), "clientes": dict(clientes)}           # a memória sempre acompanha
    ref = _referencia(enquete_id)
    if ref is not None:
        try:
            ref.set({"votos": {str(i): v for i, v in enumerate(votos)}, "clientes": clientes}, merge=True)
        except Exception:
            pass


def estado(enquete, cliente=None):
    votos, clientes = _carregar(enquete["id"], len(enquete["opcoes"]))
    escolha = clientes.get(cliente) if cliente and _RE_CLIENTE.match(cliente) else None
    return {
        "id": enquete["id"], "pergunta": enquete["pergunta"],
        "opcoes": [{"texto": t, "votos": votos[i]} for i, t in enumerate(enquete["opcoes"])],
        "total": sum(votos), "votou": escolha,
    }


def votar(enquete_id, opcao, cliente):
    """Registra o voto. Devolve (estado, erro). Um cliente só vota uma vez por enquete (a 2ª tentativa só devolve o resultado)."""
    enquete = _por_id(enquete_id)
    if enquete is None:
        return None, "Enquete não encontrada."
    if not isinstance(opcao, int) or not 0 <= opcao < len(enquete["opcoes"]):
        return None, "Opção inválida."
    if not cliente or not _RE_CLIENTE.match(cliente):
        return None, "Identificador do navegador inválido."
    with _trava:
        votos, clientes = _carregar(enquete_id, len(enquete["opcoes"]))
        if cliente in clientes:
            return estado(enquete, cliente), None
        votos[opcao] += 1
        if len(clientes) < MAX_CLIENTES:
            clientes[cliente] = opcao
        _salvar(enquete_id, votos, clientes)
    return estado(enquete, cliente), None
