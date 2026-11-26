"""Geração de uma faixa instrumental a partir do áudio de referência do Studio."""

import inspect
import logging
import os
import re
import tempfile
from pathlib import Path
from threading import BoundedSemaphore

import numpy as np

import converter_audio
import harmonia
import producao_dsp
import producao_ritmos
from audio_analysis import detectar_bpm_e_beats
from espectro_leve import tarefa_pesada

INSTRUMENTOS = {
    "bateria": ("drums", "drum kit"),
    "baixo": ("bass", "bass line"),
    "acordes": ("guitar", "rhythm guitar chords"),
    "teclado": ("keyboard", "keyboard accompaniment"),
    "solo": ("guitar", "lead guitar solo"),
}
SECOES = {
    "introducao": "intro", "verso": "verse", "pre-refrao": "pre-chorus",
    "refrao": "chorus", "ponte": "bridge", "solo": "solo", "final": "outro", "pausa": "break",
}
DURACAO_MINIMA = 10
PERMITE_GERACAO = BoundedSemaphore(1)
log = logging.getLogger(__name__)


class FalhaHuggingFace(Exception):
    def __init__(self, mensagem, status=502):
        super().__init__(mensagem)
        self.status = status


def space_configurado():
    space = os.environ.get("PRODUTOR_HF_SPACE", "").strip()
    if not re.fullmatch(r"[\w.-]+/[\w.-]+", space, flags=re.ASCII):
        raise FalhaHuggingFace("Configure PRODUTOR_HF_SPACE (conta/nome-do-space) no servidor para usar o Produtor com IA.", 503)
    return space


def _caption(instrumento, estilo, instrucoes, grade, plano):
    _, papel = INSTRUMENTOS[instrumento]
    marcas = []
    anterior = None
    for compasso, barra in plano.items():
        secao = "pausa" if instrumento == "bateria" and barra.sem_bateria else barra.secao
        inicio = grade.tempo(compasso, 0)
        if secao != anterior and inicio is not None:
            if secao in SECOES:
                marcas.append(f"{inicio:.1f}s {SECOES[secao]}")
            anterior = secao

    brief = f"Isolated {papel}, {estilo}. Follow the source timing and harmony."
    mapa = " | ".join(marcas)
    if len(mapa) > 170:
        mapa = mapa[:170].rsplit(" | ", 1)[0]
    if mapa:
        brief += f" Sections: {mapa}."
    direcao = " ".join(instrucoes.split()) or "Sparse verses, fuller choruses, varied transitions."
    return f"{brief} {direcao}"[:512]


def _pedir_faixa(space, pasta, referencia, instrumento, caption, bpm, batidas):
    from gradio_client import Client, handle_file

    token = os.environ.get("HF_TOKEN", "").strip()
    opcoes = {"download_files": str(pasta), "verbose": False}
    parametros = inspect.signature(Client.__init__).parameters
    if token:
        opcoes["token" if "token" in parametros else "hf_token"] = token
    if "httpx_kwargs" in parametros:
        opcoes["httpx_kwargs"] = {"timeout": 45}

    cliente = Client(space, **opcoes)
    try:
        job = cliente.submit(
            handle_file(str(referencia)), INSTRUMENTOS[instrumento][0], caption, round(bpm) if 30 <= bpm <= 300 else 0, batidas,
            api_name="/gerar_instrumento",
        )
        try:
            return job.result(timeout=220)
        except TimeoutError:
            job.cancel()
            raise
    finally:
        fechar = getattr(cliente, "close", None)
        if fechar:
            fechar()


def _aplicar_pausas(trilha, sr, grade, plano, instrumento):
    inicio = None
    intervalos = []
    for compasso, barra in plano.items():
        tempo = grade.tempo(compasso, 0)
        if tempo is None:
            continue
        pos = min(len(trilha), max(0, round(tempo * sr)))
        silenciar = barra.secao == "pausa" or (instrumento == "bateria" and barra.sem_bateria)
        if silenciar and inicio is None:
            inicio = 0 if compasso == 0 else pos
        elif not silenciar and inicio is not None:
            intervalos.append((inicio, pos))
            inicio = None
    if inicio is not None:
        intervalos.append((inicio, len(trilha)))

    transicao = max(1, round(sr * 0.005))
    for ini, fim in intervalos:
        trilha[ini:fim] = 0
        antes = min(ini, transicao)
        depois = min(len(trilha) - fim, transicao)
        trilha[ini - antes:ini] *= np.linspace(1, 0, antes)
        trilha[fim:fim + depois] *= np.linspace(0, 1, depois)


def gerar(space, audio, sr, instrumento, estilo, instrucoes, secoes, bpm_manual, qualidade_pro):
    """Usa a fila local só na análise e no acabamento. A inferência roda no Space."""
    with tempfile.TemporaryDirectory(prefix="orange-produtor-") as temporaria:
        pasta = Path(temporaria)
        referencia = pasta / "referencia.wav"
        with tarefa_pesada():
            if len(audio) < DURACAO_MINIMA * sr:
                raise FalhaHuggingFace(f"Selecione pelo menos {DURACAO_MINIMA} segundos de referência para a IA.", 422)
            if not np.isfinite(audio).all() or float(np.max(np.abs(audio))) < 1e-4:
                raise FalhaHuggingFace("A referência está silenciosa ou inválida. Selecione um trecho audível.", 422)
            bpm, tempos = detectar_bpm_e_beats(audio, sr, bpm_manual if 40 <= bpm_manual <= 220 else None)
            info = harmonia.preparar(audio, sr, estilo, bpm, tempos)
            grade, plano = producao_ritmos.preparar_arranjo(audio, sr, bpm, tempos, estilo, (0.44, 0.65, instrucoes, secoes))
            caption = _caption(instrumento, estilo, instrucoes, grade, plano)
            referencia.write_bytes(converter_audio.audio_para_wav_bytes(audio, sr))

        try:
            resultado = _pedir_faixa(space, pasta, referencia, instrumento, caption, bpm, grade.esp["batidas"])
        except TimeoutError as erro:
            raise FalhaHuggingFace("A geração no Hugging Face demorou demais. Tente uma referência mais curta.", 504) from erro
        except Exception as erro:
            mensagem = str(erro).lower()
            log.warning("Falha no Produtor HF (%s)", type(erro).__name__)
            if any(sinal in mensagem for sinal in ("quota", "429", "rate limit")):
                raise FalhaHuggingFace("A cota do Hugging Face está indisponível agora. Tente mais tarde.", 429) from erro
            if any(sinal in mensagem for sinal in ("401", "403", "unauthorized", "forbidden", "not found")):
                raise FalhaHuggingFace("Confira o nome do Space e a permissão de acesso do HF_TOKEN no servidor.") from erro
            raise FalhaHuggingFace("O Space não conseguiu gerar o instrumento. Confira se o Space do Produtor está ativo e usando o ACE-Step Base.") from erro

        with tarefa_pesada():
            import soundfile as sf
            from math import gcd
            from scipy.signal import resample_poly

            try:
                caminho = Path(resultado).resolve()
                if not caminho.is_relative_to(pasta.resolve()) or caminho == referencia:
                    raise ValueError("Caminho de saída inválido")
                with sf.SoundFile(caminho) as wav:
                    taxa = wav.samplerate
                    faixa = wav.read(frames=round(len(audio) / sr * taxa), dtype="float32", always_2d=True).mean(axis=1)
                if taxa != sr:
                    divisor = gcd(taxa, sr)
                    faixa = resample_poly(faixa, sr // divisor, taxa // divisor)
            except (TypeError, ValueError, OSError, RuntimeError) as erro:
                raise FalhaHuggingFace("O Hugging Face devolveu uma faixa que o Studio não conseguiu ler.") from erro
            if len(faixa) < len(audio) - max(sr // 2, len(audio) // 50) or not np.isfinite(faixa).all():
                raise FalhaHuggingFace("A duração ou os dados da faixa gerada não correspondem à referência.")
            if float(np.max(np.abs(faixa))) < 1e-4:
                raise FalhaHuggingFace("O modelo devolveu uma faixa silenciosa. Tente outro trecho da gravação.")

            saida = np.zeros_like(audio, dtype=np.float32)
            n = min(len(saida), len(faixa))
            saida[:n] = faixa[:n]
            if qualidade_pro and instrumento != "bateria":
                saida = producao_dsp.aplicar_ducking(saida, audio, sr, intensidade=0.30)
            saida = producao_ritmos.camada_nivelada(saida, producao_ritmos.rms_voz(audio), instrumento, estilo)
            if secoes:
                _aplicar_pausas(saida, sr, grade, plano, instrumento)
            if not np.any(saida):
                raise FalhaHuggingFace("A faixa ficou silenciosa após aplicar as pausas. Revise as seções ou use outro trecho.", 422)
            return converter_audio.audio_para_wav_bytes(saida, sr), {
                **info, "estilo": estilo, "bpm": bpm, "plano": producao_ritmos.resumo_arranjo(plano),
            }
