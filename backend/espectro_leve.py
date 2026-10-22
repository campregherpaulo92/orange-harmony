# ══════════════════════════════════════════════════════════════
# espectro_leve.py — Contas de espectro em BLOCOS, para caber nos 512 MB do plano gratuito do Render.
#
# A librosa calcula o espectro do áudio INTEIRO de uma vez: para 2 minutos isso cria cópias temporárias
# de 40 a 100 MB, e o Python não devolve essa memória ao sistema entre uma etapa e outra. Aqui o mesmo
# cálculo é feito em blocos de 20–30 s e só o resultado (pequeno) é guardado. O RESULTADO É O MESMO da
# librosa (cada quadro do espectro é calculado igual; só muda a ordem em que são feitos) — veja os testes.
#
# Também mora aqui:
#   • liberar_memoria()  — devolve ao sistema a memória que o Python soltou mas o Linux ainda segura
#   • tarefa_pesada()    — só UMA tarefa pesada (análise, produção, edição...) por vez; as outras esperam
# ══════════════════════════════════════════════════════════════
import gc
import os
import threading

import numpy as np
import librosa


def liberar_memoria():
    """Devolve memória ao sistema operacional depois de uma tarefa pesada.
    O Python solta os arrays, mas o alocador do Linux costuma ficar com a memória reservada —
    malloc_trim faz ela voltar (senão o pico vira permanente)."""
    gc.collect()
    try:
        import ctypes
        ctypes.CDLL("libc.so.6").malloc_trim(0)
    except Exception:
        pass


# ───────────────────────── guarda de memória ─────────────────────────
# O plano gratuito do Render mata o servidor quando ele passa de 512 MB (e, depois de várias quedas seguidas, demora para
# deixá-lo voltar: já houve ~75 min fora do ar). Antes de começar uma tarefa pesada, o servidor confere a folga e, se estiver
# apertada, RECUSA com um aviso claro em vez de aceitar e cair. Só vale no Render (ou com LIMITE_MEMORIA_MB definido).
def _vmrss_mb(pid="self"):
    try:
        with open(f"/proc/{pid}/status") as f:
            for linha in f:
                if linha.startswith("VmRSS:"):
                    return int(linha.split()[1]) / 1024.0
    except Exception:
        pass
    return None


def memoria_em_uso_mb():
    """Memória do processo (mais subprocessos, como o ffmpeg) em MB; None se não der para medir."""
    total = _vmrss_mb("self")
    if total is None:
        return None
    try:
        for tid in os.listdir("/proc/self/task"):
            try:
                with open(f"/proc/self/task/{tid}/children") as f:
                    for filho in f.read().split():
                        extra = _vmrss_mb(filho)
                        if extra:
                            total += extra
            except Exception:
                pass
    except Exception:
        pass
    return total


def limite_de_memoria_mb():
    """Limite do servidor em MB: LIMITE_MEMORIA_MB, ou 512 no Render; None = sem guarda (computador local)."""
    valor = os.environ.get("LIMITE_MEMORIA_MB")
    if valor:
        try:
            return float(valor)
        except ValueError:
            pass
    return 512.0 if os.environ.get("RENDER") else None


def margem_de_memoria_mb():
    try:
        return float(os.environ.get("MARGEM_MEMORIA_MB", 140))     # uma produção/análise de 2 min precisa de ~100–110 MB acima da base
    except ValueError:
        return 140.0


class ServidorOcupado(Exception):
    """Outra tarefa pesada demorou mais que o tempo de espera."""


class MemoriaBaixa(ServidorOcupado):
    """Pouca memória livre: aceitar a tarefa derrubaria o servidor."""


def _conferir_memoria():
    limite = limite_de_memoria_mb()
    uso = memoria_em_uso_mb()
    if limite is None or uso is None:
        return
    margem = margem_de_memoria_mb()
    if limite - uso >= margem:
        return
    liberar_memoria()                                  # tenta devolver o que o Python soltou antes de recusar
    uso = memoria_em_uso_mb() or uso
    if limite - uso < margem:
        raise MemoriaBaixa(f"O servidor está com pouca memória agora ({uso:.0f} de {limite:.0f} MB em uso). "
                           "Espere cerca de 1 minuto e tente de novo.")


_TRAVA_PESADA = threading.RLock()          # RLock: a mesma tarefa pode chamar outra pesada sem travar a si mesma
ESPERA_MAX_PESADA_S = 100


class tarefa_pesada:
    """with tarefa_pesada(): ... — o servidor gratuito tem 512 MB; duas análises ao mesmo tempo estouram a memória.
    A segunda espera a primeira terminar (até ESPERA_MAX_PESADA_S) e só então roda."""

    def __init__(self, espera_s=None):
        self.espera_s = ESPERA_MAX_PESADA_S if espera_s is None else espera_s

    def __enter__(self):
        if not _TRAVA_PESADA.acquire(timeout=self.espera_s):
            raise ServidorOcupado("O servidor está ocupado com outra tarefa pesada. Tente de novo em instantes.")
        try:
            _conferir_memoria()
        except BaseException:
            _TRAVA_PESADA.release()
            raise
        return self

    def __exit__(self, *exc):
        _TRAVA_PESADA.release()
        liberar_memoria()
        return False


# ───────────────────────── espectro em blocos (resultado igual ao da librosa) ─────────────────────────
def _limites_dos_blocos(n_quadros, por_bloco):
    for i in range(0, n_quadros, por_bloco):
        yield i, min(n_quadros, i + por_bloco)


def mel_db_em_blocos(y, sr, n_fft=2048, hop_length=512, bloco_s=10.0):
    """Espectrograma mel em dB, igual ao que librosa.onset.onset_strength(y=...) calcula por dentro,
    mas com o espectro de cada bloco descartado assim que vira mel (o mel é pequeno: 128 × quadros)."""
    y = np.asarray(y, dtype=np.float32)
    n_quadros = 1 + len(y) // hop_length                       # igual ao center=True da librosa
    ypad = np.pad(y, (n_fft // 2, n_fft // 2), mode="constant")
    por_bloco = max(8, int(bloco_s * sr / hop_length))
    partes = []
    for i, j in _limites_dos_blocos(n_quadros, por_bloco):
        seg = ypad[i * hop_length: (j - 1) * hop_length + n_fft]
        partes.append(librosa.feature.melspectrogram(y=seg, sr=sr, n_fft=n_fft, hop_length=hop_length, center=False))
    return librosa.power_to_db(np.concatenate(partes, axis=1))


def envelope_de_onsets(y, sr, hop_length=512):
    """Envelope de ataques (a base de andamento e batidas). Igual a librosa.onset.onset_strength(y=y, sr=sr)."""
    return librosa.onset.onset_strength(S=mel_db_em_blocos(y, sr, hop_length=hop_length), sr=sr, hop_length=hop_length)


def envelopes_de_onsets(y, sr, hop_length=512):
    """(média, mediana): os dois envelopes de ataque que o app usa, calculados a partir do MESMO espectro.
    O beat_track da librosa usa por dentro o de MEDIANA; a estimativa por ataques usa o de MÉDIA."""
    S = mel_db_em_blocos(y, sr, hop_length=hop_length)
    return (librosa.onset.onset_strength(S=S, sr=sr, hop_length=hop_length),
            librosa.onset.onset_strength(S=S, sr=sr, hop_length=hop_length, aggregate=np.median))


def tempograma_em_blocos(onset_envelope, sr, hop_length=512, ac_size=8.0, bloco=600):
    """Tempograma igual ao que a librosa calcula por dentro de tempo()/beat_track(), mas em blocos de colunas.
    A librosa faz a autocorrelação de TODAS as janelas de uma vez (~90 MB de pico para 2 min de áudio); o resultado
    em si é pequeno (344 × quadros), então dá para montá-lo aos poucos."""
    win_length = int(librosa.time_to_frames(ac_size, sr=sr, hop_length=hop_length).item())
    env = np.asarray(onset_envelope)
    n = env.shape[-1]
    padded = np.pad(env, [(int(win_length // 2),) * 2], mode="linear_ramp", end_values=[0, 0])
    janela = librosa.filters.get_window("hann", win_length, fftbins=True)[:, np.newaxis]
    partes = []
    for i, j in _limites_dos_blocos(n, bloco):
        quadros = librosa.util.frame(padded[i: j + win_length - 1], frame_length=win_length, hop_length=1)
        partes.append(librosa.util.normalize(librosa.autocorrelate(quadros * janela, axis=0), norm=np.inf, axis=0))
    return np.concatenate(partes, axis=1)


def _funcao_tempo():
    return getattr(librosa.feature, "tempo", None) or librosa.beat.tempo


def tempo_leve(onset_envelope, sr, hop_length=512, **kw):
    """librosa.feature.tempo(onset_envelope=…, **kw) com o tempograma calculado em blocos (mesmo resultado, bem menos memória)."""
    try:
        tg = tempograma_em_blocos(onset_envelope, sr, hop_length, ac_size=kw.get("ac_size", 8.0))
        return _funcao_tempo()(onset_envelope=onset_envelope, sr=sr, hop_length=hop_length, tg=tg, **kw)
    except TypeError:                                   # versão antiga da librosa, sem o parâmetro tg: faz do jeito normal
        return _funcao_tempo()(onset_envelope=onset_envelope, sr=sr, hop_length=hop_length, **kw)


def chroma_stft_em_blocos(y, sr, n_fft, hop_length, bloco_s=30.0, tuning=0.0):
    """Cromagrama (norm=None), igual a librosa.feature.chroma_stft(y=y, sr=sr, n_fft=..., hop_length=..., tuning=..., norm=None)."""
    y = np.asarray(y, dtype=np.float32)
    n_quadros = 1 + len(y) // hop_length
    ypad = np.pad(y, (n_fft // 2, n_fft // 2), mode="constant")
    por_bloco = max(8, int(bloco_s * sr / hop_length))
    partes = []
    for i, j in _limites_dos_blocos(n_quadros, por_bloco):
        seg = ypad[i * hop_length: (j - 1) * hop_length + n_fft]
        partes.append(librosa.feature.chroma_stft(y=seg, sr=sr, n_fft=n_fft, hop_length=hop_length, center=False, tuning=tuning, norm=None))
    return np.concatenate(partes, axis=1)


def rms_em_blocos(y, frame_length=2048, hop_length=512, bloco_quadros=512):
    """Envelope de volume (RMS), igual a librosa.feature.rms(y=y, frame_length=..., hop_length=...)[0]."""
    y = np.asarray(y, dtype=np.float32)
    pad = frame_length // 2
    ypad = np.pad(y, (pad, pad), mode="constant")
    n_quadros = 1 + (len(ypad) - frame_length) // hop_length
    saida = np.empty(n_quadros, dtype=np.float32)
    for i, j in _limites_dos_blocos(n_quadros, bloco_quadros):
        seg = ypad[i * hop_length: (j - 1) * hop_length + frame_length]
        quadros = librosa.util.frame(seg, frame_length=frame_length, hop_length=hop_length)
        saida[i:j] = np.sqrt(np.mean(np.abs(quadros) ** 2, axis=0))
    return saida
