# 🍊 Orange Harmony — Professor de Canto com IA

Aplicação web que analisa sua voz em tempo real, detecta afinação, vibrato, sustentação e pausas respiratórias, e gera um feedback pedagógico completo com IA — como um professor particular de canto.

🔗 **App publicado:** [orange-harmony.streamlit.app](https://orange-harmony.streamlit.app)

---

## ✨ Funcionalidades

| Módulo | Descrição |
|--------|-----------|
| 🎵 **Análise de Voz** | Extração de pitch (F0), nota predominante, desvio em cents, % de afinação |
| 🎸 **Afinador** | Afinador multi-instrumento com 11 afinações (violão, 7 cordas, ukulele, drop tunings) |
| 🎯 **Vibrato** | Detecção de taxa (Hz), extensão (cents), periodicidade e classificação |
| 🤖 **Professor de IA** | Devolutiva pedagógica personalizada via Google Gemini (pontos fortes, melhorias, exercício) |
| 📊 **Histórico** | Evolução da performance salva no Firebase Firestore |
| 🎼 **Composições** | Criação e versionamento de letras com cifras e seções |
| ✨ **Edição Vocal** | Redução de ruído, normalização, ajuste de tom e EQ via comandos de texto |

---

## 🛠️ Stack Tecnológica

- **Python 3.10+**
- **Streamlit** — interface web
- **Librosa** — processamento de áudio e extração de pitch
- **NumPy** — computação numérica
- **Matplotlib** — gráficos de curva de pitch
- **Google Gemini API** — professor de IA (modelo `gemini-3.6-flash`)
- **Firebase Firestore** — histórico e composições
- **Noisereduce** — redução de ruído na edição vocal

---

## 🚀 Como rodar localmente

```bash
# 1. Clone o repositório
git clone https://github.com/SEU_USUARIO/orange-harmony.git
cd orange-harmony

# 2. Crie e ative o ambiente virtual
python -m venv venv
venv\Scripts\activate        # Windows
# source venv/bin/activate   # Linux/Mac

# 3. Instale as dependências
pip install -r requirements.txt

# 4. Configure as variáveis de ambiente
#   GEMINI_API_KEY = sua chave do Google AI Studio
#   GOOGLE_APPLICATION_CREDENTIALS_JSON = conteúdo do firebase_service_account.json

# 5. Rode o app
streamlit run app.py
