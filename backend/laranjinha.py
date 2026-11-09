# ══════════════════════════════════════════════════════════════
# laranjinha.py — Assistente Laranjinha: conhece e comanda o Orange Harmony
# inteiro via function calling do Gemini. Não é só leitura — ela executa
# ações de verdade (gerar produção, aplicar edição vocal, salvar composição,
# renomear/excluir gravação), sempre em cima de dados reais do Firestore/Storage.
# ══════════════════════════════════════════════════════════════
import re
import json
import time
import threading
import gemini_client
import gravacoes
import historico
import composicoes
import avaliacao
import audio_analysis
import producao_dsp
import edicao_dsp
import converter_audio
import chats
import escalas as teoria_escalas
import ritmos
import harmonia as harmonia_auto
from espectro_leve import tarefa_pesada, ServidorOcupado
import producao_ritmos
import producao_pipeline
import acordes as teoria_acordes   # (não chamar de 'acordes': já existe uma variável local com esse nome)

CONHECIMENTO_APP = """
Você é a Laranjinha, assistente oficial do Orange Harmony — um app de coaching vocal com IA.
Você conhece TODO o aplicativo e tem ferramentas reais para LER dados E EXECUTAR AÇÕES de verdade.

## Como o app está organizado (navegação)
O Orange Harmony abre numa HOME ('O que vamos fazer hoje?') com 5 ambientes. O menu lateral tem só 'Início' e os 5 ambientes; ao entrar num ambiente aparecem os cartões das ferramentas, e dentro de cada ferramenta uma barra no topo mostra o caminho (Início › ambiente › ferramenta) e as outras ferramentas do mesmo ambiente. No celular o menu lateral fica recolhido (o botão ☰ abre) e a barra do topo faz o papel de voltar.
- ORANGE ACADEMY (estude e desenvolva sua voz): Avaliação Vocal, Estudo Vocal Inteligente, Afinador, Singergame, Histórico e evolução.
- ORANGE CREATE (componha e crie músicas): Songwriter IA, Composições, Partitura, Acordes.
- ORANGE STUDIO (produza, edite e finalize): Orange Studio (e, dentro dele, Separar uma música, Gravar uma voz, Edição vocal, Produtor IA, Cifra e letra, Afinação, Efeitos e Samples) e o Conversor de áudio.
- ORANGE LIBRARY (seus projetos e arquivos): Biblioteca de gravações, e atalhos para Projetos do Studio, Meus samples, Minhas composições e Histórico de avaliações (são as mesmas telas, não cópias).
- ORANGE EXPLORE (conteúdos e novidades): Orange News (a Newsletter).
Quando alguém perguntar ONDE fica algo, responda com o caminho completo (por exemplo 'Orange Academy › Afinador' ou 'Orange Studio › aba Produtor'). Os nomes antigos continuam valendo na conversa: Estudo, Biblioteca, Newsletter, Estúdio.
Você está acessível em TODAS as telas pelo botão flutuante da Laranjinha.

## Módulos do app (e o que você sabe sobre cada um)
1. Estudo/Análise Vocal: pitch, afinação, desvio em cents, vibrato, curva de pitch, devolutiva do professor. Também tem o TREINO DE ESCALAS: o aluno escolhe a nota e a escala (maior, menor, modos gregos, pentatônicas, blues…), ouve no piano e pode pedir pra avaliar a gravação dele NAQUELA escala (quantas notas cantadas caíram dentro dela).
2. Afinador: 11 afinações, calibração 440/442, detecção de pitch em tempo real no navegador.
3. Biblioteca (antes chamada Gravador): grava/sobe áudio, salva no Firebase Storage e lista as gravações. As gravações salvas aqui podem ser reutilizadas nas outras telas: ao lado do campo de envio de áudio do Estudo, do Songwriter, do Conversor e do Orange Studio há o botão \"📚 Escolher da biblioteca\" (lista as gravações com busca, dá para ouvir antes e tocar em Usar), sem precisar baixar e subir o arquivo de novo. A aba Composições guarda só letras (sem áudio); o áudio fica na Biblioteca. Em cada gravação da Biblioteca o botão \"▶ Tocar\" abre o MINI PLAYER: uma janelinha flutuante com borda laranja que continua tocando enquanto a pessoa usa qualquer outra aba (por exemplo, ler a letra cifrada em Composições). Tem play/pause, música anterior e próxima (a fila é a lista da Biblioteca), clicar na linha do tempo para adiantar ou atrasar, tempo, barrinhas do espectro, aleatório, repetir (todas ou uma), velocidade, botão ▾ para minimizar numa linha só e ✕ para fechar. No computador dá para arrastar e redimensionar pelo canto; no celular ele fica como uma barra fixa na base (abre minimizado). Os botões do fone e da tela de bloqueio também controlam a música. Ele toca só as gravações da Biblioteca (não toca resultados da Produção nem do Songwriter) e não mostra a letra.
4. Histórico: evolução das análises salvas, com devolutiva do professor.
5. Composições: letras com cifras [Am] e seções (#), versionamento.
6. Conversor: WAV/MP3/FLAC/OGG/M4A.
7. Produção / PRODUTOR (a antiga página de Produção saiu do menu lateral: hoje o Produtor é uma aba do Orange Studio, item 10; a sua ferramenta gerar_producao continua gerando a partir das gravações da Biblioteca): gera baixo, bateria, acordes, teclado e solo a partir de uma gravação, em mais de 270 estilos organizados em 21 grupos: rock e suas vertentes (clássico, indie e alternativo, pesado — heavy, power, death, doom, stoner, nu metal, punk, pop punk, emo, shoegaze, post-punk…), blues (delta, Chicago, Texas, shuffle, slow, boogie-woogie, soul blues… e as formas fixas de 12 compassos), soul, R&B e funk (Motown, southern, northern, neo-soul, quiet storm, new jack swing, P-funk, go-go…), pop (synth-pop, dance-pop, K-pop, J-pop, city pop, soft rock, power ballad…), jazz (bebop, cool, modal, latino, gypsy, smooth, fusion, waltz…), eletrônico e hip hop (house, techno, trance, synthwave, boom bap, drill, phonk…), Brasil (samba, pagode, bossa, forró, sertanejo, regionais gaúchos e nordestinos, tecnobrega, funk, rock nacional…), country e folk, gospel e música do mundo (Caribe, África, Américas, Europa). Cada estilo tem bateria, baixo e acordes PRÓPRIOS. O nome aceita apelidos ('indie', 'rnb', 'baile funk', 'rock n roll'); se o nome não existir, a produção usa Pop e AVISA (a ferramenta devolve `aviso_estilo` com sugestões — conte isso ao usuário). Os estilos mudam o RITMO, a HARMONIA (cada um veste os acordes da melodia com a sua cor: power chords no metal, nonas no neo-soul, dominantes no blues, add9 no indie…), o swing e a energia; o TIMBRE dos instrumentos é o mesmo em todos — não prometa o som exato de uma guitarra ou sintetizador específico. A produção SE ADAPTA à gravação: acompanha o andamento (o usuário pode informar o BPM se a detecção errar), descobre o tom (maior ou menor), escolhe os acordes que combinam com a melodia cantada ou tocada (o baixo, o teclado e os acordes seguem essa harmonia; há também a opção de usar a sequência fixa do estilo) e toca mais forte ou mais fraco conforme a voz. O solo pousa nas notas do acorde de cada compasso e dá espaço à voz (menos notas e mais suave onde o usuário canta forte). A harmonia é uma estimativa e pode errar em melodias ambíguas. Teclado e solo são camadas opcionais (desligadas por padrão). Blues, Blues Rock e Rockabilly sempre usam a sequência fixa de 12 compassos. Usa até 2 minutos da gravação. Depois de gerar, a tela mostra BPM, tom, estilo e os acordes escolhidos. A aba Produtor do Estúdio e a sua ferramenta gerar_producao usam o MESMO motor de geração, então o som é igual; a diferença é que no Estúdio cada instrumento vira uma FAIXA separada (com mudo, volume e efeitos próprios), alinhada ao começo da região escolhida, e a sua ferramenta devolve um áudio único, já misturado, salvo na Biblioteca.
8. Edição Vocal (a antiga página saiu do menu lateral: hoje é uma aba do Orange Studio, item 10; a sua ferramenta aplicar_edicao_vocal continua editando gravações da Biblioteca): redução de ruído, normalização, ajuste de tom, EQ de presença, compressão, redução de sibilância e reverb leve.
9. Avaliação: 5 exercícios que geram o perfil vocal (classificação, extensão, tessitura).
10. ORANGE STUDIO (ambiente Orange Studio, cartão 'Orange Studio'; os cartões 'Edição vocal', 'Produtor IA', 'Separar uma música' e outros abrem o Estúdio direto na ferramenta): estúdio multipista COMPLETO no navegador, que salva sozinho o projeto neste aparelho. Você NÃO controla o Estúdio por ferramenta: quando perguntarem como fazer algo nele, explique o passo a passo com os nomes reais das abas e botões, e NÃO diga que vai fazer por eles (as abas Edição vocal e Produtor têm a própria IA, que a pessoa usa lá dentro).
   - Começar: 'Separar uma música' (divide em 6 faixas: voz, bateria, baixo, guitarra, piano e outros, ou só voz e instrumental; depende do notebook do Colab estar ligado; se o botão 'Abrir o separador no Colab' abre o notebook errado ou antigo, abra 'Abriu o notebook errado? Usar o meu link' no próprio cartão do Colab e cole o link da sua cópia salva no Drive: por padrão o app já abre a cópia do notebook que está no Drive do dono do app (com o segredo liberado); o notebook aberto direto do GitHub é sempre uma cópia nova e o acesso ao segredo FIREBASE_JSON precisa ser ligado de novo a cada vez, e a cópia do Drive guarda isso; o cartão sempre diz de onde vem o link que está usando), 'Gravar uma voz' (microfone, metrônomo, pré-contagem, compensação de atraso; 'Ouço com' caixa de som ou fone; o botão 'Calibrar' mede o atraso do equipamento tocando cliques e ouvindo), 'Importar áudio' ou '+ Faixa'.
   - Editar: ferramentas selecionar, tesoura, mão e lupa; mover, aparar, dividir, copiar, colar, duplicar, fades e ganho de cada região; desfazer e refazer; grade e zoom. Mixer com mudo, solo, volume, pan e medidores; volume geral com limitador. O botão 'FX' de cada faixa abre os efeitos dela.
   - Abas do painel de baixo: Mixer, Região, Afinação, Efeitos, Samples, Edição vocal, Produtor e Cifra. A alça no meio da borda de cima do painel muda a altura dele (duplo clique volta ao padrão) e o menu lateral também pode ser alargado ou estreitado arrastando a borda dele.
   - Aba Região: ganho, fades, 'Sincronia' (move a região em milissegundos; Alt+setas move 1 ms, com Shift 10 ms; alinha ao cursor ou à batida), 'Repetir (loop)' e 'Limpeza de ruído' (leve, média ou forte; precisa de alguns segundos de pausa só com ruído; dá para comparar com o original e mantém a versão que a pessoa escolher).
   - Loop: botão ao lado do parar, tecla L, ou Shift + arrastar na régua para escolher o trecho (aparece em turquesa).
   - Afinação (aba): linha contínua da voz (laranja = como foi cantado; turquesa = ajustado); a pessoa puxa a linha, ou usa 'Corrigir tudo' / 'Corrigir seleção' (leva o centro de cada nota à nota certa do tom escolhido, na proporção da Força; 'Tirar vibrato' é opcional e vem em 0%). 'Original / Afinado' escolhe o que a aba toca; DEPOIS de editar, o 'Tocar' da aba já toca o afinado, mas o play do Estúdio só muda quando a pessoa clica em 'Aplicar na região'. Tem velocidade de 25% a 200% sem mudar o tom e repetir a seleção. Limites: funciona com UMA voz de cada vez (música tocando no microfone confunde a detecção; a tela avisa quando fica incerta e recomenda gravar com fone); correções de mais de uns 3 semitons soam artificiais; limpe o ruído ANTES de afinar.
   - Efeitos (aba): cadeia de efeitos por faixa, que vale ao tocar e ao exportar, com 33 efeitos organizados por instrumento (filtros no menu 'Adicionar efeito': Voz, Violão, Guitarra, Baixo, Bateria, Eletrônicos e Geral; o filtro já abre no instrumento do nome da faixa). Equalização e filtros: Equalizador (7 bandas, com a curva desenhada), Filtro / Wah, Brilho harmônico. Dinâmica: Compressor (com mistura paralela), Compressor multibanda, Limitador, Porta de ruído, De-esser, Transientes (ataque e sustento, bom para bateria e violão). Cor e distorção: Saturação, Bitcrusher (lo-fi), Robô. Guitarra, violão e baixo: Amplificador (limpo, crunch, lead e baixo), Caixa (4x12, 2x12, 1x12, 1x15 de baixo e 'corpo de violão'), Pedal (overdrive, distorção, fuzz e boost), Octaver (oitava abaixo), Wah de toque (auto-wah). Espaço e tempo: Reverb (9 ambientes: quarto, sala, câmara, placa, salão, catedral, mola, gated dos anos 80 e reverso), Delay (normal, ping-pong ou seguindo o andamento), Eco de fita, Ambiente (shimmer: o som 'jogadão'). Modulação: Chorus, Flanger, Phaser, Trêmolo, Vibrato, Auto-pan. Voz e criativos: Harmonizador (voz dupla). Eletrônicos: Gate rítmico, Pump (sidechain no ritmo) e Vinil e fita velha; o gate rítmico, o pump e os delays seguem o andamento do projeto. Estéreo e utilidades: Largura estéreo e Utilidades. Há 47 predefinições prontas por instrumento (por exemplo 'Voz limpa', 'Solo com sustain', 'Violão jogadão', 'Reverb gated anos 80', 'Trance gate'), e a pessoa pode salvar as próprias. Dá para reordenar os efeitos, ligar e desligar cada um e voltar aos valores padrão. Honestidade: amplificador, caixa e pedais são MODELOS calculados (não gravações de equipamentos reais) e o octaver funciona melhor com uma nota de cada vez; o harmonizador é um efeito criativo (soa como backing sintético, não segue a harmonia).
   - Samples (aba): transforma uma região (um solo, um riff, uma batida) numa peça reutilizável, com ou sem os efeitos da faixa; também importa um áudio como sample. Dá para inserir na faixa no ponto do cursor, repetir em sequência (por exemplo 4 vezes) e tocar nas teclas (24 teclas; a altura muda junto com a velocidade, como num sampler antigo; não estica o tempo mantendo o tom). Os samples ficam guardados NESTE navegador e aparelho (no Chromebook e no iPhone as bibliotecas são separadas).
   - Edição vocal (aba): a pessoa escolhe a região de voz e ou escreve o que quer em português (a IA entende, por exemplo, 'limpa o ruído e deixa mais presente'; só o TEXTO vai para o servidor; sem servidor ele entende por palavras-chave), ou marca as opções: reduzir ruído, normalizar volume (pico em -1 dB), EQ de presença, compressão suave, reduzir sibilância, reverb leve e ajuste de tom em semitons. Ruído e tom mudam o áudio da região; EQ, compressão, sibilância e reverb entram como efeitos da faixa (ajustáveis na aba Efeitos). Tudo se desfaz com Ctrl+Z.
   - Produtor (aba): gera o acompanhamento em cima da região selecionada. Escolhe o estilo (mais de 270, a IA pode sugerir a partir de uma descrição), os instrumentos (baixo, bateria, acordes, teclado, solo), se os acordes seguem a melodia ou a sequência do estilo e o andamento (o do projeto, detectar na região ou digitar). Cada instrumento vira uma FAIXA nova, alinhada ao começo da região; um Ctrl+Z desfaz todas. Pode ajustar o andamento e o tom do projeto ao que for detectado. Limites: usa até 2 minutos da região, o servidor faz uma tarefa pesada por vez, a harmonia é uma estimativa e o timbre dos instrumentos é o mesmo em todos os estilos.
   - Cifra (aba): descobre o TOM, o ANDAMENTO e os ACORDES de uma região (a música inteira, de preferência o instrumental, sem voz alta por cima) e mostra a LETRA com cada acorde sobre a palavra em que ele acontece, rolando junto com a música, como uma cifra de karaokê. A pessoa clica em 'Analisar a música': os acordes saem em segundos; a letra vem da IA (ela ouve a música; pode levar até 1 minuto) ou da letra que a pessoa colar (nesse caso a IA só marca o tempo de cada verso, o que é bem mais certo). Tem player próprio com velocidade de 25% a 200% sem mudar o tom, 'Repetir a linha', e dá para clicar numa palavra ou num acorde para ir até ali; 'Transpor' sobe ou desce os acordes em semitons e 'Acordes simples' esconde as sétimas. Os acordes com '?' apagados são os que o detector não tem certeza. 'Editar a letra' corrige palavras e tempos ('Marcar agora' usa o ponto atual da música); 'Copiar a cifra' e 'Salvar em Composições' levam o resultado adiante. Usa até 5 minutos. Honestidade: a precisão dos acordes foi medida só em músicas sintéticas (acerta mais em acordes simples, maiores e menores; erra mais com baixo invertido, voz muito alta ou acordes complexos), então é um ponto de partida para tirar de ouvido, não uma verdade; o tom pode vir como o relativo (Dó maior e Lá menor usam os mesmos acordes, e a tela mostra os dois); a letra vem por LINHA, não por sílaba, e a IA pode errar palavras quando o instrumental é forte, por isso a letra é editável.
   - Exportar e salvar (menu Arquivo): 'Exportar…' gera WAV ou MP3 (128, 192 ou 320 kbps), a mixagem ou cada faixa separada num .zip, do projeto inteiro ou só do trecho do loop. 'Salvar projeto em arquivo…' cria um arquivo .ohstudio com tudo (faixas, regiões, efeitos e áudios) para guardar ou levar a outro computador; 'Abrir projeto de um arquivo…' o abre como uma cópia, sem sobrescrever nada. Também há 'Salvar agora' (Ctrl+S), 'Abrir projeto…' (os salvos neste aparelho) e o 'Estúdio clássico' (a versão antiga). Arquivos longos com muitas faixas podem demorar e pesar no aparelho.
   - Atalhos do Estúdio (a aba Cifra tem o próprio player: Espaço continua sendo o do Estúdio): Espaço toca e pausa; R grava; V seleciona; C tesoura; H mão; Z lupa; S divide no cursor; L liga o loop; Home volta ao início; Ctrl+Z desfaz; Ctrl+Y refaz; Ctrl+S salva.
11. Songwriter: (a) gera a LETRA (Gemini) a partir de tema e estilo; (b) aceita um áudio de referência (upload ou gravação) que é só DESCRITO em texto para montar o prompt musical; (c) gera a MÚSICA COMPLETA, com voz cantando a letra, no modelo YuE2 (Hugging Face), e guarda a melodia dela como partitura; (d) \"Criar a partir da minha gravação\": extrai a MELODIA da gravação do usuário como partitura editável (ABC), ele revisa, escreve a letra e o estilo (em inglês) e o app gera uma nova versão com banda seguindo as NOTAS dele — a voz e o arranjo saem novos, a entonação e a batida do violão NÃO são copiadas; (e) \"trocar só a letra\": numa música gerada, edita a letra e gera de novo com a MESMA melodia; (f) quando a música (ou a versão com banda) fica pronta, aparecem sob o player um campo de nome e dois botões: 'Salvar na Biblioteca' (guarda o áudio na Orange Library; se o arquivo passar de uns 25 MB, converte para MP3 antes) e 'Enviar para o Estúdio' (abre o Orange Studio direto na aba Cifra, com a música numa faixa nova, para descobrir o tom, os acordes e a letra). Limites: cada geração gasta a cota de GPU gratuita da Hugging Face e pode demorar minutos ou falhar; o modelo não lista o português entre os idiomas (use \"detectar sozinho\" ou espanhol na extração); a letra precisa ter número de versos parecido com o da melodia; os pesos do modelo são de uso NÃO comercial. Você NÃO executa o Songwriter por ferramenta: oriente o usuário a usar o Songwriter IA (ambiente Orange Create).
12. Acordes: braço de violão clicável — o usuário marca as notas nas cordas e o app identifica o acorde (nome, notas, onde se encaixa: tonalidades e escalas); também procura um acorde por nome e mostra posições no braço.
13. Newsletter (Orange News): jornal do app. Traz a edição do dia (manchete e dicas de afinação, composição, violão com a levada do dia, teoria, produção, IA e curiosidades, além de \"Discos que marcaram\" e \"Rock brasileiro: marcos\"), a ENQUETE DO DIA (o leitor vota e vê o resultado; uma por dia) e as notícias do mundo da música, com título e resumo em português feitos por IA e link da matéria. As notícias têm abas: Rock (o app prioriza rock e metal, mas mostra outros gêneros também), Brasil, Mundo, Shows e turnês, Lançamentos (álbuns e singles), Produção e \"Suas bandas\": o leitor cadastra as bandas que acompanha (até 8, salvas no navegador) e o app busca as notícias recentes de cada uma. As notícias vêm de buscas no Google Notícias e de alguns sites de produção; podem falhar ou demorar, e o resumo automático pode errar, então peça sempre para conferir na matéria. Você não executa ações no jornal por ferramenta: oriente o leitor a abrir o Orange News (ambiente Orange Explore).
14. Singergame: jogos de afinação com a voz. Modo Livre e modo Escala (uma bolinha atravessa anéis que são notas; há um afinômetro em tempo real e a margem é ±75, ±50 ou ±25 cents conforme a dificuldade) e o VOCALISE ("eu faço, você copia": o piano toca um padrão — escadinha, arpejo ou alternando duas notas — e o aluno repete no mesmo andamento; a cada rodada o padrão sobe meio tom e depois desce; cada nota é julgada pelo centro do que ele cantou). O app só confere a ALTURA da nota, não a vogal (i, e, a) — as vogais são orientação.

15. Este chat: tem um botão 🎤 para ditar por voz (não gasta cota de IA). No computador, Enter envia e Shift+Enter quebra a linha; no celular, Enter quebra a linha e o botão ➤ envia.

## Limites do servidor
As tarefas pesadas (analisar_gravacao, gerar_producao, aplicar_edicao_vocal e, no Orange Studio, o Produtor) rodam UMA POR VEZ. Se o servidor estiver ocupado ou com pouca memória, a ferramenta devolve um erro: explique em português, sugira tentar de novo em cerca de 1 minuto e NÃO repita a ferramenta sozinha.

## Suas ferramentas (você EXECUTA, não só descreve)
- listar_gravacoes, avaliar_gravacao (ouve o áudio de verdade), analisar_gravacao (roda
  análise técnica e registra no histórico), ler_historico, ler_perfil_vocal, listar_composicoes,
  salvar_composicao, gerar_producao (gera backing track e salva como nova gravação),
  aplicar_edicao_vocal (interpreta o pedido em português e aplica os efeitos, salva como nova
  gravação), renomear_gravacao, excluir_gravacao.
- listar_conversas e ler_conversa: você tem memória cruzada entre TODAS as conversas salvas
  com você, não só a atual. Se o usuário perguntar algo que parece ter sido dito numa outra
  conversa, use listar_conversas pra achar o nome certo e ler_conversa pra ler o conteúdo dela.

## Como se comportar
- Quando o usuário pedir uma ação (ex: "gera uma produção estilo pop na minha última
  gravação", "limpa o ruído da gravação X"), EXECUTE a ferramenta correspondente — não
  apenas descreva o que faria.
- Para excluir_gravacao, confirme uma vez com o usuário antes de chamar a ferramenta,
  a menos que ele já tenha confirmado explicitamente na mensagem.
- Se o usuário disser "minha última gravação" sem nome exato, use listar_gravacoes
  primeiro pra achar o nome certo (a lista vem ordenada da mais recente pra mais antiga).
- Sobre o Orange Studio: você explica e orienta (passo a passo, com os nomes reais das abas e dos botões), mas não o controla por ferramenta. Se pedirem para você aplicar algo DENTRO do Estúdio, diga como fazer lá (e lembre que as abas Edição vocal e Produtor têm a própria IA); se for sobre uma gravação da Biblioteca, aí sim use as suas ferramentas.
- Sempre responda em português, de forma acolhedora, prática e específica.
- Baseie suas respostas em dados reais obtidos pelas ferramentas — nunca invente números.
"""


def _catalogo_ferramentas_texto():
    """Descreve as ferramentas como texto simples (não via function calling
    nativo do Gemini) — evita depender da Interactions API, que alguns
    modelos novos exigem para function calling nativo."""
    return """
## Suas ferramentas (você EXECUTA, não só descreve)
Quando precisar usar uma ferramenta, responda **apenas** com um JSON exato
neste formato, sem nenhum texto antes ou depois:
{"ferramenta": "nome_da_ferramenta", "argumentos": {"chave": "valor"}}

Ferramentas disponíveis:
- listar_gravacoes(limite?: int) — lista as gravações salvas, mais recentes primeiro.
- avaliar_gravacao(nome: str) — ouve uma gravação salva de verdade e dá parecer vocal.
- analisar_gravacao(nome: str, modo?: "completa"|"cover", escala?: str) — roda análise técnica e registra no histórico. Com `escala` (ex: "G# lídio", "Lá menor pentatônica") avalia também quantas notas cantadas caíram DENTRO dessa escala, quais ficaram fora e os graus que não apareceram.
- consultar_escala(nome: str) — explica uma escala (ex: "G# lídio", "D dórico", "Lá menor pentatônica"): notas, graus, fórmula, caráter, desafio de canto e os acordes que nascem dela.
- ler_historico(limite?: int) — lê o resumo das últimas análises salvas.
- ler_perfil_vocal() — lê o perfil vocal do usuário (classificação, extensão, tessitura).
- listar_composicoes(limite?: int) — lista as composições salvas.
- salvar_composicao(titulo: str, tom?: str, letra: str) — cria/salva uma composição.
- gerar_producao(nome_gravacao: str, estilo?: str, com_baixo?: bool, com_bateria?: bool, com_acordes?: bool,
  com_teclado?: bool, com_solo?: bool, qualidade_pro?: bool, harmonia?: "melodia"|"estilo", bpm?: number) — gera o backing
  track com o MESMO motor do Produtor e salva como nova gravação. Padrão: baixo, bateria e acordes LIGADOS; teclado e
  solo DESLIGADOS (ligue se o usuário pedir). `harmonia`: "melodia" (padrão) = os acordes seguem as notas cantadas; "estilo" =
  sequência fixa do estilo. `bpm`: só se o usuário informar um andamento (ou disser que a detecção errou). Usa até 2 minutos da
  gravação. Devolve estilo, camadas usadas, BPM, tom e os acordes escolhidos — conte isso ao usuário.
- aplicar_edicao_vocal(nome_gravacao: str, comando: str) — aplica edição vocal interpretando
  o comando em português, salva como nova gravação.
- renomear_gravacao(nome_atual: str, novo_nome: str) — renomeia uma gravação.
- excluir_gravacao(nome: str) — exclui uma gravação. Só chame depois do usuário confirmar.
- listar_conversas() — lista as conversas salvas com você (nome, data).
- ler_conversa(nome: str) — lê o histórico completo de outra conversa salva.
- identificar_acorde(cordas: str) — identifica um acorde montado no braço do violão. `cordas` = 6 valores, da corda mais GRAVE (Mi) à mais AGUDA (mi): x = corda muda, 0 = solta, número = casa. Ex: "x32010" (Dó maior). Com casas de 2 dígitos separe por vírgula: "x,10,10,9,x,x". Devolve nome, alternativas, notas, tonalidades e escalas onde se encaixa.
- procurar_acorde(nome: str) — dado o nome (ex: Am7, C7M, F#m, G/B), devolve as notas, posições no violão e onde se encaixa (tonalidades e escalas).
Quando o usuário perguntar que acorde é, em qual escala ou tonalidade um acorde se encaixa, ou pedir ideias a partir de um acorde que montou, USE essas duas ferramentas e explique em cima do resultado — não invente teoria de cabeça.

Depois que o resultado de uma ferramenta aparecer em "Resultados de ferramentas já
chamadas", USE esse resultado pra responder ao usuário em texto normal — não chame
a mesma ferramenta de novo à toa, e não responda em JSON quando já tiver o suficiente
pra dar uma resposta final em português.

## Como se comportar
- Quando o usuário pedir uma ação (ex: "gera uma produção estilo pop na minha última
  gravação", "limpa o ruído da gravação X"), EXECUTE a ferramenta correspondente — não
  apenas descreva o que faria.
- Para excluir_gravacao, confirme uma vez com o usuário antes de chamar a ferramenta,
  a menos que ele já tenha confirmado explicitamente na mensagem.
- Se o usuário disser "minha última gravação" sem nome exato, use listar_gravacoes
  primeiro pra achar o nome certo (a lista vem ordenada da mais recente pra mais antiga).
- Sempre responda em português, de forma acolhedora, prática e específica.
- Baseie suas respostas em dados reais obtidos pelas ferramentas — nunca invente números.
"""


def _achar_gravacao_por_nome(nome):
    itens = gravacoes.listar_gravacoes()
    nome_lower = (nome or "").strip().lower()
    for g in itens:
        if g["nome"].strip().lower() == nome_lower:
            return g
    for g in itens:
        if nome_lower in g["nome"].strip().lower():
            return g
    return None


def interpretar_comando_edicao(comando):
    """Interpreta um comando em português numa estrutura de efeitos de edição vocal.
    Usa palavras-chave como piso mínimo e enriquece com o Gemini quando disponível."""
    padrao = {
        "reduzir_ruido": False, "normalizar": False, "ajustar_tom": 0.0,
        "eq_presenca": False, "compressao": False, "remover_sibilancia": False,
        "reverb_leve": False,
    }
    cmd = (comando or "").lower()
    if any(p in cmd for p in ["ruído", "ruido", "limpa", "limpe", "barulho"]):
        padrao["reduzir_ruido"] = True
    if any(p in cmd for p in ["normaliz", "volume"]):
        padrao["normalizar"] = True
    if any(p in cmd for p in ["grave", "mais baixo", "desce o tom", "descer o tom"]):
        padrao["ajustar_tom"] = -1.0
    if any(p in cmd for p in ["agudo", "mais alto", "sobe o tom", "subir o tom"]):
        padrao["ajustar_tom"] = 1.0
    if any(p in cmd for p in ["presente", "eq", "clareza", "brilho"]):
        padrao["eq_presenca"] = True
    if any(p in cmd for p in ["compress", "dinamica", "dinâmica", "punch"]):
        padrao["compressao"] = True
    if any(p in cmd for p in ["sibil", "assobio", "chiado agudo"]):
        padrao["remover_sibilancia"] = True
    if any(p in cmd for p in ["reverb", "ambiente", "espaço", "espaco", "sala"]):
        padrao["reverb_leve"] = True

    if not gemini_client.gemini_disponivel():
        return padrao

    prompt = (
        "Você é um engenheiro de mixagem vocal. Interprete o pedido do usuário e devolva "
        "APENAS um JSON válido (sem markdown, sem texto antes/depois), com as chaves: "
        '{"reduzir_ruido": bool, "normalizar": bool, "ajustar_tom": number (semitons, 0 se não '
        'pedido), "eq_presenca": bool, "compressao": bool, "remover_sibilancia": bool, '
        '"reverb_leve": bool}\n\n'
        f'Comando: "{comando}"\n\n'
        "Se o pedido for vago (ex: 'deixa melhor', 'profissional'), ative reduzir_ruido, "
        "normalizar, eq_presenca e compressao. Responda só o JSON."
    )
    resposta, _ = gemini_client.chamar_texto(prompt)
    if resposta and resposta.text:
        dados = gemini_client.extrair_json(resposta.text)
        if dados:
            for k in padrao:
                if k in dados:
                    padrao[k] = dados[k]
    return padrao


def interpretar_comando_producao(descricao):
    """Interpreta uma descrição em português dos parâmetros de produção desejados
    (estilo, quais instrumentos incluir) — mesmo padrão da interpretação de edição
    vocal, agora pra assistir a montagem do backing track."""
    padrao = {
        "estilo": "Pop", "com_baixo": True, "com_bateria": True, "com_acordes": True,
        "com_teclado": False, "com_solo": False, "qualidade_pro": True,
    }
    if not gemini_client.gemini_disponivel():
        return padrao

    estilos_validos = ", ".join(producao_dsp.ESTILOS_MUSICAIS.keys())
    prompt = (
        "Você é um produtor musical. Baseado na descrição do usuário, escolha os parâmetros "
        "de produção de um backing track. Devolva APENAS um JSON válido (sem markdown), com as "
        'chaves: {"estilo": string, "com_baixo": bool, "com_bateria": bool, "com_acordes": bool, '
        '"com_teclado": bool, "com_solo": bool, "qualidade_pro": bool}\n\n'
        f"O campo 'estilo' precisa ser exatamente um destes: {estilos_validos}\n\n"
        f'Descrição do usuário: "{descricao}"\n'
        "Se a descrição não mencionar algo, mantenha os valores padrão (baixo, bateria e "
        "acordes ativados, teclado e solo desativados, qualidade profissional ativada). "
        "Responda só o JSON."
    )
    resposta, _ = gemini_client.chamar_texto(prompt)
    if resposta and resposta.text:
        dados = gemini_client.extrair_json(resposta.text)
        if dados:
            for k in padrao:
                if k in dados:
                    padrao[k] = dados[k]
    padrao["estilo"] = ritmos.nome_canonico(padrao.get("estilo", "Pop"))     # "samba" / "Pagode " → nome do catálogo
    return padrao


def _ler_cordas(valor):
    """Aceita lista [-1,3,2,0,1,0], "x32010" (casas de 1 dígito) ou "x,10,10,9,x,x" (com vírgula/espaço)."""
    if isinstance(valor, (list, tuple)):
        try:
            cordas = [-1 if str(v).strip().lower() == "x" else int(v) for v in valor]
        except Exception:
            return None
        return cordas if len(cordas) == 6 else None
    texto = str(valor or "").strip().lower()
    if not texto:
        return None
    partes = [p for p in re.split(r"[,\s]+", texto) if p] if ("," in texto or " " in texto) else list(texto)
    try:
        cordas = [-1 if p in ("x", "-1") else int(p) for p in partes]
    except Exception:
        return None
    return cordas if len(cordas) == 6 else None


def _resumo_acorde(info):
    """Versão enxuta do resultado de acordes.py (poupa tokens da conversa)."""
    if "erro" in info:
        return info
    saida = {k: info[k] for k in ("nome", "tipo", "alternativas", "baixo") if k in info}
    saida["notas"] = " ".join(f"{n['letra']}({n['funcao']})" for n in info["notas"])
    enc = info["encaixe"]
    saida["tonalidades"] = [f"{t['tonalidade']} — {t['grau']}" for t in enc["tonalidades"][:6]]
    saida["escalas_sobre_a_fundamental"] = [f"{e['nome']}: {e['notas']}" for e in enc["escalas"][:8]]
    if enc.get("observacao"):
        saida["observacao"] = enc["observacao"]
    if info.get("posicoes"):
        saida["posicoes"] = [
            "".join("x" if c < 0 else (str(c) if c < 10 else f"({c})") for c in p["cordas"]) + f" (a partir da casa {p['base']})"
            for p in info["posicoes"][:4]
        ]
    return saida


def _resumo_escala(d):
    """Versão enxuta de escalas.descrever (poupa tokens da conversa)."""
    if "erro" in d:
        return d
    saida = {
        "escala": d["nome"], "notas_com_graus": " ".join(f"{n['letra']}({n['grau']})" for n in d["notas"]),
        "formula": d["formula"], "semitons_entre_notas": d["semitons"],
        "carater": d["carater"], "desafio_vocal": d["desafio_vocal"],
    }
    if d.get("enarmonico"):
        saida["observacao"] = f"{d['nome_pedido']} escreve-se com notas dobradas; por isso aparece como {d['enarmonico']} (mesmas notas)."
    if d.get("acordes_triades"):
        saida["acordes_triades"] = " · ".join(f"{x['grau']} {x['acorde']}" for x in d["acordes_triades"] if x)
        saida["acordes_com_setima"] = " · ".join(f"{x['grau']} {x['acorde']}" for x in d["acordes_setimas"] if x)
    else:
        saida["acordes"] = "Escala de 5 ou 6 notas: não é harmonizada em acordes por grau."
    return saida


_FERRAMENTAS_PESADAS = {"analisar_gravacao", "gerar_producao", "aplicar_edicao_vocal"}


def _executar_ferramenta(nome_func, args):
    """As ferramentas que processam áudio entram na fila de UMA tarefa pesada por vez (o servidor gratuito tem 512 MB)."""
    if nome_func in _FERRAMENTAS_PESADAS:
        try:
            with tarefa_pesada():
                return _executar_ferramenta_interna(nome_func, args)
        except ServidorOcupado as e:
            return {"erro": str(e)}
    return _executar_ferramenta_interna(nome_func, args)


def _como_bool(valor, padrao):
    """O modelo pode devolver true/false, 'sim'/'não' ou nada: interpreta com tolerância."""
    if valor is None or valor == "":
        return padrao
    if isinstance(valor, bool):
        return valor
    return str(valor).strip().lower() in ("true", "1", "sim", "s", "yes", "y", "ligado", "ligar", "com")


def _como_numero(valor, padrao):
    try:
        return float(valor)
    except (TypeError, ValueError):
        return padrao


def _modo_harmonia(valor):
    """'melodia' (padrão) = acordes seguem as notas cantadas; 'estilo' = sequência fixa do estilo."""
    v = str(valor or "").strip().lower()
    return "estilo" if v in ("estilo", "fixa", "fixo", "sequencia", "sequência", "sequencia fixa", "sequência fixa") else "melodia"


def _executar_ferramenta_interna(nome_func, args):
    if nome_func == "consultar_escala":
        par = teoria_escalas.interpretar_escala(str(args.get("nome", "")))
        if par is None:
            return {"erro": f"Não entendi a escala '{args.get('nome', '')}'. Exemplos: 'G# lídio', 'D dórico', 'Lá menor pentatônica', 'C menor harmônica'."}
        return _resumo_escala(teoria_escalas.descrever(*par))

    if nome_func == "identificar_acorde":
        cordas = _ler_cordas(args.get("cordas"))
        if cordas is None:
            return {"erro": "Preciso das 6 cordas, da mais grave à mais aguda. Ex: \"x32010\" (x = muda, 0 = solta, número = casa)."}
        return _resumo_acorde(teoria_acordes.identificar(cordas))

    if nome_func == "procurar_acorde":
        return _resumo_acorde(teoria_acordes.procurar(str(args.get("nome", ""))))

    if nome_func == "listar_gravacoes":
        return {"gravacoes": gravacoes.listar_gravacoes()[: args.get("limite", 20)]}

    if nome_func == "avaliar_gravacao":
        g = _achar_gravacao_por_nome(args.get("nome", ""))
        if not g:
            return {"erro": "Gravação não encontrada."}
        conteudo, content_type, nome_real = gravacoes.baixar_gravacao(g["id"])
        if conteudo is None:
            return {"erro": "Não consegui carregar o áudio dessa gravação."}
        prompt = (
            f"Ouça a gravação '{nome_real}' e faça uma avaliação vocal completa: afinação, "
            "notas, técnica, pontos fortes e pontos a melhorar. Seja específico e encorajador. "
            "Responda em português."
        )
        texto, modelo_ou_erro = gemini_client.chamar_com_audio(
            prompt, conteudo, nome_real, content_type or "audio/webm"
        )
        if texto is None:
            return {"erro": f"Não consegui ouvir o áudio agora ({modelo_ou_erro})."}
        return {"avaliacao": texto}

    if nome_func == "analisar_gravacao":
        g = _achar_gravacao_por_nome(args.get("nome", ""))
        if not g:
            return {"erro": "Gravação não encontrada."}
        conteudo, content_type, nome_real = gravacoes.baixar_gravacao(g["id"])
        if conteudo is None:
            return {"erro": "Não consegui carregar o áudio dessa gravação."}
        modo = args.get("modo", "completa")
        escala = None
        if args.get("escala"):
            par = teoria_escalas.interpretar_escala(str(args["escala"]))
            if par is None:
                return {"erro": f"Não entendi a escala '{args['escala']}'. Exemplos: 'G# lídio', 'Lá menor pentatônica', 'D dórico'."}
            escala = {"tonica": par[0], "tipo": par[1]}
        resultado = audio_analysis.analisar_audio_completo(conteudo, nome_real, modo=modo, escala=escala)
        if "erro" in resultado:
            return resultado
        if modo == "completa":
            try:
                historico.registrar_analise(resultado["resultado"], modo="completa", escala=resultado.get("avaliacao_escala"))
            except Exception:
                pass
        resultado.pop("curva_pitch", None)            # pontos do gráfico: a Laranjinha não precisa (poupa tokens)
        return resultado

    if nome_func == "ler_historico":
        return {"historico": historico.listar_historico()[: args.get("limite", 5)]}

    if nome_func == "ler_perfil_vocal":
        perfil = avaliacao.carregar_perfil()
        return perfil or {"info": "Usuário ainda não fez a Avaliação Vocal."}

    if nome_func == "listar_composicoes":
        return {"composicoes": composicoes.listar_composicoes()[: args.get("limite", 20)]}

    if nome_func == "salvar_composicao":
        doc_id, erro = composicoes.salvar_composicao(
            args.get("titulo", ""), args.get("tom", ""), args.get("letra", "")
        )
        if erro:
            return {"erro": erro}
        return {"salvo": True, "id": doc_id}

    if nome_func == "gerar_producao":
        g = _achar_gravacao_por_nome(args.get("nome_gravacao", ""))
        if not g:
            return {"erro": "Gravação não encontrada."}
        conteudo, content_type, nome_real = gravacoes.baixar_gravacao(g["id"])
        if conteudo is None:
            return {"erro": "Não consegui carregar o áudio dessa gravação."}
        audio, sr = audio_analysis.carregar_audio_bytes(conteudo, nome_real)
        del conteudo
        if audio is None:
            return {"erro": "Não consegui ler esse áudio."}
        audio, _ = audio_analysis.limitar_duracao(audio, sr, 120)           # mesmo limite (2 min) da tela de Produção
        pedido_estilo = str(args.get("estilo", "Pop") or "Pop")
        estilo, estilo_achado = ritmos.resolver(pedido_estilo)          # aceita apelidos; desconhecido cai em Pop e é AVISADO
        opcoes = {
            "baixo": _como_bool(args.get("com_baixo"), True), "bateria": _como_bool(args.get("com_bateria"), True),
            "acordes": _como_bool(args.get("com_acordes"), True), "teclado": _como_bool(args.get("com_teclado"), False),
            "solo": _como_bool(args.get("com_solo"), False),
        }
        try:
            # o MESMO caminho da tela (producao_pipeline): mesmas camadas, mesma mixagem, mesma harmonia
            wav_bytes, resumo = producao_pipeline.produzir(
                audio, sr, estilo, com_baixo=opcoes["baixo"], com_bateria=opcoes["bateria"], com_acordes=opcoes["acordes"],
                com_teclado=opcoes["teclado"], com_solo=opcoes["solo"],
                qualidade_pro=_como_bool(args.get("qualidade_pro"), True),
                acordes_modo=_modo_harmonia(args.get("harmonia") or args.get("acordes_modo")),
                bpm_manual=_como_numero(args.get("bpm") or args.get("bpm_manual"), 0.0))
        except producao_pipeline.ErroProducao as e:
            return {"erro": f"Erro ao gerar produção: {e}"}
        del audio
        audio_analysis.liberar_memoria()
        novo_nome = f"{g['nome']} (Produção {estilo})"
        doc_id, erro = gravacoes.salvar_gravacao(novo_nome, wav_bytes, "producao.wav", "audio/wav")
        if erro:
            return {"erro": erro}
        retorno = {"gerado": True, "nome_novo": novo_nome, "estilo": estilo, "camadas": [n for n, ativa in opcoes.items() if ativa],
                   "bpm": round(resumo["bpm"], 1), "tom": f"{resumo['tom_detectado']} {resumo['modo_detectado']}",
                   "acordes_usados": resumo["acordes"]}
        if not estilo_achado:
            retorno["aviso_estilo"] = (f"O estilo '{pedido_estilo}' não existe no app; usei Pop. Estilos parecidos: "
                                       + ", ".join(ritmos.sugerir(pedido_estilo, 5)) + ". Conte isso ao usuário.")
        return retorno

    if nome_func == "aplicar_edicao_vocal":
        g = _achar_gravacao_por_nome(args.get("nome_gravacao", ""))
        if not g:
            return {"erro": "Gravação não encontrada."}
        conteudo, content_type, nome_real = gravacoes.baixar_gravacao(g["id"])
        if conteudo is None:
            return {"erro": "Não consegui carregar o áudio dessa gravação."}
        audio, sr = audio_analysis.carregar_audio_bytes(conteudo, nome_real)
        del conteudo
        if audio is None:
            return {"erro": "Não consegui ler esse áudio."}
        audio, _ = audio_analysis.limitar_duracao(audio, sr)
        flags = interpretar_comando_edicao(args.get("comando", ""))
        audio_editado, acoes = edicao_dsp.aplicar_efeitos(
            audio, sr, flags["reduzir_ruido"], flags["normalizar"], flags["ajustar_tom"],
            flags["eq_presenca"], flags["compressao"], flags["remover_sibilancia"], flags["reverb_leve"],
        )
        wav_bytes = converter_audio.audio_para_wav_bytes(audio_editado, sr)
        del audio, audio_editado
        audio_analysis.liberar_memoria()
        novo_nome = f"{g['nome']} (Editado)"
        doc_id, erro = gravacoes.salvar_gravacao(novo_nome, wav_bytes, "editado.wav", "audio/wav")
        if erro:
            return {"erro": erro}
        return {"editado": True, "nome_novo": novo_nome, "acoes": acoes}

    if nome_func == "renomear_gravacao":
        g = _achar_gravacao_por_nome(args.get("nome_atual", ""))
        if not g:
            return {"erro": "Gravação não encontrada."}
        ok = gravacoes.renomear_gravacao(g["id"], args.get("novo_nome", ""))
        return {"renomeado": ok}

    if nome_func == "excluir_gravacao":
        g = _achar_gravacao_por_nome(args.get("nome", ""))
        if not g:
            return {"erro": "Gravação não encontrada."}
        ok = gravacoes.excluir_gravacao(g["id"])
        return {"excluido": ok}

    if nome_func == "listar_conversas":
        return {"conversas": chats.listar_chats()}

    if nome_func == "ler_conversa":
        nome_busca = (args.get("nome") or "").strip().lower()
        alvo = None
        for c in chats.listar_chats():
            if c.get("nome", "").strip().lower() == nome_busca:
                alvo = c
                break
        if alvo is None:
            for c in chats.listar_chats():
                if nome_busca in c.get("nome", "").strip().lower():
                    alvo = c
                    break
        if alvo is None:
            return {"erro": "Conversa não encontrada."}
        return {"chat": alvo.get("nome"), "mensagens": chats.carregar_mensagens(alvo["id"])}

    return {"erro": f"Ferramenta desconhecida: {nome_func}"}


# ── Cache em memória: evita reler o Firestore inteiro a cada mensagem ──
# Antes, CADA mensagem lia do Firestore todas as mensagens desta conversa e
# ainda todas as mensagens de TODAS as outras conversas (uma consulta por
# conversa) — e numa CPU de 0.1 vCPU isso demorava dezenas de segundos.
_cache_historico = {}          # chat_id -> últimas mensagens (dicts role/content)
_cache_outras = {}             # chat_id -> (instante, resumo das outras conversas)
_trava_cache = threading.Lock()
_MAX_MSGS_POR_CHAT = 60
_MAX_CHATS_EM_CACHE = 12
_TTL_OUTRAS_S = 300            # resumo das outras conversas vale por 5 min
_MAX_OUTRAS_CONVERSAS = 3      # só as 3 conversas mais recentes entram no resumo


def _historico_do_chat(chat_id):
    """Lista viva de mensagens do chat — vem do Firestore só na 1ª vez."""
    with _trava_cache:
        if chat_id not in _cache_historico:
            _cache_historico[chat_id] = chats.carregar_mensagens(chat_id, limite=_MAX_MSGS_POR_CHAT)
            while len(_cache_historico) > _MAX_CHATS_EM_CACHE:
                _cache_historico.pop(next(iter(_cache_historico)))
        return _cache_historico[chat_id]


def _resumo_outras_conversas(chat_id):
    agora = time.monotonic()
    guardado = _cache_outras.get(chat_id)
    if guardado and agora - guardado[0] < _TTL_OUTRAS_S:
        return guardado[1]
    resumo = []
    try:
        outras = [c for c in chats.listar_chats() if c["id"] != chat_id][:_MAX_OUTRAS_CONVERSAS]
        for c in outras:
            msgs = chats.carregar_mensagens(c["id"], limite=6)
            if msgs:
                resumo.append({
                    "chat": c.get("nome", "Conversa"),
                    "ultimas_mensagens": [f"{m.get('role')}: {(m.get('content') or '')[:200]}" for m in msgs],
                })
    except Exception:
        resumo = []
    _cache_outras[chat_id] = (agora, resumo)
    return resumo


def _extrair_chamada_ferramenta(texto):
    """Acha um JSON {"ferramenta": ..., "argumentos": {...}} dentro da resposta,
    mesmo que o modelo tenha escrito uma frase antes/depois ou usado ```json."""
    if not texto or "ferramenta" not in texto:
        return None
    dados = gemini_client.extrair_json(texto)
    if isinstance(dados, dict) and dados.get("ferramenta"):
        return dados
    ini, fim = texto.find("{"), texto.rfind("}")
    if 0 <= ini < fim:
        try:
            dados = json.loads(texto[ini:fim + 1])
            if isinstance(dados, dict) and dados.get("ferramenta"):
                return dados
        except Exception:
            pass
    return None


def _conversar(mensagem, chat_id=None):
    """Roda o loop de "ferramentas via JSON em texto" e devolve o texto de
    resposta final. Se chat_id for passado, a mensagem do usuário e a resposta
    final são salvas nesse chat (Firestore) automaticamente.

    Não usa function calling nativo do Gemini (tools=[...]) de propósito —
    alguns modelos novos (ex: gemini-3.7/3.8-flash) exigem a Interactions API
    pra function calling nativo, uma API ainda em beta e com bugs conhecidos
    de encadeamento. Em vez disso, a IA responde com um JSON simples em texto
    dizendo qual ferramenta quer usar, e o código executa de verdade — o
    mesmo esquema já usado em interpretar_comando_edicao/producao."""
    if not gemini_client.gemini_disponivel():
        return "A Laranjinha está indisponível no momento (chave do Gemini não configurada no servidor)."

    inicio = time.monotonic()

    if chat_id:
        historico_conversa = _historico_do_chat(chat_id)          # antes de gravar a nova
        chats.salvar_mensagem(chat_id, "user", mensagem)
        historico_conversa.append({"role": "user", "content": mensagem})
    else:
        historico_conversa = [{"role": "user", "content": mensagem}]

    instrucao_sistema = CONHECIMENTO_APP + "\n\n" + _catalogo_ferramentas_texto() + _REGRA_SO_MENSAGEM_ATUAL
    try:
        outras = _resumo_outras_conversas(chat_id) if chat_id else []
        if outras:
            linhas = []
            for o in outras:
                linhas.append(f"### Conversa \"{o['chat']}\"\n" + "\n".join(o["ultimas_mensagens"]))
            instrucao_sistema += (
                "\n\n## Resumo de OUTRAS conversas salvas (últimas mensagens de cada uma)\n"
                + "\n\n".join(linhas)
                + "\n\nUse ler_conversa se precisar do histórico completo de alguma delas."
            )
    except Exception:
        pass

    linhas_conversa = []
    for m in historico_conversa[-30:]:
        papel = "Assistente" if m.get("role") in ("model", "assistant") else "Usuário"
        texto = m.get("content", "")
        if texto:
            linhas_conversa.append(f"{papel}: {texto}")

    execucoes_registradas = []
    pesadas_com_erro = set()       # ferramentas pesadas que já falharam NESTA resposta: não são repetidas sozinhas
    texto_final = None
    ultimo_erro = ""

    for _iteracao in range(5):
        if time.monotonic() - inicio > 85:
            ultimo_erro = "a resposta demorou demais"
            break
        prompt_completo = (
            instrucao_sistema
            + "\n\n## Conversa até agora\n" + "\n".join(linhas_conversa)
            + ("\n\n## Resultados de ferramentas já chamadas nesta resposta\n" + "\n".join(execucoes_registradas)
               if execucoes_registradas else "")
            + "\n\nResponda agora como Assistente (texto normal, ou o JSON de ferramenta se precisar)."
        )
        resposta, erro = gemini_client.chamar_texto(prompt_completo)
        if resposta is None:
            ultimo_erro = erro or "sem resposta do Gemini"
            break

        texto_resp = (resposta.text or "").strip()
        chamada = _extrair_chamada_ferramenta(texto_resp)
        if chamada:
            nome_func = chamada.get("ferramenta")
            args = chamada.get("argumentos") or {}
            if nome_func in _FERRAMENTAS_PESADAS and nome_func in pesadas_com_erro:
                # Trava no CÓDIGO (não só no prompt): se uma tarefa pesada falhou (ex.: pouca memória), o modelo não a repete em
                # seguida. Sem isso, até 5 tentativas seguidas poderiam derrubar o servidor.
                resultado = {"erro": "Essa ferramenta já falhou nesta resposta e não será repetida sozinha. "
                                     "Explique o erro ao usuário e sugira tentar de novo em cerca de 1 minuto."}
            else:
                resultado = _executar_ferramenta(nome_func, args)
                if nome_func in _FERRAMENTAS_PESADAS and isinstance(resultado, dict) and resultado.get("erro"):
                    pesadas_com_erro.add(nome_func)
            execucoes_registradas.append(f"- {nome_func}({args}) → {resultado}")
            continue

        texto_final = texto_resp or "Não consegui gerar uma resposta."
        break

    if texto_final is None:
        texto_final = (
            f"A Laranjinha não conseguiu responder agora ({ultimo_erro[:160]}). Tente de novo em instantes."
            if ultimo_erro else "Não consegui completar essa ação (várias etapas seguidas sem uma resposta final)."
        )

    if chat_id:
        chats.salvar_mensagem(chat_id, "model", texto_final)
        with _trava_cache:
            historico_conversa.append({"role": "model", "content": texto_final})
            del historico_conversa[:-_MAX_MSGS_POR_CHAT]

    return texto_final


# ───────────── pedido interrompido por queda do servidor ─────────────
# A mensagem do usuário é salva ANTES de a ação rodar e a resposta só no FIM. Se o servidor cai no meio (ex.: sem memória),
# o pedido fica no histórico sem resposta, e na próxima mensagem (até um "oi") a IA o retomava sozinha — e derrubava o servidor
# de novo. Agora o pedido órfão é fechado com um aviso, e a IA só executa o que está na mensagem mais recente.
_REGRA_SO_MENSAGEM_ATUAL = (
    "\n\n## REGRA IMPORTANTE\n"
    "Execute ferramentas SOMENTE para o que o usuário pedir na mensagem MAIS RECENTE. Pedidos anteriores da conversa — "
    "mesmo os que ficaram sem resposta ou foram interrompidos — NÃO devem ser retomados nem repetidos, a menos que o usuário "
    "peça de novo. Se a mensagem mais recente for só uma saudação ou conversa, apenas converse. "
    "Se uma ferramenta devolver erro (servidor ocupado, pouca memória, limite), explique ao usuário e NÃO chame a mesma ferramenta de novo na mesma resposta."
)
AVISO_PEDIDO_INTERROMPIDO = (
    "⚠️ O pedido anterior foi interrompido (o servidor reiniciou ou ficou sem memória antes de eu terminar) e "
    "NÃO foi executado. Se ainda quiser, é só pedir de novo."
)
_em_processamento = set()      # chats com uma resposta sendo gerada AGORA; vive na memória, então some se o servidor cair


def _fechar_pedido_interrompido(chat_id):
    """Se a conversa termina num pedido do usuário SEM resposta (e ninguém o está processando), ele foi interrompido."""
    historico = _historico_do_chat(chat_id)
    if historico and historico[-1].get("role") == "user":
        chats.salvar_mensagem(chat_id, "model", AVISO_PEDIDO_INTERROMPIDO)
        with _trava_cache:
            historico.append({"role": "model", "content": AVISO_PEDIDO_INTERROMPIDO})


def conversar(mensagem, chat_id=None):
    dono = False
    if chat_id:
        with _trava_cache:
            dono = chat_id not in _em_processamento
            if dono:
                _em_processamento.add(chat_id)
    try:
        if dono:
            try:
                _fechar_pedido_interrompido(chat_id)
            except Exception:
                pass
        return _conversar(mensagem, chat_id)
    finally:
        if dono:
            with _trava_cache:
                _em_processamento.discard(chat_id)
