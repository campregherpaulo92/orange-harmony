# ══════════════════════════════════════════════════════════════
# laranjinha.py — Assistente Laranjinha: conhece e comanda o Orange Harmony
# inteiro via function calling do Gemini. Não é só leitura — ela executa
# ações de verdade (gerar produção, aplicar edição vocal, salvar composição,
# renomear/excluir gravação), sempre em cima de dados reais do Firestore/Storage.
# ══════════════════════════════════════════════════════════════
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

CONHECIMENTO_APP = """
Você é a Laranjinha, assistente oficial do Orange Harmony — um app de coaching vocal com IA.
Você conhece TODO o aplicativo e tem ferramentas reais para LER dados E EXECUTAR AÇÕES de verdade.

## Módulos do app (e o que você sabe sobre cada um)
1. Estudo/Análise Vocal: pitch, afinação, desvio em cents, vibrato, curva de pitch, devolutiva do professor.
2. Afinador: 11 afinações, calibração 440/442, detecção de pitch em tempo real no navegador.
3. Gravador: grava/sobe áudio, salva no Firebase Storage.
4. Histórico: evolução das análises salvas, com devolutiva do professor.
5. Composições: letras com cifras [Am] e seções (#), versionamento.
6. Conversor: WAV/MP3/FLAC/OGG/M4A.
7. Produção: gera baixo, bateria e acordes a partir de uma gravação, em 12 estilos musicais.
8. Edição Vocal: redução de ruído, normalização, tom, EQ, compressão, sibilância, reverb.
9. Avaliação: 5 exercícios que geram o perfil vocal (classificação, extensão, tessitura).
10. Orange Studio: separação de stems (voz/instrumental) via Demucs no Colab.
11. Songwriter: geração de música via Hugging Face + letra via você mesma (Gemini).

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


def _declaracoes_ferramentas(types):
    return [
        types.FunctionDeclaration(
            name="listar_gravacoes",
            description="Lista as gravações salvas do usuário (nome, data, tamanho), mais recentes primeiro.",
            parameters={"type": "object", "properties": {"limite": {"type": "integer"}}, "required": []},
        ),
        types.FunctionDeclaration(
            name="avaliar_gravacao",
            description="Ouve uma gravação salva (pelo nome) e dá um parecer vocal completo, como um professor de canto.",
            parameters={"type": "object", "properties": {"nome": {"type": "string"}}, "required": ["nome"]},
        ),
        types.FunctionDeclaration(
            name="analisar_gravacao",
            description="Roda uma análise técnica (pitch, afinação, vibrato) numa gravação salva e registra no histórico.",
            parameters={
                "type": "object",
                "properties": {
                    "nome": {"type": "string"},
                    "modo": {"type": "string", "enum": ["completa", "cover"]},
                },
                "required": ["nome"],
            },
        ),
        types.FunctionDeclaration(
            name="ler_historico",
            description="Lê o resumo das últimas análises salvas no histórico do usuário.",
            parameters={"type": "object", "properties": {"limite": {"type": "integer"}}, "required": []},
        ),
        types.FunctionDeclaration(
            name="ler_perfil_vocal",
            description="Lê o perfil vocal do usuário (classificação, extensão, tessitura), se ele já fez a Avaliação.",
        ),
        types.FunctionDeclaration(
            name="listar_composicoes",
            description="Lista as composições salvas (título, tom, versão).",
            parameters={"type": "object", "properties": {"limite": {"type": "integer"}}, "required": []},
        ),
        types.FunctionDeclaration(
            name="salvar_composicao",
            description="Cria/salva uma nova composição (letra com cifras e seções).",
            parameters={
                "type": "object",
                "properties": {
                    "titulo": {"type": "string"},
                    "tom": {"type": "string"},
                    "letra": {"type": "string"},
                },
                "required": ["titulo", "letra"],
            },
        ),
        types.FunctionDeclaration(
            name="gerar_producao",
            description="Gera um backing track (baixo, bateria, acordes) a partir de uma gravação salva, e salva o resultado como uma nova gravação.",
            parameters={
                "type": "object",
                "properties": {
                    "nome_gravacao": {"type": "string"},
                    "estilo": {"type": "string"},
                    "com_baixo": {"type": "boolean"},
                    "com_bateria": {"type": "boolean"},
                    "com_acordes": {"type": "boolean"},
                    "qualidade_pro": {"type": "boolean"},
                },
                "required": ["nome_gravacao"],
            },
        ),
        types.FunctionDeclaration(
            name="aplicar_edicao_vocal",
            description="Aplica edição vocal numa gravação salva, interpretando o comando em português (ex: 'limpa o ruído e deixa mais grave'), e salva o resultado como uma nova gravação.",
            parameters={
                "type": "object",
                "properties": {
                    "nome_gravacao": {"type": "string"},
                    "comando": {"type": "string"},
                },
                "required": ["nome_gravacao", "comando"],
            },
        ),
        types.FunctionDeclaration(
            name="renomear_gravacao",
            description="Renomeia uma gravação salva.",
            parameters={
                "type": "object",
                "properties": {"nome_atual": {"type": "string"}, "novo_nome": {"type": "string"}},
                "required": ["nome_atual", "novo_nome"],
            },
        ),
        types.FunctionDeclaration(
            name="excluir_gravacao",
            description="Exclui uma gravação salva. Só chame depois que o usuário confirmar.",
            parameters={"type": "object", "properties": {"nome": {"type": "string"}}, "required": ["nome"]},
        ),
        types.FunctionDeclaration(
            name="listar_conversas",
            description="Lista as conversas salvas com a Laranjinha (nome, data da última mensagem).",
        ),
        types.FunctionDeclaration(
            name="ler_conversa",
            description="Lê o histórico completo de uma outra conversa salva com a Laranjinha, pelo nome.",
            parameters={"type": "object", "properties": {"nome": {"type": "string"}}, "required": ["nome"]},
        ),
    ]


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
    return padrao


def _executar_ferramenta(nome_func, args):
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
        resultado = audio_analysis.analisar_audio_completo(conteudo, nome_real, modo=modo)
        if "erro" in resultado:
            return resultado
        if modo == "completa":
            try:
                historico.registrar_analise(resultado["resultado"], modo="completa")
            except Exception:
                pass
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
        if audio is None:
            return {"erro": "Não consegui ler esse áudio."}
        bpm, beat_times = audio_analysis.detectar_bpm_e_beats(audio, sr)
        tom = audio_analysis.detectar_tom(audio, sr)
        estilo = args.get("estilo", "Pop")
        baixo = bateria = acordes = None
        try:
            if args.get("com_baixo", True):
                baixo = producao_dsp.gerar_baixo_melodico(audio, sr, tom, bpm, beat_times)
            if args.get("com_bateria", True):
                bateria = producao_dsp.gerar_bateria_ritmica(audio, sr, bpm, beat_times)
            if args.get("com_acordes", True):
                acordes = producao_dsp.gerar_acordes_musicais(audio, sr, tom, bpm, beat_times, estilo)
        except Exception as e:
            return {"erro": f"Erro ao gerar produção: {e}"}
        if args.get("qualidade_pro", True):
            if baixo is not None:
                baixo = producao_dsp.aplicar_ducking(baixo, audio, sr, 0.30)
            if acordes is not None:
                acordes = producao_dsp.aplicar_ducking(acordes, audio, sr, 0.40)
        mix = producao_dsp.mixar(audio, baixo, bateria, acordes)
        if args.get("qualidade_pro", True):
            mix = producao_dsp.aplicar_reverb(mix, sr, 0.08)
        wav_bytes = converter_audio.audio_para_wav_bytes(mix, sr)
        novo_nome = f"{g['nome']} (Produção {estilo})"
        doc_id, erro = gravacoes.salvar_gravacao(novo_nome, wav_bytes, "producao.wav", "audio/wav")
        if erro:
            return {"erro": erro}
        return {"gerado": True, "nome_novo": novo_nome, "bpm": bpm, "tom": tom}

    if nome_func == "aplicar_edicao_vocal":
        g = _achar_gravacao_por_nome(args.get("nome_gravacao", ""))
        if not g:
            return {"erro": "Gravação não encontrada."}
        conteudo, content_type, nome_real = gravacoes.baixar_gravacao(g["id"])
        if conteudo is None:
            return {"erro": "Não consegui carregar o áudio dessa gravação."}
        audio, sr = audio_analysis.carregar_audio_bytes(conteudo, nome_real)
        if audio is None:
            return {"erro": "Não consegui ler esse áudio."}
        flags = interpretar_comando_edicao(args.get("comando", ""))
        audio_editado, acoes = edicao_dsp.aplicar_efeitos(
            audio, sr, flags["reduzir_ruido"], flags["normalizar"], flags["ajustar_tom"],
            flags["eq_presenca"], flags["compressao"], flags["remover_sibilancia"], flags["reverb_leve"],
        )
        wav_bytes = converter_audio.audio_para_wav_bytes(audio_editado, sr)
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


def conversar(mensagem, chat_id=None):
    """Roda o loop de function calling e devolve o texto de resposta final.
    Se chat_id for passado, o histórico completo vem do Firestore (não do
    navegador) — o servidor é a fonte da verdade — e a mensagem do usuário e
    a resposta final são salvas nesse chat automaticamente."""
    if not gemini_client.gemini_disponivel():
        return "A Laranjinha está indisponível no momento (chave do Gemini não configurada no servidor)."

    from google.genai import types

    if chat_id:
        chats.salvar_mensagem(chat_id, "user", mensagem)
        historico_conversa = chats.carregar_mensagens(chat_id)
    else:
        historico_conversa = [{"role": "user", "content": mensagem}]

    ferramentas = _declaracoes_ferramentas(types)

    instrucao_sistema = CONHECIMENTO_APP
    try:
        outras = chats.ler_outras_conversas_resumo(chat_id) if chat_id else []
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

    config = types.GenerateContentConfig(
        tools=[types.Tool(function_declarations=ferramentas)],
        system_instruction=instrucao_sistema,
    )

    conteudos = []
    for m in historico_conversa[-40:]:
        papel = "model" if m.get("role") in ("model", "assistant") else "user"
        texto = m.get("content", "")
        if texto:
            conteudos.append(types.Content(role=papel, parts=[types.Part(text=texto)]))
    if not chat_id:
        conteudos.append(types.Content(role="user", parts=[types.Part(text=mensagem)]))

    modelos = gemini_client.listar_modelos()
    ultimo_erro = ""
    ultimo_modelo = ""
    texto_final = None
    for modelo in modelos:
        for _ in range(6):
            try:
                resposta = gemini_client.gerar(modelo, conteudos, config)
            except Exception as e:
                ultimo_erro = str(e)
                ultimo_modelo = modelo
                break
            chamadas = resposta.function_calls or []
            if not chamadas:
                texto_final = resposta.text or "Não consegui gerar uma resposta."
                break
            conteudos.append(resposta.candidates[0].content)
            for fc in chamadas:
                resultado = _executar_ferramenta(fc.name, dict(fc.args or {}))
                conteudos.append(types.Content(
                    role="user",
                    parts=[types.Part(function_response=types.FunctionResponse(
                        name=fc.name, response={"resultado": resultado}
                    ))],
                ))
        if texto_final is not None:
            break

    if texto_final is None:
        texto_final = f"Erro ao chamar a Laranjinha (modelo: {ultimo_modelo}): {ultimo_erro[:200]}"

    if chat_id:
        chats.salvar_mensagem(chat_id, "model", texto_final)

    return texto_final
