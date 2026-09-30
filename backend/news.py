# ══════════════════════════════════════════════════════════════
# news.py — Motor do Orange News.
#  • edicao_do_dia()  → a edição escrita (manchete, seções, levada), que troca todo dia; é instantânea.
#  • obter_noticias() → notícias de fora (feeds RSS), filtradas pelo que interessa aos recursos do app,
#                       com resumo curto em português (Gemini, só com o texto original) e link da matéria.
# Se os feeds falharem, a edição escrita continua funcionando: o jornal nunca fica vazio.
# ══════════════════════════════════════════════════════════════
import concurrent.futures
import html
import json
import re
import threading
import time
from datetime import date, datetime, timedelta, timezone
from email.utils import parsedate_to_datetime

import requests

try:                                            # parser mais seguro contra XML malicioso, se estiver instalado
    from defusedxml import ElementTree as ET
except Exception:                               # pragma: no cover
    import xml.etree.ElementTree as ET

import gemini_client
import news_conteudo as C

DIAS = ["segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado", "domingo"]
MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"]
EDICAO_INICIAL = date(2026, 9, 30)

FEEDS = [
    {"fonte": "MusicTech", "url": "https://musictech.com/feed/"},
    {"fonte": "Attack Magazine", "url": "https://www.attackmagazine.com/feed/"},
    {"fonte": "Synthtopia", "url": "https://www.synthtopia.com/feed/"},
    {"fonte": "SonicScoop", "url": "https://sonicscoop.com/feed/"},
    {"fonte": "Gearnews", "url": "https://www.gearnews.com/feed/"},
]
LIMITE_DIAS = 30
MAX_NOTICIAS = 6
MAX_POR_FONTE = 2
TTL_S = 6 * 3600                 # as notícias valem por 6 horas
ESPERA_APOS_FALHA_S = 300        # se tudo falhar, só tenta de novo daqui a 5 min


# ─────────────────────────── edição escrita ───────────────────────────
def _hoje():
    return datetime.now(timezone(timedelta(hours=-3))).date()          # horário de Brasília


def data_extenso(d):
    return f"{DIAS[d.weekday()]}, {d.day} de {MESES[d.month - 1]} de {d.year}"


def _deslocamento(categoria):
    return sum(ord(c) for c in categoria)


def edicao_do_dia(hoje=None):
    """Um item por categoria, trocando todo dia (cada categoria com deslocamento próprio, pra não girarem juntas).
    A categoria do dia da semana vira a manchete."""
    hoje = hoje or _hoje()
    dia = hoje.toordinal()
    editoria = C.EDITORIA_DA_SEMANA[hoje.weekday()]
    manchete, secoes = None, []
    for cat, rotulo in C.ROTULOS.items():
        itens = C.ITENS[cat]
        item = dict(itens[(dia + _deslocamento(cat)) % len(itens)], categoria=cat, rotulo=rotulo)
        if cat == editoria:
            manchete = item
        else:
            secoes.append(item)
    levada = dict(C.LEVADAS[dia % len(C.LEVADAS)])
    return {
        "data_iso": hoje.isoformat(),
        "data_extenso": data_extenso(hoje),
        "edicao_numero": max(1, (hoje - EDICAO_INICIAL).days + 1),
        "editoria": C.ROTULOS[editoria],
        "manchete": manchete,
        "secoes": secoes,
        "levada": levada,
    }


# ─────────────────────────── feeds ───────────────────────────
def _limpar(texto):
    texto = re.sub(r"<[^>]+>", " ", texto or "")
    texto = html.unescape(texto)
    texto = re.sub(r"\s*The post .{0,300}? appeared first on .{0,200}$", "", texto, flags=re.S)
    return re.sub(r"\s+", " ", texto).strip()


def _nome(el):
    return el.tag.split("}")[-1].lower() if isinstance(el.tag, str) else ""


def _filho(el, *nomes):
    for c in el:
        if _nome(c) in nomes:
            return c
    return None


def _data(texto):
    if not texto:
        return None
    try:
        dt = parsedate_to_datetime(texto.strip())
    except Exception:
        try:
            dt = datetime.fromisoformat(texto.strip().replace("Z", "+00:00"))
        except Exception:
            return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def parse_feed(conteudo, fonte):
    """Lê RSS 2.0 e Atom. Devolve [{titulo, link, data, trecho, fonte}]."""
    raiz = ET.fromstring(conteudo)
    saida = []
    for el in raiz.iter():
        if _nome(el) not in ("item", "entry"):
            continue
        titulo = _limpar((_filho(el, "title").text if _filho(el, "title") is not None else "") or "")
        link = ""
        for c in el:
            if _nome(c) == "link":
                if c.get("href") and c.get("rel", "alternate") == "alternate":
                    link = c.get("href")
                    break
                if (c.text or "").strip():
                    link = c.text.strip()
        d = _filho(el, "pubdate", "published", "updated", "date")
        corpo = _filho(el, "encoded", "content", "description", "summary")
        if not titulo or not link.startswith("http"):
            continue
        saida.append({"titulo": titulo, "link": link, "data": _data(d.text if d is not None else None),
                      "trecho": _limpar(corpo.text if corpo is not None else ""), "fonte": fonte})
    return saida


# Relevância para os recursos do app (voz, violão, acordes, escalas, composição, produção, IA)
_ALTO = ["vocal", "vocals", "voice", "singer", "singing", "songwriting", "songwriter", "lyrics", "chord", "chords", "scale",
         "scales", "tuner", "tuning", "pitch", "autotune", "auto-tune", "ear training", "stem", "stems", "ai music",
         "ai-generated", "suno", "udio", "generative", "artificial intelligence", "machine learning", "mixing", "mastering",
         "tutorial", "tips", "how to", "guitar", "acoustic", "practice"]
_MEDIO = ["producer", "production", "daw", "plugin", "eq", "compressor", "reverb", "sample", "melody", "harmony", "rhythm",
          "bass", "drums", "ableton", "logic pro", "fl studio", "pro tools", "recording", "microphone", "ai"]
_RE_ALTO = [re.compile(rf"\b{re.escape(p)}\b", re.I) for p in _ALTO]
_RE_MEDIO = [re.compile(rf"\b{re.escape(p)}\b", re.I) for p in _MEDIO]
_RE_LIXO = re.compile(r"\b(deals?|sales?|discounts?|coupons?|black friday|prime day|giveaway|win a|% off|bundle|cyber monday)\b", re.I)


def pontuar(titulo, trecho):
    """0 = descartar. Palavras no título valem em dobro."""
    if _RE_LIXO.search(titulo):
        return 0
    pontos = 0
    for texto, peso_texto in ((titulo, 2), (trecho[:600], 1)):
        pontos += peso_texto * (3 * sum(1 for r in _RE_ALTO if r.search(texto)) + sum(1 for r in _RE_MEDIO if r.search(texto)))
    return pontos


def selecionar(itens, agora=None, minimo=3):
    agora = agora or datetime.now(timezone.utc)
    corte = agora - timedelta(days=LIMITE_DIAS)
    candidatos, vistos = [], set()
    for it in itens:
        chave = re.sub(r"\W+", "", it["titulo"].lower())
        if chave in vistos or (it["data"] and it["data"] < corte):
            continue
        vistos.add(chave)
        p = pontuar(it["titulo"], it["trecho"])
        if p >= minimo:
            candidatos.append((p, it["data"] or corte, it))
    candidatos.sort(key=lambda t: (t[0], t[1]), reverse=True)
    escolhidos, por_fonte = [], {}
    for _, _, it in candidatos:
        if por_fonte.get(it["fonte"], 0) >= MAX_POR_FONTE:
            continue
        por_fonte[it["fonte"]] = por_fonte.get(it["fonte"], 0) + 1
        escolhidos.append(it)
        if len(escolhidos) >= MAX_NOTICIAS:
            break
    return escolhidos


def _baixar_feed(url):
    r = requests.get(url, timeout=6, headers={"User-Agent": "OrangeHarmonyNews/1.0 (+https://orange-harmony.onrender.com)"})
    r.raise_for_status()
    return r.content


def _coletar_feeds(baixar=_baixar_feed):
    def um(feed):
        try:
            return parse_feed(baixar(feed["url"]), feed["fonte"])
        except Exception:
            return []
    with concurrent.futures.ThreadPoolExecutor(max_workers=len(FEEDS)) as pool:
        futuros = [pool.submit(um, f) for f in FEEDS]
        itens = []
        for f in futuros:
            try:
                itens += f.result(timeout=12)
            except Exception:
                pass
    return itens


# ─────────────────────────── resumo em português ───────────────────────────
def _achar_json_lista(texto):
    dados = gemini_client.extrair_json(texto)
    if isinstance(dados, list):
        return dados
    i, j = (texto or "").find("["), (texto or "").rfind("]")
    if 0 <= i < j:
        try:
            dados = json.loads(texto[i:j + 1])
            return dados if isinstance(dados, list) else None
        except Exception:
            return None
    return None


def resumir_em_portugues(itens):
    """Uma única chamada ao Gemini para todos os itens. Devolve {indice: (titulo_pt, resumo_pt)}; {} se não der."""
    if not itens or not gemini_client.gemini_disponivel():
        return {}
    base = [{"id": i, "titulo": it["titulo"], "trecho": it["trecho"][:500]} for i, it in enumerate(itens)]
    prompt = (
        "Você é o editor do Orange News, um jornal de um app de coaching vocal e composição. Abaixo há notícias em inglês "
        "(título e trecho originais). Para CADA uma escreva em português do Brasil:\n"
        '- "titulo_pt": título curto e natural (até 90 caracteres);\n'
        '- "resumo_pt": 1 ou 2 frases (até 220 caracteres) dizendo do que trata a matéria.\n'
        "REGRAS: use SOMENTE o que está no título e no trecho fornecidos. Não invente detalhes, números, datas, nomes ou "
        'conclusões. Se o trecho não bastar para resumir, devolva "resumo_pt": "" (o leitor abrirá o link).\n'
        'Responda APENAS com um JSON no formato [{"id": 0, "titulo_pt": "...", "resumo_pt": "..."}], sem texto antes ou depois.\n\n'
        + json.dumps(base, ensure_ascii=False)
    )
    resposta, _ = gemini_client.chamar_texto(prompt, orcamento_s=40)
    if resposta is None:
        return {}
    lista = _achar_json_lista(resposta.text or "")
    saida = {}
    for r in lista or []:
        try:
            saida[int(r["id"])] = (str(r.get("titulo_pt", "")).strip()[:120], str(r.get("resumo_pt", "")).strip()[:260])
        except Exception:
            continue
    return saida


def _quando(dt, agora=None):
    if dt is None:
        return ""
    horas = ((agora or datetime.now(timezone.utc)) - dt).total_seconds() / 3600
    if horas < 1:
        return "agora há pouco"
    if horas < 24:
        return f"há {int(horas)} h"
    dias = int(horas // 24)
    return "ontem" if dias == 1 else f"há {dias} dias"


def montar_noticias(itens_brutos, agora=None):
    escolhidos = selecionar(itens_brutos, agora)
    traducoes = resumir_em_portugues(escolhidos)
    saida = []
    for i, it in enumerate(escolhidos):
        titulo_pt, resumo_pt = traducoes.get(i, ("", ""))
        traduzido = bool(titulo_pt)
        resumo = resumo_pt or ("" if traduzido else (it["trecho"][:220].rsplit(" ", 1)[0] + "…" if len(it["trecho"]) > 220 else it["trecho"]))
        saida.append({
            "titulo": titulo_pt or it["titulo"],
            "resumo": resumo,
            "fonte": it["fonte"], "link": it["link"],
            "data_iso": it["data"].isoformat() if it["data"] else None,
            "quando": _quando(it["data"], agora),
            "traduzido": traduzido,           # False = título/trecho no idioma original (sem resumo do Gemini)
        })
    return saida


# ─────────────────────────── cache ───────────────────────────
_cache = {"ts": 0.0, "dados": None, "falha_ts": 0.0}
_trava = threading.Lock()


def obter_noticias(forcar=False, baixar=_baixar_feed):
    with _trava:
        agora = time.time()
        if not forcar and _cache["dados"] and agora - _cache["ts"] < TTL_S:
            return _cache["dados"]
        if not forcar and not _cache["dados"] and agora - _cache["falha_ts"] < ESPERA_APOS_FALHA_S:
            return {"status": "indisponivel", "itens": [], "atualizado_em": None}
        itens = montar_noticias(_coletar_feeds(baixar))
        if itens:
            dados = {"status": "ok", "itens": itens, "atualizado_em": datetime.now(timezone.utc).isoformat()}
            _cache.update(ts=agora, dados=dados)
            return dados
        _cache["falha_ts"] = agora
        if _cache["dados"]:
            return {**_cache["dados"], "status": "cache_antigo"}
        return {"status": "indisponivel", "itens": [], "atualizado_em": None}
