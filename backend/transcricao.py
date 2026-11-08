# transcricao.py — Cifra do Estúdio: tom, acordes ao longo do tempo (detector próprio, só numpy) e a letra com o tempo de cada linha (a IA ouve; aqui só montamos o pedido e validamos a resposta).
# Nada aqui depende do librosa: o andamento e as batidas (opcionais) vêm de fora e só servem para "encaixar" os acordes na grade.
import re
import json
import difflib
import numpy as np

SR = 22050            # taxa em que a análise trabalha (o Estúdio já manda a 22,05 kHz, mono)
N_FFT = 8192          # janela de 0,37 s: separa bem as notas graves
HOP = 2048            # um quadro a cada 93 ms
FMIN, FMAX = 82.0, 2200.0
DURACAO_MAX_S = 300   # 5 minutos

NOMES_SUST = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
NOMES_BEM = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"]
# (intervalos, sufixo, penalidade a priori: a sétima só ganha da tríade quando há evidência clara)
QUALIDADES = [
    ("maj", (0, 4, 7), "", 0.0),
    ("min", (0, 3, 7), "m", 0.0),
    ("7", (0, 4, 7, 10), "7", 0.05),
    ("maj7", (0, 4, 7, 11), "maj7", 0.07),
    ("m7", (0, 3, 7, 10), "m7", 0.05),
]
PESO_NOTA = {0: 1.0, 3: 0.85, 4: 0.85, 7: 0.9, 10: 0.7, 11: 0.7}
TRIADE_DE = {"maj": "maj", "7": "maj", "maj7": "maj", "min": "min", "m7": "min"}
KS_MAIOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
KS_MENOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
# graus diatônicos (semitons acima da tônica) e a qualidade da tríade em cada um
DIATONICOS = {"maior": {0: "maj", 2: "min", 4: "min", 5: "maj", 7: "maj", 9: "min"},
              "menor": {0: "min", 3: "maj", 5: "min", 7: "min", 8: "maj", 10: "maj"}}
BEMOL_MAIOR = {5, 10, 3, 8, 1}      # F, Bb, Eb, Ab, Db escrevem-se com bemóis
BEMOL_MENOR = {2, 7, 0, 5, 10, 3}   # Dm, Gm, Cm, Fm, Bbm, Ebm


def _montar_modelos():
    nomes, raizes, quals, penal = [], [], [], []
    modelos = []
    for raiz in range(12):
        for q, ints, _suf, pen in QUALIDADES:
            v = np.zeros(12)
            for i in ints:
                v[(raiz + i) % 12] = PESO_NOTA[i]
            v = v - v.mean()
            modelos.append(v / np.linalg.norm(v))
            raizes.append(raiz); quals.append(q); penal.append(pen)
    return np.array(modelos), np.array(raizes), quals, np.array(penal)


MODELOS, RAIZES, QUALS, PENAL = _montar_modelos()
K = len(QUALS)
TRIADE_ID = np.array([int(RAIZES[i]) * 2 + (0 if TRIADE_DE[QUALS[i]] == 'maj' else 1) for i in range(K)])


def usa_bemol(tonica, modo):
    return tonica in (BEMOL_MAIOR if modo == "maior" else BEMOL_MENOR)


def nome_nota(pc, bemol):
    return (NOMES_BEM if bemol else NOMES_SUST)[pc % 12]


def nome_acorde(raiz, qual, bemol=False, simples=False):
    suf = {q: s for q, _i, s, _p in QUALIDADES}
    if simples:
        qual = TRIADE_DE[qual]
    return nome_nota(raiz, bemol) + suf[qual]


# ───────────────────────── cromagrama ─────────────────────────
def _espectro(y):
    """Magnitude do espectro (quadros x bins de FMIN a FMAX), calculada em blocos (pouca memória)."""
    y = np.asarray(y, dtype=np.float32)
    pad = np.pad(y, (N_FFT // 2, N_FFT // 2))
    n_quadros = 1 + len(y) // HOP
    win = np.hanning(N_FFT).astype(np.float32)
    freqs = np.fft.rfftfreq(N_FFT, 1.0 / SR)
    sel = (freqs >= FMIN) & (freqs <= FMAX)
    saida = np.empty((n_quadros, int(sel.sum())), dtype=np.float32)
    z = 0j; peso = 0.0
    bloco = 128
    for i in range(0, n_quadros, bloco):
        j = min(n_quadros, i + bloco)
        idx = (np.arange(N_FFT)[None, :] + HOP * np.arange(i, j)[:, None])
        mag = np.abs(np.fft.rfft(pad[idx] * win, axis=1)).astype(np.float32)
        saida[i:j] = mag[:, sel]
        # afinação: o desvio dos picos em relação ao semitom mais próximo (média circular, ponderada pela força do pico)
        m = mag[:, 1:-1]; a, b, c = mag[:, :-2], m, mag[:, 2:]
        pico = (b > a) & (b >= c) & (b > 0.15 * mag.max(axis=1, keepdims=True))
        if pico.any():
            q, k = np.nonzero(pico); k = k + 1
            aa, bb, cc = mag[q, k - 1], mag[q, k], mag[q, k + 1]
            den = aa - 2 * bb + cc
            delta = np.where(np.abs(den) > 1e-9, 0.5 * (aa - cc) / den, 0.0)
            f = (k + delta) * SR / N_FFT
            ok = (f >= FMIN) & (f <= FMAX)
            midi = 69 + 12 * np.log2(f[ok] / 440.0)
            dev = midi - np.round(midi)
            w = bb[ok]
            z += np.sum(w * np.exp(2j * np.pi * dev)); peso += float(np.sum(w))
    afin = float(np.angle(z) / (2 * np.pi)) if peso > 0 and abs(z) / peso > 0.2 else 0.0
    return saida, freqs[sel], afin


PESO_BAIXO = 0.40     # o baixo ajuda a achar a raiz, mas não pode sufocar as notas do acorde (inversões, baixo "andando")
CORTE_BAIXO_HZ = 260.0


def cromagrama(y):
    """Devolve (chroma [quadros x 12], energia por quadro, afinação em semitons). Baixo e médios são analisados em separado e depois somados com pesos."""
    esp, freqs, afin = _espectro(y)
    midi = 69 + 12 * np.log2(freqs / 440.0) - afin
    p0 = np.round(midi)
    w = np.exp(-0.5 * ((midi - p0) / 0.28) ** 2) / (1.0 + freqs / 900.0)    # perto do centro do semitom pesa mais; agudos pesam menos (hi-hats, sibilância)
    W = np.zeros((len(freqs), 12), dtype=np.float32)
    W[np.arange(len(freqs)), (p0.astype(int)) % 12] = w
    raiz_q = np.sqrt(esp)
    grave = freqs < CORTE_BAIXO_HZ
    cb, cm = raiz_q[:, grave] @ W[grave], raiz_q[:, ~grave] @ W[~grave]
    nb, nm = np.linalg.norm(cb, axis=1, keepdims=True), np.linalg.norm(cm, axis=1, keepdims=True)
    piso_b, piso_m = max(float(np.percentile(nb, 75)) * 0.1, 1e-9), max(float(np.percentile(nm, 75)) * 0.1, 1e-9)
    c = cm / np.maximum(nm, piso_m) + PESO_BAIXO * cb / np.maximum(nb, piso_b)
    energia = np.sqrt(np.sum(esp.astype(np.float64) ** 2, axis=1))
    return c, energia, afin


SUAVIZAR = ("mediana", 9)


def _suavizar(c, n=None):
    tipo, n0 = SUAVIZAR
    n = n or n0
    if len(c) < n:
        return c
    pad = n // 2
    cp = np.pad(c, ((pad, pad), (0, 0)), mode="edge")
    if tipo == "mediana":
        janelas = np.lib.stride_tricks.sliding_window_view(cp, n, axis=0)        # [T x 12 x n]
        return np.median(janelas, axis=-1)
    k = np.ones(n) / n
    return np.stack([np.convolve(cp[:, i], k, mode="valid") for i in range(12)], axis=1)


def _pontuar(c):
    """Semelhança (cosseno com média removida) de cada quadro com cada acorde-modelo."""
    z = c - c.mean(axis=1, keepdims=True)
    n = np.linalg.norm(z, axis=1, keepdims=True)
    z = z / np.maximum(n, 1e-9)
    return z @ MODELOS.T


# ───────────────────────── decodificação (Viterbi) ─────────────────────────
def _viterbi(obs, p_stay=0.93, bonus=None):
    """obs: [quadros x (K+1)] log-verossimilhança; o último estado é 'sem acorde'. Devolve o caminho."""
    T, N = obs.shape
    lstay = np.log(p_stay); lsw = np.log((1 - p_stay) / (N - 1))
    delta = np.empty((T, N)); psi = np.zeros((T, N), dtype=np.int32)
    delta[0] = obs[0]
    for t in range(1, T):
        prev = delta[t - 1]
        melhor = int(np.argmax(prev)); vm = prev[melhor]
        troca = vm + lsw                                  # vir do melhor estado anterior (qualquer outro)
        fica = prev + lstay
        usa_fica = fica >= troca
        delta[t] = np.where(usa_fica, fica, troca) + obs[t]
        psi[t] = np.where(usa_fica, np.arange(N), melhor)
    caminho = np.empty(T, dtype=np.int32)
    caminho[-1] = int(np.argmax(delta[-1]))
    for t in range(T - 1, 0, -1):
        caminho[t - 1] = psi[t, caminho[t]]
    return caminho


def _bonus_tom(tonica, modo, forca):
    b = np.zeros(K)
    dia = DIATONICOS[modo]
    for i in range(K):
        grau = (RAIZES[i] - tonica) % 12
        if grau in dia and dia[grau] == TRIADE_DE[QUALS[i]]:
            b[i] = forca
    if modo == "menor":                                   # a dominante maior (V) é comum no menor
        for i in range(K):
            if (RAIZES[i] - tonica) % 12 == 7 and TRIADE_DE[QUALS[i]] == "maj":
                b[i] = forca
    return b


def _decodificar(c, energia, bonus=None, beta=14.0):
    cs = _suavizar(c)
    s = _pontuar(cs)                                       # [T x K]
    lim = max(float(np.percentile(energia, 90)) * 0.04, 1e-6)
    silencio = energia < lim
    obs = np.empty((len(cs), K + 1))
    obs[:, :K] = beta * s - beta * PENAL[None, :] * 1.0
    if bonus is not None:
        obs[:, :K] += bonus[None, :]
    obs[:, K] = np.where(silencio, 1.0 * beta, -0.30 * beta)
    obs[silencio, :K] -= 0.6 * beta
    caminho = _viterbi(obs)
    return caminho, s, silencio


# ───────────────────────── tom ─────────────────────────
def estimar_tom(chroma_medio, segmentos=None):
    """segmentos: lista de (raiz, qualidade, duracao_s). Soma a correlação com os perfis de Krumhansl e a evidência dos acordes."""
    cm = np.asarray(chroma_medio, dtype=np.float64)
    pontos = []
    total = sum(d for _r, _q, d in segmentos) if segmentos else 0.0
    for modo, perfil in (("maior", KS_MAIOR), ("menor", KS_MENOR)):
        for t in range(12):
            p = np.roll(perfil, t)
            corr = float(np.corrcoef(cm, p)[0, 1]) if cm.std() > 1e-9 else 0.0
            extra = 0.0
            if segmentos and total > 0:
                dia = DIATONICOS[modo]; fit = 0.0; ton = 0.0
                for raiz, qual, dur in segmentos:
                    grau = (raiz - t) % 12; tri = TRIADE_DE[qual]
                    if grau in dia and dia[grau] == tri:
                        fit += dur
                    elif modo == "menor" and grau == 7 and tri == "maj":
                        fit += dur
                    if grau == 0 and tri == dia[0]:
                        ton += dur
                extra = 0.9 * fit / total + 0.35 * ton / total
                if segmentos[0][0] == t and TRIADE_DE[segmentos[0][1]] == dia[0]:
                    extra += 0.06
                if segmentos[-1][0] == t and TRIADE_DE[segmentos[-1][1]] == dia[0]:
                    extra += 0.08
            pontos.append((corr + extra, t, modo))
    pontos.sort(reverse=True)
    (p1, t1, m1), (p2, _t2, _m2) = pontos[0], pontos[1]
    return t1, m1, float(np.clip((p1 - p2) / 0.35, 0.0, 1.0))


# ───────────────────────── acordes ─────────────────────────
def _segmentos(caminho, s, silencio, dur_total):
    segs = []
    i = 0; T = len(caminho)
    while i < T:
        j = i
        while j + 1 < T and caminho[j + 1] == caminho[i]:
            j += 1
        est = int(caminho[i])
        if est < K:
            ordem = np.sort(s[i:j + 1], axis=1)
            margem = float(np.mean(ordem[:, -1] - ordem[:, -2]))
            outro = TRIADE_ID != TRIADE_ID[est]                           # margem contra um acorde DIFERENTE (e não contra a versão com sétima do mesmo acorde)
            margem_tri = float(np.mean(s[i:j + 1, est] - s[i:j + 1][:, outro].max(axis=1)))
            segs.append({"i0": i, "i1": j, "est": est, "margem": margem, "margem_tri": margem_tri, "score": float(np.mean(s[i:j + 1, est]))})
        i = j + 1
    return segs


LIMIAR_INCERTO = 0.6      # abaixo disso o acorde aparece "apagado" na tela (medido: pega ~2 de cada 3 erros em músicas de teste difíceis)


def _recorta(x, a, b):
    return float(np.clip((x - a) / (b - a), 0.0, 1.0))


def confianca(seg):
    """0 a 1. Mede o que se mostrou separar de verdade os acertos dos erros: trecho longo, margem contra OUTRO acorde e ajuste ao modelo."""
    q = seg["i1"] - seg["i0"] + 1
    return 0.45 * _recorta(q, 3, 14) + 0.35 * _recorta(seg["margem_tri"], 0.0, 0.18) + 0.20 * _recorta(seg["score"], 0.55, 0.95)


def _tempo(i, kind="ini"):
    return max(0.0, (i - 0.5) * HOP / SR) if kind == "ini" else (i + 0.5) * HOP / SR


def _fundir_curtos(segs, minimo_quadros):
    mudou = True
    while mudou and len(segs) > 1:
        mudou = False
        for k, sg in enumerate(segs):
            if sg["i1"] - sg["i0"] + 1 < minimo_quadros:
                vizinhos = [x for x in (k - 1, k + 1) if 0 <= x < len(segs)]
                alvo = max(vizinhos, key=lambda x: segs[x]["score"] * (segs[x]["i1"] - segs[x]["i0"] + 1))
                a = segs[alvo]
                a["i0"] = min(a["i0"], sg["i0"]); a["i1"] = max(a["i1"], sg["i1"])
                segs.pop(k); mudou = True
                break
    return segs


def _juntar_iguais(segs):
    saida = []
    for sg in segs:
        if saida and saida[-1]["est"] == sg["est"] and sg["i0"] - saida[-1]["i1"] <= 1:
            a = saida[-1]; na, nb = a["i1"] - a["i0"] + 1, sg["i1"] - sg["i0"] + 1
            a["margem"] = (a["margem"] * na + sg["margem"] * nb) / (na + nb); a["margem_tri"] = (a["margem_tri"] * na + sg["margem_tri"] * nb) / (na + nb); a["score"] = (a["score"] * na + sg["score"] * nb) / (na + nb); a["i1"] = sg["i1"]
        else:
            saida.append(dict(sg))
    return saida


def encaixar_nas_batidas(acordes, beats, tolerancia=0.15):
    """Leva cada mudança de acorde à batida mais próxima (se estiver a menos de `tolerancia`). Não mexe no começo nem no fim."""
    if not beats or len(acordes) < 2:
        return acordes
    b = np.asarray(beats, dtype=float)
    for k in range(1, len(acordes)):
        t = acordes[k]["ini"]
        j = int(np.argmin(np.abs(b - t)))
        if abs(b[j] - t) <= tolerancia and acordes[k - 1]["ini"] + 0.2 < b[j] < (acordes[k]["fim"] - 0.2):
            acordes[k]["ini"] = round(float(b[j]), 3); acordes[k - 1]["fim"] = acordes[k]["ini"]
    return acordes


def analisar(y, beats=None, bpm=None):
    """y: áudio mono a 22,05 kHz. Devolve {tom, modo, rotulo, tom_conf, acordes[], duracao, bpm, aviso?}."""
    y = np.asarray(y, dtype=np.float32)
    dur = len(y) / float(SR)
    resultado = {"duracao": round(dur, 3), "bpm": bpm, "tom": None, "modo": None, "rotulo": None, "tom_conf": 0.0, "acordes": [], "afinacao_cents": 0}
    if len(y) < SR * 2 or float(np.max(np.abs(y))) < 1e-4:
        resultado["aviso"] = "Não achei som suficiente para analisar."
        return resultado
    c, energia, afin = cromagrama(y)
    resultado["afinacao_cents"] = int(round(afin * 100))
    caminho, s, sil = _decodificar(c, energia)
    segs = _juntar_iguais(_fundir_curtos(_segmentos(caminho, s, sil, dur), 4))
    if not segs:
        resultado["aviso"] = "Não identifiquei acordes claros (a música pode ter pouca harmonia)."
        return resultado
    seg_t = [(int(RAIZES[x["est"]]), QUALS[x["est"]], (x["i1"] - x["i0"] + 1) * HOP / SR) for x in segs]
    tonica, modo, tom_conf = estimar_tom(c[~sil].mean(axis=0) if (~sil).any() else c.mean(axis=0), seg_t)
    # 2ª passada: com o tom na mão, os acordes que pertencem a ele ganham uma pequena vantagem
    caminho, s, sil = _decodificar(c, energia, bonus=_bonus_tom(tonica, modo, 0.9))
    segs = _juntar_iguais(_fundir_curtos(_segmentos(caminho, s, sil, dur), 4))
    seg_t = [(int(RAIZES[x["est"]]), QUALS[x["est"]], (x["i1"] - x["i0"] + 1) * HOP / SR) for x in segs]
    tonica, modo, tom_conf = estimar_tom(c[~sil].mean(axis=0) if (~sil).any() else c.mean(axis=0), seg_t)
    bemol = usa_bemol(tonica, modo)
    acordes = []
    for x in segs:
        raiz, qual = int(RAIZES[x["est"]]), QUALS[x["est"]]
        conf = confianca(x)
        acordes.append({"ini": round(_tempo(x["i0"], "ini"), 3), "fim": round(min(dur, _tempo(x["i1"], "fim")), 3), "acorde": nome_acorde(raiz, qual, bemol),
                        "simples": nome_acorde(raiz, qual, bemol, simples=True), "raiz": raiz, "conf": round(conf, 2), "incerto": bool(conf < LIMIAR_INCERTO)})
    acordes[0]["ini"] = 0.0 if acordes[0]["ini"] < 0.4 else acordes[0]["ini"]
    for a, b in zip(acordes, acordes[1:]):                # sem buracos entre acordes vizinhos
        meio = round((a["fim"] + b["ini"]) / 2, 3); a["fim"] = meio; b["ini"] = meio
    acordes = encaixar_nas_batidas(acordes, beats)
    rel_t, rel_m = ((tonica + 9) % 12, "menor") if modo == "maior" else ((tonica + 3) % 12, "maior")
    resultado.update({"tom": nome_nota(tonica, bemol), "modo": modo, "rotulo": f"{nome_nota(tonica, bemol)} {modo}", "tom_conf": round(tom_conf, 2), "acordes": acordes,
                      "relativo": f"{nome_nota(rel_t, usa_bemol(rel_t, rel_m))} {rel_m}"})
    return resultado


# ───────────────────────── letra (a IA ouve; aqui montamos o pedido e validamos a resposta) ─────────────────────────
def montar_prompt_letra(duracao, letra_conhecida=""):
    base = (f"Você é um transcritor de letras de músicas. O áudio tem {duracao:.0f} segundos. "
            "Responda SOMENTE com um JSON válido (sem markdown, sem texto antes ou depois) neste formato exato: "
            '{"linhas":[{"ini":12.4,"fim":16.8,"texto":"primeiro verso"}]}. '
            '"ini" e "fim" são o instante, em SEGUNDOS desde o início do áudio (número decimal), em que o verso COMEÇA e TERMINA de ser cantado. ')
    letra_conhecida = (letra_conhecida or "").strip()
    if letra_conhecida:
        return (base + "A letra desta música é a seguinte, um verso por linha:\n\n" + letra_conhecida[:6000] +
                "\n\nOuça o áudio e devolva EXATAMENTE essas mesmas linhas, na mesma ordem e sem alterar o texto, com o tempo de cada uma. "
                "Se um verso se repete na música, devolva-o a cada vez que aparece.")
    return (base + "Transcreva a letra CANTADA, um verso por linha, no idioma em que ela é cantada. "
            "Não invente: não escreva nada nos trechos instrumentais e, se não entender uma palavra, escreva [?]. "
            "Se o mesmo refrão se repete, escreva-o a cada vez que ele aparece, com o tempo certo de cada repetição.")


def tempo_em_segundos(v):
    """Aceita 12.4, '12.4', '0:12', '00:12.5', '1:02:03'. Devolve float ou None."""
    if v is None or isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v) if np.isfinite(v) else None
    t = str(v).strip().lower().replace(",", ".").rstrip("s").strip()
    if not t:
        return None
    try:
        if ":" in t:
            partes = [float(p) for p in t.split(":")]
            if len(partes) > 3:
                return None
            seg = 0.0
            for p in partes:
                seg = seg * 60 + p
            return seg
        return float(t)
    except ValueError:
        return None


def _extrair_lista(texto):
    t = (texto or "").strip()
    t = re.sub(r"^```[a-zA-Z]*\s*|\s*```$", "", t.strip())
    for ini, fim in (("{", "}"), ("[", "]")):
        a, b = t.find(ini), t.rfind(fim)
        if a >= 0 and b > a:
            try:
                dados = json.loads(t[a:b + 1])
            except ValueError:
                continue
            if isinstance(dados, dict):
                for k in ("linhas", "letra", "lines", "lyrics"):
                    if isinstance(dados.get(k), list):
                        return dados[k]
            elif isinstance(dados, list):
                return dados
    return None


def distribuir_igualmente(textos, duracao):
    n = len(textos)
    if n == 0:
        return []
    passo = duracao / n
    return [{"ini": round(i * passo, 2), "fim": round((i + 1) * passo, 2), "texto": t} for i, t in enumerate(textos)]


def ler_resposta_letra(texto, duracao, letra_conhecida=""):
    """Valida o que a IA devolveu. Devolve (linhas, avisos). Nunca devolve tempos fora do áudio nem fora de ordem."""
    avisos = []
    lista = _extrair_lista(texto)
    conhecidas = [l.strip() for l in (letra_conhecida or "").splitlines() if l.strip()]
    if not lista:
        if conhecidas:
            return distribuir_igualmente(conhecidas, duracao), ["A IA não devolveu os tempos: distribuí as linhas igualmente pela música (tempos só aproximados)."]
        return [], ["A IA não devolveu uma letra que eu consiga ler."]
    linhas = []
    for item in lista:
        if isinstance(item, str):
            linhas.append({"ini": None, "fim": None, "texto": item.strip()}); continue
        if not isinstance(item, dict):
            continue
        txt = str(item.get("texto", item.get("text", item.get("letra", "")))).strip()
        if not txt:
            continue
        ini = tempo_em_segundos(item.get("ini", item.get("inicio", item.get("start", item.get("t")))))
        fim = tempo_em_segundos(item.get("fim", item.get("end")))
        linhas.append({"ini": ini, "fim": fim, "texto": txt})
    if not linhas:
        return [], ["A IA não devolveu nenhuma linha de letra."]
    if conhecidas:
        if len(linhas) != len(conhecidas):                # a IA mexeu na quantidade: casa cada linha pelo texto (as mais parecidas primeiro, sempre respeitando a ordem da música)
            pares = sorted(((difflib.SequenceMatcher(None, c.lower(), l["texto"].lower()).ratio(), ki, kj) for ki, c in enumerate(conhecidas) for kj, l in enumerate(linhas)), reverse=True)
            casados = {}
            for r, ki, kj in pares:
                if r < 0.6 or ki in casados or kj in casados.values():
                    continue
                if all((ci < ki and mj < kj) or (ci > ki and mj > kj) for ci, mj in casados.items()):
                    casados[ki] = kj
            linhas = [{"ini": linhas[casados[ki]]["ini"], "fim": linhas[casados[ki]]["fim"], "texto": c} if ki in casados else {"ini": None, "fim": None, "texto": c} for ki, c in enumerate(conhecidas)]
            avisos.append("A IA devolveu uma quantidade de linhas diferente da sua letra: casei cada linha pelo texto.")
        else:
            for l, c in zip(linhas, conhecidas):
                l["texto"] = c
    validos = [l for l in linhas if l["ini"] is not None and 0 <= l["ini"] <= duracao + 1]
    if len(validos) < max(1, len(linhas) // 2):
        avisos.append("A IA não deu tempos confiáveis: distribuí as linhas igualmente pela música (tempos só aproximados).")
        return distribuir_igualmente([l["texto"] for l in linhas], duracao), avisos
    # preenche tempos que faltam (interpola entre vizinhos), corrige ordem e limites
    n = len(linhas)
    for k, l in enumerate(linhas):
        if l["ini"] is None or l["ini"] < 0 or l["ini"] > duracao + 1:
            ant = next((linhas[x]["ini"] for x in range(k - 1, -1, -1) if linhas[x]["ini"] is not None and 0 <= linhas[x]["ini"] <= duracao + 1), 0.0)
            prox = next((linhas[x]["ini"] for x in range(k + 1, n) if linhas[x]["ini"] is not None and 0 <= linhas[x]["ini"] <= duracao + 1), duracao)
            l["ini"] = (ant + prox) / 2.0
    if any(linhas[k]["ini"] < linhas[k - 1]["ini"] - 0.01 for k in range(1, n)):
        avisos.append("Os tempos vieram fora de ordem: reordenei.")
        linhas.sort(key=lambda l: l["ini"])
    teto = max(0.0, duracao - 0.3)                    # toda linha precisa caber (com ao menos 0,3 s) dentro da música
    anterior = 0.0
    for l in linhas:
        l["ini"] = float(max(anterior, min(max(l["ini"], 0.0), teto))); anterior = l["ini"]
    for k, l in enumerate(linhas):
        prox = linhas[k + 1]["ini"] if k + 1 < n else duracao
        fim = l["fim"] if (l["fim"] is not None and l["fim"] > l["ini"]) else min(prox, l["ini"] + 5.0)
        l["fim"] = float(min(max(fim, l["ini"] + 0.3), max(prox, l["ini"] + 0.3), duracao))
        l["ini"], l["fim"] = round(l["ini"], 2), round(l["fim"], 2)
    return linhas, avisos
