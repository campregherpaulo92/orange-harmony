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
import tempfile
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


def gerar_musica_ia(prompt_musical, letra):
    """Gera a música completa (com voz e letra) via YuE2-3B, no Hugging Face,
    usando gradio_client — o mesmo espaço/API que o app original usava (não a
    API genérica de Inference da Hugging Face, que não tem esse modelo)."""
    try:
        from gradio_client import Client
    except ImportError:
        return None, "Biblioteca ausente no servidor (gradio_client)."

    try:
        try:
            cliente = Client(ESPACO_YUE2, hf_token=HF_TOKEN or None)
        except TypeError:
            cliente = Client(ESPACO_YUE2)
    except Exception as e:
        return None, f"Não consegui conectar ao estúdio da IA (Hugging Face): {str(e)[:300]}"

    if not letra or not letra.strip():
        return None, "Gere a letra primeiro (botão 'Gerar letra') — ela é usada na composição."

    try:
        resultado = cliente.predict(
            prompt_musical,
            letra,
            "full",
            16,
            42,
            api_name="/generate_song",
        )
    except Exception as e:
        return None, f"Erro na geração da música: {str(e)[:300]}"

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
        return None, f"Resposta inesperada da IA: {str(e)[:300]}"
