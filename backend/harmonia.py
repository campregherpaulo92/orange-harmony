# ══════════════════════════════════════════════════════════════
# harmonia.py — Harmonização automática: a produção passa a ACOMPANHAR a sua melodia.
#  1) descobre o tom E se ele é maior ou menor (perfis de Krumhansl sobre o cromagrama);
#  2) em cada compasso, olha quais notas você cantou/tocou e escolhe, entre os acordes do tom,
#     o que melhor combina (com preferência pelos acordes mais comuns e por trocas naturais).
# É uma ESTIMATIVA: com uma melodia limpa funciona bem; com muito ruído ou melodia ambígua pode
# escolher um acorde parecido. Por isso a tela deixa voltar para a sequência fixa do estilo.
# ══════════════════════════════════════════════════════════════
import numpy as np
import librosa

import ritmos as R

NOMES = R.NOMES_NOTAS
PERFIL_MAIOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
PERFIL_MENOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
HOP = 4096
N_FFT = 8192
# Parâmetros da escolha dos acordes (ajustados com músicas de teste — veja o histórico no README)
# (busca em 700 combinações com 40 músicas sintéticas; escolhido pela validação e conferido em 40 músicas nunca usadas: 73% de acerto exato)
PARAMS = dict(k=8.0, w_raiz=1.0, w_terca=0.8, w_quinta=0.4, pen_fora=1.4, prior=0.08, bonus_igual=0.0, bonus_quarta=0.02, w_forte=2.0)

# acordes de cada modo: (semitons acima da tônica, qualidade, probabilidade de aparecer)
ACORDES_MAIOR = [(0, "M", 0.30), (5, "M", 0.20), (7, "M", 0.20), (9, "m", 0.15), (2, "m", 0.08), (4, "m", 0.04), (11, "dim", 0.03)]
ACORDES_MENOR = [(0, "m", 0.30), (8, "M", 0.15), (5, "m", 0.15), (7, "M", 0.12), (10, "M", 0.12), (3, "M", 0.08), (7, "m", 0.05), (2, "dim", 0.03)]
SUFIXO = {"M": "", "m": "m", "7": "7", "m7": "m7", "maj7": "7M", "5": "5", "dim": "dim", "m7b5": "m7(b5)", "sus4": "sus4"}


def nome_acorde(raiz_pc, qual):
    """Nome na cifra: Bb, Eb e Ab (e Db nos maiores) em vez de A#, D# e G#."""
    pc = raiz_pc % 12
    menor = qual in ("m", "m7", "dim", "m7b5")
    bemol = pc in (3, 10) or (pc in (1, 8) and not menor)
    return (R.NOMES_BEMOL_CIFRA[pc] if bemol else NOMES[pc]) + SUFIXO.get(qual, qual)


def tipo_do_estilo(esp):
    """Como os acordes do estilo soam: 'fixo' (blues de 12 compassos), '5' (power chords), '7' (com sétima) ou 'tri' (tríades)."""
    quals = [q for _, q in esp["prog"]]
    if len(quals) == 12:
        return "fixo"
    if all(q == "5" for q in quals):
        return "5"
    if any(q in ("maj7", "m7", "7") for q in quals):
        return "7"
    return "tri"


def _adaptar(funcao, qual, tipo):
    """Põe o 'sotaque' do estilo no acorde escolhido (power chord no rock, sétimas no samba/jazz...)."""
    if tipo == "5":
        return "5"
    if tipo == "7":
        if qual == "M":
            return "7" if funcao == 7 else "maj7"
        if qual == "m":
            return "m7"
        if qual == "dim":
            return "m7b5"
    return qual


def _chroma(audio, sr):
    x = np.asarray(audio[: int(sr * 150)], dtype=np.float32)
    if len(x) < N_FFT:
        x = np.pad(x, (0, N_FFT - len(x)))
    c = librosa.feature.chroma_stft(y=x, sr=sr, n_fft=N_FFT, hop_length=HOP, tuning=0.0, norm=None)
    return c / (np.max(c) + 1e-9)


class Analise:
    """Análise feita UMA vez por gravação (tom, modo e cromagrama); depois serve para qualquer estilo."""

    def __init__(self, audio, sr):
        self.sr = int(sr)
        self.dur = min(len(audio), int(sr * 150)) / self.sr
        self.bruto = _chroma(audio, sr)
        self.chroma = np.log1p(60 * self.bruto)           # comprime: harmônicos fortes não "mandam" sozinhos (usado no tom)
        self.tempos = librosa.frames_to_time(np.arange(self.chroma.shape[1]), sr=self.sr, hop_length=HOP) + N_FFT / 2 / self.sr
        media = self.chroma.mean(axis=1)
        melhor = (-2.0, 0, "maior")
        for t in range(12):
            for modo, perfil in (("maior", PERFIL_MAIOR), ("menor", PERFIL_MENOR)):
                r = float(np.corrcoef(np.roll(perfil, t), media)[0, 1]) if np.std(media) > 1e-9 else 0.0
                if r > melhor[0]:
                    melhor = (r, t, modo)
        self.confianca, self.tonica, self.modo = melhor
        self.tonica_nome = NOMES[self.tonica]

    def harmonizar(self, esp, bpm, beat_times):
        """{compasso: (raiz_pc, qualidade)} para o estilo `esp`, seguindo a melodia. None se o estilo tem harmonia fixa (blues)."""
        tipo = tipo_do_estilo(esp)
        if tipo == "fixo":
            return None
        dur = self.dur
        tempos, comp, passo = R.construir_grade(beat_times, bpm, dur, esp["passos"] // esp["batidas"], esp["batidas"])
        inicio = {int(c): float(t) for t, c, p in zip(tempos, comp, passo) if p == 0}
        compassos = sorted(inicio)
        if not compassos:
            return {}
        por_acorde = esp["acorde_compassos"]
        grupos = sorted(set(c // por_acorde for c in compassos))
        base = ACORDES_MAIOR if self.modo == "maior" else ACORDES_MENOR

        # notas de cada grupo de compassos = média do cromagrama no intervalo do grupo
        perfis = []
        for g in grupos:
            barras = [c for c in compassos if c // por_acorde == g]
            t0, t1 = inicio[min(barras)], inicio.get(max(barras) + 1, dur)
            quadros = (self.tempos >= t0) & (self.tempos < t1)
            if quadros.any():
                peso = np.where(self.tempos[quadros] < t0 + 60.0 / bpm, PARAMS["w_forte"], 1.0)         # o 1º tempo do compasso conta mais
                perfis.append((np.log1p(PARAMS["k"] * self.bruto[:, quadros]) * peso).sum(axis=1) / peso.sum())
            else:
                perfis.append(np.zeros(12))

        # pontuação de cada acorde candidato em cada grupo
        pontos = np.zeros((len(grupos), len(base)))
        for i, c in enumerate(perfis):
            total = float(c.sum())
            if total < 1e-3:
                pontos[i, :] = 0.0
                continue
            for j, (grau, qual, prior) in enumerate(base):
                raiz = (self.tonica + grau) % 12
                terca = (raiz + (3 if qual in ("m", "dim") else 4)) % 12
                quinta = (raiz + (6 if qual == "dim" else 7)) % 12
                de_acorde = PARAMS["w_raiz"] * c[raiz] + PARAMS["w_terca"] * c[terca] + PARAMS["w_quinta"] * c[quinta]
                de_fora = total - c[raiz] - c[terca] - c[quinta]
                pontos[i, j] = (de_acorde - PARAMS["pen_fora"] * de_fora) / total + PARAMS["prior"] * np.log(prior)

        # Viterbi: prefere ficar no mesmo acorde ou fazer trocas comuns (quarta/quinta)
        n, m = pontos.shape
        trans = np.zeros((m, m))
        for a in range(m):
            for b in range(m):
                if a == b:
                    trans[a, b] = PARAMS["bonus_igual"]
                else:
                    intervalo = (base[b][0] - base[a][0]) % 12
                    trans[a, b] = PARAMS["bonus_quarta"] if intervalo in (5, 7) else 0.0
        v = pontos[0].copy()
        voltar = np.zeros((n, m), dtype=int)
        for i in range(1, n):
            cand = v[:, None] + trans
            voltar[i] = np.argmax(cand, axis=0)
            v = cand[voltar[i], np.arange(m)] + pontos[i]
        caminho = [int(np.argmax(v))]
        for i in range(n - 1, 0, -1):
            caminho.append(int(voltar[i][caminho[-1]]))
        caminho.reverse()

        por_grupo = {}
        for g, j in zip(grupos, caminho):
            grau, qual, _ = base[j]
            por_grupo[g] = ((self.tonica + grau) % 12, _adaptar(grau, qual, tipo))
        return {c: por_grupo[c // por_acorde] for c in compassos}

    def resumo(self, harmonia, limite=12):
        """Nomes dos acordes (sem repetir seguidos) para mostrar na tela."""
        if not harmonia:
            return []
        nomes = []
        for c in sorted(harmonia):
            n = nome_acorde(*harmonia[c])
            if not nomes or nomes[-1] != n:
                nomes.append(n)
        return nomes[:limite]


def preparar(audio, sr, estilo, bpm, beat_times, acordes="melodia"):
    """Tudo o que a produção precisa saber sobre a harmonia de uma gravação para um estilo.
    acordes = "melodia" (os acordes seguem a sua melodia) ou "estilo" (sequência fixa do estilo).
    Devolve {tom, modo, harmonia, tom_detectado, modo_detectado, acordes}: `tom`/`modo` são os que o gerador deve usar."""
    ana = Analise(audio, sr)
    esp = R.obter(estilo)
    harm = ana.harmonizar(esp, bpm, beat_times) if acordes == "melodia" else None
    if harm is not None:
        tom, modo = ana.tonica_nome, ana.modo
    else:
        # sequência fixa do estilo (escrita em tom maior): se a música é menor, usa a relativa maior, que tem as mesmas notas
        tom = NOMES[(ana.tonica + 3) % 12] if ana.modo == "menor" else ana.tonica_nome
        modo = "maior"
    return {"tom": tom, "modo": modo, "harmonia": harm, "tom_detectado": ana.tonica_nome, "modo_detectado": ana.modo,
            "acordes": ana.resumo(harm) if harm else []}
