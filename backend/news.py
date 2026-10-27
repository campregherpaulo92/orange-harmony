# ══════════════════════════════════════════════════════════════
# news.py — Motor do Orange News.
#  • edicao_do_dia()  → a edição escrita (manchete, seções, levada, discos e rock brasileiro), que troca todo dia; é instantânea.
#  • obter_noticias() → notícias do mundo da música: rock e metal (Brasil e mundo), shows e turnês, lançamentos, produção, e as
#                       notícias das bandas que o leitor acompanha. Vêm de buscas no Google Notícias (que cobre dezenas de
#                       veículos de uma vez) e de alguns sites de produção; com título/resumo em português (Gemini, só com o
#                       texto original) e link da matéria.
# Se as buscas falharem, a edição escrita continua funcionando: o jornal nunca fica vazio.
# ══════════════════════════════════════════════════════════════
import concurrent.futures
import html
import json
import re
import threading
import time
import unicodedata
from datetime import date, datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from urllib.parse import quote_plus

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



# ─────────────────────────── fontes ───────────────────────────
def _gn(consulta, idioma="pt"):
    """Feed de uma busca no Google Notícias. Aceita site:, aspas, OR e when:3d (últimos 3 dias)."""
    hl, gl, ceid = ("pt-BR", "BR", "BR:pt-419") if idioma == "pt" else ("en-US", "US", "US:en")
    return f"https://news.google.com/rss/search?q={quote_plus(consulta)}&hl={hl}&gl={gl}&ceid={ceid}"


def _g(nome, consulta, idioma, regiao, rock_sempre=False, especializada=False, dias=4, exige_musica=False):
    """Uma fonte. rock_sempre: veículo/busca 100% rock (tudo dela conta como rock). exige_musica: busca ampla, descarta o que
    não parece música. especializada: ganha um pequeno bônus (veículo dedicado ao rock)."""
    return dict(fonte=nome, url=_gn(consulta, idioma), google=True, idioma=idioma, regiao=regiao, categoria="geral",
                rock_sempre=rock_sempre, especializada=especializada, dias=dias, exige_musica=exige_musica)


def _p(nome, url):
    """Feed direto de um site de produção musical (inglês)."""
    return dict(fonte=nome, url=url, google=False, idioma="en", regiao="mundo", categoria="producao",
                rock_sempre=False, especializada=False, dias=30, exige_musica=False)


FONTES = [
    # ── Brasil ──
    _g("Whiplash", "site:whiplash.net when:3d", "pt", "br", rock_sempre=True, especializada=True, dias=5),
    _g("Igor Miranda", "site:igormiranda.com.br when:3d", "pt", "br", rock_sempre=True, especializada=True, dias=5),
    _g("Rock Bizz", "site:rockbizz.com.br when:5d", "pt", "br", rock_sempre=True, especializada=True, dias=6),
    _g("Tenho Mais Discos Que Amigos", "site:tenhomaisdiscosqueamigos.com when:5d", "pt", "br", especializada=True, dias=6),
    _g("Rolling Stone Brasil", "site:rollingstone.com.br (rock OR banda OR show OR álbum OR turnê OR festival OR música) when:3d", "pt", "br", dias=5, exige_musica=True),
    _g("Billboard Brasil", "site:billboard.com.br (rock OR banda OR show OR álbum OR turnê OR festival) when:3d", "pt", "br", dias=5, exige_musica=True),
    _g("Rock nacional", '("rock nacional" OR "rock brasileiro" OR "banda brasileira") when:4d', "pt", "br", rock_sempre=True, dias=6),
    _g("Metal e punk no Brasil", "(metal OR \"heavy metal\" OR hardcore OR punk) (banda OR show OR álbum) Brasil when:4d", "pt", "br", rock_sempre=True, dias=6),
    _g("Shows de rock", "(show OR turnê OR festival OR ingressos) (rock OR metal OR banda) when:3d", "pt", "br", dias=7, exige_musica=True),
    _g("Festivais", '("Rock in Rio" OR Lollapalooza OR "The Town" OR "Monsters of Rock" OR Knotfest OR "Maximus Festival") when:7d', "pt", "br", dias=10),
    _g("Lançamentos", '("novo álbum" OR "novo single" OR "novo disco" OR "lança álbum" OR "lança single" OR "nova música") (rock OR metal OR banda) when:5d', "pt", "br", dias=7, exige_musica=True),
    _g("Música no Brasil", "música (banda OR cantor OR cantora OR show OR álbum OR festival) when:2d", "pt", "br", dias=3, exige_musica=True),
    # ── Mundo (inglês) ──
    _g("Loudwire", "site:loudwire.com when:2d", "en", "mundo", rock_sempre=True, especializada=True, dias=4),
    _g("Metal Injection", "site:metalinjection.net when:2d", "en", "mundo", rock_sempre=True, especializada=True, dias=4),
    _g("Ultimate Classic Rock", "site:ultimateclassicrock.com when:2d", "en", "mundo", rock_sempre=True, especializada=True, dias=4),
    _g("Blabbermouth", "site:blabbermouth.net when:2d", "en", "mundo", rock_sempre=True, especializada=True, dias=4),
    _g("Kerrang!", "site:kerrang.com when:3d", "en", "mundo", rock_sempre=True, especializada=True, dias=5),
    _g("Louder", "site:loudersound.com when:3d", "en", "mundo", rock_sempre=True, especializada=True, dias=5),
    _g("Brave Words", "site:bravewords.com when:3d", "en", "mundo", rock_sempre=True, especializada=True, dias=5),
    _g("Rock Sound", "site:rocksound.tv when:4d", "en", "mundo", rock_sempre=True, especializada=True, dias=6),
    _g("Stereogum", "site:stereogum.com when:2d", "en", "mundo", especializada=True, dias=4, exige_musica=True),
    _g("Pitchfork", "site:pitchfork.com when:3d", "en", "mundo", especializada=True, dias=5, exige_musica=True),
    _g("NME", "site:nme.com when:2d", "en", "mundo", dias=4),
    _g("Rolling Stone", "site:rollingstone.com (rock OR band OR album OR tour) when:2d", "en", "mundo", dias=4, exige_musica=True),
    _g("Billboard", "site:billboard.com (rock OR band OR tour OR album) when:2d", "en", "mundo", dias=4, exige_musica=True),
    _g("Consequence", "site:consequence.net (rock OR metal OR band OR tour) when:2d", "en", "mundo", dias=4),
    _g("Shows e turnês (mundo)", '(tour OR concert OR festival OR "tour dates") (rock OR metal OR band) when:3d', "en", "mundo", dias=7, exige_musica=True),
    _g("Lançamentos (mundo)", '("new album" OR "new single" OR "new song" OR "album review") (rock OR metal OR band) when:3d', "en", "mundo", dias=6, exige_musica=True),
    _g("Música no mundo", "music news (artist OR album OR tour OR festival) when:1d", "en", "mundo", dias=3, exige_musica=True),
    # ── Produção e equipamento (os sites que o jornal já usava) ──
    _p("MusicTech", "https://musictech.com/feed/"),
    _p("Attack Magazine", "https://www.attackmagazine.com/feed/"),
    _p("Synthtopia", "https://www.synthtopia.com/feed/"),
    _p("SonicScoop", "https://sonicscoop.com/feed/"),
    _p("Gearnews", "https://www.gearnews.com/feed/"),
]
ROTULOS_CATEGORIAS = {"shows": "Shows e turnês", "lancamentos": "Lançamentos", "brasil": "Música no Brasil",
                      "mundo": "Música no mundo", "producao": "Produção e equipamento"}
MAX_POR_CATEGORIA = 10
MAX_ROCK_POR_CATEGORIA = 7       # o rock vem primeiro, mas ao menos 3 de cada 10 são de outros gêneros (quando houver)
MAX_POR_FONTE = 4                # por categoria
TTL_S = 3 * 3600                 # as notícias valem por 3 horas
TTL_BANDA_S = 2 * 3600
ESPERA_APOS_FALHA_S = 300        # se tudo falhar, só tenta de novo daqui a 5 min
MAX_BANDAS = 8
MAX_POR_BANDA = 4
MAX_TRADUCOES = 60               # títulos por chamada ao Gemini
HEADERS = {"User-Agent": "OrangeHarmonyNews/2.0 (leitor de RSS pessoal do app Orange Harmony)"}


# ─────────────────────────── leitura dos feeds ───────────────────────────
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


def parse_feed(conteudo, fonte, google=False):
    """Lê RSS 2.0 e Atom. Devolve [{titulo, link, data, trecho, fonte}].
    Feed do Google Notícias (google=True): o título vem como 'Manchete - Veículo', o veículo vem em <source> e o texto
    da descrição só repete o título (por isso o trecho fica vazio)."""
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
        nome_fonte, trecho = fonte, _limpar(corpo.text if corpo is not None else "")
        if google:
            src = _filho(el, "source")
            veiculo = _limpar(src.text) if src is not None and src.text else ""
            if veiculo and titulo.endswith(" - " + veiculo):
                titulo = titulo[: -len(veiculo) - 3].rstrip()
            elif not veiculo and " - " in titulo:
                titulo, veiculo = titulo.rsplit(" - ", 1)
            nome_fonte, trecho = _nome_da_fonte(veiculo or fonte), ""
        saida.append({"titulo": titulo, "link": link, "data": _data(d.text if d is not None else None),
                      "trecho": trecho, "fonte": nome_fonte})
    return saida


NOMES_FONTES = {"whiplash.net rock e heavy metal": "Whiplash", "whiplash net rock e heavy metal": "Whiplash", "whiplash.net": "Whiplash",
                "blabbermouth.net": "Blabbermouth", "consequence of sound": "Consequence", "rockbizz": "Rock Bizz",
                "loudwire": "Loudwire", "braveWords".lower(): "Brave Words", "bravewords": "Brave Words", "kerrang!": "Kerrang!",
                "ultimate classic rock": "Ultimate Classic Rock", "rolling stone brasil": "Rolling Stone Brasil", "igor miranda": "Igor Miranda"}


def _nome_da_fonte(nome):
    return NOMES_FONTES.get(str(nome or "").strip().lower(), str(nome or "").strip())


def _baixar_feed(url):
    r = requests.get(url, timeout=(4, 8), headers=HEADERS)
    r.raise_for_status()
    return r.content


def _coletar_feeds(baixar=_baixar_feed, fontes=None):
    """(itens, diagnóstico). Uma fonte que falha só some da lista: as outras seguem."""
    fontes = fontes if fontes is not None else FONTES

    def um(f):
        try:
            itens = parse_feed(baixar(f["url"]), f["fonte"], f.get("google", False))
            return itens, {"fonte": f["fonte"], "ok": True, "itens": len(itens), "erro": ""}
        except Exception as e:
            return [], {"fonte": f["fonte"], "ok": False, "itens": 0, "erro": f"{type(e).__name__}: {str(e)[:90]}"}
    itens, diag = [], []
    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, len(fontes))) as pool:
        futuros = [(f, pool.submit(um, f)) for f in fontes]
        for f, fut in futuros:
            try:
                brutos, d = fut.result(timeout=14)
            except Exception:
                brutos, d = [], {"fonte": f["fonte"], "ok": False, "itens": 0, "erro": "demorou demais"}
            for it in brutos:
                it.update(idioma=f["idioma"], regiao=f["regiao"], cat_fonte=f["categoria"], rock_sempre=f["rock_sempre"],
                          especializada=f["especializada"], dias=f["dias"], exige_musica=f["exige_musica"])
            itens += brutos
            diag.append(d)
    return itens, diag


# ─────────────────────────── classificação e pontuação ───────────────────────────
def _norm(texto):
    """Minúsculas, sem acento nem pontuação: 'AC/DC' → 'ac dc', 'Mötley Crüe' → 'motley crue'."""
    t = unicodedata.normalize("NFKD", str(texto or "")).encode("ascii", "ignore").decode().lower()
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", t)).strip()


def _regex(termos):
    return re.compile(r"\b(?:" + "|".join(re.escape(_norm(t)) for t in termos) + r")\b")


_RE_ROCK = _regex([
    "rock", "metal", "heavy metal", "punk", "grunge", "hardcore", "thrash", "hard rock", "indie rock", "emo", "shoegaze",
    "blues rock", "prog rock", "stoner", "doom", "death metal", "black metal", "power metal", "glam rock", "garage rock",
    "rock alternativo", "rock nacional", "guitarra", "guitar", "riff", "rock n roll",
])
BANDAS_ROCK = [
    "Metallica", "Iron Maiden", "Black Sabbath", "Ozzy Osbourne", "Judas Priest", "Megadeth", "Slayer",
    "Motörhead", "AC/DC", "Led Zeppelin", "Deep Purple", "Scorpions", "Guns N' Roses", "Aerosmith", "Van Halen",
    "Bon Jovi", "Def Leppard", "Mötley Crüe", "Whitesnake", "Rolling Stones", "Beatles", "The Who", "Pink Floyd",
    "David Bowie", "Pearl Jam", "Nirvana", "Soundgarden", "Alice in Chains", "Foo Fighters", "Red Hot Chili Peppers",
    "Green Day", "Blink-182", "Linkin Park", "System of a Down", "Slipknot", "Korn", "Rage Against the Machine",
    "Radiohead", "Arctic Monkeys", "The Strokes", "U2", "Queens of the Stone Age", "Royal Blood",
    "Greta Van Fleet", "Gojira", "Mastodon", "Bring Me the Horizon", "Avenged Sevenfold", "Sabaton",
    "Dream Theater", "The Cure", "The Smiths", "Ramones", "Sex Pistols", "The Clash", "Bad Religion", "NOFX",
    "Paramore", "My Chemical Romance", "Fall Out Boy", "Pixies", "Weezer", "Kings of Leon", "The Black Keys",
    "The White Stripes", "Stone Temple Pilots", "Lynyrd Skynyrd", "Bruce Springsteen", "Tom Petty", "Neil Young",
    "Legião Urbana", "Titãs", "Paralamas do Sucesso", "Barão Vermelho", "Capital Inicial", "Engenheiros do Hawaii",
    "Raimundos", "Pitty", "Charlie Brown Jr", "Los Hermanos", "Nação Zumbi", "Chico Science", "Sepultura", "Angra",
    "Krisiun", "Ratos de Porão", "Plebe Rude", "Detonautas", "O Rappa", "Jota Quest", "Nenhum de Nós",
    "Biquini Cavadão", "Ultraje a Rigor", "Cássia Eller", "Rita Lee", "Os Mutantes", "Raul Seixas", "Secos & Molhados",
    "Cazuza", "Lobão", "Camisa de Vênus", "Replicantes", "Dr. Sin", "Korzus", "Torture Squad", "Project46", "Far From Alaska",
    "Scalene", "CPM 22", "NX Zero", "Black Pantera", "Dead Fish", "Cachorro Grande", "Pato Fu", "Garotos Podres",
]
# Nomes de banda que também são palavras comuns ("Muse" é um álbum do John Legend, "Queen" é rainha, "Anthrax" é uma doença…):
# NÃO marcam rock sozinhos. Só contam quando o leitor segue a banda, ou quando a notícia vem de um veículo de rock.
BANDAS_AMBIGUAS = ["Queen", "Kiss", "Tool", "Muse", "Ghost", "Rush", "Oasis", "Anthrax", "Pantera", "Shaman", "Cólera", "Ira!", "Skank", "Fresno", "Yes", "Live"]
_RE_BANDAS_ROCK = _regex(BANDAS_ROCK)
_RE_SHOWS = _regex(["show", "shows", "turne", "tour", "tours", "festival", "festivais", "ingresso", "ingressos", "ticket", "tickets",
                    "setlist", "concert", "concerto", "concertos", "apresentacao", "apresentacoes", "datas", "dates", "headliner",
                    "line up", "lineup", "cancela", "cancelado", "cancelled", "postponed"])
_RE_LANC = _regex(["album", "albums", "single", "singles", "ep", "novo disco", "disco novo", "novo album", "nova musica", "novas musicas",
                   "lanca", "lancou", "lancamento", "lancamentos", "release", "released", "releases", "new song", "new songs",
                   "new album", "new single", "clipe", "videoclipe", "music video", "tracklist", "review", "resenha", "critica",
                   "reissue", "remaster", "remasterizado", "deluxe"])
_RE_MUSICA = _regex(["musica", "musicas", "music", "banda", "bandas", "band", "bands", "album", "single", "show", "shows", "tour", "turne",
                     "festival", "cantor", "cantora", "singer", "disco", "clipe", "rock", "metal", "punk", "guitarra", "guitar",
                     "vocal", "ep", "setlist", "ingresso", "ingressos", "ticket", "tickets", "rapper", "dj", "pop", "sertanejo", "mpb",
                     "concerto", "concertos", "concert", "concerts", "musical", "gig", "apresentacao", "apresentacoes", "cover",
                     "coral", "orquestra", "orchestra", "sinfonico", "gravacao", "repertorio"])
_RE_LIXO = re.compile(r"\b(deals?|sales?|discounts?|coupons?|black friday|prime day|giveaway|win a|% off|bundle|cyber monday|horoscopo|signo)\b", re.I)
_STOP = {"the", "and", "for", "with", "from", "that", "this", "new", "his", "her", "are", "was", "has", "have", "will", "about",
         "que", "uma", "com", "para", "por", "dos", "das", "nos", "nas", "mais", "como", "sobre", "apos", "ao", "aos", "pelo", "pela"}
_PT = {"de", "do", "da", "dos", "das", "em", "no", "na", "nos", "nas", "para", "com", "que", "um", "uma", "e", "o", "a", "os", "as", "se", "por", "ao", "mais", "novo", "nova"}
_EN = {"the", "of", "and", "to", "in", "with", "for", "on", "at", "is", "are", "new", "from", "his", "her", "its", "will", "has", "by", "after", "as"}


def _idioma(titulo):
    palavras = _norm(titulo).split()
    pt, en = sum(1 for p in palavras if p in _PT), sum(1 for p in palavras if p in _EN)
    return "en" if en > pt else "pt"


def _tokens(titulo):
    return {p for p in _norm(titulo).split() if len(p) >= 3 and p not in _STOP}


def _parecidos(a, b):
    if len(a) < 3 or len(b) < 3:
        return False
    comum = len(a & b)
    jac = comum / len(a | b)
    return jac >= 0.6 or (comum >= 5 and jac >= 0.4)         # 2º critério: a mesma notícia em português e em inglês (6 de 13 palavras)


# Relevância dos sites de PRODUÇÃO (a regra que o jornal já usava: o que interessa aos recursos do app)
_ALTO = ["vocal", "vocals", "voice", "singer", "singing", "songwriting", "songwriter", "lyrics", "chord", "chords", "scale",
         "scales", "tuner", "tuning", "pitch", "autotune", "auto-tune", "ear training", "stem", "stems", "ai music",
         "ai-generated", "suno", "udio", "generative", "artificial intelligence", "machine learning", "mixing", "mastering",
         "tutorial", "tips", "how to", "guitar", "acoustic", "practice"]
_MEDIO = ["producer", "production", "daw", "plugin", "eq", "compressor", "reverb", "sample", "melody", "harmony", "rhythm",
          "bass", "drums", "ableton", "logic pro", "fl studio", "pro tools", "recording", "microphone", "ai"]
_RE_ALTO = [re.compile(rf"\b{re.escape(p)}\b", re.I) for p in _ALTO]
_RE_MEDIO = [re.compile(rf"\b{re.escape(p)}\b", re.I) for p in _MEDIO]


def pontuar(titulo, trecho):
    """Relevância para os recursos do app (sites de produção). 0 = descartar. Palavras no título valem em dobro."""
    if _RE_LIXO.search(titulo):
        return 0
    pontos = 0
    for texto, peso_texto in ((titulo, 2), (trecho[:600], 1)):
        pontos += peso_texto * (3 * sum(1 for r in _RE_ALTO if r.search(texto)) + sum(1 for r in _RE_MEDIO if r.search(texto)))
    return pontos


def classificar(titulo, regiao, cat_fonte="geral"):
    """Seção da notícia: shows, lançamentos, brasil, mundo ou produção."""
    if cat_fonte == "producao":
        return "producao"
    t = _norm(titulo)
    if _RE_SHOWS.search(t):
        return "shows"
    if _RE_LANC.search(t):
        return "lancamentos"
    return "brasil" if regiao == "br" else "mundo"


def _eh_rock(it):
    if it.get("rock_sempre"):
        return True
    t = _norm(it["titulo"]) + " | " + _norm(it.get("trecho", "")[:300])
    return bool(_RE_ROCK.search(t) or _RE_BANDAS_ROCK.search(t))


def _pontos(it, agora):
    horas = ((agora - it["data"]).total_seconds() / 3600) if it.get("data") else 72.0
    pts = 100.0 * 0.5 ** (max(0.0, horas) / 36.0)                 # a notícia perde metade do peso a cada 36 horas
    if it["rock"]:
        pts += 60                                                 # rock e metal vêm primeiro
    if _RE_BANDAS_ROCK.search(_norm(it["titulo"])):
        pts += 15
    if it["categoria"] in ("shows", "lancamentos"):
        pts += 8
    if it.get("especializada"):
        pts += 10
    return pts


def selecionar(itens, agora=None):
    """Escolhe as notícias de cada seção: tira repetidas (a mesma notícia em vários veículos), lixo, antigas e o que não é música;
    ordena por (rock primeiro, recência) e limita por seção e por veículo."""
    agora = agora or datetime.now(timezone.utc)
    candidatos = []
    for it in itens:
        if it.get("data") and it["data"] < agora - timedelta(days=it.get("dias", 4)):
            continue
        if _RE_LIXO.search(it["titulo"]):
            continue
        titulo_norm = _norm(it["titulo"])
        if it.get("exige_musica") and not _RE_MUSICA.search(titulo_norm):
            continue
        cat = classificar(it["titulo"], it["regiao"], it.get("cat_fonte", "geral"))
        if cat == "producao" and pontuar(it["titulo"], it.get("trecho", "")) < 3:
            continue
        it = dict(it, categoria=cat, rock=(cat != "producao" and _eh_rock(it)))
        it["pontos"] = _pontos(it, agora)
        candidatos.append(it)
    candidatos.sort(key=lambda x: x["pontos"], reverse=True)
    escolhidos, tokens_ok, por_cat, por_fonte, rock_cat, reserva = [], [], {}, {}, {}, []

    def aceitar(it):
        cat, fonte = it["categoria"], it["fonte"]
        if por_cat.get(cat, 0) >= MAX_POR_CATEGORIA or por_fonte.get((cat, fonte), 0) >= MAX_POR_FONTE:
            return False
        tk = _tokens(it["titulo"])
        if any(_parecidos(tk, o) for o in tokens_ok) or any(it["link"] == e["link"] for e in escolhidos):
            return False
        tokens_ok.append(tk)
        por_cat[cat] = por_cat.get(cat, 0) + 1
        por_fonte[(cat, fonte)] = por_fonte.get((cat, fonte), 0) + 1
        rock_cat[cat] = rock_cat.get(cat, 0) + (1 if it["rock"] else 0)
        escolhidos.append(it)
        return True

    for it in candidatos:                                     # 1ª passada: rock primeiro, mas com teto de 70% por seção
        if it["rock"] and rock_cat.get(it["categoria"], 0) >= MAX_ROCK_POR_CATEGORIA:
            reserva.append(it)
            continue
        aceitar(it)
    for it in reserva:                                        # 2ª passada: se sobrou espaço, o rock que ficou de fora entra
        aceitar(it)
    escolhidos.sort(key=lambda x: x["pontos"], reverse=True)
    return escolhidos


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
    base = [{"id": i, "titulo": it["titulo"], "trecho": (it.get("trecho") or "")[:500]} for i, it in enumerate(itens)]
    prompt = (
        "Você é o editor do Orange News, o jornal de música de um app de coaching vocal e composição. Abaixo há notícias em inglês "
        "(título e, às vezes, um trecho). Para CADA uma escreva em português do Brasil:\n"
        '- "titulo_pt": título curto e natural (até 90 caracteres), mantendo nomes de bandas, álbuns e músicas como estão;\n'
        '- "resumo_pt": 1 ou 2 frases (até 220 caracteres) dizendo do que trata a matéria; se NÃO houver trecho, devolva "".\n'
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


_traducoes = {}                       # link -> (titulo_pt, resumo_pt): uma notícia só é traduzida uma vez


def _traduzir(itens):
    pendentes = [it for it in itens if it.get("idioma") == "en" and it["link"] not in _traducoes][:MAX_TRADUCOES]
    if not pendentes:
        return
    res = resumir_em_portugues(pendentes)
    for i, it in enumerate(pendentes):
        if i in res and res[i][0]:
            _traducoes[it["link"]] = res[i]


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


def _para_saida(it, agora=None):
    titulo_pt, resumo_pt = _traducoes.get(it["link"], ("", ""))
    em_pt = it.get("idioma") == "pt"
    traduzido = em_pt or bool(titulo_pt)
    trecho = it.get("trecho", "")
    if em_pt:
        resumo = trecho[:220].rsplit(" ", 1)[0] + "…" if len(trecho) > 220 else trecho
    elif titulo_pt:
        resumo = resumo_pt
    else:
        resumo = trecho[:220].rsplit(" ", 1)[0] + "…" if len(trecho) > 220 else trecho
    cat = it["categoria"]
    saida = {
        "titulo": titulo_pt or it["titulo"], "resumo": resumo, "fonte": it["fonte"], "link": it["link"],
        "data_iso": it["data"].isoformat() if it.get("data") else None, "quando": _quando(it.get("data"), agora),
        "traduzido": traduzido, "categoria": cat, "rotulo": ROTULOS_CATEGORIAS[cat], "regiao": it["regiao"], "rock": bool(it["rock"]),
    }
    if it.get("banda"):
        saida["banda"] = it["banda"]
    return saida


def montar_noticias(itens_brutos, agora=None):
    escolhidos = selecionar(itens_brutos, agora)
    _traduzir(escolhidos)
    return [_para_saida(it, agora) for it in escolhidos]


# ─────────────────────────── suas bandas ───────────────────────────
_cache_bandas = {}                    # nome normalizado -> (timestamp, itens)
_trava_bandas = threading.Lock()


def limpar_bandas(bandas):
    """Até 8 nomes, sem repetição, de 2 a 40 caracteres (aspas e símbolos de busca saem)."""
    saida, vistos = [], set()
    for b in bandas or []:
        nome = re.sub(r'["()\\]', " ", str(b or "")).strip()
        nome = re.sub(r"\s+", " ", nome)[:40].strip()
        chave = _norm(nome)
        if len(chave) < 2 or chave in vistos:
            continue
        vistos.add(chave)
        saida.append(nome)
        if len(saida) >= MAX_BANDAS:
            break
    return saida


def _buscar_banda(nome, baixar, agora):
    chave = _norm(nome)
    with _trava_bandas:
        guardado = _cache_bandas.get(chave)
        if guardado and time.time() - guardado[0] < TTL_BANDA_S:
            return guardado[1]
    consulta = f'"{nome}" (banda OR band OR rock OR show OR álbum OR album OR turnê OR tour) when:14d'
    try:
        brutos = parse_feed(baixar(_gn(consulta, "pt")), "Google Notícias", google=True)
    except Exception:
        brutos = []
    re_nome = re.compile(r"\b" + re.escape(chave) + r"\b")
    ambigua = chave in {_norm(b) for b in BANDAS_AMBIGUAS}      # "Queen", "Muse"…: também são palavras comuns
    itens, tokens_ok = [], []
    for it in sorted(brutos, key=lambda x: x.get("data") or agora - timedelta(days=30), reverse=True):
        titulo_norm = _norm(it["titulo"])
        if not re_nome.search(titulo_norm) or (ambigua and not _RE_MUSICA.search(titulo_norm)):
            continue
        tk = _tokens(it["titulo"])
        if any(_parecidos(tk, o) for o in tokens_ok):
            continue
        tokens_ok.append(tk)
        idioma = _idioma(it["titulo"])
        itens.append(dict(it, idioma=idioma, regiao="br" if idioma == "pt" else "mundo", cat_fonte="geral", rock=True, banda=nome,
                          categoria=classificar(it["titulo"], "br" if idioma == "pt" else "mundo")))
        if len(itens) >= MAX_POR_BANDA:
            break
    if brutos or itens:                                  # não guarda no cache uma falha de rede
        with _trava_bandas:
            _cache_bandas[chave] = (time.time(), itens)
    return itens


def noticias_das_bandas(bandas, pool=None, baixar=_baixar_feed, agora=None):
    """Notícias das bandas que o leitor acompanha: busca própria de cada banda + o que já veio nas seções principais."""
    agora = agora or datetime.now(timezone.utc)
    nomes = limpar_bandas(bandas)
    if not nomes:
        return []
    with concurrent.futures.ThreadPoolExecutor(max_workers=len(nomes)) as ex:
        por_banda = list(ex.map(lambda n: _buscar_banda(n, baixar, agora), nomes))
    todos = []
    for nome, itens in zip(nomes, por_banda):
        re_nome = re.compile(r"\b" + re.escape(_norm(nome)) + r"\b")
        vistos = {it["link"] for it in itens}
        tokens_ok = [_tokens(it["titulo"]) for it in itens]
        extras = []
        for it in pool or []:                            # o que as seções principais já traziam sobre a banda
            if it["link"] in vistos or not re_nome.search(_norm(it["titulo"])):
                continue
            if it.get("data") and it["data"] < agora - timedelta(days=14):
                continue
            tk = _tokens(it["titulo"])
            if any(_parecidos(tk, o) for o in tokens_ok):
                continue
            tokens_ok.append(tk)
            extras.append(dict(it, rock=True, banda=nome, categoria=classificar(it["titulo"], it["regiao"], it.get("cat_fonte", "geral"))))
        todos += (itens + extras)[:MAX_POR_BANDA]
    _traduzir(todos)
    return [_para_saida(it, agora) for it in todos]


# ─────────────────────────── cache e entrega ───────────────────────────
_cache = {"ts": 0.0, "dados": None, "falha_ts": 0.0, "pool": []}
_trava = threading.Lock()


def _principal(forcar, baixar):
    with _trava:
        agora = time.time()
        if not forcar and _cache["dados"] and agora - _cache["ts"] < TTL_S:
            return _cache["dados"], _cache["pool"]
        if not forcar and not _cache["dados"] and agora - _cache["falha_ts"] < ESPERA_APOS_FALHA_S:
            return {"status": "indisponivel", "itens": [], "atualizado_em": None}, []
        brutos, diag = _coletar_feeds(baixar)
        itens = montar_noticias(brutos)
        if itens:
            dados = {"status": "ok", "itens": itens, "atualizado_em": datetime.now(timezone.utc).isoformat(),
                     "fontes": {"ok": sum(1 for d in diag if d["ok"]), "total": len(diag)}}
            _cache.update(ts=agora, dados=dados, pool=brutos)
            return dados, brutos
        _cache["falha_ts"] = agora
        if _cache["dados"]:
            return {**_cache["dados"], "status": "cache_antigo"}, _cache["pool"]
        return {"status": "indisponivel", "itens": [], "atualizado_em": None}, []


def obter_noticias(forcar=False, baixar=_baixar_feed, bandas=None):
    dados, pool = _principal(forcar, baixar)
    saida = dict(dados)
    saida["suas_bandas"] = noticias_das_bandas(bandas, pool, baixar) if bandas else []
    return saida


def diagnosticar_fontes(baixar=_baixar_feed):
    """Para conferir quais fontes estão respondendo (sem usar o cache): [{fonte, ok, itens, erro}]."""
    _, diag = _coletar_feeds(baixar)
    return diag
