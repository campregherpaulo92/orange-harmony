# 🍊 Orange Harmony — Coaching Vocal com IA

Aplicação completa de coaching vocal e composição: analisa sua voz, detecta afinação, vibrato e sustentação, gera devolutiva pedagógica com IA, identifica acordes no braço do violão, monta produções musicais, separa stems num mini-estúdio (DAW) e compõe músicas do zero com o Songwriter — tudo isso com a **Laranjinha**, uma assistente de IA que enxerga e age sobre qualquer parte do app.

🌐 **App no ar:** [orange-harmony.onrender.com](https://orange-harmony.onrender.com) *(plano gratuito — se ficar parado, a primeira abertura pode levar cerca de 1 minuto)*
🕰️ **Versão antiga (Streamlit, mantida como referência):** [orange-harmony.streamlit.app](https://orange-harmony.streamlit.app)

---

## 📸 Telas

| Acordes | Orange Studio |
|---|---|
| ![Aba Acordes identificando um Am7](screenshots/acordes.png) | ![Card do separador de stems no Estúdio](screenshots/estudio-separador.png) |
| Monte o acorde no braço e veja o nome, as notas, as tonalidades e as escalas | O separador de stems roda no Colab; o card mostra sozinho se ele está ligado |

---

## ✨ Funcionalidades

| Módulo | Descrição |
|---|---|
| 📋 **Avaliação** | 5 exercícios vocais (nota grave, aguda, confortável, glissando, frase) que geram o perfil: classificação, extensão e tessitura. O professor usa esse perfil nas análises |
| 🎵 **Estudo** | Análise de voz: pitch (F0), nota predominante, desvio em cents, % de afinação, vibrato (taxa, extensão, periodicidade), curva de pitch, BPM e tom. Devolutiva do **Professor de IA** (Gemini). Tom de referência e escala maior em **piano sintetizado** |
| 🎸 **Afinador** | 11 afinações (violão, 7 cordas, ukulele, drop tunings, open tunings), calibração 440/442 Hz, agulha em tempo real |
| 🎶 **Acordes** | Braço de violão clicável: você marca as notas e o app diz o **nome do acorde** (com alternativas), as **notas**, as **tonalidades** onde ele é diatônico (com o grau, ex: vi7) e as **escalas** que dá pra tocar por cima. Também **procura por nome** (Am7, C7M, F#m, G/B…) e mostra posições no braço. Toca o acorde (violão sintetizado), insere na composição e leva a pergunta pra Laranjinha |
| 🎙️ **Biblioteca** | Grava ou sobe áudios, salva no Firebase Storage e lista as gravações |
| 📊 **Histórico** | Evolução das análises salvas no Firestore, com filtro por análise e devolutiva |
| 🎼 **Composições** | Letra com cifras `[Am]` e seções `#`, prévia colorida, versionamento |
| 🔄 **Conversor** | WAV, MP3, FLAC, OGG e M4A, vários formatos de uma vez |
| 🎛️ **Produtor** | Backing track com baixo, bateria, acordes, teclado e solo em **20 estilos** (Pop, Rock, Balada, Sertanejo, Funk, MPB, Gospel, Reggae, Blues, Jazz, Forró, Eletrônica, Samba, Pagode, Axé, Bossa Nova, Country, R&B, Trap e Metal). Um assistente de IA sugere a configuração a partir de uma frase |
| ✨ **Edição Vocal Inteligente** | EQ de presença, compressão, redução de ruído, sibilância, ajuste de tom e reverb — por checkbox ou por **comando em português** interpretado por IA |
| 🤖 **Songwriter** | Letra original em português (Gemini), referência sonora analisada por IA, prompt musical e geração da música completa via Hugging Face (YuE2) |
| 🍊 **Laranjinha** | Assistente de IA multi-chat, com memória entre conversas, que **age**: avalia gravações, gera produções, aplica edições, salva composições, renomeia e exclui, e consulta o motor de acordes |
| 🎚️ **Orange Studio** | Mini-DAW: separação de stems (voz e instrumental), forma de onda e espectro ao vivo, mute/solo/volume, corte e deslocamento por faixa (com desfazer), renomear faixas, substituir e baixar por faixa, e um agente de IA que aplica ajustes por texto |

---

## 🏗️ Como as peças se encaixam

```
 Navegador ──► Render (FastAPI + front-end) ──► Firebase (Firestore + Storage)
                    │                                   ▲
                    ├──► Google Gemini                  │  fila de trabalhos
                    └──► Hugging Face (YuE2)            │  + batida de coração
                                                Google Colab (Demucs) ─┘
```

- **Render** hospeda o app (front-end e API no mesmo endereço). Um monitor gratuito (UptimeRobot) checa o endereço a cada 5 minutos para o serviço não dormir.
- **Firebase** guarda histórico, composições, chats e gravações.
- **Separação de stems:** o Demucs não cabe nos 512 MB do plano gratuito, então roda no **Google Colab**. O app e o Colab conversam pelo Firebase: o app deixa o áudio no Storage e cria um trabalho no Firestore; o Colab (ligado) pega, separa e devolve os stems em MP3. O card do Estúdio descobre sozinho se o Colab está ligado (ele avisa a cada ~20 s). **Não há link para copiar e colar.**

---

## ⚠️ Limites do plano gratuito

| Assunto | O que acontece |
|---|---|
| **Memória e CPU** (512 MB, 0,1 vCPU) | Análise, Produção e Edição processam no máximo os **primeiros 120 segundos** do áudio, e a tela avisa quando corta. Em testes locais, os picos ficaram em torno de 374 MB (análise), 435 MB (produção) e 460 MB (edição) com áudios de 3 min |
| **Servidor dorme** | Depois de 15 min sem acesso. O monitor de 5 min evita isso |
| **Separar stems** | Precisa do Colab ligado (veja abaixo). Sem ele, o Estúdio mostra o card explicando o que fazer |
| **Songwriter (música)** | A geração roda numa GPU compartilhada da Hugging Face, cuja cota diária é pequena no nível gratuito — conta grátis rende poucas músicas por dia. O modelo lista apenas inglês e chinês, então letras em português podem sair menos naturais |
| **Gemini** | Uma chave do nível gratuito tem limites de uso por minuto e por dia |

---

## 🛠️ Stack Tecnológica

- **Backend:** Python, FastAPI, Uvicorn
- **Frontend:** HTML, CSS e JavaScript puro (sem framework), Web Audio API
- **Áudio:** Librosa, NumPy, SciPy, Soundfile, Noisereduce, Pydub, `imageio-ffmpeg` (ffmpeg embutido)
- **Separação de stems:** Demucs (`htdemucs`), no Colab (ou local, se o servidor tiver torch e demucs instalados)
- **IA de texto e áudio:** Google Gemini (`google-genai`) — devolutiva, Laranjinha, Songwriter e interpretação de comandos. O app descobre os modelos disponíveis na chave e tenta do mais rápido ao mais capaz
- **IA de geração musical:** Hugging Face (`gradio_client`, espaço `mrfakename/yue2-3b`)
- **Persistência:** Firebase Firestore e Storage (plano Blaze)
- **Hospedagem:** Render (serviço web) + Google Colab (separador de stems)

---

## 🚀 Publicar no Render

1. Crie um **Web Service** apontando para este repositório.
2. Configure:
   - **Root Directory:** `backend`
   - **Build Command:** `pip install -r requirements.txt`
   - **Start Command:** `uvicorn main:app --host 0.0.0.0 --port $PORT`
3. Em **Environment**, adicione as variáveis:

| Variável | Para quê |
|---|---|
| `GEMINI_API_KEY` | Chave do [Google AI Studio](https://aistudio.google.com/apikey) (Professor, Laranjinha, Songwriter) |
| `HF_TOKEN` | Token da [Hugging Face](https://huggingface.co/settings/tokens), só para gerar música no Songwriter |
| `GOOGLE_APPLICATION_CREDENTIALS_JSON` | Conteúdo **inteiro** do `firebase_service_account.json` |
| `FIREBASE_STORAGE_BUCKET` | Nome do bucket do Firebase Storage |
| `COLAB_SEPARADOR_URL` | *(opcional)* endereço do notebook, se você mover ele de lugar |

> 🔒 **Nunca** coloque chaves ou o JSON do Firebase no repositório. Elas vivem só nas variáveis de ambiente.

---

## 🎚️ Ligar o separador de stems (Colab)

O botão do card do Estúdio abre o notebook direto do GitHub. Na primeira vez:

1. *(opcional, bem mais rápido)* **Ambiente de execução → Alterar tipo → GPU T4**
2. **Ambiente de execução → Executar tudo**
3. Escolha o arquivo `firebase_service_account.json` quando pedir
4. Quando aparecer **🟢 Separador ligado**, volte ao app: o card fica verde sozinho

Deixe a última célula rodando enquanto usar o Estúdio. O notebook fica em [`notebooks/separador_stems.ipynb`](notebooks/separador_stems.ipynb).

---

## 💻 Rodar localmente

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

export GEMINI_API_KEY="..."
export GOOGLE_APPLICATION_CREDENTIALS_JSON="$(cat firebase_service_account.json)"
export FIREBASE_STORAGE_BUCKET="seu-bucket.firebasestorage.app"

uvicorn main:app --reload --port 8000
# abra http://localhost:8000
```

Para separar stems na própria máquina (sem Colab), instale também `demucs torch torchaudio torchcodec` — o app detecta e passa a usar o Demucs local.

---

## 📁 Estrutura do projeto

```
orange-harmony/
├── backend/
│   ├── main.py                 # rotas da API (FastAPI)
│   ├── audio_analysis.py       # pitch, BPM, tom, vibrato (em blocos, memória constante)
│   ├── acordes.py              # teoria de acordes: identificar, procurar, escalas e tonalidades
│   ├── edicao_dsp.py           # EQ, compressor, redução de ruído, ajuste de tom
│   ├── producao_dsp.py         # baixo, bateria, acordes, teclado, solo
│   ├── songwriter.py           # letra, referência sonora, geração via YuE2
│   ├── stems.py                # separação de stems (Demucs)
│   ├── estudio_fila.py         # fila app <-> Colab (Firestore + Storage)
│   ├── estudio_agente.py       # agente embutido no Estúdio
│   ├── laranjinha.py           # assistente de IA com ferramentas
│   ├── gemini_client.py        # cliente Google Gemini
│   ├── firebase_config.py      # Firestore + Storage
│   └── ...
├── frontend/
│   ├── index.html
│   ├── app.js, estudio.js, acordes.js, songwriter.js, producao.js, edicao.js, ...
│   └── styles.css
├── notebooks/
│   ├── separador_stems.ipynb   # separador de stems (abre pelo botão do app)
│   └── separador_worker.py     # código que o notebook executa
└── screenshots/
```

*(Os arquivos `app.py` e `requirements.txt` na raiz são da versão antiga em Streamlit.)*

---

## 🗺️ Próximos passos

- [ ] **Produção com IA:** gerar baixo, bateria e backing track via Hugging Face, com um campo de prompt (ex: "respeitar o padrão da música", "solo de contrabaixo no meio", "pausa na bateria")
- [ ] **Estúdio:** quando o agente gerar uma faixa nova, criar e abrir ela como nova track
- [ ] **Estúdio:** arrastar na linha do tempo para avançar e voltar a música
- [ ] **Acordes:** campo para digitar as notas ("Lá, Dó, Mi, Sol") e descobrir o acorde
- [ ] **Colab:** guardar o JSON do Firebase nos Segredos, para não escolher o arquivo toda vez

---

## 📝 Histórico de versões

**v9 — hospedagem e acordes**
- Migração para o Render, com monitor de 5 min contra o sono do servidor
- Separador de stems via Colab, comunicando pelo Firebase (card visual, detecção automática)
- Nova aba **Acordes**, com ferramentas na Laranjinha
- Análise, produção e edição em blocos e limitadas a 120 s, para caber em 512 MB
- Gravador converte para WAV no navegador (Chrome, Safari/iPhone e Firefox)
- Novo piano sintetizado no tom de referência e na escala
- Aba Gravador renomeada para **Biblioteca**, e ícone da aba do navegador

**Versões anteriores**
- Edição Vocal: EQ paramétrico e compressor com envelope reescritos (o EQ antigo derrubava 91% do pico da voz)
- Songwriter: passou a usar `gradio_client` com o espaço `mrfakename/yue2-3b`, mais análise de referência sonora
- Produção: 20 estilos, camadas de teclado e solo, assistente de IA
- Orange Studio: espectro ao vivo, corte, deslocamento, desfazer, nomes de faixa editáveis, substituir e baixar por faixa

---

## 📄 Licença

Projeto pessoal — uso e estudo próprio.
