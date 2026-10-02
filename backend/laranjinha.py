# ══════════════════════════════════════════════════════════════
# laranjinha.py — Assistente Laranjinha: conhece e comanda o Orange Harmony
# inteiro via function calling do Gemini. Não é só leitura — ela executa
# ações de verdade (gerar produção, aplicar edição vocal, salvar composição,
# renomear/excluir gravação), sempre em cima de dados reais do Firestore/Storage.
# ══════════════════════════════════════════════════════════════
import re
import json
import time
import threading
import gemini_client
import gravacoes
import historico
import composicoes
import avaliacao
import audio_analysis
import producao_dsp
import edicao_dsp
import converter_audio
import chats
import escalas as teoria_escalas
import ritmos
import harmonia as harmonia_auto
import producao_ritmos
import acordes as teoria_acordes   # (não chamar de 'acordes': já existe uma variável local com esse nome)

CONHECIMENTO_APP = """
Você é a Laranjinha, assistente oficial do Orange Harmony — um app de coaching vocal com IA.
Você conhece TODO o aplicativo e tem ferramentas reais para LER dados E EXECUTAR AÇÕES de verdade.

## Módulos do app (e o que você sabe sobre cada um)
1. Estudo/Análise Vocal: pitch, afinação, desvio em cents, vibrato, curva de pitch, devolutiva do professor. Também tem o TREINO DE ESCALAS: o aluno escolhe a nota e a escala (maior, menor, modos gregos, pentatônicas, blues…), ouve no piano e pode pedir pra avaliar a gravação dele NAQUELA escala (quantas notas cantadas caíram dentro dela).
2. Afinador: 11 afinações, calibração 440/442, detecção de pitch em tempo real no navegador.
3. Biblioteca (antes chamada Gravador): grava/sobe áudio, salva no Firebase Storage e lista as gravações.
4. Histórico: evolução das análises salvas, com devolutiva do professor.
5. Composições: letras com cifras [Am] e seções (#), versionamento.
6. Conversor: WAV/MP3/FLAC/OGG/M4A.
7. Produção: gera baixo, bateria, acordes, teclado e solo a partir de uma gravação, em mais de 70 estilos (samba, pagode, bossa nova, forró, baião, axé, sertanejo, funk carioca, MPB, pop, pop rock, rock, metal, jazz, blues, reggae, salsa, eletrônica, trap e muitos outros), cada um com bateria, baixo e acordes PRÓPRIOS. A produção SE ADAPTA à gravação: acompanha o andamento (o usuário pode informar o BPM se a detecção errar), descobre o tom (maior ou menor), escolhe os acordes que combinam com a melodia cantada ou tocada (o baixo, o teclado e os acordes seguem essa harmonia; há também a opção de usar a sequência fixa do estilo) e toca mais forte ou mais fraco conforme a voz. A harmonia é uma estimativa e pode errar em melodias ambíguas.
8. Edição Vocal: redução de ruído, normalização, tom, EQ, compressão, sibilância, reverb.
9. Avaliação: 5 exercícios que geram o perfil vocal (classificação, extensão, tessitura).
10. Orange Studio: separação de stems (voz/instrumental) via Demucs no Colab.
11. Songwriter: geração de música via Hugging Face + letra via você mesma (Gemini).
12. Acordes: braço de violão clicável — o usuário marca as notas nas cordas e o app identifica o acorde (nome, notas, onde se encaixa: tonalidades e escalas); também procura um acorde por nome e mostra posições no braço.
13. Newsletter (Orange News): jornal do app, com manchete e dicas do dia (afinação, composição, violão com a levada do dia, teoria, produção, IA e curiosidades) e notícias de fora sobre música, com resumo curto em português e link.
14. Singergame: jogos de afinação com a voz. Modo Livre e modo Escala (uma bolinha atravessa anéis que são notas; há um afinômetro em tempo real e a margem é ±75, ±50 ou ±25 cents conforme a dificuldade) e o VOCALISE ("eu faço, você copia": o piano toca um padrão — escadinha, arpejo ou alternando duas notas — e o aluno repete no mesmo andamento; a cada rodada o padrão sobe meio tom e depois desce; cada nota é julgada pelo centro do que ele cantou). O app só confere a ALTURA da nota, não a vogal (i, e, a) — as vogais são orientação.

## Suas ferramentas (você EXECUTA, não só descreve)
- listar_gravacoes, avaliar_gravacao (ouve o áudio de verdade), analisar_gravacao (roda
  análise técnica e registra no histórico), ler_historico, ler_perfil_vocal, listar_composicoes,
  salvar_composicao, gerar_producao (gera backing track e salva como nova gravação),
  aplicar_edicao_vocal (interpreta o pedido em português e aplica os efeitos, salva como nova
  gravação), renomear_gravacao, excluir_gravacao.
- listar_conversas e ler_conversa: você tem memória cruzada entre TODAS as conversas salvas
  com você, não só a atual. Se o usuário perguntar algo que parece ter sido dito numa outra
  conversa, use listar_conversas pra achar o nome certo e ler_conversa pra ler o conteúdo dela.

## Como se comportar
- Quando o usuário pedir uma ação (ex: "gera uma produção estilo pop na minha última
  gravação", "limpa o ruído da gravação X"), EXECUTE a ferramenta correspondente — não
  apenas descreva o que faria.
- Para excluir_gravacao, confirme uma vez com o usuário antes de chamar a ferramenta,
  a menos que ele já tenha confirmado explicitamente na mensagem.
- Se o usuário disser "minha última gravação" sem nome exato, use listar_gravacoes
  primeiro pra achar o nome certo (a lista vem ordenada da mais recente pra mais antiga).
- Sempre responda em português, de forma acolhedora, prática e específica.
- Baseie suas respostas em dados reais obtidos pelas ferramentas — nunca invente números.
"""


def _catalogo_ferramentas_texto():
    """Descreve as ferramentas como texto simples (não via function calling
    nativo do Gemini) — evita depender da Interactions API, que alguns
    modelos novos exigem para function calling nativo."""
    return """
## Suas ferramentas (você EXECUTA, não só descreve)
Quando precisar usar uma ferramenta, responda **apenas** com um JSON exato
neste formato, sem nenhum texto antes ou depois:
{"ferramenta": "nome_da_ferramenta", "argumentos": {"chave": "valor"}}

Ferramentas disponíveis:
- listar_gravacoes(limite?: int) — lista as gravações salvas, mais recentes primeiro.
- avaliar_gravacao(nome: str) — ouve uma gravação salva de verdade e dá parecer vocal.
- analisar_gravacao(nome: str, modo?: "completa"|"cover", escala?: str) — roda análise técnica e registra no histórico. Com `escala` (ex: "G# lídio", "Lá menor pentatônica") avalia também quantas notas cantadas caíram DENTRO dessa escala, quais ficaram fora e os graus que não apareceram.
- consultar_escala(nome: str) — explica uma escala (ex: "G# lídio", "D dórico", "Lá menor pentatônica"): notas, graus, fórmula, caráter, desafio de canto e os acordes que nascem dela.
- ler_historico(limite?: int) — lê o resumo das últimas análises salvas.
- ler_perfil_vocal() — lê o perfil vocal do usuário (classificação, extensão, tessitura).
- listar_composicoes(limite?: int) — lista as composições salvas.
- salvar_composicao(titulo: str, tom?: str, letra: str) — cria/salva uma composição.
- gerar_producao(nome_gravacao: str, estilo?: str, com_baixo?: bool, com_bateria?: bool,
  com_acordes?: bool, qualidade_pro?: bool) — gera backing track e salva como nova gravação.
- aplicar_edicao_vocal(nome_gravacao: str, comando: str) — aplica edição vocal interpretando
  o comando em português, salva como nova gravação.
- renomear_gravacao(nome_atual: str, novo_nome: str) — renomeia uma gravação.
- excluir_gravacao(nome: str) — exclui uma gravação. Só chame depois do usuário confirmar.
- listar_conversas() — lista as conversas salvas com você (nome, data).
- ler_conversa(nome: str) — lê o histórico completo de outra conversa salva.
- identificar_acorde(cordas: str) — identifica um acorde montado no braço do violão. `cordas` = 6 valores, da corda mais GRAVE (Mi) à mais AGUDA (mi): x = corda muda, 0 = solta, número = casa. Ex: "x32010" (Dó maior). Com casas de 2 dígitos separe por vírgula: "x,10,10,9,x,x". Devolve nome, alternativas, notas, tonalidades e escalas onde se encaixa.
- procurar_acorde(nome: str) — dado o nome (ex: Am7, C7M, F#m, G/B), devolve as notas, posições no violão e onde se encaixa (tonalidades e escalas).
Quando o usuário perguntar que acorde é, em qual escala ou tonalidade um acorde se encaixa, ou pedir ideias a partir de um acorde que montou, USE essas duas ferramentas e explique em cima do resultado — não invente teoria de cabeça.

Depois que o resultado de uma ferramenta aparecer em "Resultados de ferramentas já
chamadas", USE esse resultado pra responder ao usuário em texto normal — não chame
a mesma ferramenta de novo à toa, e não responda em JSON quando já tiver o suficiente
pra dar uma resposta final em português.

## Como se comportar
- Quando o usuário pedir uma ação (ex: "gera uma produção estilo pop na minha última
  gravação", "limpa o ruído da gravação X"), EXECUTE a ferramenta correspondente — não
  apenas descreva o que faria.
- Para excluir_gravacao, confirme uma vez com o usuário antes de chamar a ferramenta,
  a menos que ele já tenha confirmado explicitamente na mensagem.
- Se o usuário disser "minha última gravação" sem nome exato, use listar_gravacoes
  primeiro pra achar o nome certo (a lista vem ordenada da mais recente pra mais antiga).
- Sempre responda em português, de forma acolhedora, prática e específica.
- Baseie suas respostas em dados reais obtidos pelas ferramentas — nunca invente números.
"""


def _achar_gravacao_por_nome(nome):
    itens = gravacoes.listar_gravacoes()
    nome_lower = (nome or "").strip().lower()
    for g in itens:
        if g["nome"].strip().lower() == nome_lower:
            return g
    for g in itens:
        if nome_lower in g["nome"].strip().lower():
            return g
    return None


def interpretar_comando_edicao(comando):
    """Interpreta um comando em português numa estrutura de efeitos de edição vocal.
    Usa palavras-chave como piso mínimo e enriquece com o Gemini quando disponível."""
    padrao = {
        "reduzir_ruido": False, "normalizar": False, "ajustar_tom": 0.0,
        "eq_presenca": False, "compressao": False, "remover_sibilancia": False,
        "reverb_leve": False,
    }
    cmd = (comando or "").lower()
    if any(p in cmd for p in ["ruído", "ruido", "limpa", "limpe", "barulho"]):
        padrao["reduzir_ruido"] = True
    if any(p in cmd for p in ["normaliz", "volume"]):
        padrao["normalizar"] = True
    if any(p in cmd for p in ["grave", "mais baixo", "desce o tom", "descer o tom"]):
        padrao["ajustar_tom"] = -1.0
    if any(p in cmd for p in ["agudo", "mais alto", "sobe o tom", "subir o tom"]):
        padrao["ajustar_tom"] = 1.0
    if any(p in cmd for p in ["presente", "eq", "clareza", "brilho"]):
        padrao["eq_presenca"] = True
    if any(p in cmd for p in ["compress", "dinamica", "dinâmica", "punch"]):
        padrao["compressao"] = True
    if any(p in cmd for p in ["sibil", "assobio", "chiado agudo"]):
        padrao["remover_sibilancia"] = True
    if any(p in cmd for p in ["reverb", "ambiente", "espaço", "espaco", "sala"]):
        padrao["reverb_leve"] = True

    if not gemini_client.gemini_disponivel():
        return padrao

    prompt = (
        "Você é um engenheiro de mixagem vocal. Interprete o pedido do usuário e devolva "
        "APENAS um JSON válido (sem markdown, sem texto antes/depois), com as chaves: "
        '{"reduzir_ruido": bool, "normalizar": bool, "ajustar_tom": number (semitons, 0 se não '
        'pedido), "eq_presenca": bool, "compressao": bool, "remover_sibilancia": bool, '
        '"reverb_leve": bool}\n\n'
        f'Comando: "{comando}"\n\n'
        "Se o pedido for vago (ex: 'deixa melhor', 'profissional'), ative reduzir_ruido, "
        "normalizar, eq_presenca e compressao. Responda só o JSON."
    )
    resposta, _ = gemini_client.chamar_texto(prompt)
    if resposta and resposta.text:
        dados = gemini_client.extrair_json(resposta.text)
        if dados:
            for k in padrao:
                if k in dados:
                    padrao[k] = dados[k]
    return padrao


def interpretar_comando_producao(descricao):
    """Interpreta uma descrição em português dos parâmetros de produção desejados
    (estilo, quais instrumentos incluir) — mesmo padrão da interpretação de edição
    vocal, agora pra assistir a montagem do backing track."""
    padrao = {
        "estilo": "Pop", "com_baixo": True, "com_bateria": True, "com_acordes": True,
        "com_teclado": False, "com_solo": False, "qualidade_pro": True,
    }
    if not gemini_client.gemini_disponivel():
        return padrao

    estilos_validos = ", ".join(producao_dsp.ESTILOS_MUSICAIS.keys())
    prompt = (
        "Você é um produtor musical. Baseado na descrição do usuário, escolha os parâmetros "
        "de produção de um backing track. Devolva APENAS um JSON válido (sem markdown), com as "
        'chaves: {"estilo": string, "com_baixo": bool, "com_bateria": bool, "com_acordes": bool, '
        '"com_teclado": bool, "com_solo": bool, "qualidade_pro": bool}\n\n'
        f"O campo 'estilo' precisa ser exatamente um destes: {estilos_validos}\n\n"
        f'Descrição do usuário: "{descricao}"\n'
        "Se a descrição não mencionar algo, mantenha os valores padrão (baixo, bateria e "
        "acordes ativados, teclado e solo desativados, qualidade profissional ativada). "
        "Responda só o JSON."
    )
    resposta, _ = gemini_client.chamar_texto(prompt)
    if resposta and resposta.text:
        dados = gemini_client.extrair_json(resposta.text)
        if dados:
            for k in padrao:
                if k in dados:
                    padrao[k] = dados[k]
    padrao["estilo"] = ritmos.nome_canonico(padrao.get("estilo", "Pop"))     # "samba" / "Pagode " → nome do catálogo
    return padrao


def _ler_cordas(valor):
    """Aceita lista [-1,3,2,0,1,0], "x32010" (casas de 1 dígito) ou "x,10,10,9,x,x" (com vírgula/espaço)."""
    if isinstance(valor, (list, tuple)):
        try:
            cordas = [-1 if str(v).strip().lower() == "x" else int(v) for v in valor]
        except Exception:
            return None
        return cordas if len(cordas) == 6 else None
    texto = str(valor or "").strip().lower()
    if not texto:
        return None
    partes = [p for p in re.split(r"[,\s]+", texto) if p] if ("," in texto or " " in texto) else list(texto)
    try:
        cordas = [-1 if p in ("x", "-1") else int(p) for p in partes]
    except Exception:
        return None
    return cordas if len(cordas) == 6 else None


def _resumo_acorde(info):
    """Versão enxuta do resultado de acordes.py (poupa tokens da conversa)."""
    if "erro" in info:
        return info
    saida = {k: info[k] for k in ("nome", "tipo", "alternativas", "baixo") if k in info}
    saida["notas"] = " ".join(f"{n['letra']}({n['funcao']})" for n in info["notas"])
    enc = info["encaixe"]
    saida["tonalidades"] = [f"{t['tonalidade']} — {t['grau']}" for t in enc["tonalidades"][:6]]
    saida["escalas_sobre_a_fundamental"] = [f"{e['nome']}: {e['notas']}" for e in enc["escalas"][:8]]
    if enc.get("observacao"):
        saida["observacao"] = enc["observacao"]
    if info.get("posicoes"):
        saida["posicoes"] = [
            "".join("x" if c < 0 else (str(c) if c < 10 else f"({c})") for c in p["cordas"]) + f" (a partir da casa {p['base']})"
            for p in info["posicoes"][:4]
        ]
    return saida


def _resumo_escala(d):
    """Versão enxuta de escalas.descrever (poupa tokens da conversa)."""
    if "erro" in d:
        return d
    saida = {
        "escala": d["nome"], "notas_com_graus": " ".join(f"{n['letra']}({n['grau']})" for n in d["notas"]),
        "formula": d["formula"], "semitons_entre_notas": d["semitons"],
        "carater": d["carater"], "desafio_vocal": d["desafio_vocal"],
    }
    if d.get("enarmonico"):
        saida["observacao"] = f"{d['nome_pedido']} escreve-se com notas dobradas; por isso aparece como {d['enarmonico']} (mesmas notas)."
    if d.get("acordes_triades"):
        saida["acordes_triades"] = " · ".join(f"{x['grau']} {x['acorde']}" for x in d["acordes_triades"] if x)
        saida["acordes_com_setima"] = " · ".join(f"{x['grau']} {x['acorde']}" for x in d["acordes_setimas"] if x)
    else:
        saida["acordes"] = "Escala de 5 ou 6 notas: não é harmonizada em acordes por grau."
    return saida


def _executar_ferramenta(nome_func, args):
    if nome_func == "consultar_escala":
        par = teoria_escalas.interpretar_escala(str(args.get("nome", "")))
        if par is None:
            return {"erro": f"Não entendi a escala '{args.get('nome', '')}'. Exemplos: 'G# lídio', 'D dórico', 'Lá menor pentatônica', 'C menor harmônica'."}
        return _resumo_escala(teoria_escalas.descrever(*par))

    if nome_func == "identificar_acorde":
        cordas = _ler_cordas(args.get("cordas"))
        if cordas is None:
            return {"erro": "Preciso das 6 cordas, da mais grave à mais aguda. Ex: \"x32010\" (x = muda, 0 = solta, número = casa)."}
        return _resumo_acorde(teoria_acordes.identificar(cordas))

    if nome_func == "procurar_acorde":
        return _resumo_acorde(teoria_acordes.procurar(str(args.get("nome", ""))))

    if nome_func == "listar_gravacoes":
        return {"gravacoes": gravacoes.listar_gravacoes()[: args.get("limite", 20)]}

    if nome_func == "avaliar_gravacao":
        g = _achar_gravacao_por_nome(args.get("nome", ""))
        if not g:
            return {"erro": "Gravação não encontrada."}
        conteudo, content_type, nome_real = gravacoes.baixar_gravacao(g["id"])
        if conteudo is None:
            return {"erro": "Não consegui carregar o áudio dessa gravação."}
        prompt = (
            f"Ouça a gravação '{nome_real}' e faça uma avaliação vocal completa: afinação, "
            "notas, técnica, pontos fortes e pontos a melhorar. Seja específico e encorajador. "
            "Responda em português."
        )
        texto, modelo_ou_erro = gemini_client.chamar_com_audio(
            prompt, conteudo, nome_real, content_type or "audio/webm"
        )
        if texto is None:
            return {"erro": f"Não consegui ouvir o áudio agora ({modelo_ou_erro})."}
        return {"avaliacao": texto}

    if nome_func == "analisar_gravacao":
        g = _achar_gravacao_por_nome(args.get("nome", ""))
        if not g:
            return {"erro": "Gravação não encontrada."}
        conteudo, content_type, nome_real = gravacoes.baixar_gravacao(g["id"])
        if conteudo is None:
            return {"erro": "Não consegui carregar o áudio dessa gravação."}
        modo = args.get("modo", "completa")
        escala = None
        if args.get("escala"):
            par = teoria_escalas.interpretar_escala(str(args["escala"]))
            if par is None:
                return {"erro": f"Não entendi a escala '{args['escala']}'. Exemplos: 'G# lídio', 'Lá menor pentatônica', 'D dórico'."}
            escala = {"tonica": par[0], "tipo": par[1]}
        resultado = audio_analysis.analisar_audio_completo(conteudo, nome_real, modo=modo, escala=escala)
        if "erro" in resultado:
            return resultado
        if modo == "completa":
            try:
                historico.registrar_analise(resultado["resultado"], modo="completa", escala=resultado.get("avaliacao_escala"))
            except Exception:
                pass
        resultado.pop("curva_pitch", None)            # pontos do gráfico: a Laranjinha não precisa (poupa tokens)
        return resultado

    if nome_func == "ler_historico":
        return {"historico": historico.listar_historico()[: args.get("limite", 5)]}

    if nome_func == "ler_perfil_vocal":
        perfil = avaliacao.carregar_perfil()
        return perfil or {"info": "Usuário ainda não fez a Avaliação Vocal."}

    if nome_func == "listar_composicoes":
        return {"composicoes": composicoes.listar_composicoes()[: args.get("limite", 20)]}

    if nome_func == "salvar_composicao":
        doc_id, erro = composicoes.salvar_composicao(
            args.get("titulo", ""), args.get("tom", ""), args.get("letra", "")
        )
        if erro:
            return {"erro": erro}
        return {"salvo": True, "id": doc_id}

    if nome_func == "gerar_producao":
        g = _achar_gravacao_por_nome(args.get("nome_gravacao", ""))
        if not g:
            return {"erro": "Gravação não encontrada."}
        conteudo, content_type, nome_real = gravacoes.baixar_gravacao(g["id"])
        if conteudo is None:
            return {"erro": "Não consegui carregar o áudio dessa gravação."}
        audio, sr = audio_analysis.carregar_audio_bytes(conteudo, nome_real)
        del conteudo
        if audio is None:
            return {"erro": "Não consegui ler esse áudio."}
        audio, _ = audio_analysis.limitar_duracao(audio, sr)
        bpm, beat_times = audio_analysis.detectar_bpm_e_beats(audio, sr)
        estilo = ritmos.nome_canonico(args.get("estilo", "Pop"))
        info = harmonia_auto.preparar(audio, sr, estilo, bpm, beat_times, "melodia")         # os acordes seguem a melodia da gravação
        tom, harm = info["tom"], info["harmonia"]
        baixo = bateria = acordes = None
        try:
            if args.get("com_baixo", True):
                baixo = producao_ritmos.gerar_baixo_estilo(audio, sr, tom, bpm, beat_times, estilo, harm)
            if args.get("com_bateria", True):
                bateria = producao_ritmos.gerar_bateria_estilo(audio, sr, bpm, beat_times, estilo)
            if args.get("com_acordes", True):
                acordes = producao_ritmos.gerar_acordes_estilo(audio, sr, tom, bpm, beat_times, estilo, harm)
        except Exception as e:
            return {"erro": f"Erro ao gerar produção: {e}"}
        if args.get("qualidade_pro", True):
            if baixo is not None:
                baixo = producao_dsp.aplicar_ducking(baixo, audio, sr, 0.30)
            if acordes is not None:
                acordes = producao_dsp.aplicar_ducking(acordes, audio, sr, 0.40)
        mix = producao_ritmos.mixar_estilo(audio, estilo, baixo=baixo, bateria=bateria, acordes=acordes)
        if args.get("qualidade_pro", True):
            mix = producao_dsp.aplicar_reverb(mix, sr, 0.08)
        wav_bytes = converter_audio.audio_para_wav_bytes(mix, sr)
        del mix, baixo, bateria, acordes, audio
        audio_analysis.liberar_memoria()
        novo_nome = f"{g['nome']} (Produção {estilo})"
        doc_id, erro = gravacoes.salvar_gravacao(novo_nome, wav_bytes, "producao.wav", "audio/wav")
        if erro:
            return {"erro": erro}
        return {"gerado": True, "nome_novo": novo_nome, "bpm": bpm, "tom": f"{info['tom_detectado']} {info['modo_detectado']}", "acordes_usados": info["acordes"]}

    if nome_func == "aplicar_edicao_vocal":
        g = _achar_gravacao_por_nome(args.get("nome_gravacao", ""))
        if not g:
            return {"erro": "Gravação não encontrada."}
        conteudo, content_type, nome_real = gravacoes.baixar_gravacao(g["id"])
        if conteudo is None:
            return {"erro": "Não consegui carregar o áudio dessa gravação."}
        audio, sr = audio_analysis.carregar_audio_bytes(conteudo, nome_real)
        del conteudo
        if audio is None:
            return {"erro": "Não consegui ler esse áudio."}
        audio, _ = audio_analysis.limitar_duracao(audio, sr)
        flags = interpretar_comando_edicao(args.get("comando", ""))
        audio_editado, acoes = edicao_dsp.aplicar_efeitos(
            audio, sr, flags["reduzir_ruido"], flags["normalizar"], flags["ajustar_tom"],
            flags["eq_presenca"], flags["compressao"], flags["remover_sibilancia"], flags["reverb_leve"],
        )
        wav_bytes = converter_audio.audio_para_wav_bytes(audio_editado, sr)
        del audio, audio_editado
        audio_analysis.liberar_memoria()
        novo_nome = f"{g['nome']} (Editado)"
        doc_id, erro = gravacoes.salvar_gravacao(novo_nome, wav_bytes, "editado.wav", "audio/wav")
        if erro:
            return {"erro": erro}
        return {"editado": True, "nome_novo": novo_nome, "acoes": acoes}

    if nome_func == "renomear_gravacao":
        g = _achar_gravacao_por_nome(args.get("nome_atual", ""))
        if not g:
            return {"erro": "Gravação não encontrada."}
        ok = gravacoes.renomear_gravacao(g["id"], args.get("novo_nome", ""))
        return {"renomeado": ok}

    if nome_func == "excluir_gravacao":
        g = _achar_gravacao_por_nome(args.get("nome", ""))
        if not g:
            return {"erro": "Gravação não encontrada."}
        ok = gravacoes.excluir_gravacao(g["id"])
        return {"excluido": ok}

    if nome_func == "listar_conversas":
        return {"conversas": chats.listar_chats()}

    if nome_func == "ler_conversa":
        nome_busca = (args.get("nome") or "").strip().lower()
        alvo = None
        for c in chats.listar_chats():
            if c.get("nome", "").strip().lower() == nome_busca:
                alvo = c
                break
        if alvo is None:
            for c in chats.listar_chats():
                if nome_busca in c.get("nome", "").strip().lower():
                    alvo = c
                    break
        if alvo is None:
            return {"erro": "Conversa não encontrada."}
        return {"chat": alvo.get("nome"), "mensagens": chats.carregar_mensagens(alvo["id"])}

    return {"erro": f"Ferramenta desconhecida: {nome_func}"}


# ── Cache em memória: evita reler o Firestore inteiro a cada mensagem ──
# Antes, CADA mensagem lia do Firestore todas as mensagens desta conversa e
# ainda todas as mensagens de TODAS as outras conversas (uma consulta por
# conversa) — e numa CPU de 0.1 vCPU isso demorava dezenas de segundos.
_cache_historico = {}          # chat_id -> últimas mensagens (dicts role/content)
_cache_outras = {}             # chat_id -> (instante, resumo das outras conversas)
_trava_cache = threading.Lock()
_MAX_MSGS_POR_CHAT = 60
_MAX_CHATS_EM_CACHE = 12
_TTL_OUTRAS_S = 300            # resumo das outras conversas vale por 5 min
_MAX_OUTRAS_CONVERSAS = 3      # só as 3 conversas mais recentes entram no resumo


def _historico_do_chat(chat_id):
    """Lista viva de mensagens do chat — vem do Firestore só na 1ª vez."""
    with _trava_cache:
        if chat_id not in _cache_historico:
            _cache_historico[chat_id] = chats.carregar_mensagens(chat_id, limite=_MAX_MSGS_POR_CHAT)
            while len(_cache_historico) > _MAX_CHATS_EM_CACHE:
                _cache_historico.pop(next(iter(_cache_historico)))
        return _cache_historico[chat_id]


def _resumo_outras_conversas(chat_id):
    agora = time.monotonic()
    guardado = _cache_outras.get(chat_id)
    if guardado and agora - guardado[0] < _TTL_OUTRAS_S:
        return guardado[1]
    resumo = []
    try:
        outras = [c for c in chats.listar_chats() if c["id"] != chat_id][:_MAX_OUTRAS_CONVERSAS]
        for c in outras:
            msgs = chats.carregar_mensagens(c["id"], limite=6)
            if msgs:
                resumo.append({
                    "chat": c.get("nome", "Conversa"),
                    "ultimas_mensagens": [f"{m.get('role')}: {(m.get('content') or '')[:200]}" for m in msgs],
                })
    except Exception:
        resumo = []
    _cache_outras[chat_id] = (agora, resumo)
    return resumo


def _extrair_chamada_ferramenta(texto):
    """Acha um JSON {"ferramenta": ..., "argumentos": {...}} dentro da resposta,
    mesmo que o modelo tenha escrito uma frase antes/depois ou usado ```json."""
    if not texto or "ferramenta" not in texto:
        return None
    dados = gemini_client.extrair_json(texto)
    if isinstance(dados, dict) and dados.get("ferramenta"):
        return dados
    ini, fim = texto.find("{"), texto.rfind("}")
    if 0 <= ini < fim:
        try:
            dados = json.loads(texto[ini:fim + 1])
            if isinstance(dados, dict) and dados.get("ferramenta"):
                return dados
        except Exception:
            pass
    return None


def conversar(mensagem, chat_id=None):
    """Roda o loop de "ferramentas via JSON em texto" e devolve o texto de
    resposta final. Se chat_id for passado, a mensagem do usuário e a resposta
    final são salvas nesse chat (Firestore) automaticamente.

    Não usa function calling nativo do Gemini (tools=[...]) de propósito —
    alguns modelos novos (ex: gemini-3.7/3.8-flash) exigem a Interactions API
    pra function calling nativo, uma API ainda em beta e com bugs conhecidos
    de encadeamento. Em vez disso, a IA responde com um JSON simples em texto
    dizendo qual ferramenta quer usar, e o código executa de verdade — o
    mesmo esquema já usado em interpretar_comando_edicao/producao."""
    if not gemini_client.gemini_disponivel():
        return "A Laranjinha está indisponível no momento (chave do Gemini não configurada no servidor)."

    inicio = time.monotonic()

    if chat_id:
        historico_conversa = _historico_do_chat(chat_id)          # antes de gravar a nova
        chats.salvar_mensagem(chat_id, "user", mensagem)
        historico_conversa.append({"role": "user", "content": mensagem})
    else:
        historico_conversa = [{"role": "user", "content": mensagem}]

    instrucao_sistema = CONHECIMENTO_APP + "\n\n" + _catalogo_ferramentas_texto()
    try:
        outras = _resumo_outras_conversas(chat_id) if chat_id else []
        if outras:
            linhas = []
            for o in outras:
                linhas.append(f"### Conversa \"{o['chat']}\"\n" + "\n".join(o["ultimas_mensagens"]))
            instrucao_sistema += (
                "\n\n## Resumo de OUTRAS conversas salvas (últimas mensagens de cada uma)\n"
                + "\n\n".join(linhas)
                + "\n\nUse ler_conversa se precisar do histórico completo de alguma delas."
            )
    except Exception:
        pass

    linhas_conversa = []
    for m in historico_conversa[-30:]:
        papel = "Assistente" if m.get("role") in ("model", "assistant") else "Usuário"
        texto = m.get("content", "")
        if texto:
            linhas_conversa.append(f"{papel}: {texto}")

    execucoes_registradas = []
    texto_final = None
    ultimo_erro = ""

    for _iteracao in range(5):
        if time.monotonic() - inicio > 85:
            ultimo_erro = "a resposta demorou demais"
            break
        prompt_completo = (
            instrucao_sistema
            + "\n\n## Conversa até agora\n" + "\n".join(linhas_conversa)
            + ("\n\n## Resultados de ferramentas já chamadas nesta resposta\n" + "\n".join(execucoes_registradas)
               if execucoes_registradas else "")
            + "\n\nResponda agora como Assistente (texto normal, ou o JSON de ferramenta se precisar)."
        )
        resposta, erro = gemini_client.chamar_texto(prompt_completo)
        if resposta is None:
            ultimo_erro = erro or "sem resposta do Gemini"
            break

        texto_resp = (resposta.text or "").strip()
        chamada = _extrair_chamada_ferramenta(texto_resp)
        if chamada:
            nome_func = chamada.get("ferramenta")
            args = chamada.get("argumentos") or {}
            resultado = _executar_ferramenta(nome_func, args)
            execucoes_registradas.append(f"- {nome_func}({args}) → {resultado}")
            continue

        texto_final = texto_resp or "Não consegui gerar uma resposta."
        break

    if texto_final is None:
        texto_final = (
            f"A Laranjinha não conseguiu responder agora ({ultimo_erro[:160]}). Tente de novo em instantes."
            if ultimo_erro else "Não consegui completar essa ação (várias etapas seguidas sem uma resposta final)."
        )

    if chat_id:
        chats.salvar_mensagem(chat_id, "model", texto_final)
        with _trava_cache:
            historico_conversa.append({"role": "model", "content": texto_final})
            del historico_conversa[:-_MAX_MSGS_POR_CHAT]

    return texto_final
