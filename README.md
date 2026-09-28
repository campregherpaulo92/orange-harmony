# 🍊 Orange Harmony — Coaching Vocal com IA

Aplicação completa de coaching vocal: analisa sua voz em tempo real, detecta afinação, vibrato, sustentação e pausas respiratórias, gera devolutiva pedagógica com IA, monta produções musicais, separa stems num mini-estúdio (DAW) e compõe músicas do zero com o Songwriter — tudo isso com a Laranjinha, uma assistente de IA que enxerga e age sobre qualquer parte do app.

🔗 Versão antiga (Streamlit, mantida como referência): [orange-harmony.streamlit.app](https://orange-harmony.streamlit.app)
🖥️ Versão atual: FastAPI + HTML/JS puro, rodando via Google Colab (guia completo mais abaixo)

---

## ✨ Funcionalidades

| Módulo | Descrição |
|---|---|
| 🎵 **Análise de Voz** | Pitch (F0), nota predominante, desvio em cents, % de afinação, BPM e tom |
| 🎸 **Afinador** | Multi-instrumento, 11 afinações (violão, 7 cordas, ukulele, drop tunings), 440/442Hz |
| 🎯 **Vibrato** | Taxa (Hz), extensão (cents), periodicidade e classificação |
| 🤖 **Professor de IA** | Devolutiva pedagógica via Google Gemini (pontos fortes, melhorias, exercício) |
| 📊 **Histórico** | Evolução salva no Firebase Firestore, com filtro por análise |
| 🎼 **Composições** | Letra com cifras, prévia colorida, versionamento |
| ✨ **Edição Vocal** | EQ, compressão, redução de ruído, tom, reverb — por checkbox ou por comando em português interpretado por IA |
| 🎛️ **Produção** | Backing track completo (baixo, bateria, acordes, teclado, solo) em 20 estilos, com assistente de IA que sugere a configuração a partir de uma descrição |
| 🎚️ **Orange Studio** | Mini-DAW: separação de stems (voz/instrumental), forma de onda + espectro ao vivo, mute/solo/volume, corte e deslocamento por faixa (com desfazer), renomear faixas, upload/download individual por faixa |
| 🖋️ **Songwriter** | Letra original em português (Gemini), referência sonora analisada por IA (grava/sobe áudio e a IA descreve o estilo), prompt musical rico, geração de música completa via Hugging Face (YuE2) |
| 🍊 **Laranjinha** | Assistente de IA multi-chat, com memória entre conversas e capacidade de agir: avalia gravações, gera produções, aplica edições, salva composições, renomeia/exclui — tudo por comando de texto |

---

## 🛠️ Stack Tecnológica

- **Backend**: Python 3.10+, FastAPI, Uvicorn
- **Frontend**: HTML/CSS/JavaScript puro (sem framework), Web Audio API
- **Áudio**: Librosa, NumPy, SciPy, Soundfile, Noisereduce, Pydub
- **Separação de stems**: Demucs (modelo `htdemucs`, local)
- **IA de texto/áudio**: Google Gemini (`google-genai`) — devolutiva, Laranjinha, Songwriter, interpretação de comandos
- **IA de geração musical**: Hugging Face (`gradio_client`, espaço `mrfakename/yue2-3b`)
- **Persistência**: Firebase Firestore (histórico, composições, chats) + Firebase Storage (gravações, plano Blaze)
- **Execução**: Google Colab (notebook com todas as células prontas — veja "Como rodar")

---

## 🆕 Atualizações mais recentes

**Edição Vocal — bug de qualidade corrigido**
O "EQ de presença" e a "Compressão" antigos estavam degradando o som em vez de melhorar (medido: o EQ derrubava 91% do pico e 93% da frequência fundamental da voz; a compressão introduzia 12.6% de distorção harmônica espúria). Foram reescritos com processamento de áudio de verdade — um EQ paramétrico peaking e um compressor com envelope (attack/release/ratio) — e a normalização final agora sempre roda no fim da cadeia, então a edição nunca mais deixa o resultado mais baixo que o original.

**Songwriter reescrito**
Passou a usar `gradio_client` conectando no espaço `mrfakename/yue2-3b` na Hugging Face — a mesma integração que o app original usava, em vez de uma API genérica incompatível. A letra em português (gerada pelo Gemini, considerando o perfil vocal do usuário) virou a fonte principal da composição. Foi adicionada a análise de referência sonora: um trecho gravado ou enviado é ouvido pelo Gemini, que descreve estilo, clima e instrumentação — isso entra automaticamente no prompt de geração.

**Produção musical expandida**
Foram adicionados 8 estilos musicais novos (total de 20, incluindo Samba, Pagode, Axé, Bossa Nova, Trap, entre outros), duas camadas de instrumento novas (Teclado, com acordes arpejados, e Solo, com linha melódica), e um assistente de IA que sugere toda a configuração (estilo e instrumentos) a partir de uma frase descrevendo o resultado desejado.

**Tom de referência mais musical**
A síntese do tom de referência (aba Estudo) ganhou vibrato sutil e reverb leve, saindo de um som seco e sintético pra algo mais próximo de um instrumento de verdade.

**Orange Studio — recursos de DAW**
- Espectro de frequências ao vivo durante a reprodução (antes só existia a forma de onda estática)
- Nomes de faixa editáveis — a Laranjinha reconhece o nome mencionado na mensagem (ex: "abaixa o volume da guitarra") sem precisar trocar de menu
- Corte (início/fim) e deslocamento (adiantar/atrasar) por faixa, com desfazer de 1 nível
- Upload de substituição e download individual por faixa

---

## 🚀 Como rodar (Google Colab)

O app roda inteiro dentro do Google Colab, sem precisar de instalação local:

1. Abra o notebook `orange_harmony_backend_colab.ipynb` no Google Colab
2. Execute as células na ordem (▶️ em cada uma)
3. Na célula de credenciais, cole sua chave do [Google AI Studio](https://aistudio.google.com/apikey) (Gemini) e, opcionalmente, um token da [Hugging Face](https://huggingface.co/settings/tokens) (necessário só pra gerar música de verdade no Songwriter)
4. Suba o arquivo `firebase_service_account.json` quando solicitado
5. Ao rodar a célula do servidor, um link público aparece — é o app rodando

**Importante**: se você trocar uma chave depois de já ter iniciado o servidor, precisa rodar a célula do servidor de novo — ele só lê as chaves no momento em que é iniciado.

---

## 📁 Estrutura do projeto

```
orange-harmony-web/
├── backend/
│   ├── main.py                 # rotas da API (FastAPI)
│   ├── audio_analysis.py       # pitch, BPM, tom, vibrato
│   ├── edicao_dsp.py           # EQ, compressor, redução de ruído
│   ├── producao_dsp.py         # baixo, bateria, acordes, teclado, solo
│   ├── songwriter.py           # letra, referência sonora, geração via YuE2
│   ├── stems.py                # separação de stems (Demucs)
│   ├── laranjinha.py           # assistente de IA com function calling
│   ├── estudio_agente.py       # agente embutido no Estúdio
│   ├── gemini_client.py        # cliente Google Gemini
│   ├── firebase_config.py      # Firestore + Storage
│   └── ...
└── frontend/
    ├── index.html
    ├── app.js, estudio.js, songwriter.js, producao.js, edicao.js, ...
    └── styles.css
```

---

## 📄 Licença

Projeto pessoal — uso e estudo próprio.
