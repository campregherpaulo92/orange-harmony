# ══════════════════════════════════════════════════════════════
# main.py — Orange Harmony API (FastAPI)
# Fase 1: só a Análise Vocal, pra validar o pipeline upload -> análise -> JSON.
# Rodar localmente: uvicorn main:app --reload --port 8000
# ══════════════════════════════════════════════════════════════
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import Response, JSONResponse
import os
import time
import threading
from contextlib import asynccontextmanager

from audio_analysis import analisar_audio_completo, carregar_audio_bytes, detectar_bpm_e_beats, detectar_tom, liberar_memoria
import audio_analysis
import gravacoes
import historico
import composicoes
import producao_dsp
import edicao_dsp
import converter_audio
import avaliacao
import gemini_client
import professor
import laranjinha
import estudio_agente
import stems
import estudio_fila
import acordes
import escalas
from urllib.parse import quote

import news
import ritmos
import harmonia
import producao_ritmos
import singergame
import chats
import songwriter

@asynccontextmanager
async def _ciclo_de_vida(_app):
    """Aquecimento das bibliotecas de áudio — só no Render, e só DEPOIS que o
    servidor já está no ar (rodar isso durante a inicialização disputava a CPU
    de 0.1 vCPU com o próprio boot e atrasava a detecção da porta pelo Render)."""
    if os.environ.get("RENDER") or os.environ.get("AQUECER_LIBS"):
        def _aquecer():
            time.sleep(20)
            audio_analysis.aquecer_bibliotecas()
        threading.Thread(target=_aquecer, daemon=True).start()
    yield


app = FastAPI(title="Orange Harmony API", version="0.1.0", lifespan=_ciclo_de_vida)


@app.exception_handler(Exception)
async def _erro_inesperado(request, exc):
    """Qualquer erro não tratado vira JSON legível (antes virava texto puro
    'Internal Server Error', e o navegador mostrava um erro confuso de JSON)."""
    return JSONResponse(
        status_code=500,
        content={"detail": f"Erro interno do servidor ({type(exc).__name__}). Tente de novo."},
    )

# CORS liberado para desenvolvimento local (ajustar para o domínio real em produção)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health():
    """Checagem simples de que a API está de pé."""
    return {"status": "ok", "service": "orange-harmony-api"}


@app.post("/api/analyze")
def analisar(
    arquivo: UploadFile = File(...),
    modo: str = Form("completa"),
    calibracao: float = Form(440.0),
    nota_ref: str = Form(None),
    base_devolutiva: str = Form("detectada"),
    escala_tonica: str = Form(None),
    escala_tipo: str = Form(None),
):
    """Recebe um áudio (multipart/form-data) e devolve a análise numérica em
    JSON — RÁPIDO de propósito (não chama o Gemini aqui). A devolutiva do
    professor é gerada numa segunda chamada, separada (/api/analyze/devolutiva),
    porque a soma "análise de áudio + chamada de IA" numa CPU limitada (plano
    grátis de hospedagem) corria risco real de exceder o tempo limite da
    conexão e cortar a resposta no meio (erro de JSON incompleto no navegador).
    """
    dados = arquivo.file.read()
    resultado = analisar_audio_completo(
        dados=dados,
        nome_arquivo=arquivo.filename or "audio.wav",
        modo=modo,
        calibracao=calibracao,
        # a nota de referência só serve de régua quando o aluno escolheu "Nota de referência";
        # com "Nota detectada" cada nota é medida contra ela mesma (antes a referência valia sempre)
        nota_ref=nota_ref if base_devolutiva == "referencia" else None,
        escala={"tonica": escala_tonica, "tipo": escala_tipo} if escala_tonica and escala_tipo else None,
    )

    historico_id = None
    if modo == "completa" and "erro" not in resultado:
        try:
            historico_id = historico.registrar_analise(
                resultado["resultado"], modo="completa", tom_ref=nota_ref, devolutiva=None,
                escala=resultado.get("avaliacao_escala"),
            )
        except Exception:
            pass

    resultado["historico_id"] = historico_id
    return resultado


@app.post("/api/analyze/devolutiva")
def gerar_devolutiva_rota(
    resultado: str = Form(...),
    nota_ref: str = Form(None),
    base_devolutiva: str = Form("detectada"),
    sequencia_notas: str = Form(None),
    historico_id: str = Form(None),
    escala: str = Form(None),
):
    """Segunda etapa da análise: gera a devolutiva do professor IA (chamada
    ao Gemini) separada da análise numérica, e atualiza o registro do
    histórico já salvo com o texto, se um historico_id foi passado."""
    import json as _json
    resultado_dict = _json.loads(resultado)
    sequencia_dict = _json.loads(sequencia_notas) if sequencia_notas else None
    escala_dict = _json.loads(escala) if escala else None

    devolutiva, erro = professor.gerar_devolutiva(
        resultado_dict, nota_ref=nota_ref, base_devolutiva=base_devolutiva,
        sequencia_notas=sequencia_dict, escala=escala_dict,
    )

    if devolutiva and historico_id:
        try:
            historico.atualizar_devolutiva(historico_id, devolutiva)
        except Exception:
            pass

    return {"devolutiva": devolutiva, "erro": erro}


# ══════════════════════════════════════════════════════════════
# LARANJINHA (assistente com leitura + ação sobre a plataforma inteira)
# ══════════════════════════════════════════════════════════════
@app.get("/api/laranjinha/chats")
def listar_chats_rota():
    return {"chats": chats.listar_chats()}


@app.post("/api/laranjinha/chats")
def criar_chat_rota(nome: str = Form("Nova conversa")):
    chat_id, erro = chats.criar_chat(nome)
    if erro:
        raise HTTPException(status_code=502, detail=erro)
    return {"id": chat_id}


@app.put("/api/laranjinha/chats/{chat_id}")
def renomear_chat_rota(chat_id: str, novo_nome: str = Form(...)):
    ok = chats.renomear_chat(chat_id, novo_nome)
    if not ok:
        raise HTTPException(status_code=404, detail="Conversa não encontrada.")
    return {"renomeado": True}


@app.delete("/api/laranjinha/chats/{chat_id}")
def excluir_chat_rota(chat_id: str):
    ok = chats.excluir_chat(chat_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Conversa não encontrada.")
    return {"excluido": True}


@app.get("/api/laranjinha/chats/{chat_id}/mensagens")
def carregar_mensagens_rota(chat_id: str):
    return {"mensagens": chats.carregar_mensagens(chat_id)}


@app.post("/api/laranjinha/mensagem")
def laranjinha_mensagem_rota(mensagem: str = Form(...), chat_id: str = Form(None)):
    """Rota síncrona: a chamada ao Gemini (com function calling, potencialmente
    várias idas e vindas) é bloqueante — como rota 'def' comum, roda numa
    threadpool à parte, sem travar o resto do app."""
    resposta = laranjinha.conversar(mensagem, chat_id)
    return {"resposta": resposta}


# ══════════════════════════════════════════════════════════════
# ORANGE STUDIO (separação de stems + agente embutido de limpeza)
# ══════════════════════════════════════════════════════════════
@app.post("/api/estudio/separar")
def separar_stems_rota(arquivo: UploadFile = File(...)):
    """Rota síncrona (não async) de propósito: a separação com Demucs é uma
    operação pesada e bloqueante (import de torch + inferência em CPU).
    O FastAPI roda rotas 'def' comuns numa threadpool à parte, então isso
    não trava o loop de eventos e o resto do app continua respondendo
    normalmente enquanto a separação roda."""
    dados = arquivo.file.read()
    voz_bytes, inst_bytes, erro = stems.separar(dados, arquivo.filename or "audio.wav")
    if erro:
        raise HTTPException(status_code=400, detail=erro)
    import base64

    bpm = tom = None
    try:
        audio, sr = carregar_audio_bytes(dados, arquivo.filename or "audio.wav")
        if audio is not None:
            bpm, _ = detectar_bpm_e_beats(audio, sr)
            tom = detectar_tom(audio, sr)
    except Exception:
        pass

    return {
        "voz_base64": base64.b64encode(voz_bytes).decode("ascii"),
        "instrumental_base64": base64.b64encode(inst_bytes).decode("ascii"),
        "bpm": round(bpm, 1) if bpm else None,
        "tom": tom,
    }


# ══════════════════════════════════════════════════════════════
# ACORDES (braço do violão: identificar, procurar por nome, onde se encaixa)
# ══════════════════════════════════════════════════════════════
@app.post("/api/acordes/identificar")
def acordes_identificar(cordas: str = Form(...)):
    """cordas: '-1,3,2,0,1,0' (da corda mais grave à mais aguda; -1 = muda, 0 = solta, n = casa).
    Problemas de digitação voltam como {"erro": ...} (status 200) — a tela mostra como dica."""
    try:
        lista = [int(x) for x in cordas.split(",")]
    except Exception:
        return {"erro": "Formato inválido. Envie 6 números separados por vírgula."}
    return acordes.identificar(lista)


@app.post("/api/acordes/procurar")
def acordes_procurar(nome: str = Form(...)):
    return acordes.procurar(nome)


# ══════════════════════════════════════════════════════════════
# SINGERGAME (jogo de afinação: a bolinha atravessa o anel certo)
# ══════════════════════════════════════════════════════════════
@app.post("/api/singergame/pontuacao")
def singergame_salvar(modo: str = Form(...), dificuldade: str = Form(...), pontos: int = Form(...),
                       acertos: int = Form(...), total: int = Form(...), combo_maximo: int = Form(...),
                       escala_nome: str = Form(None)):
    recorde, bateu = singergame.salvar_pontuacao(modo, dificuldade, pontos, acertos, total, combo_maximo, escala_nome)
    if recorde is None:
        raise HTTPException(status_code=400, detail="Modo inválido.")
    return {"recorde": recorde, "bateu_recorde": bateu}


@app.get("/api/singergame/recordes")
def singergame_recordes():
    return {"recordes": singergame.listar_recordes()}


# ══════════════════════════════════════════════════════════════
# ORANGE NEWS (jornal do app: dicas escritas + notícias de fora)
# ══════════════════════════════════════════════════════════════
@app.get("/api/news/edicao")
def news_edicao():
    """Edição escrita do dia (instantânea; não depende de internet nem de IA)."""
    return news.edicao_do_dia()


@app.get("/api/news/noticias")
def news_noticias(atualizar: bool = False):
    """Notícias de fora, filtradas e resumidas em português (com cache de 6 h)."""
    return news.obter_noticias(forcar=atualizar)


# ══════════════════════════════════════════════════════════════
# ESCALAS (treino: notas, graus, acordes da escala)
# ══════════════════════════════════════════════════════════════
@app.get("/api/escalas/tipos")
def escalas_tipos():
    return {"tipos": escalas.tipos_disponiveis()}


@app.post("/api/escalas/descrever")
def escalas_descrever(tonica: str = Form(...), tipo: str = Form(...)):
    return escalas.descrever(tonica, tipo)


# ── Separação de stems via Colab (fila no Firebase) ──
# Link do notebook no Colab (abre direto do GitHub). Dá pra trocar pela variável
# de ambiente COLAB_SEPARADOR_URL no Render, se você mover o notebook de lugar.
COLAB_SEPARADOR_URL = os.environ.get(
    "COLAB_SEPARADOR_URL",
    "https://colab.research.google.com/github/campregherpaulo92/orange-harmony/blob/main/notebooks/separador_stems.ipynb",
)


@app.get("/api/estudio/config")
def estudio_config():
    """Diz ao front-end COMO separar: 'local' (este servidor tem Demucs) ou
    'fila' (manda pro Colab), e se o Colab está ligado agora."""
    modo = estudio_fila.modo_separacao()
    resp = {"modo": modo, "colab_url": COLAB_SEPARADOR_URL}
    if modo == "fila":
        resp["colab"] = estudio_fila.status_colab()
    return resp


@app.post("/api/estudio/fila")
def estudio_fila_criar(arquivo: UploadFile = File(...)):
    if not estudio_fila.status_colab().get("online"):
        raise HTTPException(
            status_code=409,
            detail="O separador do Colab está desligado. Abra o notebook no Colab e execute-o.",
        )
    job_id, erro = estudio_fila.criar_job(arquivo.file, arquivo.filename, arquivo.content_type)
    if erro:
        raise HTTPException(status_code=502, detail=erro)
    return {"job_id": job_id}


@app.get("/api/estudio/fila/{job_id}")
def estudio_fila_status(job_id: str):
    info = estudio_fila.consultar_job(job_id)
    if info is None:
        raise HTTPException(status_code=404, detail="Trabalho não encontrado (talvez já tenha sido apagado).")
    return info


@app.get("/api/estudio/fila/{job_id}/{stem}")
def estudio_fila_baixar(job_id: str, stem: str):
    dados = estudio_fila.baixar_stem(job_id, stem)
    if dados is None:
        raise HTTPException(status_code=404, detail="Stem não encontrado.")
    return Response(content=dados, media_type="audio/mpeg")


@app.delete("/api/estudio/fila/{job_id}")
def estudio_fila_apagar(job_id: str):
    return {"apagado": estudio_fila.apagar_job(job_id)}


@app.post("/api/estudio/comando")
def estudio_comando_rota(
    mensagem: str = Form(...),
    faixa: str = Form(""),
    arquivo: UploadFile = File(None),
):
    dados = arquivo.file.read() if arquivo is not None else None
    resultado = estudio_agente.processar_comando(mensagem, faixa, dados)
    return resultado


# ══════════════════════════════════════════════════════════════
# GRAVAÇÕES (Firebase Storage + Firestore)
# ══════════════════════════════════════════════════════════════
@app.post("/api/gravacoes")
def criar_gravacao(nome: str = Form(...), arquivo: UploadFile = File(...)):
    """Salva uma gravação: sobe o áudio para o Storage e indexa no Firestore."""
    dados = arquivo.file.read()
    if not dados:
        raise HTTPException(status_code=400, detail="Arquivo de áudio vazio.")

    doc_id, erro = gravacoes.salvar_gravacao(
        nome=nome,
        dados=dados,
        nome_arquivo_original=arquivo.filename or "gravacao.webm",
        content_type=arquivo.content_type,
    )
    if erro:
        raise HTTPException(status_code=502, detail=erro)
    return {"id": doc_id, "nome": nome}


@app.get("/api/gravacoes")
def listar_gravacoes_rota():
    """Lista as gravações salvas (sem o áudio em si — só o índice)."""
    return {"gravacoes": gravacoes.listar_gravacoes()}


@app.get("/api/gravacoes/{doc_id}")
def baixar_gravacao_rota(doc_id: str):
    """Devolve o áudio de uma gravação (para tocar no <audio> ou baixar)."""
    conteudo, content_type, nome = gravacoes.baixar_gravacao(doc_id)
    if conteudo is None:
        raise HTTPException(status_code=404, detail="Gravação não encontrada.")
    return Response(content=conteudo, media_type=content_type)


@app.delete("/api/gravacoes/{doc_id}")
def excluir_gravacao_rota(doc_id: str):
    """Exclui uma gravação (Storage + índice no Firestore)."""
    ok = gravacoes.excluir_gravacao(doc_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Gravação não encontrada.")
    return {"excluido": True}


@app.put("/api/gravacoes/{doc_id}")
def renomear_gravacao_rota(doc_id: str, novo_nome: str = Form(...)):
    """Renomeia uma gravação salva."""
    ok = gravacoes.renomear_gravacao(doc_id, novo_nome)
    if not ok:
        raise HTTPException(status_code=404, detail="Gravação não encontrada.")
    return {"renomeado": True}


# ══════════════════════════════════════════════════════════════
# AVALIAÇÃO VOCAL INICIAL
# ══════════════════════════════════════════════════════════════
@app.post("/api/avaliacao/exercicio")
def analisar_exercicio_rota(arquivo: UploadFile = File(...)):
    dados = arquivo.file.read()
    resultado = avaliacao.analisar_exercicio(dados, arquivo.filename or "audio.wav")
    if resultado is None:
        raise HTTPException(status_code=400, detail="Não detectei voz. Tente de novo, mais perto do microfone.")
    return resultado


@app.post("/api/avaliacao/gerar")
def gerar_avaliacao_rota(voz_tipo: str = Form(...), resultados: str = Form(...)):
    import json as _json
    try:
        lista = _json.loads(resultados)
    except Exception:
        raise HTTPException(status_code=400, detail="Dados de exercícios inválidos.")
    if len(lista) < 3:
        raise HTTPException(status_code=400, detail="Grave pelo menos 3 exercícios antes de gerar a avaliação.")
    perfil = avaliacao.gerar_perfil(voz_tipo, lista)
    salvo = avaliacao.salvar_perfil(perfil)
    if not salvo:
        raise HTTPException(status_code=502, detail="Não foi possível salvar o perfil (Firebase não configurado).")
    return perfil


@app.get("/api/avaliacao/perfil")
def carregar_perfil_rota():
    perfil = avaliacao.carregar_perfil()
    return perfil or {}


# ══════════════════════════════════════════════════════════════
# HISTÓRICO
# ══════════════════════════════════════════════════════════════
@app.get("/api/historico")
def listar_historico_rota():
    return {"historico": historico.listar_historico()}


@app.put("/api/historico/{doc_id}")
def renomear_historico_rota(doc_id: str, novo_nome: str = Form(...)):
    ok = historico.renomear_analise(doc_id, novo_nome)
    if not ok:
        raise HTTPException(status_code=404, detail="Análise não encontrada.")
    return {"renomeado": True}


@app.delete("/api/historico/{doc_id}")
def excluir_historico_rota(doc_id: str):
    ok = historico.excluir_analise(doc_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Análise não encontrada.")
    return {"excluido": True}


# ══════════════════════════════════════════════════════════════
# COMPOSIÇÕES
# ══════════════════════════════════════════════════════════════
@app.post("/api/composicoes")
def criar_composicao_rota(titulo: str = Form(...), tom: str = Form(""), letra: str = Form(...)):
    doc_id, erro = composicoes.salvar_composicao(titulo, tom, letra)
    if erro:
        codigo = 400 if "Digite" in erro else 502
        raise HTTPException(status_code=codigo, detail=erro)
    return {"id": doc_id}


@app.get("/api/composicoes")
def listar_composicoes_rota():
    return {"composicoes": composicoes.listar_composicoes()}


@app.get("/api/composicoes/{doc_id}")
def carregar_composicao_rota(doc_id: str):
    dados = composicoes.carregar_composicao(doc_id)
    if dados is None:
        raise HTTPException(status_code=404, detail="Composição não encontrada.")
    return dados


@app.delete("/api/composicoes/{doc_id}")
def excluir_composicao_rota(doc_id: str):
    ok = composicoes.excluir_composicao(doc_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Composição não encontrada.")
    return {"excluido": True}


# ══════════════════════════════════════════════════════════════
# CONVERSOR
# ══════════════════════════════════════════════════════════════
@app.post("/api/converter")
def converter_rota(arquivo: UploadFile = File(...), formato: str = Form(...)):
    dados = arquivo.file.read()
    audio, sr = carregar_audio_bytes(dados, arquivo.filename or "audio.wav")
    if audio is None:
        raise HTTPException(status_code=400, detail="Não foi possível ler o áudio. Tente outro formato.")
    try:
        saida, content_type, nome_saida = converter_audio.converter(audio, sr, formato)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    return Response(
        content=saida,
        media_type=content_type,
        headers={"Content-Disposition": f'attachment; filename="{nome_saida}"'},
    )


def _limitar_duracao(audio, sr, max_s=120):
    return audio_analysis.limitar_duracao(audio, sr, max_s)


# ══════════════════════════════════════════════════════════════
# PRODUÇÃO (backing track: baixo, bateria, acordes, teclado, solo)
# ══════════════════════════════════════════════════════════════
@app.post("/api/producao")
def gerar_producao_rota(
    arquivo: UploadFile = File(...),
    estilo: str = Form("Pop"),
    com_baixo: bool = Form(True),
    com_bateria: bool = Form(True),
    com_acordes: bool = Form(True),
    com_teclado: bool = Form(False),
    com_solo: bool = Form(False),
    qualidade_pro: bool = Form(True),
    acordes_modo: str = Form("melodia"),
    bpm_manual: float = Form(0.0),
):
    estilo = ritmos.nome_canonico(estilo)           # estilo desconhecido cai em Pop (e o cabeçalho X-Estilo avisa qual foi usado)
    dados = arquivo.file.read()
    audio, sr = carregar_audio_bytes(dados, arquivo.filename or "audio.wav")
    del dados                       # solta os bytes do upload (até ~16 MB)
    if audio is None:
        raise HTTPException(status_code=400, detail="Não foi possível ler o áudio. Tente outro formato.")
    audio, aviso = _limitar_duracao(audio, sr)

    bpm, beat_times = detectar_bpm_e_beats(audio, sr, bpm_manual if 40 <= bpm_manual <= 220 else None)
    # Harmonia: "melodia" = os acordes seguem as notas que você cantou/tocou; "estilo" = sequência fixa do estilo
    info = harmonia.preparar(audio, sr, estilo, bpm, beat_times, acordes_modo if acordes_modo in ("melodia", "estilo") else "melodia")
    tom, harm = info["tom"], info["harmonia"]

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
                trilha = producao_dsp.aplicar_ducking(trilha, audio, sr, intensidade=ducking)
            producao_ritmos.somar_nivelado(mix, trilha, ref, nome_camada, estilo)
            del trilha
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao gerar produção: {e}")

    mix = producao_dsp.finalizar_mix(producao_ritmos.limitar(mix))
    if qualidade_pro:
        mix = producao_dsp.aplicar_reverb(mix, sr, quantidade=0.08)

    wav_bytes = converter_audio.audio_para_wav_bytes(mix, sr)
    del mix, audio
    liberar_memoria()
    cabecalhos = {
        "X-BPM": f"{bpm:.1f}",
        "X-Tom": info["tom_detectado"],
        "X-Modo": info["modo_detectado"],
        "X-Estilo": quote(estilo),
        "X-Acordes": quote(" – ".join(info["acordes"])),         # acordes escolhidos a partir da sua melodia (vazio na sequência fixa)
        "Access-Control-Expose-Headers": "X-BPM, X-Tom, X-Modo, X-Aviso, X-Estilo, X-Acordes",
    }
    if aviso:
        cabecalhos["X-Aviso"] = aviso
    return Response(content=wav_bytes, media_type="audio/wav", headers=cabecalhos)


@app.get("/api/estilos")
def listar_estilos():
    """Catálogo de estilos (agrupado) — única fonte da lista usada pela Produção e pelo Songwriter."""
    return {"grupos": ritmos.lista_agrupada()}


@app.post("/api/producao/interpretar")
def interpretar_producao_rota(descricao: str = Form(...)):
    """Interpreta uma descrição em português e sugere os parâmetros de produção
    (estilo, quais instrumentos incluir) — o front-end usa isso pra pré-marcar
    as opções antes do usuário confirmar e gerar de verdade."""
    parametros = laranjinha.interpretar_comando_producao(descricao)
    return parametros


# ══════════════════════════════════════════════════════════════
# EDIÇÃO VOCAL (efeitos manuais — interpretação por IA entra na fase final)
# ══════════════════════════════════════════════════════════════
@app.post("/api/edicao")
def aplicar_edicao_rota(
    arquivo: UploadFile = File(...),
    reduzir_ruido: bool = Form(False),
    normalizar: bool = Form(False),
    ajustar_tom: float = Form(0.0),
    eq_presenca: bool = Form(False),
    compressao: bool = Form(False),
    remover_sibilancia: bool = Form(False),
    reverb_leve: bool = Form(False),
):
    dados = arquivo.file.read()
    audio, sr = carregar_audio_bytes(dados, arquivo.filename or "audio.wav")
    if audio is None:
        raise HTTPException(status_code=400, detail="Não foi possível ler o áudio. Tente outro formato.")
    audio, aviso = _limitar_duracao(audio, sr)
    del dados

    audio_editado, acoes = edicao_dsp.aplicar_efeitos(
        audio, sr, reduzir_ruido, normalizar, ajustar_tom,
        eq_presenca, compressao, remover_sibilancia, reverb_leve,
    )
    wav_bytes = converter_audio.audio_para_wav_bytes(audio_editado, sr)
    del audio, audio_editado
    liberar_memoria()
    cabecalhos = {"X-Acoes": ", ".join(acoes), "Access-Control-Expose-Headers": "X-Acoes, X-Aviso"}
    if aviso:
        cabecalhos["X-Aviso"] = aviso
    return Response(content=wav_bytes, media_type="audio/wav", headers=cabecalhos)


@app.post("/api/edicao/comando")
def aplicar_edicao_por_comando_rota(arquivo: UploadFile = File(...), comando: str = Form(...)):
    """Aplica edição vocal interpretando um comando em português (ex: 'limpa o
    ruído e deixa mais grave') — a mesma IA usada pelo agente do Estúdio, agora
    disponível direto na aba de Edição Vocal, sem precisar abrir o Estúdio."""
    dados = arquivo.file.read()
    audio, sr = carregar_audio_bytes(dados, arquivo.filename or "audio.wav")
    if audio is None:
        raise HTTPException(status_code=400, detail="Não foi possível ler o áudio. Tente outro formato.")
    audio, aviso = _limitar_duracao(audio, sr)
    del dados

    flags = laranjinha.interpretar_comando_edicao(comando)
    audio_editado, acoes = edicao_dsp.aplicar_efeitos(
        audio, sr, flags["reduzir_ruido"], flags["normalizar"], flags["ajustar_tom"],
        flags["eq_presenca"], flags["compressao"], flags["remover_sibilancia"], flags["reverb_leve"],
    )
    wav_bytes = converter_audio.audio_para_wav_bytes(audio_editado, sr)
    del audio, audio_editado
    liberar_memoria()
    cabecalhos = {"X-Acoes": ", ".join(acoes), "Access-Control-Expose-Headers": "X-Acoes, X-Aviso"}
    if aviso:
        cabecalhos["X-Aviso"] = aviso
    return Response(content=wav_bytes, media_type="audio/wav", headers=cabecalhos)


# ══════════════════════════════════════════════════════════════
# SONGWRITER (letra + referência sonora + prompt musical via Gemini,
# música completa via gradio_client + YuE2-3B na Hugging Face)
# ══════════════════════════════════════════════════════════════
@app.post("/api/songwriter/letra")
def gerar_letra_rota(tema: str = Form(...), estilo: str = Form("Pop")):
    letra, erro = songwriter.gerar_letra(tema, estilo)
    if erro:
        raise HTTPException(status_code=502, detail=erro)
    return {"letra": letra}


@app.post("/api/songwriter/referencia")
def analisar_referencia_rota(arquivo: UploadFile = File(...)):
    dados = arquivo.file.read()
    descricao, erro = songwriter.analisar_referencia_sonora(dados, arquivo.filename or "referencia.webm")
    if descricao is None:
        raise HTTPException(status_code=502, detail=erro or "Não foi possível analisar a referência.")
    return {"descricao": descricao}


@app.post("/api/songwriter/prompt-musical")
def gerar_prompt_musical_rota(
    letra: str = Form(...),
    estilo: str = Form("Pop"),
    tema: str = Form(None),
    descricao_referencia: str = Form(None),
):
    prompt_texto, erro = songwriter.gerar_prompt_musical(letra, estilo, tema, descricao_referencia)
    if erro:
        raise HTTPException(status_code=502, detail=erro)
    return {"prompt": prompt_texto}


@app.post("/api/songwriter/musica")
def gerar_musica_rota(prompt_musical: str = Form(...), letra: str = Form(...)):
    audio_bytes, erro = songwriter.gerar_musica_ia(prompt_musical, letra)
    if erro:
        raise HTTPException(status_code=502, detail=erro)
    return Response(content=audio_bytes, media_type="audio/wav")


# ── Serve o frontend estático na raiz (montado por ÚLTIMO, depois das rotas /api/*
#    acima — assim elas continuam funcionando normalmente).
#    html=True faz o "/" devolver automaticamente o index.html, e os outros arquivos
#    (styles.css, app.js, recorder.js) resolvem certinho porque agora estão na MESMA
#    raiz que o HTML. ──
class ArquivosEstaticosSemCache(StaticFiles):
    """Serve os arquivos do frontend sempre SEM CACHE. Durante o desenvolvimento
    ativo do app, um JS/CSS antigo guardado no navegador pode dar a falsa
    impressão de que uma correção não funcionou — quando na real o navegador
    só não buscou a versão nova do arquivo."""

    async def get_response(self, path, scope):
        resposta = await super().get_response(path, scope)
        resposta.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        resposta.headers["Pragma"] = "no-cache"
        resposta.headers["Expires"] = "0"
        return resposta


FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend")
if os.path.isdir(FRONTEND_DIR):
    app.mount("/", ArquivosEstaticosSemCache(directory=FRONTEND_DIR, html=True), name="static")
