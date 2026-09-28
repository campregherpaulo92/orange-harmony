# ══════════════════════════════════════════════════════════════
# estudio_agente.py — Agente embutido no Orange Studio.
#
# Diferente da Laranjinha "geral" (que age sobre gravações já salvas no
# Storage), aqui o áudio das faixas separadas (vocal/instrumental) vive só
# no navegador — vieram do Colab/Demucs e nunca passam pelo Storage. Por
# isso o front-end reenvia o áudio da faixa junto com o comando a cada
# pedido: o backend não guarda estado nenhum do Estúdio entre mensagens.
# ══════════════════════════════════════════════════════════════
import base64

import gemini_client
import audio_analysis
import edicao_dsp
import converter_audio
from laranjinha import interpretar_comando_edicao


def processar_comando(mensagem, faixa_nome, dados_audio):
    """Retorna dict {resposta, audio_base64 (ou None), acoes (lista)}."""
    tem_audio = dados_audio is not None and len(dados_audio) > 0

    if not tem_audio:
        prompt = (
            "Você é a Laranjinha, atuando dentro do Orange Studio (separação de stems). "
            "O usuário ainda não tem uma faixa de áudio ativa nesta conversa (ou não escolheu "
            "qual faixa — vocal ou instrumental). Responda em português, de forma breve e "
            "acolhedora, explicando que ele precisa separar os stems primeiro (ou escolher a "
            "faixa) antes de pedir uma limpeza ou ajuste.\n\n"
            f"Mensagem do usuário: {mensagem}"
        )
        resposta, erro = gemini_client.chamar_texto(prompt)
        if resposta and resposta.text:
            texto = resposta.text
        else:
            texto = (
                "Separe os stems primeiro (ou escolha qual faixa — vocal ou instrumental) "
                "e me diga o que quer ajustar nela."
                if erro is None else f"A Laranjinha está indisponível agora ({erro})."
            )
        return {"resposta": texto, "audio_base64": None, "acoes": []}

    audio, sr = audio_analysis.carregar_audio_bytes(dados_audio, "stem.wav")
    if audio is None:
        return {"resposta": "Não consegui ler o áudio dessa faixa.", "audio_base64": None, "acoes": []}

    flags = interpretar_comando_edicao(mensagem)
    audio_editado, acoes = edicao_dsp.aplicar_efeitos(
        audio, sr, flags["reduzir_ruido"], flags["normalizar"], flags["ajustar_tom"],
        flags["eq_presenca"], flags["compressao"], flags["remover_sibilancia"], flags["reverb_leve"],
    )
    wav_bytes = converter_audio.audio_para_wav_bytes(audio_editado, sr)
    audio_b64 = base64.b64encode(wav_bytes).decode("ascii")

    rotulos = {
        "reducao_ruido": "reduzi o ruído",
        "normalizacao": "normalizei o volume",
        "eq_presenca": "apliquei EQ de presença",
        "compressao": "apliquei compressão suave",
        "reducao_sibilancia": "reduzi a sibilância",
        "reverb_leve": "coloquei um reverb leve",
    }
    partes_resposta = []
    for a in acoes:
        if a.startswith("ajuste_tom:"):
            valor = a.split(":")[1]
            partes_resposta.append(f"ajustei o tom em {valor} semitons")
        else:
            partes_resposta.append(rotulos.get(a, a))

    nome_faixa = faixa_nome or "faixa selecionada"
    resposta = f"Prontinho! Na {nome_faixa}, eu {', '.join(partes_resposta)}. Já pode ouvir o resultado."
    return {"resposta": resposta, "audio_base64": audio_b64, "acoes": acoes}
