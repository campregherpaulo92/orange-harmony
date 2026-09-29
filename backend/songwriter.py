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
import avaliacao
import audio_analysis
import converter_audio

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
        f'Escreva a letra de uma música original sobre: "{tema}", no estilo {estilo}.\n'
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
        + f"\n\nEstilo: {estilo}\n\nLetra:\n{letra}\n\n"
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
    sem_token = "" if _token_hf() else " (O HF_TOKEN não está configurado no Render — configure pra ter cota de GPU.)"
    if "quota" in b or "exceeded" in b and "gpu" in b:
        return ("Acabou a cota de GPU grátis da Hugging Face por hoje — contas gratuitas têm só alguns "
                "minutos de GPU por dia, e cada música consome 2 a 5. Tente amanhã, ou use uma conta PRO." + sem_token)
    if "401" in b or "unauthorized" in b or "invalid" in b and "token" in b or "credentials" in b:
        return "A Hugging Face recusou o seu HF_TOKEN (inválido ou sem permissão). Gere um novo em huggingface.co/settings/tokens."
    if etapa == "conectar" or "gradio config" in b or "connect" in b or "timed out" in b or "502" in b or "503" in b:
        return ("O estúdio de música da Hugging Face não respondeu — o Space costuma estar reiniciando ou "
                "sobrecarregado (é um Space público e disputado). Tentei 3 vezes; tente de novo em alguns minutos." + sem_token)
    return f"Erro na geração da música: {bruto[:250]}" + sem_token


def gerar_musica_ia(prompt_musical, letra):
    """Gera a música completa (com voz e letra) via YuE2-3B, no Hugging Face,
    usando gradio_client — o mesmo espaço/API que o app original usava (não a
    API genérica de Inference da Hugging Face, que não tem esse modelo)."""
    try:
        import gradio_client  # noqa: F401
    except ImportError:
        return None, "Biblioteca ausente no servidor (gradio_client)."

    if not letra or not letra.strip():
        return None, "Gere a letra primeiro (botão 'Gerar letra') — ela é usada na composição."

    cliente, erro = _conectar_space()
    if cliente is None:
        return None, _explicar_erro(erro, "conectar")

    estilo = (prompt_musical or "").strip()[:1000]          # limite do Space: 1.000 caracteres
    letra_yue = preparar_letra_para_yue(letra)
    if not estilo:
        estilo = "Pop, warm vocal, acoustic guitar, steady drums"

    try:
        resultado = cliente.predict(
            estilo,        # style
            letra_yue,     # lyrics (com seções [Verse]/[Chorus])
            "full",        # planning_mode: melodia + acordes
            16,            # render_quality: rápido (16 passos)
            42,            # seed
            api_name="/generate_song",
        )
    except Exception as e:
        return None, _explicar_erro(e, "gerar")

    try:
        caminho = resultado
        if isinstance(caminho, (list, tuple)):
            caminho = caminho[0]
        if isinstance(caminho, dict):
            caminho = caminho.get("path") or caminho.get("value") or list(caminho.values())[0]
        import soundfile as sf
        audio_ia, sr_ia = sf.read(caminho)
        if audio_ia.ndim > 1:
            audio_ia = audio_ia.mean(axis=1)
        wav_bytes = converter_audio.audio_para_wav_bytes(audio_ia.astype(np.float32), int(sr_ia))
        return wav_bytes, None
    except Exception as e:
        return None, f"A música foi gerada, mas não consegui ler o arquivo devolvido: {str(e)[:250]}"
