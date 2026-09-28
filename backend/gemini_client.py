# ══════════════════════════════════════════════════════════════
# gemini_client.py — Cliente do Google Gemini, com fallback entre modelos,
# para texto (com function calling) e para áudio (avaliação de gravações).
# ══════════════════════════════════════════════════════════════
import os
import io
import time

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")

try:
    from google import genai
    from google.genai import types
    _cliente = genai.Client(api_key=GEMINI_API_KEY) if GEMINI_API_KEY else None
except Exception:
    genai = None
    types = None
    _cliente = None

MODELOS_PADRAO = ["gemini-3.5-flash", "gemini-3-flash", "gemini-2.5-flash", "gemini-3.1-pro", "gemini-2.0-flash"]
MODELOS_COM_AUDIO = ["gemini-3.5-flash", "gemini-3-flash", "gemini-2.5-flash", "gemini-2.0-flash"]

_modelos_cache = None


def gemini_disponivel():
    return _cliente is not None


def listar_modelos():
    """Descobre os modelos de texto realmente disponíveis na chave configurada."""
    global _modelos_cache
    if _modelos_cache:
        return _modelos_cache
    if _cliente is None:
        return MODELOS_PADRAO
    try:
        encontrados = []
        for m in _cliente.models.list():
            nome = (getattr(m, "name", "") or "").replace("models/", "")
            acoes = getattr(m, "supported_actions", None) or []
            if acoes and "generateContent" not in acoes:
                continue
            if not ("flash" in nome or "pro" in nome):
                continue
            if any(x in nome for x in ["image", "tts", "embedding", "live", "veo", "lyria", "nano-banana"]):
                continue
            encontrados.append(nome)
        if encontrados:
            # "gemini-3.8-flash" propositalmente NÃO entra nessa ordem de
            # preferência — modelos novíssimos da Google às vezes só funcionam
            # pela "Interactions API" (lançada em 2026), separada da chamada
            # padrão (generateContent) que este app usa. Preferimos modelos
            # já estabelecidos, que sabidamente continuam suportando
            # generateContent sem essa exigência nova.
            ordem = ["gemini-3.5-flash", "gemini-3-flash", "gemini-2.5-flash",
                     "gemini-3.1-pro", "gemini-2.5-pro", "gemini-2.0-flash"]
            encontrados = [n for n in encontrados if n != "gemini-3.8-flash"]
            encontrados.sort(key=lambda n: ordem.index(n) if n in ordem else 99)
            # Rede de segurança: "gemini-2.0-flash" é um modelo bem mais antigo
            # e estabelecido, de antes da Interactions API existir — se TODOS
            # os modelos descobertos acima falharem por essa exigência nova,
            # ainda tentamos esse aqui por último, como garantia.
            if "gemini-2.0-flash" not in encontrados:
                encontrados.append("gemini-2.0-flash")
            _modelos_cache = encontrados
            return encontrados
    except Exception:
        pass
    return MODELOS_PADRAO


def gerar(modelo, contents, config=None):
    """Chamada direta de baixo nível (usada pelo loop de function calling)."""
    if _cliente is None:
        raise RuntimeError("Gemini não configurado (falta GEMINI_API_KEY).")
    return _cliente.models.generate_content(model=modelo, contents=contents, config=config)


def chamar_texto(prompt):
    """Chamada simples só de texto, com fallback entre modelos.
    Retorna (resposta_do_sdk, None) ou (None, mensagem_de_erro)."""
    if _cliente is None:
        return None, "Gemini não configurado (falta GEMINI_API_KEY)."
    ultimo_erro = ""
    for modelo in listar_modelos():
        try:
            resposta = _cliente.models.generate_content(model=modelo, contents=prompt)
            if resposta and resposta.text and resposta.text.strip():
                return resposta, None
            ultimo_erro = "Resposta vazia"
        except Exception as e:
            ultimo_erro = str(e)
            # "Interactions API" = esse modelo específico não aceita a chamada
            # padrão de forma alguma — não adianta tentar de novo, já pula pro
            # próximo modelo da lista imediatamente.
            continue
    return None, ultimo_erro


def chamar_com_audio(prompt, audio_bytes, nome_arquivo="audio.mp3", mime_type="audio/mpeg"):
    """Envia um prompt + áudio pro Gemini (upload de arquivo), com fallback entre
    modelos que suportam áudio. Retorna (texto, modelo_usado) ou (None, motivo_erro)."""
    if _cliente is None:
        return None, "Gemini não configurado (falta GEMINI_API_KEY)."

    modelos_disponiveis = listar_modelos()
    modelos = [m for m in MODELOS_COM_AUDIO if m in modelos_disponiveis] or MODELOS_COM_AUDIO

    try:
        arquivo = _cliente.files.upload(
            file=io.BytesIO(audio_bytes),
            config=types.UploadFileConfig(mime_type=mime_type, display_name=nome_arquivo),
        )
        for _ in range(30):
            estado = _cliente.files.get(name=arquivo.name)
            if estado.state.name == "ACTIVE":
                break
            time.sleep(1)
    except Exception as e:
        return None, f"Falha ao enviar o áudio: {e}"

    ultimo_erro = ""
    for modelo in modelos:
        try:
            resposta = _cliente.models.generate_content(
                model=modelo,
                contents=[prompt, types.Part.from_uri(file_uri=arquivo.uri, mime_type=mime_type)],
            )
            texto = resposta.text
            if texto and texto.strip():
                return texto, modelo
            ultimo_erro = "Resposta vazia"
        except Exception as e:
            ultimo_erro = str(e)
            continue
    return None, ultimo_erro


def extrair_json(texto):
    """Tenta extrair um JSON de uma resposta de texto (removendo cercas de markdown)."""
    import json
    if not texto:
        return None
    limpo = texto.strip().strip("`")
    if limpo.lower().startswith("json"):
        limpo = limpo[4:].strip()
    try:
        return json.loads(limpo)
    except Exception:
        return None
