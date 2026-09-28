# ══════════════════════════════════════════════════════════════
# firebase_config.py — Inicialização do Firebase Admin (Firestore + Storage)
#
# Credenciais: mesma lógica do app.py original —
#   1) variável de ambiente GOOGLE_APPLICATION_CREDENTIALS_JSON (conteúdo JSON completo)
#   2) arquivo local firebase_service_account.json
#
# Bucket do Storage: variável de ambiente FIREBASE_STORAGE_BUCKET.
# Se não for definida, tenta adivinhar como "{project_id}.appspot.com"
# (formato clássico) — projetos criados a partir de meados de 2024 usam
# "{project_id}.firebasestorage.app" e PRECISAM da variável explícita.
# ══════════════════════════════════════════════════════════════
import os
import json

import firebase_admin
from firebase_admin import credentials, firestore, storage

_db = None
_bucket = None
_erro_inicializacao = None


def _carregar_credencial():
    """Devolve (cred, project_id) ou (None, None) se não achar nada configurado."""
    bruto = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS_JSON")
    if bruto:
        info = json.loads(bruto)
        return credentials.Certificate(info), info.get("project_id")

    caminho = "firebase_service_account.json"
    if os.path.exists(caminho):
        with open(caminho, "r", encoding="utf-8") as f:
            info = json.load(f)
        return credentials.Certificate(caminho), info.get("project_id")

    return None, None


def _inicializar():
    global _db, _bucket, _erro_inicializacao
    try:
        if not firebase_admin._apps:
            cred, project_id = _carregar_credencial()
            if cred is None:
                _erro_inicializacao = (
                    "Nenhuma credencial do Firebase encontrada. Defina a variável de "
                    "ambiente GOOGLE_APPLICATION_CREDENTIALS_JSON (conteúdo do JSON da "
                    "service account) ou coloque o arquivo firebase_service_account.json "
                    "na pasta do backend."
                )
                return

            bucket_nome = os.environ.get("FIREBASE_STORAGE_BUCKET") or (
                f"{project_id}.appspot.com" if project_id else None
            )
            firebase_admin.initialize_app(cred, {"storageBucket": bucket_nome} if bucket_nome else None)

        _db = firestore.client()
        try:
            _bucket = storage.bucket()
        except Exception as e:
            _erro_inicializacao = (
                f"Firestore conectou, mas o Storage não: {e}. Confira se você definiu "
                "FIREBASE_STORAGE_BUCKET com o nome exato do bucket (aparece no console "
                "do Firebase, em Storage)."
            )
    except Exception as e:
        _erro_inicializacao = f"Falha ao inicializar o Firebase: {e}"


_inicializar()


def get_db():
    return _db


def get_bucket():
    return _bucket


def get_erro():
    return _erro_inicializacao
