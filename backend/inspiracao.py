# -*- coding: utf-8 -*-
"""inspiracao.py — biblioteca de ideias para o Songwriter e a Laranjinha escreverem letras MENOS PREVISÍVEIS.

Por que existe: pedida uma letra com um tema, a IA cai sempre nos mesmos clichês (sol, janela, brisa, "vida boa", "liberdade"…).
Aqui o app sorteia, a cada pedido, uma DIREÇÃO CRIATIVA (ângulo, vibe, recurso narrativo, família de imagens, detalhes concretos e
uma "regra do jogo") a partir de uma biblioteca própria, soma uma lista de palavras a EVITAR (clichês + palavras das últimas letras)
e só então manda escrever. Só biblioteca padrão do Python: funciona sem internet e sem chave.
"""
import inspect
import random
import re
import secrets
import unicodedata
from collections import Counter


def _norm(t):
    return "".join(c for c in unicodedata.normalize("NFD", str(t or "")) if unicodedata.category(c) != "Mn").lower()


# ════════════════════════════════════════════════ A BIBLIOTECA ════════════════════════════════════════════════
# grupo: usado para a combinação "ousada" juntar ângulos de mundos diferentes
ANGULOS = [
    {"id": "poetico", "nome": "Poético", "grupo": "tom", "instrucao": "poético: imagens inesperadas, metáforas frescas, a música das palavras (aliterações, ecos)"},
    {"id": "historico", "nome": "Histórico", "grupo": "mente", "instrucao": "histórico: parta de um fato, época ou personagem REAL (uma invenção, uma viagem, uma data, um objeto de museu) e ligue ao sentimento de hoje"},
    {"id": "cientifico", "nome": "Científico", "grupo": "mente", "instrucao": "científico: use um fenômeno de verdade (gravidade, entropia, maré, fotossíntese, eclipse, efeito Doppler, DNA, fusão) como metáfora do sentimento"},
    {"id": "romantico", "nome": "Romântico", "grupo": "afeto", "instrucao": "romântico: desejo, cuidado, distância, ciúme ou reencontro, com um detalhe íntimo e específico (nunca o “amor” genérico)"},
    {"id": "humor", "nome": "Bem-humorado", "grupo": "tom", "instrucao": "bem-humorado: ironia, exagero e autocrítica; uma cena do cotidiano que dá risada e, no fim, dá um nó na garganta"},
    {"id": "sombrio", "nome": "Sombrio", "grupo": "tom", "instrucao": "sombrio: o lado escuro (medo, culpa, insônia, ressaca emocional), sem glamourizar e sem incentivar violência"},
    {"id": "nostalgico", "nome": "Nostálgico", "grupo": "afeto", "instrucao": "nostálgico: memória sensorial de um tempo (infância, um bairro, uma casa que já não existe), com cheiros e sons"},
    {"id": "social", "nome": "Crônica social", "grupo": "mundo", "instrucao": "crônica social: olhe a cidade, o trabalho e o transporte lotado como um narrador que viu de perto, sem panfleto"},
    {"id": "filosofico", "nome": "Filosófico", "grupo": "mente", "instrucao": "filosófico: uma pergunta grande feita com palavras simples (tempo, escolha, acaso, identidade)"},
    {"id": "mitologico", "nome": "Mitos e lendas", "grupo": "mundo", "instrucao": "mitos e lendas: histórias antigas (gregas, nórdicas, indígenas, do folclore brasileiro como saci, iara, boitatá, curupira) como espelho de algo de hoje"},
    {"id": "viagem", "nome": "Viagem e lugares", "grupo": "mundo", "instrucao": "viagem e lugares: partida, chegada, mapa, fuso horário, rodoviária, aeroporto; um lugar específico com nome e cheiro"},
    {"id": "espiritual", "nome": "Espiritual", "grupo": "mundo", "instrucao": "espiritual, sem pregar: fé, dúvida honesta, silêncio, gratidão por uma coisa pequena e concreta"},
    {"id": "fantastico", "nome": "Fantasia e ficção científica", "grupo": "mente", "instrucao": "fantasia ou ficção científica: um mundo inventado, robô, planeta, viagem no tempo, para falar de algo muito humano"},
    {"id": "cotidiano", "nome": "Cena do cotidiano", "grupo": "mundo", "instrucao": "cena do cotidiano: um momento pequeno (cozinha, ônibus, mensagem sem resposta) visto de perto, quase em câmera lenta"},
    {"id": "natureza", "nome": "Natureza específica", "grupo": "mundo", "instrucao": "natureza específica: uma espécie de ave, um tipo de nuvem, uma planta de verdade (nunca “mar azul” genérico)"},
    {"id": "corpo", "nome": "Corpo e pista", "grupo": "tom", "instrucao": "corpo e pista: ritmo, suor, dança, o jeito de andar, o toque; letra que dá vontade de mexer"},
]

VIBES = [
    {"id": "boa", "nome": "Boa vibe", "rara": False, "instrucao": "boa vibe: leve, luminosa, de celebração, mas com um detalhe específico (nada de só “felicidade”)"},
    {"id": "ruim", "nome": "Má vibe", "rara": True, "instrucao": "má vibe: tensa e amarga, raiva ou ressaca emocional, sem violência explícita"},
    {"id": "agridoce", "nome": "Agridoce", "rara": True, "instrucao": "agridoce: alegria e perda na mesma frase"},
    {"id": "misteriosa", "nome": "Misteriosa", "rara": True, "instrucao": "misteriosa: suspense, meia-luz, coisas que ficam por dizer"},
    {"id": "epica", "nome": "Épica", "rara": False, "instrucao": "épica: grande, coletiva, de arrepiar; um “nós” em vez de um “eu”"},
    {"id": "intima", "nome": "Íntima", "rara": False, "instrucao": "íntima: baixinho, perto do ouvido, quase uma confissão"},
    {"id": "ironica", "nome": "Irônica", "rara": True, "instrucao": "irônica: diz uma coisa e quer dizer outra, com um sorriso no canto da boca"},
]

OUSADIAS = {
    "suave": {"nome": "Suave", "angulos": 1, "familias": 1, "detalhes": 2, "recurso": 0.5, "regra": 0.0, "temperatura": 0.9},
    "media": {"nome": "Média", "angulos": 2, "familias": 1, "detalhes": 3, "recurso": 1.0, "regra": 0.5, "temperatura": 1.05},
    "ousada": {"nome": "Ousada", "angulos": 2, "familias": 2, "detalhes": 4, "recurso": 1.0, "regra": 1.0, "temperatura": 1.2},
}

DISPOSITIVOS = [
    "uma carta (de quem escreve para quem lê, com data e assinatura imaginárias)",
    "um diálogo entre duas vozes que se respondem",
    "uma contagem regressiva (ou progressiva) que muda de sentido no fim",
    "uma pergunta que se repete e vai mudando de significado a cada volta",
    "uma lista que começa banal e vira confissão",
    "o ponto de vista de um objeto ou de um bicho que assiste à cena",
    "uma virada no último verso que reorganiza tudo o que veio antes",
    "dois tempos (antes e depois) cortados como cenas de filme",
    "uma única cena em câmera lenta, do primeiro ao último segundo",
    "um mapa ou itinerário, parada por parada",
    "um conjunto de instruções, como uma receita ou manual",
    "um boletim ou notícia dada com a maior seriedade sobre algo íntimo",
    "uma oração ou pedido feito a alguém (ou a algo) que talvez não escute",
    "um inventário de objetos que sobraram num lugar",
    "uma conversa com a cidade, a rua ou a casa",
    "um bilhete deixado na geladeira, ou uma mensagem de voz que não foi apagada",
    "um refrão que muda uma palavra cada vez que volta",
]

FAMILIAS = {
    "astronomia": ["órbita", "eclipse", "poeira estelar", "anã marrom", "cometa", "buraco negro", "fase da lua", "luz de estrela que já morreu"],
    "geologia": ["placas tectônicas", "sedimento", "fóssil", "erosão", "magma", "camadas de rocha", "cratera"],
    "cozinha": ["fermento", "ponto da massa", "panela de pressão", "brasa", "tempero", "peneira", "banho-maria"],
    "oficina": ["engrenagem", "parafuso", "embreagem", "óleo", "freio", "chave de fenda", "ferrugem"],
    "navegação": ["bússola", "farol", "maré", "âncora", "rota", "bote", "cais"],
    "botânica": ["raiz", "semente", "enxerto", "poda", "floração", "folha seca", "clorofila"],
    "tempo e clima": ["frente fria", "nevoeiro", "trovoada", "orvalho", "pressão baixa", "estiagem", "granizo"],
    "eletricidade": ["curto-circuito", "tomada", "fusível", "corrente", "resistência", "voltagem", "apagão"],
    "mapas": ["escala", "meridiano", "fronteira", "legenda", "curva de nível", "norte perdido"],
    "obra e construção": ["alicerce", "laje", "andaime", "reboco", "viga", "planta baixa"],
    "tecnologia": ["sinal fraco", "bateria", "atualização", "cache", "buffer", "senha", "backup"],
    "relojoaria": ["ponteiro", "mola", "pêndulo", "corda", "fuso", "badalada"],
    "biologia": ["célula", "simbiose", "metamorfose", "DNA", "pele nova", "sistema imunológico"],
    "física": ["inércia", "atrito", "vácuo", "onda", "ressonância", "ponto de equilíbrio", "efeito Doppler"],
    "esporte": ["escanteio", "prorrogação", "pênalti", "banco de reservas", "apito final", "VAR"],
    "teatro e cinema": ["coxia", "roteiro", "corte seco", "close", "ensaio", "plateia vazia"],
}

DETALHES = {
    "lugares": ["rodoviária às cinco da manhã", "padaria de esquina", "fliperama", "terminal de ônibus", "laje com varal", "feira livre",
                "estacionamento de supermercado", "barbearia", "igreja vazia numa segunda", "quadra de futsal", "estação de trem", "cinema antigo"],
    "objetos": ["chinelo trocado", "fita cassete", "chaveiro quebrado", "ventilador de teto", "cadeira de plástico", "rádio de pilha",
                "guarda-chuva torto", "calendário de padaria", "caderno de receitas", "porta-retrato sem foto", "relógio parado"],
    "cheiros": ["café coado", "asfalto molhado", "naftalina", "sabão em pó", "goiaba madura", "tinta fresca", "fumaça de churrasco", "perfume de gaveta"],
    "sons": ["chuveiro elétrico", "portão enferrujado", "notificação de celular", "sirene ao longe", "moeda no balcão",
             "vizinho tocando cavaquinho", "panela na pia", "chinelo arrastando", "ônibus freando"],
    "horários e clima": ["madrugada de terça", "domingo às cinco da tarde", "meio-dia de verão", "onda de calor", "garoa fina", "apagão no bairro", "feriado de segunda"],
    "gente e ofícios": ["motoboy", "cobrador de ônibus", "enfermeira de plantão", "padeiro", "DJ de casamento", "bibliotecário", "eletricista", "taxista", "faxineira do prédio"],
    "comidas": ["pastel de feira", "marmita", "bolo de fubá", "pão na chapa", "arroz queimado", "sorvete derretendo", "café requentado"],
    "vida digital": ["mensagem visualizada e sem resposta", "áudio de três minutos", "senha do wifi", "bateria em três por cento", "carregador emprestado", "foto que ficou na galeria"],
}

REGRAS = [
    "não use as palavras “amor” nem “coração”",
    "o refrão tem no máximo oito palavras",
    "o primeiro verso é uma pergunta",
    "o último verso repete o primeiro com outro sentido",
    "inclua uma única palavra de outro idioma, em um momento certeiro",
    "nenhum adjetivo de cor",
    "cada estrofe traz um número exato (horas, quilômetros, degraus…)",
    "o refrão muda uma palavra cada vez que volta",
    "só substantivos concretos no refrão, nada abstrato",
    "um verso curtíssimo (três palavras) no meio de estrofes longas",
    "uma rima rara por estrofe e o resto solto, de conversa",
    "nenhuma estrofe repete a estrutura da anterior",
    "o título aparece só no último refrão",
]

CLICHES_BASE = [
    "sol", "janela", "brisa", "vento", "mar azul", "estrada", "luz no fim do túnel", "coração", "voar", "liberdade", "paz e amor",
    "vida boa", "felicidade", "positividade", "sonhos", "alma", "o universo conspira", "para sempre", "estrelas no céu",
    "lágrimas de chuva", "ninguém vai nos parar", "levantar a cabeça", "recomeçar", "brilhar", "caminho",
]

# notas por gênero: chaves (sem acento) que casam com o nome do estilo; ordem do mais específico para o mais geral
GENEROS = [
    {"id": "pagode", "chaves": ["pagode"], "nome": "pagode", "temas": "amor de bar, ciúme, reconciliação, resenha com os amigos, saudade", "vocabulario": "banjo, tantã, repique de mão, mesa de bar, roda", "estrutura": "refrão grudento que o coro repete; verso conversado", "fugir": "um pagode com humor e ironia, ou sobre a rotina de quem trabalha de madrugada"},
    {"id": "samba", "chaves": ["samba", "partido alto"], "nome": "samba", "temas": "roda de samba, saudade, o morro e a cidade, a malandragem boa, homenagem a um lugar ou a uma pessoa", "vocabulario": "cavaquinho, pandeiro, tamborim, surdo, cuíca, quintal, batucada", "estrutura": "versos de sete sílabas, cadência, refrão curto de coro", "fugir": "um samba de quintal sobre um fato histórico, ou a crônica de um ônibus lotado"},
    {"id": "forro", "chaves": ["forro", "baiao", "xote", "xaxado"], "nome": "forró", "temas": "festa junina, saudade do sertão, dançar coladinho, amor de quem mora longe, a chuva que chega depois da seca", "vocabulario": "sanfona, zabumba, triângulo, fogueira, terreiro, mandacaru, cuscuz", "estrutura": "versos curtos e dançantes, pergunta e resposta, refrão para cantar junto", "fugir": "o forró da cidade grande (rodoviária, WhatsApp), ou a seca vista por quem estuda as nuvens"},
    {"id": "brega", "chaves": ["brega", "arrocha", "piseiro", "tecnobrega"], "nome": "brega/arrocha", "temas": "amor intenso, traição, saudade, o recado que ficou no ar", "vocabulario": "sofrência, sintetizador, dança colada", "estrutura": "refrão de sofrência dançante, verso confessional", "fugir": "sofrência contada com humor, ou do ponto de vista de quem foi deixado e vai dançar mesmo assim"},
    {"id": "sertanejo", "chaves": ["sertanej", "modao", "sofrencia", "viola caipira", "caipira"], "nome": "sertanejo", "temas": "sofrência, bar e copo, saudade, a roça, a estrada, o interior diante da cidade grande", "vocabulario": "viola, boteco, poeira, porteira, interior", "estrutura": "refrão bem cantável, verso narrativo", "fugir": "sofrência com ironia, ou o interior de hoje (aplicativo de entrega, internet no sítio)"},
    {"id": "funk", "chaves": ["funk", "baile", "mandelao", "tamborzao"], "nome": "funk", "temas": "o baile, a paquera, o orgulho do lugar de onde se vem, a superação, o humor", "vocabulario": "batida, grave, baile, quebrada, tamborzão", "estrutura": "refrão repetitivo e rítmico, versos curtos", "fugir": "um funk romântico, ou sobre quem trabalha na madrugada; sem apologia de violência"},
    {"id": "rap", "chaves": ["rap", "hip hop", "hip-hop", "trap", "boom bap"], "nome": "rap/hip-hop", "temas": "relato do cotidiano, crônica da cidade, superação, a rima como ofício", "vocabulario": "rima interna, punchline, flow, quebrada, esquina", "estrutura": "16 compassos por verso, gancho curto no refrão", "fugir": "storytelling com começo, meio e fim, ou rimas tiradas da ciência e da história"},
    {"id": "metal", "chaves": ["metal", "heavy", "thrash", "death", "power metal"], "nome": "metal", "temas": "mitologia, histórias épicas, ficção, a natureza e a ruína, batalhas lembradas de longe", "vocabulario": "ferro, trovão, lenda, tempestade, relíquia", "estrutura": "versos narrativos, refrão épico para gritar", "fugir": "metal sobre ciência e astronomia, ou sobre uma luta bem pequena e doméstica"},
    {"id": "rock", "chaves": ["rock", "indie", "alternativ", "grunge", "punk", "emo", "post-punk", "new wave"], "nome": "rock", "temas": "rebeldia sem pose, a cidade à noite, a ressaca, a amizade, o palco", "vocabulario": "guitarra, garagem, amplificador, camisa suada, van", "estrutura": "verso, pré-refrão que sobe, refrão aberto, ponte", "fugir": "rock sobre algo pequeno e doméstico, ou saudade de fita cassete"},
    {"id": "latino", "chaves": ["reggaeton", "latin", "cumbia", "salsa", "bachata", "merengue", "tango", "bolero"], "nome": "música latina", "temas": "paquera, dança, saudade, ciúme", "vocabulario": "ritmo marcado, coro, calor", "estrutura": "refrão rítmico e repetido", "fugir": "a mesma pista vista pelo garçom"},
    {"id": "reggae", "chaves": ["reggae", "ska", "dancehall", "dub"], "nome": "reggae", "temas": "paz com consciência, resistência, o ritmo lento da vida, amor tranquilo", "vocabulario": "contratempo, raiz, groove, maré", "estrutura": "refrão em forma de mantra, versos que balançam", "fugir": "reggae urbano do cotidiano, ônibus e feira"},
    {"id": "axe", "chaves": ["axe", "carnaval", "frevo", "marchinha", "trio eletrico"], "nome": "axé/carnaval", "temas": "festa de rua, paquera, folia, orgulho do lugar", "vocabulario": "trio elétrico, bloco, serpentina, avenida, confete", "estrutura": "refrão de coro para pular, versos de chamada e resposta", "fugir": "o carnaval visto por quem fica de plantão, ou a quarta-feira de cinzas"},
    {"id": "regional", "chaves": ["maracatu", "coco", "ciranda", "carimbo", "congada", "bumba", "samba de roda", "lundu"], "nome": "ritmos regionais", "temas": "tradição, ancestralidade, rio e mar, festa popular", "vocabulario": "alfaia, ganzá, toada, terreiro, cortejo", "estrutura": "toada com resposta de coro", "fugir": "a tradição conversando com o presente"},
    {"id": "choro", "chaves": ["choro"], "nome": "choro", "temas": "conversa de rua, o músico e seu instrumento, nostalgia", "vocabulario": "cavaquinho, bandolim, flauta, pandeiro, roda", "estrutura": "frases longas e ágeis, ritmo conversado", "fugir": "um choro cantado como se fosse uma conversa de calçada"},
    {"id": "bossa", "chaves": ["bossa"], "nome": "bossa nova", "temas": "o amor sussurrado, a tarde, o apartamento, o mar sem clichê", "vocabulario": "violão, voz baixa, harmonia com sétimas", "estrutura": "melodia conversada, frases longas, rima discreta", "fugir": "bossa sobre ciência ou astronomia, ou um bilhete"},
    {"id": "mpb", "chaves": ["mpb", "musica popular brasileira", "tropicalia", "cancao"], "nome": "MPB", "temas": "o Brasil de verdade, o cotidiano poético, uma carta, a memória", "vocabulario": "imagem poética, ironia fina, palavras brasileiras", "estrutura": "livre, métrica irregular, quase poema", "fugir": "a história de um objeto contada como canção"},
    {"id": "blues", "chaves": ["blues", "soul", "r&b", "rnb", "neo soul"], "nome": "blues/soul", "temas": "o dia ruim, a estrada, o amor que dói, contar uma história", "vocabulario": "harmônica, guitarra chorada, groove", "estrutura": "AAB: um verso, a repetição dele e a resposta", "fugir": "blues de segunda-feira, ou do ponto de vista de um objeto"},
    {"id": "jazz", "chaves": ["jazz", "swing", "bebop", "big band"], "nome": "jazz", "temas": "a noite, a cidade, o improviso, uma conversa", "vocabulario": "improviso, sax, contrabaixo, pista vazia", "estrutura": "AABA, frases que escorregam do tempo", "fugir": "jazz sobre uma cena de cozinha"},
    {"id": "folk", "chaves": ["country", "folk", "bluegrass", "acustic", "cantautor", "singer"], "nome": "folk/country", "temas": "histórias de pessoas, a estrada, a família, cidade pequena", "vocabulario": "violão, harmônica, varanda, poeira", "estrutura": "narrativa com refrão simples", "fugir": "uma história de gente comum contada com um fato histórico no meio"},
    {"id": "gospel", "chaves": ["gospel", "louvor", "worship", "crista"], "nome": "gospel/louvor", "temas": "gratidão, dúvida honesta, cuidado, esperança sem clichê", "vocabulario": "simples e universal", "estrutura": "verso íntimo, refrão que todos cantam", "fugir": "uma oração em primeira pessoa, cheia de detalhes do cotidiano"},
    {"id": "infantil", "chaves": ["infantil", "crianca", "cantiga", "ninar", "lullaby"], "nome": "infantil", "temas": "bichos, rotina, brincadeira, imaginação", "vocabulario": "palavras simples, onomatopeias", "estrutura": "repetição e rima simples", "fugir": "uma pergunta de criança levada a sério; sem conteúdo adulto"},
    {"id": "fado", "chaves": ["fado", "flamenco"], "nome": "fado/flamenco", "temas": "saudade funda, destino, a cidade antiga", "vocabulario": "guitarra, viela, madrugada, destino", "estrutura": "versos longos e dramáticos", "fugir": "saudade de algo que nunca aconteceu"},
    {"id": "kpop", "chaves": ["k-pop", "kpop", "j-pop", "jpop"], "nome": "pop asiático", "temas": "juventude, ensaio, sonho de palco, amizade", "vocabulario": "refrão com palavras curtas, mudanças de clima", "estrutura": "seções bem marcadas, hook forte", "fugir": "o ensaio visto dos bastidores"},
    {"id": "eletronica", "chaves": ["eletron", "edm", "house", "techno", "trance", "dance", "synth", "lo-fi", "lofi", "chill", "ambient", "drum and bass", "dubstep"], "nome": "eletrônica", "temas": "a noite, a pista, solidão na multidão, o futuro, a tecnologia", "vocabulario": "poucas palavras, repetição hipnótica, build-up e drop", "estrutura": "letra mínima que cresce até o drop", "fugir": "uma letra mínima com um fato científico no meio"},
    {"id": "trilha", "chaves": ["trilha", "orquestr", "classic", "epic", "cinematic", "soundtrack"], "nome": "trilha/épico", "temas": "a jornada, a despedida, o recomeço sem pressa", "vocabulario": "imagens grandes e simples", "estrutura": "crescendo, poucos versos e muito espaço", "fugir": "a jornada de um personagem muito pequeno"},
    {"id": "pop", "chaves": ["pop"], "nome": "pop", "temas": "variados; o hook manda", "vocabulario": "conversa de hoje, imagem estranha no verso", "estrutura": "refrão forte (hook) de poucas palavras, verso conversado", "fugir": "uma imagem estranha no verso e um hook simples e inesquecível"},
]

_STOP = set(_norm(p) for p in """
a o as os um uma uns umas de do da dos das em no na nos nas por para pra com sem sob sobre entre ate que quem qual quais quando onde como porque pois mas
e ou nem se so já ja não nao sim muito mais menos tão tao bem mal aqui ali lá la ai aí então entao também tambem ainda sempre nunca tudo nada todo toda todos
todas cada outro outra outros outras mesmo mesma eu tu ele ela nós nos vocês voces eles elas me te se lhe nos meu minha meus minhas teu tua seu sua nosso nossa
esse essa esses essas este esta estes estas isso isto aquilo aquele aquela está estou estamos são sou somos era foi fui ser estar ter tem tinha vai vou vamos
pode posso quer quero faz fazer deixa deixar vem vir ver vejo dar dá
verso refrao ponte pre intro interludio final
""".split())


# ════════════════════════════════════════════════ ESCOLHAS, MEMÓRIA, BRIEFING ════════════════════════════════════════════════
def opcoes():
    """Listas para a tela (os seletores de ângulo, vibe e ousadia)."""
    return {
        "angulos": [{"id": a["id"], "nome": a["nome"]} for a in ANGULOS],
        "vibes": [{"id": v["id"], "nome": v["nome"]} for v in VIBES],
        "ousadias": [{"id": k, "nome": v["nome"]} for k, v in OUSADIAS.items()],
    }


def _casa(chave, texto_norm):
    """Chave curta (até 4 letras: rap, emo, pop, dub…) só vale como palavra inteira; as mais longas valem como começo/trecho (sertanej…)."""
    if len(chave) <= 4:
        return re.search(r"(?<![a-z0-9])" + re.escape(chave) + r"(?![a-z0-9])", texto_norm) is not None
    return chave in texto_norm


def achar_genero(estilo):
    n = _norm(estilo)
    for g in GENEROS:
        if any(_casa(c, n) for c in g["chaves"]):
            return g
    return None


def palavras_marcantes(texto, top=10, minimo=2):
    """As palavras de conteúdo que mais se repetem numa letra (sem títulos [Verso 1] e sem palavras comuns). Conta sem acento,
    mas devolve a forma como foi escrita (com acento), para o modelo reconhecer."""
    sem_titulos = re.sub(r"^\s*(\[.*?\]|#.*)\s*$", "", str(texto or ""), flags=re.M)
    cont, formas = Counter(), {}
    for p in re.findall(r"[A-Za-zÀ-ÖØ-öø-ÿ]+", sem_titulos):
        n = _norm(p)
        if len(n) >= 4 and n not in _STOP:
            cont[n] += 1
            formas.setdefault(n, Counter())[p.lower()] += 1
    return [formas[n].most_common(1)[0][0] for n, c in cont.most_common(top) if c >= minimo]


def _lista_de_palavras(valor, maximo=40):
    if not valor:
        return []
    itens = re.split(r"[,;\n]", valor) if isinstance(valor, str) else list(valor)
    out = []
    for x in itens:
        t = re.sub(r"[^\w\s\-áàâãéêíóôõúçÁÀÂÃÉÊÍÓÔÕÚÇ]", "", str(x)).strip().lower()
        if 2 <= len(t) <= 30 and t not in out:
            out.append(t)
    return out[:maximo]


def recentes_das_composicoes(modulo_composicoes, maximo=6):
    """Títulos e letras das últimas composições salvas (para o app não repetir as mesmas palavras). Nunca levanta erro."""
    try:
        lista = modulo_composicoes.listar_composicoes() or []
    except Exception:
        return []
    saida, lidas = [], 0
    for item in lista[:maximo]:
        if not isinstance(item, dict):
            continue
        letra = item.get("letra") or ""
        if not letra and item.get("id") and lidas < 3:
            lidas += 1
            try:
                letra = (modulo_composicoes.carregar_composicao(item["id"]) or {}).get("letra") or ""
            except Exception:
                letra = ""
        saida.append({"titulo": item.get("titulo") or "", "letra": letra})
    return saida


def palavras_para_evitar(recentes=None, evitar=None, limite=30):
    """Clichês fixos + palavras repetidas nas últimas composições + palavras que o aparelho mandou das últimas letras geradas."""
    usadas = []
    for r in (recentes or []):
        usadas += palavras_marcantes((r.get("letra") or ""), top=6)
        usadas += [w.lower() for w in re.findall(r"[A-Za-zÀ-ÖØ-öø-ÿ]+", r.get("titulo") or "") if len(_norm(w)) >= 5 and _norm(w) not in _STOP]
    usadas += _lista_de_palavras(evitar)
    out = list(CLICHES_BASE)
    vistos = {_norm(c) for c in out}
    for p in usadas:
        if _norm(p) not in vistos:
            out.append(p)
            vistos.add(_norm(p))
    return out[: len(CLICHES_BASE) + limite]


def _escolher_angulos(rng, n, fixo, grupos_distintos):
    ang = {a["id"]: a for a in ANGULOS}
    escolhidos = [ang[fixo]] if fixo in ang else []
    pool = [a for a in ANGULOS if a not in escolhidos]
    while len(escolhidos) < n and pool:
        if grupos_distintos:
            usados = {a["grupo"] for a in escolhidos}
            candidatos = [a for a in pool if a["grupo"] not in usados] or pool
        else:
            candidatos = pool
        a = rng.choice(candidatos)
        escolhidos.append(a)
        pool.remove(a)
    return escolhidos[:n]


def gerar_briefing(tema="", estilo="", angulo="", vibe="", ousadia="media", semente=0, evitar=None, recentes=None):
    """Sorteia a direção criativa. Mesma `semente` = mesma ideia (a semente usada volta no resultado, para repetir ou variar)."""
    cfg = OUSADIAS.get(ousadia) or OUSADIAS["media"]
    ousadia = ousadia if ousadia in OUSADIAS else "media"
    try:
        semente = int(semente or 0)
    except (TypeError, ValueError):
        semente = 0
    if semente <= 0:
        semente = secrets.randbelow(2**31 - 1) + 1
    rng = random.Random(semente)

    angulos = _escolher_angulos(rng, cfg["angulos"], _norm(angulo), grupos_distintos=(ousadia == "ousada"))
    vibes = {v["id"]: v for v in VIBES}
    if _norm(vibe) in vibes:
        vb = vibes[_norm(vibe)]
    else:
        pool = [v for v in VIBES if v["rara"]] if ousadia == "ousada" else VIBES
        vb = rng.choice(pool)
    recurso = rng.choice(DISPOSITIVOS) if rng.random() < cfg["recurso"] else ""
    familias = rng.sample(list(FAMILIAS), cfg["familias"])
    imagens = {f: rng.sample(FAMILIAS[f], 3) for f in familias}
    cats = rng.sample(list(DETALHES), min(cfg["detalhes"], len(DETALHES)))
    detalhes = [rng.choice(DETALHES[c]) for c in cats]
    regra = rng.choice(REGRAS) if rng.random() < cfg["regra"] else ""
    if ousadia == "ousada" and rng.random() < 0.3:
        extra = rng.choice([r for r in REGRAS if r != regra])
        regra = f"{regra}; e também: {extra}" if regra else extra
    genero = achar_genero(estilo)
    b = {
        "semente": semente, "ousadia": ousadia, "temperatura": cfg["temperatura"],
        "angulos": [a["id"] for a in angulos], "angulos_nomes": [a["nome"] for a in angulos], "angulos_instrucoes": [a["instrucao"] for a in angulos],
        "vibe": vb["id"], "vibe_nome": vb["nome"], "vibe_instrucao": vb["instrucao"],
        "recurso": recurso, "familias": imagens, "detalhes": detalhes, "regra": regra,
        "genero": genero["nome"] if genero else "", "genero_notas": genero,
        "evitar": palavras_para_evitar(recentes, evitar),
    }
    b["resumo"] = _resumo(b)
    b["texto"] = _texto(b, estilo)
    return b


def _resumo(b):
    partes = ["Ângulo: " + " + ".join(n.lower() for n in b["angulos_nomes"]), "vibe: " + b["vibe_nome"].lower()]
    if b["recurso"]:
        partes.append("recurso: " + re.sub(r"\s*\(.*\)$", "", b["recurso"]))
    partes.append("imagens de " + " e ".join(b["familias"]))
    if b["regra"]:
        partes.append("regra: " + b["regra"])
    return " · ".join(partes)


def _texto(b, estilo):
    L = ["DIREÇÃO CRIATIVA (use como inspiração para fugir do óbvio; não cite estas instruções na letra e mantenha o formato pedido):"]
    L.append("- Ângulo: " + " E TAMBÉM ".join(b["angulos_instrucoes"]) + ".")
    L.append("- Vibe: " + b["vibe_instrucao"] + ".")
    if b["recurso"]:
        L.append("- Recurso narrativo: construa a letra como " + b["recurso"] + ".")
    for fam, ims in b["familias"].items():
        L.append(f"- Fonte de imagens ({fam}): tire metáforas daqui, por exemplo {', '.join(ims)}.")
    L.append("- Detalhes concretos para espalhar (use pelo menos dois; troque por outros parecidos se não couberem): " + "; ".join(b["detalhes"]) + ".")
    if b["regra"]:
        L.append("- Regra do jogo: " + b["regra"] + ".")
    g = b["genero_notas"]
    if g:
        L.append(f"- Sobre o gênero ({g['nome']}): temas clássicos: {g['temas']}. Vocabulário típico: {g['vocabulario']}. Estrutura: {g['estrutura']}. Para fugir do óbvio: {g['fugir']}.")
    elif estilo:
        L.append(f"- Respeite o jeito de escrever do estilo “{estilo}”, sem cair no estereótipo.")
    L.append("- EVITE estas palavras e imagens (clichês ou já usadas nas últimas músicas), a menos que sejam essenciais e usadas de um jeito novo: " + ", ".join(b["evitar"]) + ".")
    L.append("- Troque abstrações (felicidade, liberdade, esperança, saudade) por imagens específicas: mostre em vez de dizer.")
    L.append("- Nada ofensivo; sem incentivo à violência, ao ódio ou à autoagressão.")
    return "\n".join(L)


def resumo_publico(b):
    """O que a tela recebe (sem o texto longo)."""
    return {k: b[k] for k in ("resumo", "semente", "ousadia", "angulos", "angulos_nomes", "vibe", "vibe_nome", "recurso", "detalhes", "regra")}


def tema_com_direcao(tema, b):
    """Plano B: o caminho antigo (songwriter.gerar_letra) recebe a direção junto do tema."""
    return f"{str(tema).strip()}\n\n{b['texto']}"


def enriquecer_tema(tema, estilo, **opcoes):
    b = gerar_briefing(tema=tema, estilo=estilo, **opcoes)
    return tema_com_direcao(tema, b), b


# ════════════════════════════════════════════════ ESCREVER A LETRA ════════════════════════════════════════════════
def _limpar_letra(t):
    t = re.sub(r"```[a-z]*", "", str(t or ""))
    linhas = []
    for l in t.replace("\r", "").split("\n"):
        l = re.sub(r"^\s*>+\s*", "", l)
        l = re.sub(r"\*\*|__|`", "", l)
        l = re.sub(r"^\s*#{1,6}\s*(.+?)\s*$", lambda m: f"[{m.group(1)}]" if len(m.group(1)) < 30 else m.group(1), l)
        linhas.append(l.rstrip())
    out = "\n".join(linhas)
    out = re.sub(r"\n{3,}", "\n\n", out).strip()
    return re.sub(r"^(letra|aqui está a letra)[^\n]*:\s*\n", "", out, flags=re.I).strip()


def montar_prompt_letra(tema, estilo, b, contexto_vocal=""):
    return (
        "Você é um(a) letrista brasileiro(a) premiado(a), famoso(a) por fugir do óbvio e por imagens que ninguém tinha usado.\n"
        "Escreva a LETRA COMPLETA de uma música original em português do Brasil.\n\n"
        f"TEMA: {str(tema).strip()}\n"
        f"ESTILO/RITMO: {estilo}\n"
        + (f"\nSOBRE QUEM VAI CANTAR (ajuste a tessitura e o fôlego dos versos): {contexto_vocal.strip()}\n" if contexto_vocal and contexto_vocal.strip() else "")
        + "\n" + b["texto"] + "\n\n"
        "FORMATO: cada parte numa linha própria entre colchetes ([Verso 1], [Pré-refrão] se fizer sentido, [Refrão], [Verso 2], [Refrão], [Ponte], [Refrão]). "
        "Versos de 6 a 12 sílabas, adequados ao ritmo; refrão forte e fácil de cantar junto; rimas naturais (nunca forçadas); "
        "entre 24 e 32 linhas cantadas no total.\n"
        "Responda SOMENTE com a letra: sem título, sem explicações, sem markdown (nada de ** ou #) e sem repetir estas instruções."
    )


def escrever_letra(tema, estilo, b, contexto_vocal="", gemini=None):
    """Escreve a letra com a direção criativa. Devolve (letra, None) ou (None, erro). `gemini` é o módulo gemini_client (injetável)."""
    try:
        if gemini is None:
            import gemini_client as gemini
        if hasattr(gemini, "gemini_disponivel") and not gemini.gemini_disponivel():
            return None, "O Gemini não está configurado no servidor."
        prompt = montar_prompt_letra(tema, estilo, b, contexto_vocal)
        kwargs = {}
        try:                                         # só passa a temperatura se a função do app aceitar
            params = inspect.signature(gemini.chamar_texto).parameters
            for nome in ("temperature", "temperatura"):
                if nome in params:
                    kwargs[nome] = b["temperatura"]
        except (TypeError, ValueError):
            pass
        resposta, erro = gemini.chamar_texto(prompt, **kwargs)
        if resposta is None:
            return None, erro or "Sem resposta do Gemini."
        letra = _limpar_letra(getattr(resposta, "text", "") or "")
        if len([l for l in letra.split("\n") if l.strip() and not l.strip().startswith("[")]) < 8:
            return None, "A letra veio curta demais."
        return letra, None
    except Exception as e:                           # nunca derruba a rota: quem chamou tem o plano B
        return None, f"Erro ao escrever a letra: {e}"


def ideias(args=None, modulo_composicoes=None):
    """Para a ferramenta da Laranjinha: devolve a direção criativa pronta para ela escrever a letra."""
    args = args or {}
    recentes = recentes_das_composicoes(modulo_composicoes) if modulo_composicoes is not None else []
    b = gerar_briefing(tema=args.get("tema", ""), estilo=args.get("estilo", ""), angulo=args.get("angulo", ""), vibe=args.get("vibe", ""),
                       ousadia=args.get("ousadia", "media"), semente=args.get("semente", 0), evitar=args.get("evitar"), recentes=recentes)
    return {"resumo": b["resumo"], "direcao": b["texto"], "semente": b["semente"], "evitar": b["evitar"]}
