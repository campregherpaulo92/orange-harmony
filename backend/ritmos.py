# ══════════════════════════════════════════════════════════════
# ritmos.py — Catálogo de ritmos/estilos do Orange Harmony (Produção e Songwriter).
# É a ÚNICA fonte da lista de estilos: a tela busca em /api/estilos.
#
# Cada estilo descreve, por compasso, o que a bateria, o baixo e os acordes tocam.
# NOTAÇÃO — uma letra por passo (por padrão 16 passos = 1 compasso de 4/4 em semicolcheias):
#   '.' silêncio
#   bateria (um padrão por instrumento): X forte · x normal · o fraca (nota fantasma)
#   baixo : r fundamental · 5 quinta · 8 oitava · 3 terça · 6 sexta maior · 7 sétima menor · a nota de aproximação
#   acordes: X x o = batida de acorde (forte/normal/fraca) · _ segura a batida anterior
#            1 2 3 4 = nota solta do acorde, em arpejo (1 fundamental, 2 terça, 3 quinta, 4 oitava)
#   '|' separa compassos quando o padrão tem mais de um (ex.: padrão de 2 compassos)
# Grade: passos/batidas — 16/4 = 4/4 em semicolcheias · 12/4 = 12/8 (swing de tercinas, shuffle)
#        12/3 = 3/4 (valsa)
# São versões SIMPLIFICADAS e reconhecíveis de cada ritmo, tocadas por sons sintetizados
# (não são gravações de instrumentos reais).
# ══════════════════════════════════════════════════════════════
import numpy as np

NOMES_NOTAS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

NOMES_BEMOL_CIFRA = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"]

QUALIDADES = {            # intervalos (semitons) de cada tipo de acorde
    "M": (0, 4, 7), "m": (0, 3, 7), "7": (0, 4, 7, 10), "m7": (0, 3, 7, 10),
    "maj7": (0, 4, 7, 11), "5": (0, 7, 12), "sus4": (0, 5, 7), "dim": (0, 3, 6), "m7b5": (0, 3, 6, 10),
}
INSTRUMENTOS = {"kick", "snare", "hat", "open", "ride", "crash", "rim", "clap", "tom", "shaker", "pandeiro", "tamborim",
                "surdo", "conga", "agogo", "cowbell", "triangulo", "zabumba", "caixa", "clave"}
ESCALAS_SOLO = {
    "maior": (0, 2, 4, 5, 7, 9, 11, 12), "pent_maior": (0, 2, 4, 7, 9, 12),
    "pent_menor": (0, 3, 5, 7, 10, 12), "blues": (0, 3, 5, 6, 7, 10, 12),
}
ARPEJO_PADRAO = {16: "1.2.3.4.3.2.3.2.", 12: "1.2.3.2.3.2.", 8: "1.2.3.2."}

# padrões comuns (16 passos)
OITAVOS = "x.x.x.x.x.x.x.x."
SEMI = "xoxoxoxoxoxoxoxo"
BACK = "....X.......X..."
QUATRO = "X...X...X...X..."
MEIO = "X.......X......."
TRES = "X..x..x.x..x..x."          # divisão 3-3-2, a base de muita síncope brasileira e latina
OFF = "..X...X...X...X."
PAD = "X_______X_______"
BLUES12 = [(0, "7"), (0, "7"), (0, "7"), (0, "7"), (5, "7"), (5, "7"), (0, "7"), (0, "7"), (7, "7"), (5, "7"), (0, "7"), (7, "7")]
BLUES12P = [(g, "5") for g, _ in BLUES12]                              # o mesmo blues de 12 compassos, com power chords
POP = [(0, "M"), (7, "M"), (9, "m"), (5, "M")]                       # I – V – vi – IV
IVIVV = [(0, "M"), (5, "M"), (7, "7"), (0, "M")]                      # I – IV – V7 – I
JAZZ = [(0, "maj7"), (9, "m7"), (2, "m7"), (7, "7")]                  # I – vi – ii – V
MENOR_POP = [(9, "m"), (5, "M"), (0, "M"), (7, "M")]                  # vi – IV – I – V (toda dentro do tom detectado)

GRUPOS = ["Brasil — Samba, Pagode e Bossa", "Brasil — Nordeste e Norte", "Brasil — Sertanejo, Funk e Fé",
          "Pop e Rock", "Urbano e Eletrônico", "Jazz e Blues", "Latino e Mundo"]

RITMOS = {}


def _r(nome, grupo, desc, tags, bat, baixo, acordes, prog, passos=16, batidas=4, swing=0.0, solo=("maior", 8),
       crash=0, teclado=None, baixo_dur=0.9, acorde_compassos=1):
    RITMOS[nome] = dict(grupo=grupo, desc=desc, tags=tags, bateria=bat, baixo=baixo, acordes=acordes, prog=prog,
                        passos=passos, batidas=batidas, swing=swing, solo=solo, crash=crash,
                        teclado=teclado or ARPEJO_PADRAO[passos], baixo_dur=baixo_dur, acorde_compassos=acorde_compassos)


G1, G2, G3, G4, G5, G6, G7 = GRUPOS

# ───────────────────────── Brasil — Samba, Pagode e Bossa ─────────────────────────
_r("Samba", G1, "Suingado — surdo marcando o 2, pandeiro e tamborim sincopados, clima de roda de samba.",
   "Brazilian samba, surdo, pandeiro, tamborim, cavaquinho, nylon guitar, warm syncopated groove",
   dict(surdo="....X.......X...", pandeiro="X.xoX.xoX.xoX.xo", tamborim=TRES, shaker=SEMI),
   "r..r..5.r..r..5.", "X..x..x.x..x..x.", [(0, "M"), (9, "m"), (2, "m"), (7, "7")], swing=0.08, solo=("pent_maior", 8), baixo_dur=0.55)
_r("Samba-enredo", G1, "Intenso — bateria de escola de samba: surdos, caixas, tamborim e agogô.",
   "Brazilian samba-enredo carnival parade, surdos, caixas, tamborim, agogo, fast and energetic",
   dict(surdo="....X.......X...", caixa=SEMI, tamborim=TRES, agogo="x.x...x.x...x...", pandeiro="X.xoX.xoX.xoX.xo"),
   "r.r.r.5.r.r.r.5.", "X.xxX.xxX.xxX.xx", [(0, "M"), (5, "M"), (7, "7"), (0, "M")], swing=0.05, baixo_dur=0.5)
_r("Samba-canção", G1, "Lento e lírico — violão dedilhado, surdo suave e pandeiro de vassourinha.",
   "Brazilian samba-canção, slow romantic samba, nylon guitar, soft brushes, lyrical",
   dict(surdo="....o.......o...", pandeiro="x.x.x.x.x.x.x.x.", shaker="x.x.x.x.x.x.x.x."),
   "r.......5.......", "1.2.3.4.3.2.3.2.", [(0, "maj7"), (9, "m7"), (2, "m7"), (7, "7")], swing=0.06, solo=("maior", 4), baixo_dur=1.0)
_r("Samba-rock", G1, "Suingado e dançante — batida de rock com cadência de samba e guitarra marcada.",
   "Brazilian samba-rock, Jorge Ben style, funky guitar, backbeat drums, syncopated percussion, groovy",
   dict(kick="X.....x.X.....x.", rim=BACK, hat="XoxoXoxoXoxoXoxo", agogo=TRES),
   "r..r..5.r..r..5.", "X.xxX.xxX.xxX.xx", [(0, "7"), (5, "7"), (0, "7"), (7, "7")], swing=0.08, baixo_dur=0.6)
_r("Samba de Roda", G1, "Roda baiana — palmas, pandeiro, atabaque e violão batido.",
   "Brazilian samba de roda from Bahia, hand claps, pandeiro, atabaque, acoustic guitar, folk",
   dict(clap=TRES, pandeiro="X.xoX.xoX.xoX.xo", conga="....X.o.....X.o.", shaker=SEMI),
   "r.......5.......", "X.xxX.xxX.xxX.xx", [(0, "M"), (5, "M"), (0, "M"), (7, "7")], swing=0.08)
_r("Pagode", G1, "Suave e suingado — tantã, pandeiro, repique e cavaquinho, clima de churrasco.",
   "Brazilian pagode, tantã, pandeiro, repique de mão, cavaquinho, acoustic guitar, laid-back groove",
   dict(surdo="....X..o....X..o", pandeiro="X.xo.xxoX.xo.xxo", rim=TRES, shaker=SEMI),
   "r.....r.5..r..5.", "X.xxX.xxX.xxX.xx", [(0, "M"), (9, "m"), (2, "m7"), (7, "7")], swing=0.12, baixo_dur=0.6)
_r("Pagode Romântico", G1, "Romântico anos 90 — teclado, tantã suave, violão e cavaquinho, andamento calmo.",
   "Brazilian romantic pagode 90s, soft tantã, cavaquinho, acoustic guitar, warm keyboards, smooth",
   dict(kick=MEIO, rim="....x.......x...", conga="..x...x...x...x.", shaker="x.x.x.x.x.x.x.x."),
   "r.....r.5.....5.", "X___..x_X___..x_", [(0, "maj7"), (9, "m7"), (2, "m7"), (7, "7")], swing=0.08)
_r("Samba-reggae", G1, "Baiano — surdos sincopados sobre a pulsação do reggae, guitarra no contratempo.",
   "Brazilian samba-reggae, Olodum, heavy surdos, timbal, reggae offbeat guitar, Bahia",
   dict(surdo="....X.....x.X...", kick=MEIO, rim="....x.......x...", conga=OITAVOS, agogo=TRES),
   "r.......r..r5...", OFF, [(0, "M"), (5, "M"), (0, "M"), (7, "M")], baixo_dur=0.8)
_r("Axé", G1, "Carnaval da Bahia — percussão forte, guitarra baiana e muito suingue.",
   "Brazilian axé music from Bahia, carnival, trio elétrico, percussion, brass, upbeat",
   dict(kick="X.....X.X.....X.", snare=BACK, hat=OITAVOS, surdo="....X.......X...", conga=OITAVOS, agogo=TRES),
   "r..r..r.r..r..r.", "X.xxX.xxX.xxX.xx", [(0, "M"), (5, "M"), (7, "M"), (5, "M")], swing=0.08, crash=4)
_r("Marchinha", G1, "Marchinha de carnaval — 2 por 4 animado, surdo, caixa e tamborim.",
   "Brazilian carnival marchinha, brass band, surdo, caixa, tamborim, cheerful march",
   dict(surdo="X...x...X...x...", caixa=OITAVOS, tamborim="..x...x...x...x."),
   "r.5.r.5.r.5.r.5.", "X.x.X.x.X.x.X.x.", [(0, "M"), (7, "7"), (0, "M"), (5, "M")], baixo_dur=0.6)
_r("Choro", G1, "Instrumental e ágil — pandeiro, violão de sete cordas com baixaria e cavaquinho.",
   "Brazilian choro, pandeiro, 7-string guitar baixaria, cavaquinho, mandolin, virtuosic, acoustic",
   dict(pandeiro="X.xoX.xoX.xoX.xo"),
   "r.5.3.5.r.5.3.5.", "X.x.X.x.X.x.X.x.", [(0, "M"), (9, "m"), (2, "m7"), (7, "7")], swing=0.10, baixo_dur=0.85)
_r("Bossa Nova", G1, "Sofisticado e suave — violão sincopado, baixo alternado e acordes com sétima.",
   "Brazilian bossa nova, João Gilberto style, nylon guitar, soft rim click, shaker, jazzy chords, intimate",
   dict(rim="X..x..x...x..x..", kick=MEIO, shaker=OITAVOS),
   "r.....5.r.....5.", "...X..x...x..x..", [(0, "maj7"), (2, "m7"), (7, "7"), (0, "maj7")], solo=("maior", 4))
_r("MPB", G1, "Melódico e sofisticado — violão, percussão leve e harmonia brasileira.",
   "Brazilian MPB, acoustic guitar, light percussion, sophisticated harmony, lyrical melodies",
   dict(kick="X......xX.......", rim="....x.......x...", pandeiro=OITAVOS, shaker="..x...x...x...x."),
   "r.....5.r.....5.", "X..xx.x.X..xx.x.", [(0, "maj7"), (9, "m7"), (2, "m7"), (7, "7")], swing=0.05)

# ───────────────────────── Brasil — Nordeste e Norte ─────────────────────────
_r("Baião", G2, "Nordestino — zabumba, triângulo e sanfona, ritmo marcado e saltitante.",
   "Brazilian baião, Luiz Gonzaga, zabumba, triangle, accordion, northeastern folk, bouncy",
   dict(zabumba="X..x..X.X..x..X.", triangulo="x.xxx.xxx.xxx.xx", caixa="....o.......o..."),
   "r..5..r.r..5..r.", "X..x..X.X..x..X.", IVIVV, baixo_dur=0.6)
_r("Xote", G2, "Gingado e romântico — zabumba arrastada, triângulo e sanfona.",
   "Brazilian xote, northeastern forró, zabumba, triangle, accordion, swaying romantic",
   dict(zabumba="X.....x.X.....x.", triangulo=OITAVOS, caixa="....o.......o..."),
   "r.......5.......", "X.x.x.x.X.x.x.x.", IVIVV)
_r("Xaxado", G2, "Marcado e rápido — zabumba em quatro, triângulo e sanfona, pulso de marcha.",
   "Brazilian xaxado, northeastern folk, zabumba, triangle, accordion, marching rhythm",
   dict(zabumba=QUATRO, triangulo="x.xxx.xxx.xxx.xx", caixa="....x.......x..."),
   "r...5...r...5...", "X.x.X.x.X.x.X.x.", IVIVV)
_r("Forró", G2, "Animado — zabumba, triângulo e sanfona, clima de arrasta-pé.",
   "Brazilian forró pé-de-serra, zabumba, triangle, accordion, northeastern dance",
   dict(zabumba="X...x.x.X...x.x.", triangulo="x.xxx.xxx.xxx.xx", caixa="....x.......x..."),
   "r..5..r.r..5..r.", "X.x.X.x.X.x.X.x.", IVIVV)
_r("Piseiro", G2, "Forró eletrônico — bumbo, teclado, sanfona sintetizada e batida pulsante.",
   "Brazilian piseiro, electronic forró, synth accordion, kick drum, zabumba, modern northeastern dance",
   dict(kick=MEIO, clap=BACK, zabumba="X..x..X.X..x..X.", hat=OITAVOS, triangulo="x.xxx.xxx.xxx.xx"),
   "r.....r.r.....r.", "X.xxX.xxX.xxX.xx", POP)
_r("Arrocha", G2, "Romântico e grudado — bumbo suave, teclado e violão, andamento lento.",
   "Brazilian arrocha, slow romantic, soft kick, keyboards, acoustic guitar, bahian",
   dict(kick=MEIO, rim="....x.......x...", hat="x.x.x.x.x.x.x.x.", shaker=OITAVOS),
   "r.....r.5.....5.", "X___..x_X___..x_", POP)
_r("Brega", G2, "Paraense — batida de calypso, guitarra no contratempo e teclado.",
   "Brazilian brega pop, Pará, calypso rhythm, electric guitar, keyboards, danceable",
   dict(kick="X.....x.X.....x.", snare=BACK, hat=OITAVOS, conga="..x...x...x...x."),
   "r..r..5.r..r..5.", "X.xxX.xxX.xxX.xx", [(0, "M"), (5, "M"), (7, "M"), (5, "M")])
_r("Carimbó", G2, "Amazônico — curimbó, maracas e banjo, ritmo hipnótico e dançante.",
   "Brazilian carimbó from Pará, curimbó drums, maracas, banjo, Amazonian folk dance",
   dict(conga="X..x..X.X..x..X.", shaker=OITAVOS, zabumba=MEIO),
   "r..r..5.r..r..5.", "X.x.X.x.X.x.X.x.", [(0, "M"), (5, "M"), (7, "M"), (0, "M")])
_r("Lambada", G2, "Sensual e dançante — percussão suingada, teclado e guitarra com riff marcado.",
   "Lambada, 80s Brazilian dance, Caribbean-influenced percussion, keyboards, guitar riff, sensual",
   dict(kick=MEIO, conga=TRES, hat=OITAVOS, rim="....x.......x..."),
   "r.....5.r.....5.", "X.x.x.X.x.x.x.X.", [(0, "M"), (5, "M"), (7, "M"), (5, "M")])
_r("Frevo", G2, "Pernambucano — andamento acelerado, metais, caixa em semicolcheias e surdo.",
   "Brazilian frevo from Pernambuco, fast brass band, snare roll, surdo, carnival, frantic joy",
   dict(surdo=QUATRO, caixa=SEMI, tamborim=OITAVOS, agogo="x...x...x...x..."),
   "r.5.r.5.r.5.r.5.", "X.x.X.x.X.x.X.x.", IVIVV, baixo_dur=0.6)
_r("Maracatu", G2, "Pernambucano — alfaias pesadas, caixas e gonguê, clima de cortejo.",
   "Brazilian maracatu, heavy alfaia drums, gonguê bell, caixas, ceremonial procession from Pernambuco",
   dict(surdo="X..x..X.x..x..X.", caixa=SEMI, agogo=TRES, cowbell="x...x...x...x..."),
   "r.......r.......", "X_______X_______", [(0, "M"), (10, "M"), (0, "M"), (10, "M")], baixo_dur=1.0)

# ───────────────────────── Brasil — Sertanejo, Funk e Fé ─────────────────────────
_r("Sertanejo", G3, "Violão marcado — acordes abertos, baixo alternado e andamento médio.",
   "Brazilian sertanejo, acoustic guitar strumming, viola caipira, alternating bass, heartfelt country",
   dict(kick=MEIO, rim="....x.......x...", hat="x.x.x.x.x.x.x.x."),
   "r...5...r...5...", "X.x.X.x.X.x.X.x.", IVIVV, solo=("pent_maior", 8))
_r("Sertanejo Universitário", G3, "Pop sertanejo — bateria de pop, violão e teclado, refrão grudento.",
   "Brazilian sertanejo universitário, modern country pop, acoustic guitar, keyboards, polished drums, catchy chorus",
   dict(kick="X.....x.X.......", snare=BACK, hat=OITAVOS),
   "r.....r.r.....5.", "X.xxX.xxX.xxX.xx", POP, crash=8)
_r("Funk Carioca", G3, "Tamborzão — batida de funk do Rio, graves fortes e palmas.",
   "Brazilian funk carioca, tamborzão beat, heavy 808 bass, claps, baile funk from Rio",
   dict(kick=MEIO, tom="X..x..x...x.x...", clap=BACK, hat=OITAVOS),
   "r..r..r...r.r...", "X.....x.........", [(0, "5"), (0, "5"), (5, "5"), (5, "5")], baixo_dur=1.0)
_r("Funk Melody", G3, "Funk romântico — tamborzão suave, teclado e melodia cantada.",
   "Brazilian funk melody, soft tamborzão, romantic keyboards, melodic hooks, pop-funk",
   dict(kick="X..x..x...x.x...", rim="....x.......x...", hat=OITAVOS, tom="..x...x...x...x."),
   "r..r..r...r.r...", "X___..x_X___..x_", POP)
_r("Gospel", G3, "Emocional e edificante — acordes longos, órgão e clima de adoração.",
   "Gospel, uplifting worship, Hammond organ, warm piano, emotional choir feel, soulful",
   dict(kick=MEIO, snare="....x.......x...", hat=OITAVOS, clap="....x.......x..."),
   "r.......5.......", PAD, [(0, "M"), (5, "M"), (9, "m7"), (7, "7")], baixo_dur=1.0, acorde_compassos=2)
_r("Louvor", G3, "Adoração moderna — bateria firme, teclados amplos e acordes sustentados.",
   "Contemporary worship music, anthemic, ambient pads, steady drums, electric guitar swells, uplifting",
   dict(kick=MEIO, snare=BACK, hat=OITAVOS),
   "r.......r.......", PAD, POP, crash=8, baixo_dur=1.0, acorde_compassos=2)

# ───────────────────────── Pop e Rock ─────────────────────────
_r("Pop", G4, "Leve e dançante — batida limpa, acordes marcados, clima radiofônico.",
   "Pop, catchy melody, polished modern production, steady drums, bright synths, radio-friendly",
   dict(kick="X.......X.x.....", snare=BACK, hat=OITAVOS),
   "r...r.r.r...r.5.", "X.x.x.x.X.x.x.x.", POP, crash=8)
_r("Pop Rock", G4, "Energético e melódico — bateria de rock, guitarras e refrão forte.",
   "Pop rock, driving drums, strummed electric guitars, melodic hooks, anthemic chorus",
   dict(kick="X.....x.X.x.....", snare=BACK, hat=OITAVOS, open="..............o."),
   "r.r.r.r.r.r.r.r.", "X.x.xxx.X.x.xxx.", POP, crash=4)
_r("Rock", G4, "Energético — power chords firmes e bateria marcada nos tempos 2 e 4.",
   "Rock, power chords, distorted electric guitars, driving backbeat drums, raw energy",
   dict(kick="X.......x.x.....", snare=BACK, hat=OITAVOS),
   "r.r.r.r.r.r.r.r.", "X.x.X.x.X.x.X.x.", [(0, "5"), (5, "5"), (7, "5"), (5, "5")], crash=4, solo=("pent_menor", 8))
_r("Hard Rock", G4, "Pesado e cheio de riffs — power chords, baixo com oitavas e bumbo forte.",
   "Hard rock, heavy riffs, overdriven guitars, powerful drums, screaming energy, 70s and 80s",
   dict(kick="X.....x.X.x...x.", snare=BACK, hat="X.x.X.x.X.x.X.x."),
   "r.r.8.r.r.r.8.r.", "X.x.x.X.X.x.x.X.", [(0, "5"), (10, "5"), (5, "5"), (0, "5")], crash=4, solo=("pent_menor", 8))
_r("Rock Alternativo", G4, "Cru e atmosférico — guitarras abertas, bateria solta e clima indie.",
   "Alternative rock, indie, jangly guitars, loose drums, atmospheric, introspective",
   dict(kick="X.....x...x.x...", snare=BACK, hat=OITAVOS),
   "r.....r.r.....5.", "X.x.x.x.X.x.x.x.", [(0, "M"), (9, "m"), (5, "M"), (7, "M")])
_r("Punk Rock", G4, "Rápido e direto — power chords, bumbo e caixa sem frescura.",
   "Punk rock, fast power chords, aggressive drums, raw garage energy, shouted vocals",
   dict(kick="X...x.x.X...x.x.", snare=BACK, hat=OITAVOS),
   "r.r.r.r.r.r.r.r.", "X.x.X.x.X.x.X.x.", [(0, "5"), (5, "5"), (7, "5"), (7, "5")], baixo_dur=0.6)
_r("Grunge", G4, "Pesado e arrastado — guitarras sujas, bateria lenta e clima sombrio.",
   "Grunge, Seattle sound, sludgy distorted guitars, slow heavy drums, moody and raw",
   dict(kick="X.....x.....x...", snare=BACK, hat="x...x...x...x..."),
   "r...r...r...5...", "X___..x_X___..x_", [(0, "5"), (5, "5"), (8, "5"), (10, "5")], crash=4, solo=("pent_menor", 8))
_r("Metal", G4, "Pesado — bumbo em galope, power chords abafados e solo de guitarra.",
   "Heavy metal, galloping double kick, palm-muted power chords, distorted guitars, soaring solos",
   dict(kick="X.xxX.xxX.xxX.xx", snare=BACK, ride="X.x.X.x.X.x.X.x."),
   "r.rrr.rrr.rrr.rr", "X.xxX.xxX.xxX.xx", [(0, "5"), (8, "5"), (10, "5"), (0, "5")], crash=4, baixo_dur=0.55, solo=("pent_menor", 8))
_r("Thrash Metal", G4, "Velocidade máxima — bumbo em semicolcheias, riffs cortantes e agressividade.",
   "Thrash metal, blistering speed, fast double bass drums, razor-sharp palm-muted riffs, aggressive",
   dict(kick="XxXxXxXxXxXxXxXx", snare=BACK, ride=OITAVOS),
   "rrrrrrrrrrrrrrrr", "XxXxXxXxXxXxXxXx", [(0, "5"), (1, "5"), (0, "5"), (3, "5")], crash=4, baixo_dur=0.5, solo=("pent_menor", 8))
_r("Balada", G4, "Calmo e emotivo — acordes longos e suaves, clima intimista.",
   "Ballad, slow and emotional, soft piano and strings, gentle drums, intimate",
   dict(kick=MEIO, snare="....o.......o...", hat="x.x.x.x.x.x.x.x."),
   "r.......r.......", "X_______________", POP, baixo_dur=1.0, acorde_compassos=2)
_r("Balada Rock", G4, "Power ballad — começa suave e cresce, bateria cheia e guitarras amplas.",
   "Rock power ballad, soaring guitars, big drums, emotional build, arena rock chorus",
   dict(kick="X.......X.....x.", snare=BACK, hat=OITAVOS),
   "r.......r.......", PAD, POP, crash=4, baixo_dur=1.0)

# ───────────────────────── Urbano e Eletrônico ─────────────────────────
_r("R&B", G5, "Suave e groovado — bateria espaçada, baixo redondo e teclado com sétimas.",
   "Contemporary R&B, smooth groove, warm electric piano, round bass, laid-back drums, sensual",
   dict(kick="X.....x...x.....", snare=BACK, hat="x.x.xoxox.x.xox."),
   "r..r..r...r.r...", "X___..x_X...x...", JAZZ, swing=0.12)
_r("Soul", G5, "Clássico — baixo caminhando, palmas e metais, clima Motown.",
   "Soul, Motown, walking bass, tambourine, handclaps, brass stabs, classic 60s groove",
   dict(kick="X.......X..x....", snare=BACK, shaker=OITAVOS),
   "r.r.5.r.r.r.5.r.", "X.x.x.x.X.x.x.x.", [(0, "M"), (9, "m"), (5, "M"), (7, "M")])
_r("Funk", G5, "Ritmado — groove curto e sincopado, baixo marcado e guitarra abafada.",
   "Funk, tight syncopated groove, slap bass, muted funky guitar, ghost-note drums, James Brown style",
   dict(kick="X.....x...x.....", snare="....X..o.o..X..o", hat=SEMI),
   "r..r..r.r..r.r..", "X..x..x...x.x...", [(0, "7"), (0, "7"), (5, "7"), (0, "7")], swing=0.10, baixo_dur=0.55)
_r("Disco", G5, "Dançante — bumbo em quatro, baixo em oitavas e cordas, clima de pista.",
   "Disco, four-on-the-floor kick, octave bass, open hi-hats, lush strings, funky guitar, dancefloor",
   dict(kick=QUATRO, clap=BACK, open="..o...o...o...o.", hat=SEMI),
   "r.8.r.8.r.8.r.8.", "X.x.X.x.X.x.X.x.", [(0, "M"), (9, "m7"), (2, "m7"), (7, "7")], baixo_dur=0.6)
_r("Hip Hop", G5, "Boom bap — bumbo e caixa secos, swing no chimbal e baixo grave.",
   "Hip hop, boom bap, dusty drums, deep 808 bass, vinyl sample chops, head-nodding groove",
   dict(kick="X.....x...x.....", snare=BACK, hat=OITAVOS),
   "r.......r..r....", "X..x..x...x..x..", [(9, "m7"), (5, "maj7"), (0, "maj7"), (7, "7")], swing=0.15, baixo_dur=1.0)
_r("Trap", G5, "Trap — tempo dobrado, chimbais rápidos, caixa no 3 e 808 longo.",
   "Trap, half-time, rapid hi-hat rolls, booming 808 bass, snappy snare, dark atmosphere",
   dict(kick="X.....x...x.....", clap="........X.......", hat="x.xxx.x.x.xxx.xx"),
   "r.......r..r....", PAD, MENOR_POP, baixo_dur=1.2)
_r("Reggaeton", G5, "Dembow — bumbo em quatro, caixa sincopada 3-3-2 e baixo marcado.",
   "Reggaeton, dembow rhythm, four-on-the-floor kick, syncopated snare, latin urban, danceable",
   dict(kick=QUATRO, snare="...X..x....X..x.", hat=OITAVOS),
   "r..r..r.r..r..r.", "X..x..x.X..x..x.", MENOR_POP, baixo_dur=0.7)
_r("Lo-fi", G5, "Relaxado — batida suja e suingada, acordes jazzy e clima de estudo.",
   "Lo-fi hip hop, chill beats, dusty vinyl crackle, mellow jazzy keys, swung drums, study music",
   dict(kick="X.....x...x.....", snare="....x.......x...", hat=OITAVOS),
   "r.......5.......", "X___..x_X___....", JAZZ, swing=0.20, solo=("pent_menor", 4), baixo_dur=1.0)
_r("Eletrônica", G5, "Dançante — bumbo constante, palmas e groove de club.",
   "Electronic dance music, pulsing kick, claps, synth bass, club groove, energetic",
   dict(kick=QUATRO, clap=BACK, hat="..x...x...x...x.", shaker=SEMI),
   "r.r.r.r.r.r.r.r.", "X.x.X.x.X.x.X.x.", MENOR_POP, baixo_dur=0.5)
_r("House", G5, "House — bumbo em quatro, chimbal aberto no contratempo e piano em stabs.",
   "House music, four-on-the-floor, open hi-hat offbeats, piano stabs, deep bassline, groovy",
   dict(kick=QUATRO, clap=BACK, open="..o...o...o...o.", hat=OITAVOS, shaker=SEMI),
   "..r...r...r...r.", "X..x..x...x..x..", [(9, "m7"), (5, "maj7"), (0, "maj7"), (7, "7")], baixo_dur=0.6)
_r("Techno", G5, "Techno — bumbo martelado, chimbais secos e baixo rolante.",
   "Techno, hypnotic pounding kick, dry hi-hats, rolling bassline, minimal, dark warehouse",
   dict(kick=QUATRO, hat="..x...x...x...x.", rim="...x..x...x..x.."),
   "r.rr.rr.r.rr.rr.", "X.......X.......", [(9, "m"), (9, "m"), (5, "M"), (7, "M")], baixo_dur=0.4)
_r("Drum and Bass", G5, "Drum and bass — quebrada rápida, baixo longo e atmosfera.",
   "Drum and bass, fast breakbeat, deep sub bass, atmospheric pads, energetic",
   dict(kick="X.........x.....", snare=BACK, hat=OITAVOS),
   "r.......r.......", PAD, MENOR_POP, baixo_dur=1.2)

# ───────────────────────── Jazz e Blues ─────────────────────────
_r("Jazz", G6, "Sofisticado — ride em swing, baixo caminhando e acordes com tensão (7ª).",
   "Jazz, swing ride cymbal, walking upright bass, comping piano, seventh chords, smoky club",
   dict(ride="X..x.xX..x.x", hat="...x.....x..", kick="o..o..o..o.."),
   "r..3..5..a..", "X....x......", JAZZ, passos=12, solo=("maior", 8), baixo_dur=0.95)
_r("Swing", G6, "Big band — ride em swing, baixo caminhando e acordes no contratempo.",
   "Swing, big band era, walking bass, swinging ride, brass and sax, danceable 1940s jazz",
   dict(ride="X..x.xX..x.x", hat="...x.....x..", snare="..........o.", kick="o..o..o..o.."),
   "r..3..5..3..", "X..x..X..x..", [(0, "maj7"), (9, "7"), (2, "m7"), (7, "7")], passos=12, baixo_dur=0.95)
_r("Blues", G6, "Clima de bar — shuffle, progressão de 12 compassos e baixo alternado.",
   "Blues, 12-bar shuffle, walking bass, warm electric guitar, harmonica, smoky bar",
   dict(kick="X.....X.....", snare="...X.....X..", hat="x.xx.xx.xx.x"),
   "r.5r.5r.5r.5", "X.xX.xX.xX.x", BLUES12, passos=12, solo=("blues", 8))
_r("Blues Rock", G6, "Blues pesado — shuffle com guitarra distorcida e bateria forte.",
   "Blues rock, shuffle groove, overdriven guitar, powerful drums, gritty and soulful",
   dict(kick="X..x..X..x..", snare="...X.....X..", ride="x.xx.xx.xx.x"),
   "r.rr.rr.rr.r", "X.xX.xX.xX.x", BLUES12P, passos=12, crash=4, solo=("blues", 8))
_r("Rockabilly", G6, "Anos 50 — baixo acústico caminhando, shuffle e guitarra eco.",
   "Rockabilly, 1950s, slap upright bass, shuffle drums, twangy guitar with slapback echo",
   dict(kick="X.....X.....", snare="...x.....x..", ride="X..x..X..x.."),
   "r..3..5..6..", "X..x..X..x..", [(0, "7"), (0, "7"), (0, "7"), (0, "7"), (5, "7"), (5, "7"), (0, "7"), (0, "7"), (7, "7"), (5, "7"), (0, "7"), (7, "7")],
   passos=12, solo=("pent_maior", 8))

# ───────────────────────── Latino e Mundo ─────────────────────────
_r("Reggae", G7, "Descontraído — one drop, baixo sustentado e guitarra no contratempo.",
   "Reggae, one drop drums, deep sustained bass, offbeat guitar skank, relaxed Jamaican groove",
   dict(kick="........X.......", rim="........x.......", hat=OITAVOS),
   "r..r.....r..5...", OFF, [(0, "M"), (5, "M"), (0, "M"), (7, "M")], solo=("pent_maior", 4), baixo_dur=1.0)
_r("Ska", G7, "Rápido e saltitante — contratempo marcado, baixo caminhando e metais.",
   "Ska, fast upbeat offbeat guitar, walking bass, horn section, bouncy Jamaican dance",
   dict(kick=QUATRO, snare=BACK, hat=OITAVOS),
   "r.5.r.5.r.5.r.5.", OFF, [(0, "M"), (5, "M"), (7, "M"), (0, "M")], baixo_dur=0.6)
_r("Dancehall", G7, "Jamaicano moderno — batida sincopada, baixo grave e skank no contratempo.",
   "Dancehall, modern Jamaican riddim, syncopated drums, deep bass, offbeat stabs",
   dict(kick="X.......X..x....", snare="...x..x....x..x.", hat=OITAVOS),
   "r..r.....r.r....", OFF, MENOR_POP, baixo_dur=0.8)
_r("Salsa", G7, "Cubano e quente — clave 3-2, conga, campana e piano montuno.",
   "Salsa, son clave 3-2, congas, cowbell, piano montuno, brass section, hot Latin dance",
   dict(clave="X..x..x...x.x...", conga="..x.xx..x.x.xx..", cowbell="X.x.X.x.X.x.X.x."),
   "r..5..r.r..5..r.", "X..x..x.x..x..x.", [(0, "M"), (5, "M"), (7, "7"), (5, "M")], baixo_dur=0.7)
_r("Cha-cha-cha", G7, "Cubano — clave marcada, cowbell e piano alegre.",
   "Cha-cha-cha, Cuban dance, cowbell, rim clicks, congas, cheerful piano, playful",
   dict(kick=MEIO, rim="....x.......xxx.", cowbell=OITAVOS, conga="..x.x...x.x.x..."),
   "r.......5.......", "X.x.X.x.X.x.X.x.", [(0, "M"), (9, "m"), (2, "m7"), (7, "7")])
_r("Bachata", G7, "Dominicano — guitarra em arpejos, bongô e güira, romântico e dançante.",
   "Bachata, Dominican romantic guitar arpeggios, bongos, güira, bass, sensual",
   dict(conga="x.x.x.x.x.x.X.x.", shaker=SEMI, kick=MEIO),
   "r.....5.r.....5.", "1.2.3.2.1.2.3.2.", [(0, "M"), (9, "m"), (5, "M"), (7, "7")])
_r("Merengue", G7, "Dominicano — tambora, güira e acordeão em ritmo acelerado.",
   "Merengue, fast Dominican dance, tambora, güira, accordion, saxophone, frantic joy",
   dict(zabumba="X.xxX.xxX.xxX.xx", conga="..x.x...x.x.x...", shaker=SEMI),
   "r.5.r.5.r.5.r.5.", "X.x.X.x.X.x.X.x.", IVIVV, baixo_dur=0.6)
_r("Cumbia", G7, "Colombiano — percussão cadenciada, acordeão no contratempo e baixo marcado.",
   "Cumbia, Colombian, guacharaca, congas, accordion offbeat, steady bass, hypnotic dance",
   dict(kick="X.....x.X.....x.", conga="..x.x...x.x.x...", shaker=OITAVOS),
   "r.....5.r.....5.", "..x...x...x...x.", [(0, "M"), (5, "M"), (7, "M"), (0, "M")])
_r("Tango", G7, "Dramático — marcato em quatro, bandoneon e baixo seco.",
   "Argentine tango, dramatic marcato, bandoneon, staccato strings, passionate",
   dict(kick=QUATRO, snare="....x.......x..."),
   "r...5...r...5...", "X...x...X...x...", [(9, "m"), (2, "m"), (7, "7"), (9, "m")], baixo_dur=0.55)
_r("Bolero", G7, "Romântico e lento — bongô, maracas e violão em arpejos.",
   "Bolero, slow romantic Latin ballad, nylon guitar arpeggios, bongos, maracas, passionate vocals",
   dict(kick=MEIO, rim="..x...x...x...x.", shaker="x.xxx.xxx.xxx.xx"),
   "r.......5.......", "1.2.3.2.1.2.3.2.", [(0, "M"), (9, "m"), (2, "m7"), (7, "7")], baixo_dur=1.0)
_r("Flamenco", G7, "Espanhol — palmas, cajón e violão rasgueado, clima dramático.",
   "Flamenco, rumba flamenca, rasgueado guitar, handclaps palmas, cajón, passionate Spanish",
   dict(clap="..x.x...x.x.x...", kick=MEIO, snare="..x..x..x..x..x."),
   "r.......r.......", "X.xxX.xxX.xxX.xx", [(9, "m"), (7, "M"), (5, "M"), (4, "M")], solo=("pent_menor", 8))
_r("Country", G7, "Americano — boom-chick, baixo alternado e violão com slide.",
   "Country, boom-chick rhythm, acoustic guitar, steel guitar, fiddle, heartland storytelling",
   dict(kick=MEIO, snare="....x.......x...", hat="x...x...x...x..."),
   "r.......5.......", "....X.......X...", IVIVV, solo=("pent_maior", 8))
_r("Folk", G7, "Acústico — violão em arpejos, pandeiro leve e clima de roda.",
   "Folk, acoustic fingerpicked guitar, light tambourine, warm and intimate, singer-songwriter",
   dict(shaker=OITAVOS, kick=MEIO),
   "r.......5.......", "1.2.3.2.1.2.3.2.", [(0, "M"), (5, "M"), (0, "M"), (7, "M")])
_r("Valsa", G7, "Valsa em 3 por 4 — baixo no primeiro tempo e dois golpes leves de acorde.",
   "Waltz in 3/4, oom-pah-pah, acoustic guitar or piano, gentle and elegant",
   dict(kick="X...........", snare="....x...x..."),
   "r...........", "....X...X...", IVIVV, passos=12, batidas=3, baixo_dur=1.0)
_r("Afrobeat", G7, "Africano — polirritmia hipnótica, guitarra cortada e metais.",
   "Afrobeat, Fela Kuti, polyrhythmic percussion, interlocking guitars, horn riffs, hypnotic groove",
   dict(kick="X.....x...x.....", snare="....X..x....X..x", hat=OITAVOS, shaker=SEMI, conga="..x.x...x.x.x..."),
   "r..r..r.r..r..r.", "X.xxX.xxX.xxX.xx", [(0, "7"), (0, "7"), (5, "7"), (0, "7")], baixo_dur=0.7)


# ───────────────────────── consultas ─────────────────────────
def nomes():
    return list(RITMOS)


def obter(estilo):
    """Estilo pelo nome (sem diferenciar maiúsculas); estilo desconhecido cai em 'Pop'."""
    if estilo in RITMOS:
        return RITMOS[estilo]
    chave = (estilo or "").strip().lower()
    for nome, esp in RITMOS.items():
        if nome.lower() == chave:
            return esp
    return RITMOS["Pop"]


def nome_canonico(estilo):
    if estilo in RITMOS:
        return estilo
    chave = (estilo or "").strip().lower()
    return next((n for n in RITMOS if n.lower() == chave), "Pop")


def descricoes():
    return {n: e["desc"] for n, e in RITMOS.items()}


def tags_en(estilo):
    return obter(estilo)["tags"]


def lista_agrupada():
    return [{"grupo": g, "estilos": [{"nome": n, "descricao": e["desc"]} for n, e in RITMOS.items() if e["grupo"] == g]} for g in GRUPOS]


def parse_padrao(padrao, passos):
    """'X...|x...' → ['X...', 'x...'] (valida o tamanho de cada compasso)."""
    barras = padrao.split("|")
    for b in barras:
        if len(b) != passos:
            raise ValueError(f"padrão '{b}' tem {len(b)} passos (esperado {passos})")
    return barras


def validar():
    """Confere o catálogo inteiro; devolve a lista de problemas (vazia = tudo certo)."""
    erros = []
    for nome, e in RITMOS.items():
        p = e["passos"]
        try:
            for inst, pad in e["bateria"].items():
                if inst not in INSTRUMENTOS:
                    erros.append(f"{nome}: instrumento desconhecido '{inst}'")
                parse_padrao(pad, p)
                if set(pad.replace("|", "")) - set(".Xxo"):
                    erros.append(f"{nome}: bateria/{inst} com letra inválida")
            for campo, validas in (("baixo", set(".r58367a")), ("acordes", set(".Xxo_1234")), ("teclado", set(".1234"))):
                parse_padrao(e[campo], p)
                if set(e[campo].replace("|", "")) - validas:
                    erros.append(f"{nome}: {campo} com letra inválida")
            for grau, qual in e["prog"]:
                if qual not in QUALIDADES or not (0 <= grau < 12):
                    erros.append(f"{nome}: acorde inválido ({grau}, {qual})")
            if e["solo"][0] not in ESCALAS_SOLO:
                erros.append(f"{nome}: escala de solo inválida")
        except ValueError as ex:
            erros.append(f"{nome}: {ex}")
        if e["grupo"] not in GRUPOS:
            erros.append(f"{nome}: grupo inválido")
    return erros


# ───────────────────────── grade de tempo ─────────────────────────
def construir_grade(beat_times, bpm, duracao, passos_por_batida, batidas_por_compasso):
    """Posição (em segundos) de cada passo do ritmo, SEGUINDO as batidas detectadas na gravação
    (se o andamento oscilar, a grade acompanha). Assume que a primeira batida detectada é o tempo 1.
    Devolve (tempos, compasso, passo): três arrays com um item por passo (compasso 0 = o da 1ª batida)."""
    beat_len = 60.0 / max(bpm, 1.0)
    bt = np.asarray(beat_times, dtype=float) if beat_times is not None and len(beat_times) else np.array([])
    seguir = False
    if len(bt) >= 4:
        d = np.diff(bt)
        med = float(np.median(d))
        seguir = med > 0 and abs(med - beat_len) / beat_len < 0.25 and float(np.std(d)) / med < 0.25
    t0 = float(bt[0]) if len(bt) else 0.0
    if seguir:
        depois = bt[-1] + med * np.arange(1, int(np.ceil(max(0.0, duracao - bt[-1]) / med)) + 2)
        batidas = np.concatenate([bt, depois])
    else:
        n = int(np.ceil(max(0.0, duracao - t0) / beat_len)) + 2
        batidas = t0 + beat_len * np.arange(n)
    n_passos = (len(batidas) - 1) * passos_por_batida
    tempos = np.empty(n_passos)
    k = np.arange(n_passos)
    i_batida, s = k // passos_por_batida, k % passos_por_batida
    tempos = batidas[i_batida] + (batidas[i_batida + 1] - batidas[i_batida]) * s / passos_por_batida
    compasso = i_batida // batidas_por_compasso
    passo = (i_batida % batidas_por_compasso) * passos_por_batida + s
    validos = tempos < duracao
    return tempos[validos], compasso[validos], passo[validos]


# Quão "forte" cada estilo toca em relação à voz (1.0 = padrão). Os suaves ficam mais baixos, os pesados no máximo.
ENERGIA = {"Samba-canção": 0.55, "Bolero": 0.55, "Folk": 0.55, "Bossa Nova": 0.65, "Balada": 0.65, "Lo-fi": 0.65, "Arrocha": 0.75,
           "Pagode Romântico": 0.75, "MPB": 0.75, "Jazz": 0.75, "Valsa": 0.7, "Gospel": 0.8, "Louvor": 0.85, "Choro": 0.85, "Country": 0.85,
           "Reggae": 0.85, "R&B": 0.85, "Samba de Roda": 0.85, "Soul": 0.9, "Balada Rock": 0.9, "Metal": 1.0, "Thrash Metal": 1.0}


def energia(estilo):
    return ENERGIA.get(nome_canonico(estilo), 1.0)
