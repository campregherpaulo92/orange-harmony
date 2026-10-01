# ══════════════════════════════════════════════════════════════
# professor.py — Devolutiva do Professor de Canto (Gemini), com o mesmo
# contexto rico do app original: sequência melódica cantada, histórico
# recente do aluno, e perfil vocal (se disponível).
# ══════════════════════════════════════════════════════════════
import re

import gemini_client
import historico as historico_mod
import avaliacao as avaliacao_mod


def montar_prompt_base(resultado):
    return (
        "Você é um professor de canto experiente, com mentalidade de produtor musical. "
        "Domina afinação, tessitura, respiração, ressonância, interpretação e produção vocal, "
        "e conhece os conceitos deste aplicativo (desvio em cents, % afinado ±50c, frases "
        "sustentadas, pausas respiratórias, vibrato).\n\n"
        "ESTILO: encorajador, mas exigente. Reconheça com sinceridade o que foi bom e aponte "
        "com clareza o que ficou ruim (oscilação entre notas, desafinação, emissão fraca, falta "
        "de apoio respiratório), sem amenizar. Elogie apenas o que realmente foi bom. Cada "
        "apontamento deve citar um dado da análise — nunca seja genérico.\n\n"
        "FORMATO: parecer em 3 seções — PONTOS FORTES, PONTOS A MELHORAR e UM EXERCÍCIO PRÁTICO — "
        "terminando com 1 desafio concreto para a próxima gravação.\n\n"
        f"Dados da análise:\n"
        f"- Nota predominante: {resultado['nota_predominante']}\n"
        f"- Desvio médio absoluto: {resultado['desvio_medio_cents']:.1f} cents\n"
        f"- Tendência: {resultado['tendencia']} ({resultado['desvio_sinal_cents']:+.1f} cents)\n"
        f"- Percentual afinado (±{resultado.get('limite_afinado_cents', 50)} cents): {resultado['pct_afinado']:.1f}%\n"
        f"- Frases sustentadas: {resultado['num_frases']} (média {resultado['sustentacao_media']:.2f} s)\n"
        f"- Pausas respiratórias: {resultado['num_pausas']} (média {resultado['pausa_media']:.2f} s)"
    )


def _sem_oitava(nome):
    return re.sub(r"-?\d+$", "", nome or "").replace("♯", "#").replace("♭", "b")


def _ultimo_exercicio(historico):
    """Procura, nas devolutivas já dadas (a mais recente primeiro), a seção 'UM EXERCÍCIO PRÁTICO'."""
    for a in historico or []:
        m = re.search(r"EXERC[ÍI]CIO PR[ÁA]TICO\W*(.*)", a.get("devolutiva") or "", re.I | re.S)
        if m:
            texto = re.sub(r"[*#_`]+", "", m.group(1))
            texto = re.sub(r"\s+", " ", texto).strip()
            if len(texto) > 20:
                return texto[:600], a.get("nome", "")
    return None, None


def gerar_devolutiva(resultado, nota_ref=None, base_devolutiva="detectada", sequencia_notas=None, escala=None):
    """Gera a devolutiva do professor. Retorna (texto, None) ou (None, motivo_do_erro)."""
    if not gemini_client.gemini_disponivel():
        return None, "Gemini não configurado no servidor (falta GEMINI_API_KEY)."

    prompt = montar_prompt_base(resultado)

    limite = resultado.get("limite_afinado_cents", 50)
    if base_devolutiva == "referencia" and nota_ref:
        prompt += (
            f"\n\nCOMO OS DESVIOS FORAM MEDIDOS: contra a nota de referência {nota_ref}, escolhida pelo aluno."
            f"\nIMPORTANTE: o cantor tentou seguir a nota de referência ({nota_ref}). "
            "Compare a nota detectada com a referência e dê orientações práticas de ajuste."
        )
    else:
        prompt += (
            "\n\nCOMO OS DESVIOS FORAM MEDIDOS: cada trecho foi comparado à nota (semitom) MAIS PRÓXIMA dele, como um "
            "afinador. Por isso os números valem para qualquer nota, escala ou melodia: 'desvio' é o quanto o aluno ficou "
            "aquém ou além da PRÓPRIA nota que cantou — não a distância até uma nota-alvo. "
            f"Considere afinado quem fica dentro de ±{limite} cents."
        )

    detalhe = [n for n in (sequencia_notas or []) if n.get("duracao_s", 0) >= 0.25]
    distintas = sorted({_sem_oitava(n["nota"]) for n in detalhe})

    def _linha(n):
        d = n.get("desvio_cents")
        return f"{n['nota']} ({n['duracao_s']}s" + (f", {d:+.0f}¢" if d is not None else "") + ")"

    if len(distintas) >= 3 and not (base_devolutiva == "referencia" and nota_ref):
        prompt += (
            f"\n\nMODO MELÓDICO: a gravação tem {len(distintas)} notas distintas ({', '.join(distintas)}), ou seja, é uma "
            f"escala ou melodia e NÃO uma nota sustentada. Não existe nota-alvo única; a 'nota predominante' "
            f"({resultado['nota_predominante']}) é só a mais central, não um alvo.\n"
            "Detalhe nota a nota (nota, duração, desvio em cents; + = agudo, − = grave):\n"
            + "\n".join("- " + _linha(n) for n in detalhe[:24]) + "\n"
            "Como avaliar: (1) reconheça o que o aluno cantou — se as notas formam uma escala ou melodia conhecida, diga qual; "
            f"(2) elogie PELO NOME as notas afinadas (dentro de ±{limite}¢), citando o desvio; (3) aponte as que fugiram, "
            "com a direção (agudo ou grave) e o tamanho do erro; (4) NÃO presuma nem invente que ele 'deveria' ter cantado "
            "outra coisa: você só sabe o que está nos dados."
        )
    else:
        if not (base_devolutiva == "referencia" and nota_ref):
            prompt += (
                f"\n\nIMPORTANTE: o cantor cantou com a voz natural. Baseie a devolutiva na nota detectada "
                f"({resultado['nota_predominante']}): avalie estabilidade e afinação em relação à própria nota cantada, "
                "comente a tessitura aparente, e NÃO trate a diferença para uma referência como erro."
            )
        if detalhe:
            prompt += (
                f"\n\nSEQUÊNCIA CANTADA ({len(detalhe)} notas sustentadas): " + " → ".join(_linha(n) for n in detalhe[:15]) +
                ". Analise a oscilação entre essas notas: as transições foram limpas ou arrastadas? Houve oscilação ou "
                "notas inesperadas dentro do que foi cantado?"
            )

    if escala and "erro" not in escala:
        fora = "; ".join(f"{f['nota']} ×{f['vezes']} ({f['dica']})" for f in escala.get("fora", [])[:6]) or "nenhuma"
        prompt += (
            f"\n\nESCALA EM TREINO: o aluno estava praticando {escala['escala']}"
            + (f" (ele escolheu {escala['escala_pedida']}; são as mesmas notas, escritas de outro jeito)"
               if escala.get("escala_pedida") and escala["escala_pedida"] != escala["escala"] else "") + " "
            f"(notas: {escala['notas_da_escala']}; fórmula {escala['formula']}). "
            f"Caráter: {escala['carater']} Desafio vocal típico: {escala['desafio_vocal']}\n"
            f"- Notas cantadas DENTRO da escala: {escala['dentro']} de {escala['total_notas']} "
            f"({escala['pct_dentro']}% das notas, {escala['pct_dentro_tempo']}% do tempo).\n"
            f"- Notas FORA da escala: {fora}.\n"
            f"- Graus da escala que NÃO apareceram: {', '.join(escala['graus_nao_cantados']) or 'todos apareceram'}.\n"
            "Avalie o desempenho NESSA escala: quais graus foram difíceis, se as notas fora foram "
            "aproximações (semitom acima ou abaixo) ou erro de percurso, e termine com um exercício "
            "curto de treino específico dessa escala (ex: cantar em graus, saltos de terça, ida e volta). "
            "Cite os números."
        )

    try:
        historico_completo = historico_mod.listar_historico()
    except Exception:
        historico_completo = []

    exercicio, quando = _ultimo_exercicio(historico_completo)
    if exercicio:
        prompt += (
            f"\n\nÚLTIMO EXERCÍCIO QUE VOCÊ (O PROFESSOR) PASSOU AO ALUNO (devolutiva de {quando}): \"{exercicio}\"\n"
            "Como usar: se esta gravação parece seguir esse exercício, avalie o cumprimento dele. Se o aluno cantou OUTRA "
            "coisa (outras notas, outra escala ou outro tipo de exercício), avalie o que ele cantou pelos próprios méritos — "
            "reconheça o que está afinado e aponte o que fugiu — e apenas mencione, sem penalizar e sem tom de cobrança, que "
            "não era o exercício proposto. Nunca dê um parecer negativo apenas porque a gravação não é o exercício."
        )

    try:
        historico_recente = historico_completo[:5]
        if historico_recente:
            linhas = []
            for a in historico_recente:
                linhas.append(
                    f"- {a.get('nome', '')}: nota {a.get('nota_predominante', '—')}, "
                    f"desvio {a.get('desvio_medio_cents', 0)} cents, {a.get('pct_afinado', 0)}% afinado, "
                    f"tendência {a.get('tendencia', '—')}"
                    + (f", treinando {a['escala']} ({a.get('pct_na_escala', '—')}% dentro)" if a.get("escala") else "")
                    + ("" if a.get("metodo", 1) >= 2 else " [medição ANTIGA: comparada a uma nota só — não compare estes números]")
                )
            prompt += (
                "\n\nHISTÓRICO RECENTE DO ALUNO (mais recente primeiro):\n" + "\n".join(linhas)
                + "\nCompare o desempenho atual com esse histórico, ignorando os números das medições antigas. Se um "
                "problema persiste, cobre diretamente. Se houve melhora, reconheça citando os números."
            )
    except Exception:
        pass

    try:
        perfil = avaliacao_mod.carregar_perfil()
        if perfil:
            prompt += (
                "\n\nPERFIL VOCAL DO ALUNO:\n"
                f"- Voz: {perfil.get('voz_tipo', '—')} — classificação: {perfil.get('classificacao', '—')}\n"
                f"- Extensão: {perfil.get('nota_grave', '—')} a {perfil.get('nota_aguda', '—')} "
                f"({perfil.get('extensao_semitons', '—')} semitons)\n"
                f"- Tessitura confortável: {perfil.get('tessitura', '—')}\n"
                "Respeite a extensão nas sugestões e considere a classificação vocal."
            )
    except Exception:
        pass

    resposta, erro = gemini_client.chamar_texto(prompt)
    if resposta and getattr(resposta, "text", None):
        return resposta.text, None
    return None, erro or "Resposta vazia do Gemini."
