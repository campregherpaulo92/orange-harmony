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


def _carregar_modelo(nome="htdemucs"):
    # Propositalmente SEM cache entre chamadas — em um host com pouca memória
    # (512MB), manter o modelo carregado pra sempre economiza tempo mas nunca
    # libera essa memória de volta, mesmo quando ninguém está usando o
    # Estúdio. Recarregar a cada vez custa alguns segundos extras, mas evita
    # que o processo inteiro seja reiniciado por estourar o limite de RAM.
    from demucs.pretrained import get_model
    modelo = get_model(nome)
    modelo.eval()
    return modelo


def _dispositivo():
    """GPU se houver (Colab com GPU é bem mais rápido); senão CPU."""
    try:
        import torch
        return "cuda" if torch.cuda.is_available() else "cpu"
    except Exception:
        return "cpu"


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
        return None, None, (
            "A separação de stems não está disponível nesta hospedagem gratuita "
            "(o Demucs precisa de mais memória do que os 512 MB do plano). "
            "Use o notebook do Colab para separar os stems, ou hospede num plano com mais RAM."
        )

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
            dispositivo = _dispositivo()
            try:
                fontes = apply_model(modelo, wav_normalizado[None], device=dispositivo, progress=False)[0]
            except Exception:
                if dispositivo == "cpu":
                    raise
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


# ════════════════════════════════════════════════════════
# MODO COMPLETO — separa cada instrumento (modelo htdemucs_6s)
# O modelo entrega 6 fontes: voz, bateria, baixo, guitarra, piano e "outros"
# (tudo que sobra: teclados/sintetizadores, cordas, metais, efeitos...).
# Limites reais: o "piano" é a fonte menos confiável do modelo; voz principal x
# backing vocal e duas vozes diferentes NÃO são separadas aqui.
# ════════════════════════════════════════════════════════
MODELO_COMPLETO = "htdemucs_6s"


def wav_para_mp3(wav_bytes, kbps=192):
    """WAV (mono/estéreo) -> MP3. Cada fonte em WAV pesa ~30 MB por música; em MP3, ~4 MB."""
    import io
    import numpy as np
    import soundfile as sf
    import lameenc
    dados, sr = sf.read(io.BytesIO(wav_bytes), dtype="int16", always_2d=True)
    enc = lameenc.Encoder()
    enc.set_bit_rate(kbps)
    enc.set_in_sample_rate(int(sr))
    enc.set_channels(int(dados.shape[1]))
    enc.set_quality(2)
    return bytes(enc.encode(np.ascontiguousarray(dados).tobytes()) + enc.flush())


def _wav_bytes(tensor, taxa):
    """Salva um tensor (canais x amostras) como WAV e devolve os bytes. Usa arquivo
    temporário de verdade (o backend torchcodec do torchaudio não aceita BytesIO)."""
    import torchaudio
    fd, caminho = tempfile.mkstemp(suffix=".wav")
    os.close(fd)
    try:
        torchaudio.save(caminho, tensor.clamp(-1, 1), taxa, format="wav")
        with open(caminho, "rb") as f:
            return f.read()
    finally:
        if os.path.exists(caminho):
            os.remove(caminho)


def separar_completo(dados_audio, nome_arquivo):
    """Retorna ({fonte: wav_bytes}, None) em sucesso, ou (None, mensagem_de_erro).
    As chaves são os nomes do próprio modelo: 'vocals', 'drums', 'bass', 'guitar',
    'piano', 'other'."""
    if not dados_audio:
        return None, "Grave ou suba um áudio primeiro."

    try:
        import torch
        import torchaudio
        from demucs.apply import apply_model
    except Exception:
        return None, (
            "A separação de stems não está disponível nesta hospedagem gratuita "
            "(o Demucs precisa de mais memória do que os 512 MB do plano). "
            "Use o notebook do Colab para separar os stems, ou hospede num plano com mais RAM."
        )

    caminho_temp = None
    try:
        modelo = _carregar_modelo(MODELO_COMPLETO)

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
            dispositivo = _dispositivo()
            try:
                fontes = apply_model(modelo, wav_normalizado[None], device=dispositivo, progress=False)[0]
            except Exception:
                if dispositivo == "cpu":
                    raise
                fontes = apply_model(modelo, wav_normalizado[None], device="cpu", progress=False)[0]
        fontes = fontes * desvio + media

        saidas = {}
        for i, nome in enumerate(modelo.sources):      # ex.: ['drums','bass','other','vocals','guitar','piano']
            saidas[nome] = _wav_bytes(fontes[i], modelo.samplerate)
        return saidas, None
    except Exception as e:
        return None, f"Não foi possível separar os stems: {e}"
    finally:
        if caminho_temp and os.path.exists(caminho_temp):
            os.remove(caminho_temp)
        modelo = wav = wav_normalizado = fontes = referencia = None
        gc.collect()


MODELO_BACKING = "mel_band_roformer_karaoke_aufr33_viperx_sdr_10.1956.ckpt"


def separacao_backing_disponivel():
    """O segundo modelo é opcional no servidor; no Colab vem pelo notebook."""
    from importlib.util import find_spec

    return find_spec("audio_separator") is not None


def separar_backing(dados_audio, nome_arquivo):
    """Demucs isola as vozes. O RoFormer separa a voz principal do grupo de apoio."""
    if not separacao_backing_disponivel():
        return None, "O modelo de backing vocal não está disponível neste separador."

    voz, instrumental, erro = separar(dados_audio, nome_arquivo)
    if erro:
        return None, erro

    try:
        from pathlib import Path

        from audio_separator.separator import Separator

        with tempfile.TemporaryDirectory() as pasta:
            raiz = Path(pasta)
            entrada = raiz / "vozes.wav"
            entrada.write_bytes(voz)
            separador = Separator(
                output_dir=pasta, output_format="WAV", normalization_threshold=1.0,
                output_single_stem="Vocals",
            )
            separador.load_model(model_filename=MODELO_BACKING)
            arquivos = separador.separate(str(entrada))
            if len(arquivos) != 1:
                return None, "O modelo não devolveu a faixa de voz principal."
            principal = (raiz / Path(arquivos[0]).name).read_bytes()

        # Faz o residual com o mesmo nível da voz do Demucs, sem o ajuste de ganho
        # independente do stem secundário. Isso mantém a soma dos dois alinhada.
        import numpy as np
        import soundfile as sf

        vozes, taxa = sf.read(io.BytesIO(voz), dtype="float32", always_2d=True)
        lead, taxa_lead = sf.read(io.BytesIO(principal), dtype="float32", always_2d=True)
        if taxa != taxa_lead or lead.shape[1] != vozes.shape[1]:
            return None, "A voz principal voltou com um formato incompatível."
        alinhado = np.zeros_like(vozes)
        n = min(len(lead), len(vozes))
        alinhado[:n] = lead[:n]

        def wav(amostras):
            saida = io.BytesIO()
            sf.write(saida, amostras, taxa, format="WAV", subtype="PCM_24")
            return saida.getvalue()

        return {
            "lead_vocals": wav(alinhado),
            "backing_vocals": wav(vozes - alinhado),
            "instrumental": instrumental,
        }, None
    except Exception as erro:
        return None, f"Não foi possível separar voz principal e backings: {erro}"
