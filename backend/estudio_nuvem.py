"""Salvamento manual de projetos editáveis no Storage do Firebase."""

import json
import os
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Request
from fastapi.responses import StreamingResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from firebase_admin import auth
from google.api_core.exceptions import NotFound, PreconditionFailed
from pydantic import BaseModel, Field

import firebase_config

router = APIRouter(prefix="/api/estudio/projetos-nuvem")
bearer = HTTPBearer(auto_error=False)
MIME = "application/zip"
LIMITE = 256 * 1024 * 1024
BLOCO = 4 * 1024 * 1024
ProjetoId = Annotated[str, Path(pattern=r"^[a-zA-Z0-9_-]{1,80}$")]


class UploadProjeto(BaseModel):
    nome: str = Field(min_length=1, max_length=140)
    tamanho: int = Field(gt=0, le=LIMITE)
    geracao: str = Field(default="0", pattern=r"^[0-9]{1,20}$")


def _configuracao():
    try:
        config = json.loads(os.getenv("ESTUDIO_FIREBASE_WEB_CONFIG", "{}"))
    except ValueError:
        config = None
    campos = ("apiKey", "authDomain", "projectId", "appId")
    dono = os.getenv("ESTUDIO_NUVEM_EMAIL", "").strip().casefold()
    if not dono or not isinstance(config, dict) or not all(
        isinstance(config.get(chave), str) and config[chave].strip() for chave in campos
    ):
        raise HTTPException(503, "Configure o Firebase Authentication e o e-mail dono dos projetos no servidor.")
    return {chave: config[chave] for chave in campos}, dono


@router.get("/config")
def configuracao_web():
    config, _ = _configuracao()
    return {"firebase": config, "limite": LIMITE}


def _dono(credencial: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)]):
    _, email = _configuracao()
    if not credencial:
        raise HTTPException(401, "Entre com sua conta Google para acessar os projetos na nuvem.")
    try:
        identidade = auth.verify_id_token(credencial.credentials)
    except auth.CertificateFetchError as erro:
        raise HTTPException(503, "Não consegui validar o login com o Firebase agora.") from erro
    except (ValueError, auth.InvalidIdTokenError) as erro:
        raise HTTPException(401, "Sua sessão expirou ou é inválida. Entre novamente.") from erro
    if (
        identidade.get("email_verified") is not True
        or (identidade.get("email") or "").casefold() != email
        or identidade.get("firebase", {}).get("sign_in_provider") != "google.com"
    ):
        raise HTTPException(403, "Esta conta Google não tem acesso aos projetos do Studio.")
    return identidade["uid"]


def _bucket():
    bucket = firebase_config.get_bucket()
    if bucket is None:
        raise HTTPException(503, "O Firebase Storage do Orange Harmony ainda não está disponível.")
    return bucket


def _prefixo(uid):
    return f"estudio-projetos/{uid}/"


@router.get("")
def listar(uid: Annotated[str, Depends(_dono)]):
    prefixo = _prefixo(uid)
    projetos = [
        {
            "id": blob.name[len(prefixo):-len(".ohstudio")],
            "nome": (blob.metadata or {}).get("nome", "Projeto"),
            "geracao": str(blob.generation),
            "atualizado": blob.updated,
            "tamanho": blob.size,
        }
        for blob in _bucket().list_blobs(prefix=prefixo, delimiter="/", timeout=20)
        if blob.name.endswith(".ohstudio")
    ]
    return {"projetos": sorted(projetos, key=lambda p: p["atualizado"], reverse=True)}


@router.post("/{projeto_id}/envio")
def preparar_envio(
    projeto_id: ProjetoId,
    dados: UploadProjeto,
    request: Request,
    uid: Annotated[str, Depends(_dono)],
):
    blob = _bucket().blob(f"{_prefixo(uid)}{projeto_id}.ohstudio")
    blob.metadata = {"nome": dados.nome.strip() or "Meu projeto"}
    blob.cache_control = "private, no-store"
    origem = request.headers.get("origin")
    if not origem:
        raise HTTPException(400, "Abra o Studio no navegador para salvar na nuvem.")
    try:
        url = blob.create_resumable_upload_session(
            content_type=MIME,
            size=dados.tamanho,
            origin=origem,
            if_generation_match=int(dados.geracao),
            timeout=20,
        )
    except PreconditionFailed as erro:
        raise HTTPException(409, "Há uma versão mais recente na nuvem. Abra essa versão antes de salvar por cima.") from erro
    return {"url": url}


@router.get("/{projeto_id}/arquivo")
def baixar(
    projeto_id: ProjetoId,
    uid: Annotated[str, Depends(_dono)],
):
    try:
        blob = _bucket().blob(f"{_prefixo(uid)}{projeto_id}.ohstudio")
        blob.reload(timeout=20)
    except NotFound as erro:
        raise HTTPException(404, "Este projeto não foi encontrado na nuvem.") from erro
    if not blob.size or blob.size > LIMITE:
        raise HTTPException(422, "O arquivo salvo na nuvem está vazio ou excede o limite do Studio.")

    def ler():
        # O reload fixa a geração para a leitura inteira, mesmo durante outro salvamento.
        with blob.open("rb", chunk_size=BLOCO, timeout=30) as arquivo:
            while bloco := arquivo.read(BLOCO):
                yield bloco

    return StreamingResponse(ler(), media_type=MIME, headers={
        "Cache-Control": "private, no-store",
        "X-Projeto-Geracao": str(blob.generation),
        "X-Projeto-Tamanho": str(blob.size),
    })
