# ══════════════════════════════════════════════════════════════
# converter_audio.py — Conversão entre formatos de áudio.
# ══════════════════════════════════════════════════════════════
import io
import numpy as np

FORMATOS_SUPORTADOS = ["WAV", "MP3", "FLAC", "OGG", "M4A"]


def audio_para_wav_bytes(audio, sr):
    import soundfile as sf
    buf = io.BytesIO()
    sf.write(buf, audio, sr, format="WAV")
    return buf.getvalue()


def converter(audio, sr, formato_destino):
    """Converte para o formato pedido. Retorna (bytes, content_type, nome_arquivo)."""
    import soundfile as sf
    formato_destino = (formato_destino or "").upper()

    if formato_destino == "WAV":
        return audio_para_wav_bytes(audio, sr), "audio/wav", "convertido.wav"

    if formato_destino == "FLAC":
        buf = io.BytesIO()
        sf.write(buf, audio, sr, format="FLAC")
        return buf.getvalue(), "audio/flac", "convertido.flac"

    if formato_destino == "OGG":
        buf = io.BytesIO()
        sf.write(buf, audio, sr, format="OGG", subtype="VORBIS")
        return buf.getvalue(), "audio/ogg", "convertido.ogg"

    if formato_destino == "MP3":
        import lameenc
        encoder = lameenc.Encoder()
        encoder.set_bit_rate(192)
        encoder.set_in_sample_rate(sr)
        encoder.set_channels(1)
        pcm = (audio * 32767).astype(np.int16).tobytes()
        mp3_bytes = bytes(encoder.encode(pcm) + encoder.flush())
        return mp3_bytes, "audio/mpeg", "convertido.mp3"

    if formato_destino == "M4A":
        try:
            from pydub import AudioSegment
        except Exception:
            raise RuntimeError(
                "Conversão para M4A requer 'pydub' + ffmpeg instalados no ambiente."
            )
        wav_bytes = audio_para_wav_bytes(audio, sr)
        seg = AudioSegment.from_wav(io.BytesIO(wav_bytes))
        buf = io.BytesIO()
        seg.export(buf, format="ipod")
        return buf.getvalue(), "audio/mp4", "convertido.m4a"

    raise RuntimeError(f"Formato de destino não suportado: {formato_destino}")
