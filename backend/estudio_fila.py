# ══════════════════════════════════════════════════════════════
# estudio_fila.py — "Caixa de correio" entre o app e o separador de stems
# que roda no Google Colab (notebooks/separador_stems.ipynb).
#
# Por que assim: o Demucs não cabe nos 512 MB do plano grátis do Render.
# Em vez de um link/túnel que o usuário precisa copiar e colar, o app deixa o
# áudio no Firebase Storage e cria um "trabalho" no Firestore; o Colab (ligado)
# pega o trabalho, separa, e devolve os stems da mesma forma. O app descobre
# sozinho se o Colab está ligado (batida de coração a cada ~20 s).
#
# Coleções do Firestore:
#   estudio_status/colab   -> {online, atualizado_em, gpu}   (escrito pelo Colab)
#   estudio_jobs/<id>      -> {status, criado_em, entrada_path, voz_path, ...}
# Arquivos no Storage: estudio/<id>/entrada.*, voz.mp3, instrumental.mp3
# ══════════════════════════════════════════════════════════════
import os
import uuid
import importlib.util
from datetime import datetime, timezone, timedelta

from firebase_config import get_db, get_bucket, get_erro

COLECAO_JOBS = "estudio_jobs"
COLECAO_STATUS = "estudio_status"
DOC_STATUS = "colab"

ONLINE_SE_BATIDA_EM_S = 75      # sem sinal do Colab há mais que isso = desligado
JOB_EXPIRA_S = 20 * 60          # trabalho parado há 20 min = desiste
GUARDAR_JOBS_HORAS = 24         # limpeza: apaga trabalhos com mais de 24 h


def _agora():
    return datetime.now(timezone.utc)


def _ler_data(texto):
    try:
        dt = datetime.fromisoformat(texto)
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def modo_separacao():
    """'local' se este servidor tem torch+demucs (ex: rodando no Colab/PC);
    'fila' se não tem (Render grátis) — aí a separação vai pro Colab."""
    if importlib.util.find_spec("torch") and importlib.util.find_spec("demucs"):
        return "local"
    return "fila"


def status_colab():
    """{online: bool, gpu: bool, ...} — lê a batida de coração do Colab."""
    db = get_db()
    if db is None:
        return {"online": False, "motivo": get_erro() or "Firebase não configurado."}
    try:
        doc = db.collection(COLECAO_STATUS).document(DOC_STATUS).get()
        if not doc.exists:
            return {"online": False}
        d = doc.to_dict() or {}
        batida = _ler_data(d.get("atualizado_em") or "")
        if batida is None:
            return {"online": False}
        idade = (_agora() - batida).total_seconds()
        return {
            "online": bool(d.get("online")) and idade <= ONLINE_SE_BATIDA_EM_S,
            "gpu": bool(d.get("gpu")),
            "segundos_desde_a_ultima_batida": int(idade),
        }
    except Exception as e:
        return {"online": False, "motivo": f"{e}"}


def criar_job(arquivo, nome_arquivo, content_type):
    """Sobe o áudio pro Storage (sem carregar tudo na memória) e cria o trabalho.
    `arquivo` é um objeto tipo-arquivo (UploadFile.file). Devolve (job_id, None)
    ou (None, mensagem_de_erro)."""
    db, bucket = get_db(), get_bucket()
    if db is None or bucket is None:
        return None, get_erro() or "Firebase não configurado."

    job_id = uuid.uuid4().hex
    ext = os.path.splitext(nome_arquivo or "")[1] or ".wav"
    caminho = f"estudio/{job_id}/entrada{ext}"
    agora = _agora().isoformat()
    try:
        bucket.blob(caminho).upload_from_file(
            arquivo, rewind=True, content_type=content_type or "application/octet-stream"
        )
        db.collection(COLECAO_JOBS).document(job_id).set({
            "status": "pendente",
            "criado_em": agora,
            "atualizado_em": agora,
            "nome_original": nome_arquivo or "audio",
            "entrada_path": caminho,
        })
    except Exception as e:
        return None, f"Não consegui enviar o áudio pro separador: {e}"

    limpar_antigos()
    return job_id, None


def consultar_job(job_id):
    """Devolve dict com status ('pendente'|'processando'|'pronto'|'erro') ou None."""
    db = get_db()
    if db is None:
        return None
    ref = db.collection(COLECAO_JOBS).document(job_id)
    doc = ref.get()
    if not doc.exists:
        return None
    d = doc.to_dict() or {}
    status = d.get("status", "pendente")

    if status in ("pendente", "processando"):
        criado = _ler_data(d.get("criado_em") or "")
        if criado and (_agora() - criado).total_seconds() > JOB_EXPIRA_S:
            ref.update({"status": "erro", "erro": "O separador demorou demais ou foi desligado."})
            return {"status": "erro", "erro": "O separador demorou demais ou foi desligado."}

    saida = {"status": status}
    if status == "erro":
        saida["erro"] = d.get("erro") or "Falha na separação."
    if status == "pronto":
        saida["bpm"] = d.get("bpm")
        saida["tom"] = d.get("tom")
    if status == "pendente":
        saida["colab_online"] = status_colab().get("online", False)
    return saida


def baixar_stem(job_id, stem):
    """Bytes do MP3 do stem ('voz' ou 'instrumental'), ou None."""
    db, bucket = get_db(), get_bucket()
    if db is None or bucket is None or stem not in ("voz", "instrumental"):
        return None
    doc = db.collection(COLECAO_JOBS).document(job_id).get()
    if not doc.exists:
        return None
    caminho = (doc.to_dict() or {}).get("voz_path" if stem == "voz" else "inst_path")
    if not caminho:
        return None
    return bucket.blob(caminho).download_as_bytes()


def apagar_job(job_id):
    """Apaga os arquivos e o registro do trabalho (o app chama depois de baixar)."""
    db, bucket = get_db(), get_bucket()
    if db is None or bucket is None:
        return False
    try:
        for blob in list(bucket.list_blobs(prefix=f"estudio/{job_id}/")):
            blob.delete()
        db.collection(COLECAO_JOBS).document(job_id).delete()
        return True
    except Exception:
        return False


def limpar_antigos(max_apagar=5):
    """Faxina oportunista: apaga trabalhos com mais de 24 h (nunca quebra o fluxo)."""
    db = get_db()
    if db is None:
        return
    try:
        corte = (_agora() - timedelta(hours=GUARDAR_JOBS_HORAS)).isoformat()
        for doc in list(db.collection(COLECAO_JOBS).where("criado_em", "<", corte).limit(max_apagar).stream()):
            apagar_job(doc.id)
    except Exception:
        pass
