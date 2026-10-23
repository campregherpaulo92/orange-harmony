# ══════════════════════════════════════════════════════════════
# songwriter.py — Songwriter completo:
# - Letra em português via Gemini (nossa, personalizada pelo perfil vocal) —
#   fonte PRINCIPAL da letra, melhor que deixar o modelo de música escrever
#   sozinho (que teria como padrão espanhol, sem contexto do usuário).
# - Referência sonora: grava/sobe um trecho, o Gemini OUVE e descreve estilo,
#   clima, instrumentação — isso entra no prompt de geração.
# - Prompt musical rico via Gemini (estilo, tema, perfil vocal, referência).
# - Geração de música de verdade via gradio_client, no mesmo espaço Hugging
#   Face (YuE2-3B) que o app original usava — não a API genérica da HF.
# ══════════════════════════════════════════════════════════════
import os
import re
import time
import tempfile
import unicodedata
import numpy as np

import gemini_client
import ritmos
import avaliacao
import audio_analysis
import converter_audio
from espectro_leve import tarefa_pesada, ServidorOcupado

HF_TOKEN = os.environ.get("HF_TOKEN", "")
ESPACO_YUE2 = "mrfakename/yue2-3b"


def _contexto_vocal():
    try:
        perfil = avaliacao.carregar_perfil()
        if perfil:
            return (
                f"voz {perfil.get('voz_tipo', '')}, classificada como "
                f"{perfil.get('classificacao', '')}, com extensão de "
                f"{perfil.get('nota_grave', '')} a {perfil.get('nota_aguda', '')}"
            )
    except Exception:
        pass
    return None


def gerar_letra(tema, estilo):
    """Letra original em português, via Gemini — a fonte PRINCIPAL de letra
    do Songwriter (melhor que deixar o modelo de música escrever sozinho)."""
    if not gemini_client.gemini_disponivel():
        return None, "Gemini não configurado no servidor (falta GEMINI_API_KEY)."

    contexto = _contexto_vocal()
    prompt = (
        "Você é um letrista profissional de música popular brasileira e internacional. "
        f'Escreva a letra de uma música original sobre: "{tema}", no estilo {estilo} ({ritmos.obter(estilo)["desc"]}).\n'
        "Formate com seções marcadas por '#' (ex: # Verso 1, # Refrão, # Ponte) e cifras "
        "simples entre colchetes antes das linhas relevantes (ex: [Am] [F] [C] [G]).\n"
        + (f"O cantor tem {contexto} — escreva pensando nessa tessitura.\n" if contexto else "")
        + "Responda APENAS com a letra formatada, sem comentários antes ou depois."
    )
    resposta, erro = gemini_client.chamar_texto(prompt)
    if resposta and resposta.text:
        return resposta.text.strip(), None
    return None, erro or "Resposta vazia do Gemini."


def analisar_referencia_sonora(audio_bytes, nome_arquivo):
    """Ouve um trecho de referência (cantado/tocado) via Gemini e devolve uma
    descrição rica (gênero, clima, melodia, instrumentação, estilo vocal) pra
    enriquecer o prompt de geração — igual ao app original."""
    try:
        audio, sr = audio_analysis.carregar_audio_bytes(audio_bytes, nome_arquivo)
    except Exception:
        audio, sr = None, None
    descricao_tecnica = ""
    if audio is not None:
        try:
            bpm, _ = audio_analysis.detectar_bpm_e_beats(audio, sr)
            tom = audio_analysis.detectar_tom(audio, sr)
            descricao_tecnica = f"aproximadamente {bpm:.0f} BPM, tom de {tom}"
        except Exception:
            pass

    if not gemini_client.gemini_disponivel():
        return descricao_tecnica or None, None if descricao_tecnica else "Gemini não configurado."

    prompt = (
        "Você é um produtor musical experiente. Ouça este trecho de referência (pode ser "
        "cantado, tocado num instrumento, ou os dois) e descreva em português, em uma única "
        "frase corrida e objetiva (sem markdown, sem listas), características úteis pra "
        "recriar o estilo: gênero musical, clima/emoção, tipo de melodia (ex: ascendente, "
        "repetitiva, com saltos), instrumentação sugerida, e estilo vocal se houver voz "
        "(ex: rouca, suave, potente). Seja específico e sucinto — no máximo 2 frases."
    )
    texto_resp, erro = gemini_client.chamar_com_audio(prompt, audio_bytes, nome_arquivo, "audio/webm")
    if texto_resp:
        completa = f"{descricao_tecnica}. {texto_resp.strip()}" if descricao_tecnica else texto_resp.strip()
        return completa, None
    if descricao_tecnica:
        return descricao_tecnica, None
    return None, erro or "Não consegui analisar a referência."


def gerar_prompt_musical(letra, estilo, tema=None, descricao_referencia=None):
    """Prompt musical rico em inglês (pra IA de música), combinando estilo,
    tema, perfil vocal e a referência sonora analisada (se houver)."""
    if not gemini_client.gemini_disponivel():
        return None, "Gemini não configurado no servidor (falta GEMINI_API_KEY)."

    contexto = _contexto_vocal()
    prompt = (
        "Você escreve prompts em INGLÊS para modelos de geração de música por IA (estilo "
        "Suno/YuE/MusicGen). Baseado na letra abaixo, no estilo pedido, e no contexto extra "
        "(se houver), escreva um único parágrafo descritivo em inglês cobrindo: instrumentação, "
        "andamento em BPM, tom/tonalidade, produção/mixagem, e a voz principal — de forma "
        "concreta e específica, nunca genérica."
        + (f" A voz principal deve soar como {contexto}." if contexto else "")
        + (f"\n\nTema da música: {tema}" if tema else "")
        + (f"\n\nReferência sonora analisada: {descricao_referencia}" if descricao_referencia else "")
        + f"\n\nEstilo: {estilo} (referência em inglês para descrever o gênero: {ritmos.tags_en(estilo)})\n\nLetra:\n{letra}\n\n"
        "Responda APENAS com o parágrafo do prompt, em inglês, sem comentários antes ou depois."
    )
    resposta, erro = gemini_client.chamar_texto(prompt)
    if resposta and resposta.text:
        return resposta.text.strip(), None
    return None, erro or "Resposta vazia do Gemini."


# ── Adaptação da letra pro formato que o YuE2 entende ──────────────────────
# O modelo espera seções entre colchetes ([Verse], [Chorus]…). A nossa letra vem
# do Gemini com títulos "# Verso 1 / # Refrão" e cifras entre colchetes ([Am] [F]),
# que o modelo confundiria com nomes de seção.
_CIFRA = re.compile(r"\[\s*[A-G][#b♯♭]?(?:maj|min|dim|aug|sus|add|m|M)?\d*(?:/[A-G][#b♯♭]?)?\s*\]")
_SECOES = [                       # (palavras-chave sem acento, rótulo do YuE2) — ordem importa
    (("pre-refrao", "pre refrao", "pre-chorus", "pre chorus", "prechorus"), "[Pre-Chorus]"),
    (("refrao", "chorus", "coro", "estribilho"), "[Chorus]"),
    (("verso", "verse", "estrofe", "strofe"), "[Verse]"),
    (("ponte", "bridge"), "[Bridge]"),
    (("intro",), "[Intro]"),
    (("solo", "instrumental", "interludio"), "[Instrumental]"),
    (("outro", "final", "encerramento", "fim"), "[Outro]"),
]


def _sem_acento(texto):
    return "".join(c for c in unicodedata.normalize("NFD", texto) if unicodedata.category(c) != "Mn").lower()


def preparar_letra_para_yue(letra, limite=12000):
    """Troca '# Verso 1' por '[Verse]', '# Refrão' por '[Chorus]' etc., tira as cifras
    e respeita o limite de 12.000 caracteres do Space."""
    linhas_saida = []
    for bruta in (letra or "").splitlines():
        linha = _CIFRA.sub("", bruta).strip()
        linha = re.sub(r"[ \t]{2,}", " ", linha)
        eh_titulo = linha.startswith("#") or (linha.startswith("[") and linha.endswith("]")) or bool(
            re.fullmatch(r"[A-Za-zÀ-ú\- ]{3,20}\s*\d*\s*:", linha))
        if eh_titulo:
            chave = _sem_acento(linha.strip("#[]: ").strip())
            rotulo = next((r for palavras, r in _SECOES if any(chave.startswith(w) for w in palavras)), None)
            if rotulo:
                if linhas_saida and linhas_saida[-1] != "":
                    linhas_saida.append("")
                linhas_saida.append(rotulo)
                continue
            if linha.startswith("#"):      # título qualquer (ex: "# Minha Música") não é letra
                continue
        linhas_saida.append(linha)
    texto = re.sub(r"\n{3,}", "\n\n", "\n".join(linhas_saida)).strip()
    if texto and not texto.lstrip().startswith("["):
        texto = "[Verse]\n" + texto
    return texto[:limite]


# ── Conexão com o Space da Hugging Face ────────────────────────────────────
def _token_hf():
    """O token só vale se foi mesmo preenchido (não o texto de exemplo do notebook)."""
    t = (os.environ.get("HF_TOKEN") or HF_TOKEN or "").strip()
    return t if len(t) >= 10 and t != "SENHA_CHAVE_HF" else ""


def _conectar_space(tentativas=3, espera_s=8):
    """Cria o cliente do Space. Usa o token (o parâmetro chama `token` nas versões novas
    do gradio_client e `hf_token` nas antigas — antes o código errava o nome e conectava
    SEM token, em silêncio) e tenta de novo se o Space estiver iniciando."""
    import inspect
    from gradio_client import Client

    parametros = inspect.signature(Client.__init__).parameters
    argumentos = {}
    token = _token_hf()
    if token:
        argumentos["token" if "token" in parametros else "hf_token"] = token
    if "httpx_kwargs" in parametros:
        argumentos["httpx_kwargs"] = {"timeout": 60}

    ultimo_erro = None
    for n in range(tentativas):
        try:
            return Client(ESPACO_YUE2, **argumentos), None
        except Exception as e:
            ultimo_erro = e
            if n < tentativas - 1:
                time.sleep(espera_s * (n + 1))
    return None, ultimo_erro


def _explicar_erro(erro, etapa):
    """Traduz o erro técnico da Hugging Face pra uma frase que diz o que fazer."""
    bruto = str(erro)
    b = bruto.lower()
    sem_token = "" if _token_hf() else " (O HF_TOKEN não está configurado no servidor — configure pra ter cota de GPU.)"
    if "quota" in b or "exceeded" in b and "gpu" in b:
        return ("Acabou a cota de GPU grátis da Hugging Face por hoje — contas gratuitas têm só alguns "
                "minutos de GPU por dia, e cada música consome 2 a 5. Tente amanhã, ou use uma conta PRO." + sem_token)
    if "401" in b or "unauthorized" in b or "invalid" in b and "token" in b or "credentials" in b:
        return "A Hugging Face recusou o seu HF_TOKEN (inválido ou sem permissão). Gere um novo em huggingface.co/settings/tokens."
    if etapa == "conectar" or "gradio config" in b or "connect" in b or "timed out" in b or "502" in b or "503" in b:
        return ("O estúdio de música da Hugging Face não respondeu — o Space costuma estar reiniciando ou "
                "sobrecarregado (é um Space público e disputado). Tentei 3 vezes; tente de novo em alguns minutos." + sem_token)
    return f"Erro na geração da música: {bruto[:250]}" + sem_token


# ── Resultado do Space: uma tupla [0]=MP3, [1]=FLAC, [2]=partitura ABC (melodia + acordes), [3]=texto ──
def _item_do_resultado(resultado, indice):
    item = resultado
    if isinstance(resultado, (list, tuple)):
        item = resultado[indice] if len(resultado) > indice else None
    elif indice != 0:
        return None
    if isinstance(item, dict):
        item = item.get("path") or item.get("value") or (list(item.values())[0] if item else None)
    return item


def _partitura_do_resultado(resultado):
    item = _item_do_resultado(resultado, 2)
    return item.strip() if isinstance(item, str) and item.strip() else None


def _wav_do_resultado(resultado):
    """(wav_bytes, erro): lê o MP3 devolvido pelo Space e converte para WAV mono.
    A fila de tarefas pesadas só é usada AQUI (conversão local), nunca durante a espera do Space, que dura minutos."""
    try:
        caminho = _item_do_resultado(resultado, 0)
        import soundfile as sf
        with tarefa_pesada():
            audio_ia, sr_ia = sf.read(caminho)
            if audio_ia.ndim > 1:
                audio_ia = audio_ia.mean(axis=1)
            return converter_audio.audio_para_wav_bytes(audio_ia.astype(np.float32), int(sr_ia)), None
    except ServidorOcupado as e:
        return None, str(e)
    except Exception as e:
        return None, f"A música foi gerada, mas não consegui ler o arquivo devolvido: {str(e)[:250]}"


def gerar_musica_ia_completa(prompt_musical, letra):
    """Gera a música completa (com voz e letra) via YuE2 e devolve (wav_bytes, partitura_abc, erro).
    A partitura (melodia + acordes) vem junto: guardá-la permite refazer a música com OUTRA letra mantendo a melodia."""
    try:
        import gradio_client  # noqa: F401
    except ImportError:
        return None, None, "Biblioteca ausente no servidor (gradio_client)."

    if not letra or not letra.strip():
        return None, None, "Gere a letra primeiro (botão 'Gerar letra') — ela é usada na composição."

    cliente, erro = _conectar_space()
    if cliente is None:
        return None, None, _explicar_erro(erro, "conectar")

    estilo = (prompt_musical or "").strip()[:1000]          # limite do Space: 1.000 caracteres
    letra_yue = preparar_letra_para_yue(letra)
    if not estilo:
        estilo = "Pop, warm vocal, acoustic guitar, steady drums"

    try:
        resultado = cliente.predict(
            style=estilo,
            lyrics=letra_yue,              # com seções [Verse]/[Chorus]
            planning_mode="full",          # melodia + acordes
            render_quality=16,             # NÚMERO (16 = rápido, 32 = melhor). A documentação do Space diz texto, mas o Space só aceita número.
            seed=42,
            api_name="/generate_song",
        )
    except Exception as e:
        return None, None, _explicar_erro(e, "gerar")

    wav, erro = _wav_do_resultado(resultado)
    return wav, _partitura_do_resultado(resultado), erro


def gerar_musica_ia(prompt_musical, letra):
    """Versão de sempre: (wav_bytes, erro)."""
    wav, _partitura, erro = gerar_musica_ia_completa(prompt_musical, letra)
    return wav, erro


# ── Cover: nova música SEGUINDO a melodia de uma gravação (ou de uma música gerada antes) ──
IDIOMAS_ANALISE = ("Auto-detect", "English", "Chinese", "Cantonese", "Japanese", "Korean", "Spanish")
DURACAO_MAX_ANALISE_S = 300
_MAX_ABC = 60000


def extrair_melodia_da_gravacao(audio_bytes, nome_arquivo, idioma="Auto-detect"):
    """Manda a gravação ao Space, que extrai a MELODIA como partitura ABC editável + a letra associada.
    Devolve (partitura_abc, letra_associada, resumo, erro)."""
    try:
        from gradio_client import handle_file
    except ImportError:
        return None, None, None, "Biblioteca ausente no servidor (gradio_client)."
    if not audio_bytes:
        return None, None, None, "Nenhum áudio recebido."
    if idioma not in IDIOMAS_ANALISE:
        idioma = "Auto-detect"

    try:
        with tarefa_pesada():
            audio, sr = audio_analysis.carregar_audio_bytes(audio_bytes, nome_arquivo or "gravacao.webm")
            if audio is None or len(audio) == 0:
                return None, None, None, "Não consegui ler esse áudio. Tente WAV ou MP3."
            audio = np.asarray(audio, dtype=np.float32)[: int(sr * DURACAO_MAX_ANALISE_S)]
            wav = converter_audio.audio_para_wav_bytes(audio, int(sr))
    except ServidorOcupado as e:
        return None, None, None, str(e)
    except Exception as e:
        return None, None, None, f"Não consegui ler o áudio enviado: {str(e)[:200]}"

    cliente, erro = _conectar_space()
    if cliente is None:
        return None, None, None, _explicar_erro(erro, "conectar")

    caminho = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            f.write(wav)
            caminho = f.name
        resultado = cliente.predict(audio_path=handle_file(caminho), language=idioma, api_name="/analyze_cover_source")
    except Exception as e:
        msg = _explicar_erro(e, "analisar")
        return None, None, None, msg.replace("Erro na geração da música:", "Erro ao analisar a gravação:")
    finally:
        if caminho and os.path.exists(caminho):
            os.remove(caminho)

    abc, letra, resumo = (_item_do_resultado(resultado, i) for i in range(3))
    if not isinstance(abc, str) or not abc.strip():
        return None, None, None, ("O modelo não conseguiu extrair a melodia dessa gravação. "
                                  "Tente um trecho só com a voz, ou um trecho mais curto.")
    return (abc.strip(), letra.strip() if isinstance(letra, str) else "",
            resumo if isinstance(resumo, str) else "", None)


def gerar_cover(estilo, letra, abc, qualidade="16", seed=831001):
    """Gera uma música nova SEGUINDO a melodia (partitura ABC) dada, com a letra e o estilo informados.
    Devolve (wav_bytes, partitura_do_resultado, erro)."""
    try:
        import gradio_client  # noqa: F401
    except ImportError:
        return None, None, "Biblioteca ausente no servidor (gradio_client)."
    abc = (abc or "").strip()
    if not abc:
        return None, None, "Falta a melodia (ABC). Extraia da gravação, ou gere uma música primeiro."
    if len(abc) > _MAX_ABC:
        return None, None, "A partitura está grande demais para o modelo. Use um trecho mais curto."
    if not (letra or "").strip():
        return None, None, "Escreva ou cole a letra primeiro."
    estilo = (estilo or "").strip()[:1000] or "Pop, warm vocal, acoustic guitar, steady drums"
    qualidade = int(qualidade) if str(qualidade) in ("16", "32") else 16     # NÚMERO: o Space recusa o texto "16"
    try:
        seed = int(seed)
    except (TypeError, ValueError):
        seed = 831001

    cliente, erro = _conectar_space()
    if cliente is None:
        return None, None, _explicar_erro(erro, "conectar")
    try:
        resultado = cliente.predict(
            style=estilo,
            lyrics=preparar_letra_para_yue(letra),
            abc_score=abc,
            render_quality=qualidade,
            seed=seed,
            api_name="/generate_cover",
        )
    except Exception as e:
        return None, None, _explicar_erro(e, "gerar")

    wav, erro = _wav_do_resultado(resultado)
    return wav, _partitura_do_resultado(resultado), erro
