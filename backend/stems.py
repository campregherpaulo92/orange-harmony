# ══════════════════════════════════════════════════════════════
# stems.py — Separação de voz/instrumental rodando localmente com Demucs
# (biblioteca `demucs`, modelo htdemucs). Não depende mais de um servidor
# Colab externo/gradio.live — a separação acontece no mesmo processo do
# backend, direto no Orange Studio.
#
# Aviso honesto: sem GPU dedicada, cada separação pode levar de dezenas de
# segundos a poucos minutos, dependendo da duração do áudio e do hardware
# onde o backend está rodando.
# ══════════════════════════════════════════════════════════════
import io
import os
import tempfile
import gc


def _carregar_modelo():
    # Propositalmente SEM cache entre chamadas — em um host com pouca memória
    # (512MB), manter o modelo carregado pra sempre economiza tempo mas nunca
    # libera essa memória de volta, mesmo quando ninguém está usando o
    # Estúdio. Recarregar a cada vez custa alguns segundos extras, mas evita
    # que o processo inteiro seja reiniciado por estourar o limite de RAM.
    from demucs.pretrained import get_model
    modelo = get_model("htdemucs")
    modelo.eval()
    return modelo


def separar(dados_audio, nome_arquivo):
    """Retorna (voz_bytes, instrumental_bytes, None) em sucesso,
    ou (None, None, mensagem_de_erro) em falha."""
    if not dados_audio:
        return None, None, "Grave ou suba um áudio primeiro."

    try:
        import torch
        import torchaudio
        from demucs.apply import apply_model
    except Exception as e:
        return None, None, f"Dependências de separação (torch/demucs) não disponíveis: {e}"

    caminho_temp = None
    try:
        modelo = _carregar_modelo()

        sufixo = os.path.splitext(nome_arquivo or "")[1] or ".wav"
        fd, caminho_temp = tempfile.mkstemp(suffix=sufixo)
        with os.fdopen(fd, "wb") as f:
            f.write(dados_audio)

        wav, sr = torchaudio.load(caminho_temp)
        if sr != modelo.samplerate:
            wav = torchaudio.functional.resample(wav, sr, modelo.samplerate)
        if wav.shape[0] == 1:
            wav = wav.repeat(2, 1)
        elif wav.shape[0] > 2:
            wav = wav[:2]

        referencia = wav.mean(0)
        media, desvio = referencia.mean(), referencia.std() + 1e-8
        wav_normalizado = (wav - media) / desvio

        with torch.no_grad():
            fontes = apply_model(modelo, wav_normalizado[None], device="cpu", progress=False)[0]
        fontes = fontes * desvio + media

        nomes_fontes = modelo.sources  # ex.: ['drums', 'bass', 'other', 'vocals']
        indice_voz = nomes_fontes.index("vocals")
        voz = fontes[indice_voz]
        instrumental = sum(fontes[i] for i in range(len(nomes_fontes)) if i != indice_voz)

        # Salva em ARQUIVOS temporários de verdade (não BytesIO). Versões recentes
        # do torchaudio usam o backend "torchcodec", que não lida bem com destinos
        # em memória mesmo com format= explícito — só é confiável com um caminho
        # de arquivo real com extensão.
        fd_voz, caminho_voz = tempfile.mkstemp(suffix=".wav")
        os.close(fd_voz)
        fd_inst, caminho_inst = tempfile.mkstemp(suffix=".wav")
        os.close(fd_inst)
        try:
            torchaudio.save(caminho_voz, voz.clamp(-1, 1), modelo.samplerate, format="wav")
            torchaudio.save(caminho_inst, instrumental.clamp(-1, 1), modelo.samplerate, format="wav")
            with open(caminho_voz, "rb") as f:
                voz_bytes = f.read()
            with open(caminho_inst, "rb") as f:
                inst_bytes = f.read()
        finally:
            for c in (caminho_voz, caminho_inst):
                if os.path.exists(c):
                    os.remove(c)

        return voz_bytes, inst_bytes, None
    except Exception as e:
        return None, None, f"Não foi possível separar os stems: {e}"
    finally:
        if caminho_temp and os.path.exists(caminho_temp):
            os.remove(caminho_temp)
        # Solta as referências aos tensores/modelo pesados e força a coleta de
        # lixo — em host com pouca RAM, isso é a diferença entre o processo
        # sobreviver ou ser reiniciado por estourar o limite de memória.
        modelo = wav = wav_normalizado = fontes = voz = instrumental = referencia = None
        gc.collect()
