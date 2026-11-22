# ══════════════════════════════════════════════════════════════
# separador_worker.py — roda DENTRO do Google Colab (notebook separador_stems).
# Fica em laço: avisa que está online (batida de coração), procura trabalhos
# "pendente" no Firestore, baixa o áudio do Storage, separa com o Demucs,
# converte os stems pra MP3 (leve) e devolve. O app (Render) só lê o resultado.
# Toda a lógica recebe db/bucket/funções por parâmetro pra poder ser testada
# sem Firebase de verdade.
# ══════════════════════════════════════════════════════════════
import io
import time
from datetime import datetime, timezone

COLECAO_JOBS = "estudio_jobs"
COLECAO_STATUS = "estudio_status"
DOC_STATUS = "colab"


def _agora():
    return datetime.now(timezone.utc).isoformat()


def wav_para_mp3(wav_bytes, kbps=192):
    """WAV (16/32 bits, mono/estéreo) -> MP3. Os stems em WAV pesam ~30 MB por
    música; em MP3 ficam em ~4 MB, o que importa pra subir/baixar rápido."""
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


def bater_coracao(db, online=True, gpu=False, completo=False, backing=False):
    # `completo` avisa o app que este notebook já sabe separar em 6 faixas
    db.collection(COLECAO_STATUS).document(DOC_STATUS).set(
        {"online": bool(online), "atualizado_em": _agora(), "gpu": bool(gpu), "completo": bool(completo), "backing": bool(backing)}
    )


def processar_um_job(db, bucket, separar_fn, analisar_fn=None, log=print, separar_completo_fn=None, separar_backing_fn=None):
    """Pega UM trabalho pendente e processa. Devolve True se havia trabalho."""
    achados = list(db.collection(COLECAO_JOBS).where("status", "==", "pendente").limit(1).stream())
    if not achados:
        return False

    job_id = achados[0].id
    dados_job = achados[0].to_dict() or {}
    ref = db.collection(COLECAO_JOBS).document(job_id)
    nome = dados_job.get("nome_original") or "audio.wav"
    modo = dados_job.get("modo") or "rapido"
    log(f"▶ Trabalho {job_id[:8]}… ({nome}) — separando ({modo})…")
    inicio = time.time()

    ref.update({"status": "processando", "atualizado_em": _agora()})
    try:
        entrada = bucket.blob(dados_job["entrada_path"]).download_as_bytes()
        separador = {"completo": separar_completo_fn, "backing": separar_backing_fn}.get(modo)
        if modo == "backing" and separador is None:
            raise RuntimeError("O modelo de backing vocal não está disponível no Colab.")
        if separador is not None:
            fontes, erro = separador(entrada, nome)
            if erro:
                raise RuntimeError(erro)
            caminhos = {}
            for chave, wav in fontes.items():
                caminho = f"estudio/{job_id}/{chave}.mp3"
                bucket.blob(caminho).upload_from_string(wav_para_mp3(wav), content_type="audio/mpeg")
                caminhos[chave] = caminho
            extra = {"modo": modo, "stems": list(caminhos.keys()), "stems_paths": caminhos}
        else:
            voz_wav, inst_wav, erro = separar_fn(entrada, nome)
            if erro:
                raise RuntimeError(erro)

            voz_mp3 = wav_para_mp3(voz_wav)
            inst_mp3 = wav_para_mp3(inst_wav)
            caminho_voz = f"estudio/{job_id}/voz.mp3"
            caminho_inst = f"estudio/{job_id}/instrumental.mp3"
            bucket.blob(caminho_voz).upload_from_string(voz_mp3, content_type="audio/mpeg")
            bucket.blob(caminho_inst).upload_from_string(inst_mp3, content_type="audio/mpeg")
            extra = {"modo": "rapido", "voz_path": caminho_voz, "inst_path": caminho_inst}

        bpm = tom = None
        if analisar_fn is not None:
            try:
                bpm, tom = analisar_fn(entrada, nome)
            except Exception:
                pass  # BPM/tom são só um extra — nunca derrubam a separação

        ref.update({
            "status": "pronto", "atualizado_em": _agora(), **extra,
            "bpm": bpm, "tom": tom,
        })
        log(f"✅ Pronto em {time.time() - inicio:.0f} s")
    except Exception as e:
        ref.update({"status": "erro", "erro": str(e)[:300], "atualizado_em": _agora()})
        log(f"❌ Falhou: {e}")
    return True


def rodar(db, bucket, separar_fn, analisar_fn=None, gpu=False,
          intervalo_s=4, batida_s=20, log=print, parar=lambda: False, separar_completo_fn=None, separar_backing_fn=None):
    """Laço principal. `parar` existe só pra testes."""
    log("🟢 Separador ligado. Deixe esta célula rodando e volte ao Orange Harmony.")
    ultima_batida = 0.0
    try:
        while not parar():
            if time.time() - ultima_batida >= batida_s:
                bater_coracao(db, True, gpu, separar_completo_fn is not None, separar_backing_fn is not None)
                ultima_batida = time.time()
            try:
                if processar_um_job(db, bucket, separar_fn, analisar_fn, log, separar_completo_fn, separar_backing_fn):
                    ultima_batida = 0.0      # avisa "online" logo depois de um trabalho longo
                    continue
            except Exception as e:
                log(f"⚠️ Erro ao consultar a fila (tento de novo): {e}")
            time.sleep(intervalo_s)
    finally:
        try:
            bater_coracao(db, False, gpu)
            log("⚪ Separador desligado.")
        except Exception:
            pass
