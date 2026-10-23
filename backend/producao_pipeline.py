# ══════════════════════════════════════════════════════════════
# producao_pipeline.py — UM só caminho de produção (backing track)
#
# Usado pela tela (/api/producao) e pela Laranjinha (ferramenta gerar_producao).
# Antes cada uma tinha a sua cópia do código; a da Laranjinha ficou para trás (sem teclado, sem solo, sem BPM manual,
# sem a escolha da harmonia, com a mixagem antiga). Agora qualquer ajuste aqui vale para as duas.
# ══════════════════════════════════════════════════════════════
import converter_audio
import harmonia
import producao_dsp
import producao_ritmos
from audio_analysis import detectar_bpm_e_beats, liberar_memoria


class ErroProducao(Exception):
    """Falha ao gerar uma das camadas (baixo, bateria, acordes, teclado ou solo)."""


def produzir(audio, sr, estilo, com_baixo=True, com_bateria=True, com_acordes=True, com_teclado=False, com_solo=False,
             qualidade_pro=True, acordes_modo="melodia", bpm_manual=0.0):
    """Monta a produção em volta de `audio` (já carregado, mono) e devolve (wav_bytes, resumo).
    resumo: bpm, tom_detectado, modo_detectado, acordes (lista), estilo."""
    bpm, beat_times = detectar_bpm_e_beats(audio, sr, bpm_manual if 40 <= bpm_manual <= 220 else None)
    # Harmonia: "melodia" = os acordes seguem as notas que você cantou/tocou; "estilo" = sequência fixa do estilo
    info = harmonia.preparar(audio, sr, estilo, bpm, beat_times, acordes_modo if acordes_modo in ("melodia", "estilo") else "melodia")
    tom, harm = info["tom"], info["harmonia"]
    liberar_memoria()
    env_voz = producao_dsp.envelope_voz(audio) if qualidade_pro else None      # calculado UMA vez e usado no ducking de todas as camadas

    # Cada trilha é gerada, (opcionalmente) passa pelo ducking, é SOMADA à mixagem e
    # liberada na hora — em vez de segurar todas ao mesmo tempo na memória.
    mix = producao_dsp.iniciar_mix(audio)
    ref = producao_ritmos.rms_voz(mix)              # volume médio da voz: cada camada é nivelada em relação a ele
    try:
        camadas = [
            (com_baixo,   "baixo",   lambda: producao_ritmos.gerar_baixo_estilo(audio, sr, tom, bpm, beat_times, estilo, harm),   0.30),
            (com_bateria, "bateria", lambda: producao_ritmos.gerar_bateria_estilo(audio, sr, bpm, beat_times, estilo),      None),
            (com_acordes, "acordes", lambda: producao_ritmos.gerar_acordes_estilo(audio, sr, tom, bpm, beat_times, estilo, harm), 0.40),
            (com_teclado, "teclado", lambda: producao_ritmos.gerar_teclado_estilo(audio, sr, tom, bpm, beat_times, estilo, harm), 0.35),
            (com_solo,    "solo",    lambda: producao_ritmos.gerar_solo_estilo(audio, sr, tom, bpm, beat_times, estilo, harm, info["modo"]),     0.30),
        ]
        for ativa, nome_camada, gerar, ducking in camadas:
            if not ativa:
                continue
            trilha = gerar()
            if qualidade_pro and ducking is not None:
                trilha = producao_dsp.aplicar_ducking(trilha, audio, sr, intensidade=ducking, envelope=env_voz)
            producao_ritmos.somar_nivelado(mix, trilha, ref, nome_camada, estilo)
            del trilha
            liberar_memoria()                                # devolve ao sistema a memória temporária da camada
    except Exception as e:
        raise ErroProducao(str(e)) from e

    mix = producao_dsp.finalizar_mix(producao_ritmos.limitar(mix))
    if qualidade_pro:
        mix = producao_dsp.aplicar_reverb(mix, sr, quantidade=0.08)

    wav_bytes = converter_audio.audio_para_wav_bytes(mix, sr)
    del mix
    liberar_memoria()
    return wav_bytes, {"bpm": bpm, "tom_detectado": info["tom_detectado"], "modo_detectado": info["modo_detectado"],
                       "acordes": info["acordes"], "estilo": estilo}
