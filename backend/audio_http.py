# ══════════════════════════════════════════════════════════════
# audio_http.py — Entrega de áudio com suporte a "Range" e um cache pequeno.
#  • Range: o navegador (principalmente o Safari do iPhone) pede o áudio em pedaços para tocar e para pular na linha do tempo.
#    Sem isso, pular para o meio da música falha ou obriga a baixar tudo antes.
#  • Cache: cada pedaço pedido repetiria o download do arquivo no armazenamento. Guardamos os últimos arquivos em memória
#    (poucos e pequenos: no máximo 3 arquivos de até 40 MB, 80 MB no total).
# ══════════════════════════════════════════════════════════════
import collections
import re
import threading

from fastapi.responses import Response

MAX_ITENS = 3
MAX_BYTES_ITEM = 40 * 1024 * 1024
MAX_BYTES_TOTAL = 80 * 1024 * 1024
_cache = collections.OrderedDict()               # id -> (conteudo, content_type, nome)
_trava = threading.Lock()
_RE_RANGE = re.compile(r"^bytes=(\d*)-(\d*)$")

INVALIDO = "invalido"


def obter(doc_id, baixar):
    """(conteudo, content_type, nome) do cache ou de baixar(doc_id); None se a gravação não existe."""
    with _trava:
        if doc_id in _cache:
            _cache.move_to_end(doc_id)
            return _cache[doc_id]
    conteudo, tipo, nome = baixar(doc_id)
    if conteudo is None:
        return None
    item = (conteudo, tipo, nome)
    if len(conteudo) <= MAX_BYTES_ITEM:
        with _trava:
            _cache[doc_id] = item
            _cache.move_to_end(doc_id)
            while len(_cache) > MAX_ITENS or sum(len(v[0]) for v in _cache.values()) > MAX_BYTES_TOTAL:
                _cache.popitem(last=False)
    return item


def esquecer(doc_id):
    with _trava:
        _cache.pop(doc_id, None)


def limpar():
    with _trava:
        _cache.clear()


def tamanho_do_cache():
    with _trava:
        return len(_cache), sum(len(v[0]) for v in _cache.values())


def intervalo(cabecalho, tamanho):
    """Interpreta o cabeçalho Range. Devolve None (servir o arquivo todo), (inicio, fim) com o fim incluído, ou INVALIDO (416).
    Só um intervalo por vez; cabeçalho que não entendemos (ou vários intervalos) é ignorado e o arquivo vem inteiro, como a norma permite."""
    if not cabecalho:
        return None
    m = _RE_RANGE.match(cabecalho.strip())
    if not m:
        return None
    ini, fim = m.groups()
    if ini == "" and fim == "":
        return None
    if tamanho <= 0:
        return None
    if ini == "":                                   # "últimos N bytes"
        n = int(fim)
        if n == 0:
            return INVALIDO
        return (max(0, tamanho - n), tamanho - 1)
    inicio = int(ini)
    termino = tamanho - 1 if fim == "" else min(int(fim), tamanho - 1)
    if inicio >= tamanho or inicio > termino:
        return INVALIDO
    return (inicio, termino)


def resposta(conteudo, content_type, cabecalho_range):
    """Response 200 (arquivo todo), 206 (trecho) ou 416 (trecho impossível)."""
    base = {"Accept-Ranges": "bytes", "Cache-Control": "private, max-age=600"}
    pedido = intervalo(cabecalho_range, len(conteudo))
    if pedido == INVALIDO:
        return Response(status_code=416, headers={"Content-Range": f"bytes */{len(conteudo)}", "Accept-Ranges": "bytes"})
    if pedido is None:
        return Response(content=conteudo, media_type=content_type, headers=base)
    ini, fim = pedido
    return Response(content=conteudo[ini:fim + 1], status_code=206, media_type=content_type,
                    headers={**base, "Content-Range": f"bytes {ini}-{fim}/{len(conteudo)}"})
