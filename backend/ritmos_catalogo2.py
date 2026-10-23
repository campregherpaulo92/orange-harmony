# ══════════════════════════════════════════════════════════════
# ritmos_catalogo2.py — catálogo AMPLIADO de estilos (rock, blues, soul, pop, jazz, eletrônico, Brasil, mundo...)
#
# Cada estilo define o seu próprio desenho de bateria, baixo, acordes e teclado. A harmonia segue a SUA melodia; o campo
# `cor` diz como os acordes são "vestidos" (5 power chords · 7 sétimas de jazz · 7d dominantes de blues · 9 nonas de jazz-pop ·
# 9d nonas de funk · add9 indie · 6 sextas · tri tríades). O motor tem UM timbre por camada: o que diferencia os estilos é
# ritmo, harmonia, swing e energia — não o timbre do instrumento.
# ══════════════════════════════════════════════════════════════
import ritmos as R

_r = R._r
G1, G2, G3, G4, G5, G6, G7 = R.G1, R.G2, R.G3, R.G4, R.G5, R.G6, R.G7
GB, GR1, GR2, GR3, GP, GBL, GS = R.GB, R.GR1, R.GR2, R.GR3, R.GP, R.GBL, R.GS
GJ, GE, GH, GC, GG, GM1, GM2 = R.GJ, R.GE, R.GH, R.GC, R.GG, R.GM1, R.GM2

# progressões comuns (escritas em tom maior; a sua melodia manda quando o app segue a melodia)
P_POP = [(0, "M"), (7, "M"), (9, "m"), (5, "M")]          # I – V – vi – IV
P_VIIV = [(9, "m"), (5, "M"), (0, "M"), (7, "M")]         # vi – IV – I – V
P_DOOWOP = [(0, "M"), (9, "m"), (5, "M"), (7, "M")]       # I – vi – IV – V
P_IVV = [(0, "M"), (5, "M"), (7, "M"), (5, "M")]          # I – IV – V – IV
P_MIXO = [(0, "M"), (10, "M"), (5, "M"), (0, "M")]        # I – bVII – IV – I
P_ROCK5 = [(0, "5"), (5, "5"), (7, "5"), (5, "5")]
P_MET5 = [(0, "5"), (8, "5"), (10, "5"), (7, "5")]        # i – bVI – bVII – V
P_CROM5 = [(0, "5"), (1, "5"), (0, "5"), (6, "5")]        # riffs cromáticos do metal extremo
P_JAZZ = [(0, "maj7"), (9, "m7"), (2, "m7"), (7, "7")]    # I – vi – ii – V
P_7 = [(0, "7"), (5, "7"), (0, "7"), (7, "7")]            # I7 – IV7 – I7 – V7
H8 = "x.x.x.x.x.x.x.x."                                   # colcheias
H16 = "xoxoxoxoxoxoxoxo"                                  # semicolcheias com notas fantasma
ARP = "1.2.3.4.3.2.3.2."

# ───────────────────────── Rock — Clássico e Raízes ─────────────────────────
_r("Rock and Roll", GR1, "Anos 50 — shuffle de boogie, baixo subindo, palmas na caixa e guitarra martelando.",
   "1950s rock and roll, boogie shuffle, climbing boogie bass, rhythm guitar, honky-tonk piano, handclaps, swinging",
   dict(kick="X.....X.....", snare="...X.....X..", hat="x.xx.xx.xx.x", clap="...x.....x.."),
   "r.5r.6r.7r.6", "X.xX.xX.xX.x", [(0, "M"), (5, "M"), (0, "M"), (7, "M")], passos=12, solo=("blues", 8), baixo_dur=0.8, cor="7d")
_r("Doo-Wop", GR1, "Anos 50 — tercinas de piano, baixo suave e vozes em harmonia.",
   "1950s doo-wop, triplet piano comping, soft drums, upright bass, vocal group harmonies, nostalgic ballad",
   dict(kick="X.....X.....", snare="...o.....o..", hat="x..x..x..x.."),
   "r..5..r..5..", "XxxXxxXxxXxx", P_DOOWOP, passos=12, solo=("pent_maior", 4), baixo_dur=0.9, cor="tri", energia=0.7)
_r("Surf Rock", GR1, "Anos 60 — guitarra trêmula, bateria com viradas de tom e baixo em colcheias.",
   "1960s surf rock, reverb-drenched twangy guitar, tremolo picking, driving drums with tom fills",
   dict(kick="X...X...X...X...", snare="....X.......X...", hat=H8, tom="..........o.o.o."),
   "r.r.r.r.r.r.r.r.", H16, [(9, "m"), (5, "M"), (7, "M"), (9, "m")], solo=("pent_menor", 8), crash=4, baixo_dur=0.6, cor="tri")
_r("Garage Rock", GR1, "Cru e acelerado — bateria batendo forte sem polimento e acordes abertos.",
   "garage rock, raw lo-fi production, fuzzy guitars, pounding loose drums, energetic",
   dict(kick="X.......X.x.....", snare="....X.......X..o", hat="x...x...x...x..."),
   "r.r.r.r.r.r.r.r.", "X.x.X.x.X.x.X.x.", P_IVV, solo=("pent_menor", 8), crash=8, baixo_dur=0.7, cor="tri")
_r("Psychedelic Rock", GR1, "Anos 60/70 — viagem de arpejos, toms soltos e clima flutuante.",
   "1960s psychedelic rock, swirling arpeggiated guitars, loose tom-heavy drums, trippy hypnotic groove",
   dict(kick="X.......X..x....", snare="....x.......x..o", ride=H8, tom="o.....o.....o..."),
   "r.......r.5.....", "1.2.3.2.4.3.2.1.", P_MIXO, solo=("pent_menor", 8), crash=8, baixo_dur=1.0, cor="tri", energia=0.9)
_r("Folk Rock", GR1, "Anos 60 — violões dedilhados e rasgueados com bateria de rock leve e pandeiro.",
   "1960s folk rock, jangly strummed acoustic and electric guitars, tambourine, steady backbeat",
   dict(kick="X.......X.x.....", snare="....X.......X...", shaker=H8),
   "r...r.5.r...r.5.", "X.xxX.xxX.xxX.xx", P_POP, solo=("pent_maior", 8), cor="tri", energia=0.85)
_r("Country Rock", GR1, "Anos 70 — pegada de country com guitarra de rock, baixo em dois tempos e refrão aberto.",
   "1970s country rock, twangy guitars, two-feel bass, steady backbeat, pedal steel",
   dict(kick="X.......X.......", snare="....X.......X...", hat=H8),
   "r.......5.......", "X..xX..xX..xX..x", P_IVV, solo=("pent_maior", 8), baixo_dur=0.95, cor="tri")
_r("Southern Rock", GR1, "Anos 70 — groove pesado do Sul, guitarras em dupla e bateria de pegada larga.",
   "1970s southern rock, twin lead guitars, hard-hitting boogie groove, slide guitar",
   dict(kick="X.....x.X.x.....", snare="....X.......X..o", ride=H8, tom="..............o."),
   "r.r.r...r.r.5...", "X.x.x.X.X.x.x.X.", P_MIXO, solo=("pent_maior", 8), crash=4, baixo_dur=0.85, cor="tri")
_r("Classic Rock", GR1, "Anos 70 — pegada firme, riffs de guitarra, chimbal aberto e baixo marcando.",
   "classic rock, 1970s FM rock, solid backbeat drums, open hi-hat accents, crunchy riff guitars, melodic bass, anthemic",
   dict(kick="X.....x.X..x....", snare="....X.......X...", hat="X.x.X.x.X.x.X.x.", open="..............o."),
   "r.r.r.r.r.r.r.5.", "X.x.x.x.X.x.x.x.", P_IVV, solo=("pent_menor", 8), crash=4, cor="tri")
_r("Arena Rock", GR1, "Épico — bateria enorme com palmas, baixo em semínimas e refrão para o estádio.",
   "arena rock, stadium anthem, huge drums with handclaps, steady quarter-note bass, soaring chorus",
   dict(kick="X.......X.x.X...", snare="....X.......X...", clap="....x.......x...", hat=H8, open="..............o."),
   "r...r...r...r...", "X.x.X.x.X.x.X.x.", P_POP, solo=("maior", 8), crash=4, cor="tri")
_r("Heartland Rock", GR1, "Rock de estrada americano — pandeiro, piano e guitarra em refrões abertos.",
   "heartland rock, working-class anthems, tambourine, piano and guitar, steady mid-tempo drive",
   dict(kick="X.......X..x....", snare="....X.......X...", shaker=H8),
   "r.r.5.r.r.r.5.r.", "X.x.xxx.X.x.xxx.", P_IVV, solo=("pent_maior", 8), cor="tri", energia=0.9)
_r("Funk Rock", GR1, "Rock com suingue de funk — baixo estalado, guitarra seca e bateria em semicolcheias.",
   "funk rock, slap bass, scratchy rhythm guitar, tight sixteenth-note groove",
   dict(kick="X..x..x...x.x...", snare="o...X..o.o..X..o", hat=H16),
   "r..r.r.r..r.r.8.", "x..xx..x..x.x...", P_7, swing=0.06, solo=("pent_menor", 8), baixo_dur=0.55, cor="9d")
_r("Glam Rock", GR1, "Anos 70 — pisada pesada, palmas e baixo martelando; brilho e atitude.",
   "glam rock, stomping beat, handclaps, pounding bass, glittery guitar riffs",
   dict(kick="X.x.....X.x.....", snare="....X.......X...", clap="....x.......x...", hat=H8),
   "r.r.8.r.r.r.8.r.", "X.x.X.x.X.x.X.x.", P_IVV, solo=("pent_maior", 8), crash=4, cor="tri")
_r("Rock Progressivo", GR1, "Sincopado e cheio de viradas — frases longas, ritmos quebrados e modos.",
   "progressive rock, syncopated odd-feeling grooves, tom fills, melodic bass, dorian modal guitar and keys",
   dict(kick="X..x.xx.X..x.x..", snare="....X.......X..x", ride=H8, tom="o..............."),
   "r..r.r..r..r.r.5", "X..x.xx.X..x.x..", [(9, "m"), (7, "M"), (5, "M"), (4, "m")], solo=("dorico", 8), crash=4, cor="tri")
_r("Rock Acústico", GR1, "Violões rasgueados, pandeiro e bateria suave — formato 'unplugged'.",
   "acoustic rock, unplugged, strummed acoustic guitars, soft brushed drums, shaker, warm and intimate",
   dict(kick="X.......X.......", shaker=H8, rim="....o.......o..."),
   "r.......5.......", "X.xxX.xxX.xxX.xx", P_POP, solo=("pent_maior", 4), cor="tri", energia=0.7)

# ───────────────────────── Rock — Alternativo e Indie ─────────────────────────
_r("Indie Rock", GR2, "Guitarras abertas e brilhantes, bateria solta e baixo em colcheias — clima indie.",
   "indie rock, jangly clean guitars, driving eighth-note bass, loose live drums, reverb-soaked, introspective",
   dict(kick="X.....x.X.......", snare="....X.......X...", hat=H8, rim="..............o."),
   "r.r.r.r.r.r.r.5.", "X.xxX.x.X.xxX.x.", P_VIIV, solo=("maior", 8), cor="add9", energia=0.9)
_r("Indie Pop", GR2, "Leve e brilhante — palmas, colcheias suaves e acordes com nona.",
   "indie pop, bright jangly guitars, handclaps, light bouncy drums, sweet melodic hooks, twee",
   dict(kick="X...X...X...X...", clap="....x.......x...", hat="x.o.x.o.x.o.x.o."),
   "r.r.5.r.r.r.5.r.", "X.x.X.x.X.x.X.x.", P_POP, solo=("maior", 8), cor="add9", energia=0.85)
_r("Indie Folk", GR2, "Folk moderno — violão dedilhado, pisadas e palmas, clima íntimo.",
   "indie folk, fingerpicked acoustic guitar, foot stomps and handclaps, warm intimate vocals",
   dict(kick="X...x...X...x...", clap="....o.......o..."),
   "r.......5.......", "1.2.3.2.4.3.2.1.", P_POP, solo=("pent_maior", 4), cor="add9", energia=0.7)
_r("Dream Pop", GR2, "Névoa sonora — acordes longos, shaker miúdo e uma batida que quase não aparece.",
   "dream pop, shimmering reverb guitars, soft washed-out drums, lush sustained chords, ethereal",
   dict(kick="X.....o.X.......", snare="....o.......o...", shaker="o.o.o.o.o.o.o.o."),
   "r.......r.......", "X_______________", P_VIIV, teclado="1...2...3...2...", baixo_dur=1.0, cor="add9", energia=0.7)
_r("Shoegaze", GR2, "Muro de guitarras — acordes longos e altos, bateria firme e pratos.",
   "shoegaze, wall of sound, heavily distorted washed guitars, sustained chords, steady drums",
   dict(kick="X.......X.......", snare="....X.......X...", hat=H8),
   "r.......r...r...", "X_______X_______", P_VIIV, crash=2, baixo_dur=1.0, cor="add9", energia=1.0)
_r("Post-Punk", GR2, "Seco e angular — baixo melódico na frente, guitarra esparsa e bateria tensa.",
   "post-punk, angular guitars, melodic prominent bass, tight tense drums, cold and driving",
   dict(kick="X.....x.X.......", snare="....X.......X...", hat="X.x.X.x.X.x.X.x.", tom="..............o."),
   "r.r.8.r.r.r.8.r.", "x.......x.......", P_VIIV, solo=("pent_menor", 4), baixo_dur=0.7, cor="tri")
_r("New Wave", GR2, "Anos 80 — pulsação de teclado, bateria seca e chimbal aberto na contratempo.",
   "new wave, 1980s synth pulse, crisp dry drums, offbeat open hi-hat, bouncy bass, catchy",
   dict(kick="X...X...X...X...", snare="....X.......X...", hat=H8, open="..o...o...o...o."),
   "r.r.r.r.r.r.r.r.", "X.x.X.x.X.x.X.x.", P_VIIV, cor="tri")
_r("Britpop", GR2, "Anos 90 — guitarras rasgadas, pandeiro nas semicolcheias e refrões de coro.",
   "britpop, 1990s British guitar pop, strummed chords, tambourine, singalong choruses",
   dict(kick="X.....x.X.x.....", snare="....X.......X...", hat=H8, shaker=H16),
   "r.r.5.r.r.r.5.r.", "X.xxX.xxX.xxX.xx", P_POP, crash=4, cor="tri")
_r("Emo", GR2, "Guitarras em arpejo, bateria cheia de aro e refrões que crescem.",
   "emo, arpeggiated clean guitars building to loud choruses, busy drums with rimshots, emotional",
   dict(kick="X.....x...x.....", snare="....X.......X...", hat="X.x.X.x.X.x.X.x.", rim="..o.....o.....o."),
   "r.r.r.r.r.r.r.r.", ARP, P_VIIV, solo=("pent_menor", 8), crash=4, cor="add9")
_r("Pop Punk", GR2, "Rápido e colorido — bateria 'skate', baixo em colcheias e power chords.",
   "pop punk, fast skate-beat drums, eighth-note power chords, bouncy bass, catchy sing-along hooks",
   dict(kick="X.x...x.X.x...x.", snare="..x.X.x...x.X.x.", hat=H8),
   "r.r.r.r.r.r.r.r.", "X.x.X.x.X.x.X.x.", [(0, "5"), (7, "5"), (9, "5"), (5, "5")], crash=4, baixo_dur=0.6, cor="5")
_r("Power Pop", GR2, "Melodias grudentas com guitarras rasgadas e bateria vibrante.",
   "power pop, crunchy jangle guitars, big melodic hooks, upbeat driving drums, handclaps",
   dict(kick="X.....x.X.......", snare="....X.......X...", ride="X.x.X.x.X.x.X.x.", shaker="..x...x...x...x."),
   "r.r.r.r.r.r.r.r.", "X.xxX.xxX.xxX.xx", P_POP, crash=8, cor="tri")
_r("Post-Rock", GR2, "Instrumental e crescente — acordes longos, toms e pratos que explodem aos poucos.",
   "post-rock, slowly building instrumental, tremolo guitars, sustained chords, tom rolls, cinematic crescendos",
   dict(kick="X.......X.......", snare="........o.......", ride="x...x...x...x...", tom="o.......o......."),
   "r.......r.......", "X_______________", P_VIIV, teclado="1.......3.......", crash=4, baixo_dur=1.0, cor="add9", energia=0.8)
_r("Math Rock", GR2, "Quebrado e sincopado — guitarras em 3+3+2, bateria cheia de síncope.",
   "math rock, intricate syncopated guitar lines, off-kilter drums, tapping, clean tone, precise and angular",
   dict(kick="X..x..x.X..x.x..", snare="....X..x....X..x", hat=H8),
   "r..r..r.r..r.r..", "X..x..x.X..x..x.", P_POP, solo=("maior", 8), cor="tri")
_r("Madchester", GR2, "Dançante e cambaleante — rock com groove de pista, congas e chimbal em semicolcheias.",
   "madchester, baggy rock dance groove, shuffling hi-hats, congas, funky bass, hypnotic",
   dict(kick="X...X...X...X...", snare="....X.......X...", hat=H16, conga="..x...x...x...x."),
   "r..r..r.r..r.r..", "X..x..x.x..x..x.", P_VIIV, cor="tri", energia=0.95)
_r("Bedroom Pop", GR2, "Caseiro e sonolento — bateria miúda, acordes macios e swing leve.",
   "bedroom pop, lo-fi homemade production, soft drum machine, dreamy chords, laid-back and intimate",
   dict(kick="X.......X.......", rim="....o.......o...", hat="o.o.o.o.o.o.o.o."),
   "r.......5.......", "X___..x_X___....", P_JAZZ, swing=0.12, cor="9", energia=0.6)
_r("Rock Gótico", GR2, "Sombrio — toms tribais, baixo na frente e guitarras em arpejo com eco.",
   "gothic rock, tribal toms, driving bass, chorus-drenched arpeggio guitars, dark and dramatic",
   dict(kick="X.......X.......", tom="X...x...X...x...", snare="........x......."),
   "r.r.r.r.r.r.r.r.", "1.2.3.2.1.2.3.2.", [(9, "m"), (5, "M"), (0, "M"), (4, "m")], solo=("pent_menor", 4), baixo_dur=0.8, cor="tri", energia=0.85)

# ───────────────────────── Rock — Pesado ─────────────────────────
_r("Heavy Metal", GR3, "Clássico — riffs em power chords, bateria firme com ride e pratos de peso.",
   "heavy metal, classic riffs on power chords, solid hard-hitting drums, ride and crash cymbals, galloping bass",
   dict(kick="X.....x.X.....xx", snare="....X.......X...", ride=H8),
   "r.r.r.r.r.r.r.r.", "X.x.X.x.X.x.X.x.", P_MET5, solo=("pent_menor", 8), crash=4, baixo_dur=0.7, cor="5")
_r("Power Metal", GR3, "Veloz e épico — bumbo duplo, galope de baixo e teclado em arpejo.",
   "power metal, double bass drumming, galloping bass, epic melodic choruses, fast arpeggiated keyboards",
   dict(kick="XxXxXxXxXxXxXxXx", snare="....X.......X...", ride=H8),
   "r.rrr.rrr.rrr.rr", "X.xxX.xxX.xxX.xx", [(0, "5"), (7, "5"), (9, "5"), (5, "5")], solo=("maior", 8), crash=4, baixo_dur=0.5, cor="5")
_r("Speed Metal", GR3, "Acelerado e seco — bumbo em colcheias, baixo contínuo e riffs cortantes.",
   "speed metal, relentless fast eighth-note kick, buzzsaw riffs, tight palm-muted guitars",
   dict(kick="X.X.X.X.X.X.X.X.", snare="....X.......X...", hat=H8),
   "rrrrrrrrrrrrrrrr", "X.x.X.x.X.x.X.x.", [(0, "5"), (1, "5"), (0, "5"), (3, "5")], solo=("pent_menor", 8), crash=4, baixo_dur=0.5, cor="5")
_r("Death Metal", GR3, "Brutal — bumbo ininterrupto, caixa em colcheias e riffs cromáticos.",
   "death metal, blast beats, relentless double bass, chromatic down-tuned riffs, growled intensity",
   dict(kick="XXXXXXXXXXXXXXXX", snare="x.x.x.x.x.x.x.x."),
   "rrrrrrrrrrrrrrrr", "XxXxXxXxXxXxXxXx", P_CROM5, solo=("pent_menor", 8), crash=2, baixo_dur=0.4, cor="5")
_r("Black Metal", GR3, "Gelado e furioso — bumbo e caixa alternados, tremolo nas guitarras.",
   "black metal, blast beat alternating kick and snare, tremolo-picked guitars, raw icy atmosphere",
   dict(kick="X.X.X.X.X.X.X.X.", snare=".X.X.X.X.X.X.X.X"),
   "rrrrrrrrrrrrrrrr", "xxxxxxxxxxxxxxxx", [(0, "5"), (6, "5"), (5, "5"), (0, "5")], solo=("pent_menor", 8), crash=4, baixo_dur=0.4, cor="5")
_r("Doom Metal", GR3, "Lento e esmagador — meio tempo, acordes longos e baixo pesado.",
   "doom metal, crushingly slow half-time drums, heavy sustained power chords, fuzzy bass, dark and massive",
   dict(kick="X.......X.......", snare="........X.......", hat="x.......x......."),
   "r.......r.......", "X_______X_______", [(0, "5"), (1, "5"), (0, "5"), (10, "5")], solo=("pent_menor", 4), crash=8, baixo_dur=1.0, cor="5")
_r("Stoner Rock", GR3, "Groove pesado e arrastado — baixo gordo, ride e toms em riffs hipnóticos.",
   "stoner rock, fuzzy downtuned riffs, fat groovy bass, ride-heavy drums with tom accents, hypnotic sludgy grooves",
   dict(kick="X.....x...x.X...", snare="....X.......X...", ride=H8, tom="..............o."),
   "r.r.r.r.r.r.r.a.", "X.x...x.X.x...x.", [(0, "5"), (10, "5"), (5, "5"), (7, "5")], solo=("pent_menor", 8), crash=4, cor="5")
_r("Groove Metal", GR3, "Riffs sincopados e pesados — bumbo quebrado e acordes 'mastigados'.",
   "groove metal, syncopated chugging riffs, mid-tempo heavy groove, palm-muted guitars, tight kick patterns",
   dict(kick="X..x..x.X..x..x.", snare="....X.......X...", hat=H8),
   "r..r..r.r..r..r.", "X..x..x.X..x..x.", [(0, "5"), (3, "5"), (5, "5"), (0, "5")], solo=("pent_menor", 8), crash=4, baixo_dur=0.6, cor="5")
_r("Nu Metal", GR3, "Riffs graves e sincopados com groove de hip hop e baixo grosso.",
   "nu metal, downtuned syncopated riffs, hip hop influenced groove, heavy bass, rhythmic stabs",
   dict(kick="X.x..x..X.x...x.", snare="....X.......X...", hat=H8),
   "r.r..r..r.r...r.", "X.x..x..X.x...x.", [(0, "5"), (0, "5"), (3, "5"), (5, "5")], solo=("pent_menor", 4), baixo_dur=0.55, cor="5")
_r("Metalcore", GR3, "Peso e melodia — breakdowns em meio tempo, pratos e riffs picotados.",
   "metalcore, heavy breakdowns in half-time, chugging palm-muted riffs, melodic choruses, crashing cymbals",
   dict(kick="X..x..x.X.......", snare="........X.......", hat=H8),
   "r..r..r.r.......", "X..x..x.X.......", [(9, "5"), (5, "5"), (0, "5"), (7, "5")], solo=("pent_menor", 8), crash=2, baixo_dur=0.6, cor="5")
_r("Glam Metal", GR3, "Anos 80 — refrões enormes, palmas, bumbo em arrancada e solos longos.",
   "glam metal, 1980s hair metal, huge sing-along choruses, handclaps, double-kick bursts, flashy solos",
   dict(kick="X.....xxX.....xx", snare="....X.......X...", clap="....x.......x...", hat=H8),
   "r.r.r.r.r.r.r.r.", "X.x.X.x.X.x.X.x.", P_POP, solo=("pent_maior", 8), crash=4, cor="tri")
_r("Hardcore Punk", GR3, "Furioso e curto — d-beat, colcheias rápidas e power chords sem enfeite.",
   "hardcore punk, fast d-beat drums, buzzing power chords, raw aggression, short and relentless",
   dict(kick="X.xX.xX.X.xX.xX.", snare="....X.......X...", hat=H8),
   "r.r.r.r.r.r.r.r.", "X.x.X.x.X.x.X.x.", [(0, "5"), (5, "5"), (7, "5"), (0, "5")], baixo_dur=0.5, cor="5")
_r("Metal Progressivo", GR3, "Técnico e quebrado — compassos de síncope, viradas e escalas modais.",
   "progressive metal, complex syncopated riffs, technical drumming, modal dorian solos, heavy and intricate",
   dict(kick="X..x.xx.X..x.x..", snare="....X.......X..x", hat=H8),
   "r..r.rr.r..r.r..", "X..x.xx.X..x.x..", [(9, "5"), (7, "5"), (5, "5"), (4, "5")], solo=("dorico", 8), crash=4, baixo_dur=0.6, cor="5")

# ───────────────────────── Pop — Vertentes ─────────────────────────
_r("Synth-pop", GP, "Anos 80 — sequenciador pulsando, palmas na caixa e baixo de sintetizador.",
   "synth-pop, 1980s analog synthesizers, sequenced pulsing bass, drum machine with handclaps, melancholic catchy hooks",
   dict(kick="X...X...X...X...", clap="....X.......X...", hat=H8, open="..o...o...o...o."),
   "r..r.r.r..r.r.r.", "x.x.x.x.x.x.x.x.", P_VIIV, teclado=ARP, baixo_dur=0.6, cor="tri", energia=0.95)
_r("Dance-pop", GP, "Pop de pista — bumbo reto, palmas e chimbal na contratempo, acordes em stabs.",
   "dance-pop, four-on-the-floor kick, handclaps, offbeat hi-hats, bright synth stabs, energetic radio hit",
   dict(kick="X...X...X...X...", clap="....X.......X...", hat="..x...x...x...x.", shaker=H16),
   "r.r.5.r.r.r.5.r.", "X..x..x...x.x...", P_POP, cor="tri", energia=1.0)
_r("Electropop", GP, "Pop eletrônico — bumbo sincopado, palmas fortes e baixo grave em notas curtas.",
   "electropop, syncopated electronic kick, snappy claps, deep synth bass, glossy hooks",
   dict(kick="X.....x...x.....", clap="....X.......X...", hat=H8),
   "r..r..r...r.r...", "X..x..x...x.x...", P_VIIV, teclado=ARP, baixo_dur=0.6, cor="tri")
_r("Teen Pop", GP, "Pop adolescente — batida limpa, palmas discretas, baixo marcando e refrão grudento.",
   "teen pop, clean punchy drums, light handclaps, bouncy bass, bubbly hooks",
   dict(kick="X.....x.X.......", snare="....X.......X...", clap="....o.......o...", hat=H8),
   "r.r.r.r.r.r.r.5.", "X.xxX.xxX.xxX.xx", P_POP, cor="tri")
_r("Bubblegum Pop", GP, "Doce e simples — pandeiro, cowbell, baixo em colcheias e acordes marcados.",
   "bubblegum pop, simple sugary melodies, tambourine and cowbell, bouncy eighth-note bass, playful",
   dict(kick="X.......X.......", snare="....x.......x...", shaker=H8, cowbell="x..............."),
   "r.r.r.r.r.r.r.r.", "X.x.X.x.X.x.X.x.", P_IVV, cor="tri", energia=0.9)
_r("Pop Suave", GP, "Adulto contemporâneo — piano macio, vassourinha na caixa e acordes com sétima.",
   "adult contemporary soft pop, smooth piano, brushed drums, warm maj7 chords, easy listening",
   dict(kick="X.......X.......", rim="....o.......o...", hat=H8),
   "r.......r.......", "X_______X_______", P_JAZZ, solo=("pent_maior", 4), baixo_dur=1.0, cor="7", energia=0.65)
_r("Soft Rock", GP, "Anos 70 — suave e melódico, baixo cantante, acordes com sétima e bateria macia.",
   "soft rock, 1970s mellow melodic rock, singing bass lines, electric piano chords, gentle backbeat",
   dict(kick="X.....x...x.....", snare="....X.......X...", hat=H8),
   "r..r..5.r..r.6..", "X.x...x.X.x...x.", P_JAZZ, swing=0.05, solo=("pent_maior", 8), cor="7", energia=0.8)
_r("Yacht Rock", GP, "Anos 70/80 — groove polido com nonas, chimbal aberto e baixo cheio de notas.",
   "yacht rock, smooth polished west coast groove, jazzy maj9 chords, open hi-hat, melodic fretless bass",
   dict(kick="X.....x...x.....", snare="....X.......X...", hat="x.xox.xox.xox.xo"),
   "r..r..r.5..r.6..", "X..x..x...x.x...", P_JAZZ, swing=0.08, solo=("maior", 8), cor="9", energia=0.8)
_r("Pop Acústico", GP, "Violão rasgueado, shaker contínuo e bumbo leve — pop de voz e violão.",
   "acoustic pop, strummed acoustic guitar, steady shaker, light kick, warm intimate production",
   dict(kick="X.......X..x....", shaker="x.xxx.xxx.xxx.xx"),
   "r.......5.......", "X.xxx.xxX.xxx.xx", P_POP, solo=("pent_maior", 4), cor="tri", energia=0.7)
_r("Power Ballad", GP, "Balada de arena — meio tempo na caixa, viradas de tom e refrão que explode.",
   "power ballad, half-time snare, tom fills, sustained chords building to a huge chorus, emotional",
   dict(kick="X.......X.....x.", snare="........X.......", hat=H8, tom="..............o."),
   "r.......r.......", "X_______X_______", P_POP, solo=("maior", 8), crash=4, baixo_dur=1.0, cor="tri", energia=0.9)
_r("Balada ao Piano", GP, "Piano em arpejo, quase sem bateria — para cantar de perto.",
   "piano ballad, flowing piano arpeggios, barely-there percussion, tender and intimate",
   dict(shaker="o...o...o...o..."),
   "r.......5.......", "1.2.3.2.1.2.3.2.", P_POP, solo=("pent_maior", 4), baixo_dur=1.0, cor="7", energia=0.55)
_r("K-pop", GP, "Pop coreano — batida de trap com sintetizador, chimbal picado e stabs cortados.",
   "K-pop, polished trap-influenced beat, stuttering hi-hats, sharp synth stabs, dynamic switches",
   dict(kick="X.....x...x.....", clap="....X.......X...", hat="x.x.xxx.x.x.xxx."),
   "r.r..r..r.r..r..", "x..xx..x..x.xx..", P_VIIV, teclado=ARP, baixo_dur=0.6, cor="9")
_r("J-pop", GP, "Pop japonês — bateria vibrante com chimbal em semicolcheias, 'royal road' e refrão que sobe.",
   "J-pop, bright energetic drums, sixteenth-note hi-hats, royal road chord progression, soaring melodic choruses, fast keyboard lines",
   dict(kick="X.....x.X.....x.", snare="....X.......X...", hat=H16),
   "r.r.r.r.r.r.r.5.", "X.xxX.xxX.xxX.xx", [(5, "maj7"), (7, "7"), (4, "m7"), (9, "m7")], solo=("maior", 8), crash=4, cor="7")
_r("City Pop", GP, "Anos 80 — pop japonês de cidade grande: baixo cantante, nonas e swing macio.",
   "city pop, 1980s Japanese urban pop, slap fretless bass, lush maj9 chords, glossy production",
   dict(kick="X.....x...x.....", snare="....X.......X...", hat=H8, open="..o.......o....."),
   "r..r.r.8..r.5...", "X..x..x...x.x...", [(5, "maj7"), (4, "m7"), (9, "m7"), (7, "7")], swing=0.08, solo=("maior", 8), cor="9", energia=0.85)
_r("Pop Latino", GP, "Pop com sabor latino — bumbo sincopado, congas, aro na caixa e violão.",
   "latin pop, syncopated kick, congas, rimshot clave feel, nylon guitar strums, tropical groove",
   dict(kick="X..x..x.X..x..x.", rim="..x...x...x...x.", conga="x..x..x.x..x..x.", hat=H8),
   "r..r..r.r..r..r.", "X..x..x.X..x..x.", P_VIIV, cor="tri")
_r("Pop Anos 60", GP, "Anos 60 — chimbal firme, baixo caminhando e violões rasgando em acordes de doo-wop.",
   "1960s pop, steady hi-hat and backbeat, walking melodic bass, strummed guitars, sweet vocal harmonies",
   dict(kick="X.......X.x.....", snare="....X.......X...", hat=H8),
   "r.r.5.r.6.r.5.r.", "X.xxX.xxX.xxX.xx", P_DOOWOP, cor="tri", energia=0.85)
_r("Pop Anos 80", GP, "Anos 80 — bateria eletrônica grandiosa, chimbal em semicolcheias e teclados brilhantes.",
   "1980s pop, big gated drums, sixteenth-note hi-hats, bright synths, glossy production",
   dict(kick="X.......X.x.....", snare="....X.......X...", clap="....x.......x...", hat=H16, open="..............o."),
   "r.r.r.r.r.r.r.r.", "X.x.X.x.X.x.X.x.", P_POP, teclado=ARP, cor="tri")
_r("Country Pop", GP, "Country de rádio — bumbo e caixa de pop, violões brilhantes e pandeiro.",
   "country pop, polished pop drums, bright acoustic and electric guitars, tambourine, big chorus",
   dict(kick="X.......X.......", snare="....X.......X...", hat="x...x...x...x...", shaker="..x...x...x...x."),
   "r.......5.......", "X..xX.x.X..xX.x.", P_POP, solo=("pent_maior", 8), cor="tri", energia=0.9)

# ───────────────────────── Blues ─────────────────────────
# Os 12 compassos fixos: blues "rápido" (quick change), blues menor, de jazz. O restante SEGUE A SUA MELODIA com acordes dominantes (cor 7d).
QUICK12 = [(0, "7"), (5, "7"), (0, "7"), (0, "7"), (5, "7"), (5, "7"), (0, "7"), (0, "7"), (7, "7"), (5, "7"), (0, "7"), (7, "7")]
MENOR12 = [(9, "m7")] * 4 + [(2, "m7")] * 2 + [(9, "m7")] * 2 + [(5, "maj7"), (4, "7"), (9, "m7"), (4, "7")]      # escrito na relativa maior
JAZZB12 = [(0, "7"), (5, "7"), (0, "7"), (0, "7"), (5, "7"), (5, "7"), (0, "7"), (9, "7"), (2, "m7"), (7, "7"), (0, "7"), (7, "7")]
_r("Delta Blues", GBL, "Raiz do Mississippi — pisada no chão, violão com baixo no polegar e muito espaço.",
   "delta blues, raw acoustic slide guitar, foot stomp on every beat, thumb bass, sparse and haunting",
   dict(kick="X..X..X..X.."), "r..r..5..5..", "X..x..X..x..", P_7, passos=12, solo=("blues", 4), baixo_dur=1.0, cor="7d", energia=0.7)
_r("Chicago Blues", GBL, "Blues elétrico urbano — shuffle com baixo caminhando e gaita no fundo.",
   "Chicago blues, electric shuffle, walking bass, harmonica, tight band groove",
   dict(kick="X.....X.....", snare="...X.....X..", hat="x.xx.xx.xx.x"),
   "r.3r.5r.6r.5", "X..x..X..x..", P_7, passos=12, solo=("blues", 8), baixo_dur=0.85, cor="7d")
_r("Texas Blues", GBL, "Shuffle forte e nervoso — bumbo em todos os tempos, ride e solos agressivos.",
   "Texas blues, hard-driving shuffle, kick on every beat, ride cymbal, fiery guitar leads",
   dict(kick="X..X..X..X..", snare="...X.....X..", ride="x.xx.xx.xx.x"),
   "r.rr.5r.rr.5", "X.xX..X.xX..", P_7, passos=12, solo=("blues", 8), crash=4, cor="7d", energia=1.0)
_r("Blues Shuffle", GBL, "O shuffle de sempre, mas com acordes de blues seguindo a SUA melodia.",
   "blues shuffle, triplet feel, steady backbeat, dominant seventh chords, classic 12/8 groove",
   dict(kick="X.....X.....", snare="...X.....X..", hat="x.xx.xx.xx.x"),
   "r..r.5r..r.5", "X.xX.xX.xX.x", P_7, passos=12, solo=("blues", 8), cor="7d")
_r("Slow Blues", GBL, "Lento em 12/8 — tercinas no chimbal, acordes longos e muita emoção.",
   "slow blues, 12/8 groove, triplet hi-hats, sustained organ chords, soulful and emotional",
   dict(kick="X.....X.....", snare="...o.....x..", hat="oxxoxxoxxoxx"),
   "r.....5.....", "X_____X_____", P_7, passos=12, solo=("blues", 4), baixo_dur=1.0, cor="7d", energia=0.65)
_r("Jump Blues", GBL, "Blues dançante dos anos 40 — baixo caminhando, metais e acordes na caixa.",
   "jump blues, swinging uptempo shuffle, walking bass, honking saxophones, backbeat chords",
   dict(kick="X..X..X..X..", snare="...X.....X..", hat="x.xx.xx.xx.x"),
   "r.3r.5r.6r.5", "...X.....X..", P_7, passos=12, solo=("blues", 8), crash=4, cor="7d", energia=1.0)
_r("Boogie-Woogie", GBL, "Piano martelando — baixo em oitavas quebradas e shuffle sem parar.",
   "boogie-woogie, driving left-hand piano bass pattern, relentless shuffle, barrelhouse piano",
   dict(kick="X..X..X..X..", snare="...X.....X..", hat="x.xx.xx.xx.x"),
   "r.r5.5r.r6.6", "X.xX.xX.xX.x", P_7, passos=12, solo=("blues", 8), baixo_dur=0.7, cor="7d", energia=1.0)
_r("Electric Blues", GBL, "Blues de guitarra — bumbo marcando, ride em semínimas e solos longos.",
   "electric blues, overdriven guitar, kick on one and three with ghosts, open quarter-note ride, long expressive solos",
   dict(kick="X..x..X..x..", snare="...X.....X..", ride="X..x..x..x.."),
   "r.5r.3r.5r.3", "X..x..X..xX.", P_7, passos=12, solo=("blues", 8), crash=4, cor="7d", energia=1.0)
_r("Country Blues", GBL, "Violão dedilhado — polegar no baixo, arpejos e quase nenhuma percussão.",
   "country blues, fingerpicked acoustic guitar, alternating thumb bass, rural and intimate",
   dict(kick="X..X..X..X.."), "r..5..r..5..", "1.2.3.2.1.2.", P_7, passos=12, solo=("blues", 4), baixo_dur=1.0, cor="7d", energia=0.65)
_r("Soul Blues", GBL, "Blues com alma — shuffle lento, acentos de metais e baixo cantante.",
   "soul blues, slow shuffle, horn stabs, singing bass, gospel-tinged vocals",
   dict(kick="X.....X.....", snare="...x.....x..", hat="x..x..x..x.."),
   "r..r..5.r.5.", "..X..X..X..X", P_7, passos=12, solo=("blues", 4), cor="7d", energia=0.8)
_r("Gospel Blues", GBL, "Palmas e pandeiro em shuffle — blues de igreja, órgão e coro.",
   "gospel blues, handclaps and tambourine shuffle, Hammond organ chords, church choir feel",
   dict(kick="X..X..X..X..", clap="...X.....X..", shaker="x.xx.xx.xx.x"),
   "r..5..r..5..", "Xx.Xx.Xx.Xx.", P_7, passos=12, solo=("pent_maior", 4), cor="7d", energia=0.9)
_r("Swamp Blues", GBL, "Pântano da Louisiana — arrastado, tom pesado e guitarra suja.",
   "swamp blues, lazy dragging groove, heavy toms, murky guitar tone, Louisiana bayou feel",
   dict(kick="X.....X.....", snare="...X.....x..", tom="..........o."),
   "r.....r...5.", "X.....X.x...", P_7, passos=12, solo=("blues", 4), baixo_dur=1.0, cor="7d", energia=0.8)
_r("British Blues", GBL, "Anos 60 — blues elétrico britânico, chimbal aberto e baixo martelando.",
   "British blues, 1960s electric blues rock, open hi-hat shuffle, pounding bass, bluesy lead guitar",
   dict(kick="X..x..X..x..", snare="...X.....X..", hat="x.xx.xx.xx.x", open="..........o."),
   "r.rr.rr.5r.r", "X.x..xX.x..x", P_7, passos=12, solo=("blues", 8), crash=4, cor="7d", energia=0.95)
_r("Funky Blues", GBL, "Blues com suingue de funk — semicolcheias, baixo sincopado e guitarra seca.",
   "funky blues, sixteenth-note groove, syncopated bass, scratchy guitar, bluesy funk",
   dict(kick="X..x..x...x.x...", snare="....X..o....X..o", hat=H16),
   "r..r..r.r..r.5..", "x..xx..x..x.x...", P_7, swing=0.08, solo=("blues", 8), baixo_dur=0.6, cor="7d", energia=0.95)
_r("Balada de Blues", GBL, "Balada em 12/8 — caixa macia, acordes longos e emoção contida.",
   "blues ballad, slow 12/8 feel, soft brushed snare, sustained chords, tender and soulful",
   dict(kick="X.....X.....", snare="...o.....o..", hat="x..x..x..x.."),
   "r.....r.....", "X_____X_____", P_7, passos=12, solo=("blues", 4), baixo_dur=1.0, cor="7d", energia=0.6)
_r("Blues Menor", GBL, "Blues sombrio em tom menor, seguindo a sua melodia.",
   "minor blues, dark moody shuffle, minor seventh chords, brooding bass, smoky atmosphere",
   dict(kick="X.....X.....", snare="...X.....X..", hat="x.xx.xx.xx.x"),
   "r..r..5..3..", "X.xX.xX.xX.x", [(9, "m7"), (2, "m7"), (9, "m7"), (4, "7")], passos=12, solo=("blues", 8), cor="7d")
_r("Blues Rápido (12 compassos)", GBL, "12 compassos clássicos com troca rápida para o IV — forma fixa de blues.",
   "12-bar blues with quick change to the IV, classic shuffle, fixed blues form",
   dict(kick="X.....X.....", snare="...X.....X..", hat="x.xx.xx.xx.x"),
   "r.5r.6r.5r.6", "X.xX.xX.xX.x", QUICK12, passos=12, solo=("blues", 8))
_r("Blues Menor (12 compassos)", GBL, "12 compassos de blues menor — i, iv e V7, forma fixa (para músicas em tom menor).",
   "12-bar minor blues, fixed form, minor chords with dominant turnaround, brooding shuffle",
   dict(kick="X.....X.....", snare="...X.....X..", hat="x.xx.xx.xx.x"),
   "r.....5.....", "X_____X.x...", MENOR12, passos=12, solo=("blues", 4), baixo_dur=1.0)
_r("Boogie-Woogie (12 compassos)", GBL, "Boogie de piano na forma fixa de 12 compassos.",
   "12-bar boogie-woogie, rolling piano left hand, fixed blues form, barrelhouse shuffle",
   dict(kick="X..X..X..X..", snare="...X.....X..", hat="x.xx.xx.xx.x"),
   "r.r5.5r.r6.6", "X.xX.xX.xX.x", R.BLUES12, passos=12, solo=("blues", 8), baixo_dur=0.7)
_r("Blues de Jazz (12 compassos)", GBL, "12 compassos com a volta de jazz: vi7, ii7 e V7 no final.",
   "jazz blues 12-bar with ii-V turnaround, walking bass, swinging ride, sophisticated changes",
   dict(ride="X..x.xX..x.x", hat="...x.....x..", kick="o..o..o..o.."),
   "r..3..5..a..", "X....x......", JAZZB12, passos=12, solo=("blues", 8), baixo_dur=0.95)
_r("Slow Blues (12 compassos)", GBL, "Slow blues em 12/8 com os 12 compassos fixos, órgão e emoção.",
   "slow 12-bar blues in 12/8, fixed form, sustained organ chords, soulful guitar, late-night groove",
   dict(kick="X.....X.....", snare="...o.....x..", hat="oxxoxxoxxoxx"),
   "r.....5.....", "X_____X_____", R.BLUES12, passos=12, solo=("blues", 4), baixo_dur=1.0, energia=0.65)

# ───────────────────────── Soul, R&B e Funk ─────────────────────────
_r("Motown", GS, "Detroit anos 60 — pandeiro em tudo, caixa e palmas juntas e baixo cantando.",
   "Motown sound, tambourine on every eighth, stacked snare and handclap on two and four, melodic Jamerson bass",
   dict(kick="X.....x.X.......", snare="....X.......X...", clap="....x.......x...", shaker=H8),
   "r.r.5.r.6.r.5.a.", "X.x.X.x.X.x.X.x.", P_DOOWOP, cor="tri", energia=0.9)
_r("Southern Soul", GS, "Memphis (Stax) — groove atrás do tempo, baixo sincopado e stabs de metais.",
   "Southern soul, laid-back behind-the-beat groove, syncopated bass, horn stabs",
   dict(kick="X.......X..x....", snare="....X.......X...", hat=H8, open="..............o."),
   "r.....r.r.....5.", "X..x..x...x.x...", P_7, solo=("pent_maior", 8), baixo_dur=0.85, cor="9d", energia=0.9)
_r("Northern Soul", GS, "Pista inglesa dos anos 60/70 — bumbo reto, pandeiro nas semicolcheias, ritmo acelerado.",
   "Northern soul, uptempo stomping four-on-the-floor, driving tambourine, walking bass, dancefloor Motown stompers",
   dict(kick="X...X...X...X...", snare="....X.......X...", shaker=H16),
   "r.r.5.r.6.r.5.r.", "X.x.X.x.X.x.X.x.", P_DOOWOP, cor="tri", energia=1.0)
_r("Philly Soul", GS, "Filadélfia anos 70 — cordas sustentadas, chimbal aberto e baixo em oitavas.",
   "Philly soul, lush sustained strings, open hi-hat 16ths, melodic octave bass, silky vocals",
   dict(kick="X...X...X...X...", snare="....X.......X...", hat="x.xox.xox.xox.xo"),
   "r.8.5.8.r.8.5.8.", "X___X___X___X___", P_JAZZ, teclado=ARP, cor="7", energia=0.9)
_r("Neo-Soul", GS, "Soul moderno — swing atrasado, caixa fantasma, acordes de nona e baixo solto.",
   "neo-soul, laid-back swung groove, ghost-note snare, warm Rhodes maj9 chords, loose bass",
   dict(kick="X......x..x.....", snare="....X..o....X..o", hat=H8, rim="..o.....o......."),
   "r..r..r..r..5...", "X___..x_X___....", [(5, "maj7"), (4, "m7"), (9, "m7"), (2, "m7")], swing=0.15, solo=("pent_menor", 4), baixo_dur=0.95, cor="9", energia=0.8)
_r("Soul Gospel", GS, "Soul de igreja — órgão sustentado, palmas na caixa e baixo caminhando em 12/8.",
   "gospel soul, sustained Hammond organ, handclaps on two and four, walking bass in 12/8, uplifting call and response",
   dict(kick="X..X..X..X..", snare="...X.....X..", clap="...x.....x.."),
   "r..5..r..5..", "X_____X_____", P_JAZZ, passos=12, solo=("pent_maior", 4), cor="7", energia=0.9)
_r("Psychedelic Soul", GS, "Funk-psicodélico dos anos 60/70 — guitarra com wah arranhada e groove sujo.",
   "psychedelic soul, wah-wah scratch guitar, gritty funky groove, fuzz bass, trippy horns",
   dict(kick="X..x..x...x.x...", snare="....X.......X...", hat=H16),
   "r..r.r.r..r.r.8.", "x.xx.xx.xx.xx.xx", P_7, swing=0.08, baixo_dur=0.6, cor="9d", energia=0.95)
_r("Blue-Eyed Soul", GS, "Soul de branco anos 70/80 — groove polido, caixa seca e baixo marcado.",
   "blue-eyed soul, polished smooth groove, dry snare, tight melodic bass, silky chords",
   dict(kick="X.....x.X.......", snare="....X.......X...", hat=H8, rim="..o.......o....."),
   "r..r..r.r..r..r.", "X..x..x.X..x..x.", P_JAZZ, solo=("pent_maior", 8), cor="7", energia=0.85)
_r("Quiet Storm", GS, "Madrugada de rádio — groove lento, acordes de nona e sensualidade.",
   "quiet storm, slow sensual groove, lush maj9 chords, soft rimshot, late-night radio R&B",
   dict(kick="X.......X.......", rim="....o.......o...", hat="x...x...x...x..."),
   "r.......r.......", "X_______X_______", P_JAZZ, swing=0.1, baixo_dur=1.0, cor="9", energia=0.6)
_r("Slow Jam", GS, "Balada de R&B — bumbo arrastado, hi-hat picotado e baixo sub grave.",
   "slow jam, sensual R&B, sub bass, stuttering hi-hats, laid-back kick, smooth keys",
   dict(kick="X.......X..x....", snare="....x.......x...", hat="x.xxx.xxx.xxx.xx"),
   "r.......r..r....", "X___..x_X___....", P_VIIV, swing=0.1, baixo_dur=1.0, cor="9", energia=0.65)
_r("R&B Contemporâneo", GS, "R&B atual — trap suave, rolagens de chimbal, baixo sub e acordes de nona.",
   "contemporary R&B, trap-influenced soft beat, hi-hat rolls, deep sub bass, lush maj9 chords",
   dict(kick="X.....x...x.....", snare="....X.......X...", hat="xxx.xxx.x.xxx.x."),
   "r.......r..r....", "X___..x_X___....", P_VIIV, swing=0.1, baixo_dur=1.0, cor="9", energia=0.85)
_r("New Jack Swing", GS, "Anos 80/90 — swing duro, palmas e bateria eletrônica em semicolcheias.",
   "new jack swing, hard swung sixteenths, programmed drums with claps, punchy bass, R&B meets hip hop",
   dict(kick="X.....x...x.....", snare="....X.......X...", clap="....x.......x...", hat=H16),
   "r..r.r..r..r.r..", "X..x..x...x.x...", P_JAZZ, swing=0.2, cor="7", energia=0.95)
_r("P-Funk", GS, "Funk espacial de Parliament — baixo gordo de sintetizador e acordes picotados.",
   "P-Funk, fat synth bass, spacey chops, deep pocket groove",
   dict(kick="X..x..x...x.x...", snare="....X.......X...", hat=H8),
   "r..r.r.r..r.r.8.", "X..x.x..X..x.x..", [(0, "7"), (0, "7"), (5, "7"), (0, "7")], swing=0.05, baixo_dur=0.6, cor="9d")
_r("Jazz Funk", GS, "Funk com harmonia de jazz — semicolcheias, nonas e solos dóricos.",
   "jazz funk, sixteenth-note funk groove, rich ninth chords, dorian solos",
   dict(kick="X..x..x...x.x...", snare="o...X..o.o..X..o", hat=H16),
   "r..r.r.5..r.5...", "X..x..x...x.x...", P_JAZZ, swing=0.08, solo=("dorico", 8), baixo_dur=0.6, cor="9")
_r("Boogie (Funk dos anos 80)", GS, "Pista de 80 — bumbo reto, palmas e baixo estalado em oitavas.",
   "boogie funk, 1980s post-disco, four-on-the-floor, handclaps, slap bass octaves, synth keys",
   dict(kick="X...X...X...X...", clap="....X.......X...", hat=H16),
   "r..r.r.8..r.5...", "X.x.X.x.X.x.X.x.", P_VIIV, baixo_dur=0.6, cor="9d", energia=0.95)
_r("Go-Go", GS, "Washington D.C. — congas, cowbell e caixa em polirritmia contínua.",
   "go-go, Washington D.C. percussion-heavy groove, congas, cowbell, relentless pocket, call and response",
   dict(kick="X.....x.X.....x.", snare="....X.......X...", conga="x..x..x.x..x..x.", cowbell="x...x...x.x.x...", hat=H8),
   "r..r..r...r.r...", "X..x..x.x..x..x.", P_7, cor="9d", energia=1.0)
_r("Acid Jazz", GS, "Groove de pista com jazz — conga, acordes de nona e baixo melódico.",
   "acid jazz, danceable jazz-funk groove, congas, ninth chords, melodic bass",
   dict(kick="X.....x...x.....", snare="....X.......X...", hat=H8, conga="..x...x...x...x."),
   "r..r.r.8..r.5.r.", "X..x..x...x..x..", P_JAZZ, swing=0.1, solo=("dorico", 8), cor="9", energia=0.85)

# ───────────────────────── Jazz e Swing — Vertentes ─────────────────────────
_r("Bebop", GJ, "Anos 40 — swing veloz, caminhada de baixo, acordes picados e muita nota no solo.",
   "bebop, fast swinging ride cymbal, walking bass, comping on the off-beats, virtuosic improvisation",
   dict(ride="X..x.xX..x.x", hat="...x.....x..", kick="o..o..o..o..", snare="..o.......o."),
   "r..5..3..a..", "X.....X..x..", P_JAZZ, passos=12, solo=("maior", 8), baixo_dur=0.95, cor="7", energia=0.85)
_r("Cool Jazz", GJ, "Anos 50 — vassourinha suave, acordes longos e frases relaxadas.",
   "cool jazz, soft brushed drums, relaxed walking bass, sustained airy chords, understated and smooth",
   dict(shaker="x.xx.xx.xx.x", kick="o.....o.....", snare="...o.....o.."),
   "r..3..5..3..", "X_____X_____", P_JAZZ, passos=12, solo=("pent_maior", 4), baixo_dur=0.95, cor="7", energia=0.65)
_r("Hard Bop", GJ, "Anos 50/60 — swing com acento forte de caixa, gospel e blues na veia.",
   "hard bop, driving swing with strong snare accents, bluesy gospel-tinged phrasing, powerful walking bass",
   dict(ride="X..x.xX..x.x", snare="...x.....x..", kick="X.....X.....", hat="...x.....x.."),
   "r..3..5..a..", "X..x..X..x..", P_JAZZ, passos=12, solo=("blues", 8), baixo_dur=0.95, cor="7", energia=0.85)
_r("Jazz Modal", GJ, "Poucos acordes e muito espaço — baixo pedal, ride aberto e solos dóricos.",
   "modal jazz, sparse harmony over pedal bass, open ride cymbal, dorian improvisation, spacious and hypnotic",
   dict(ride="X..x..X..x..", kick="o.....o....."),
   "r.....5.....", "X_____X_____", [(2, "m7"), (2, "m7"), (2, "m7"), (2, "m7")], passos=12, solo=("dorico", 4), baixo_dur=1.0, cor="7", energia=0.6)
_r("Latin Jazz", GJ, "Jazz com clave — conga, cowbell e baixo em tumbao sobre acordes com sétima.",
   "Latin jazz, son clave, congas, cowbell, tumbao bass, jazz harmony with Afro-Cuban rhythm",
   dict(clave="X..x..x...x.x...", conga="x..x..x.x..x..x.", cowbell="x...x...x...x...", kick="X.......X......."),
   "r.....5...r..5..", "X..x..x...x.x...", P_JAZZ, solo=("maior", 8), baixo_dur=0.9, cor="7", energia=0.9)
_r("Smooth Jazz", GJ, "Polido e leve — groove calmo, acordes de nona, baixo cantante e sax macio.",
   "smooth jazz, polished laid-back groove, lush maj9 chords, singing bass, soft saxophone",
   dict(kick="X.....x...x.....", snare="....X.......X...", hat=H8),
   "r..r..5.r..r.6..", "X___..x_X___....", [(0, "maj7"), (9, "m7"), (5, "maj7"), (7, "7")], swing=0.05, solo=("pent_maior", 8), cor="9", energia=0.7)
_r("Jazz Fusion", GJ, "Anos 70 — rock e jazz juntos: síncope pesada, semicolcheias e escalas dóricas.",
   "jazz fusion, electric jazz-rock, complex syncopated grooves, busy sixteenth-note drums, dorian solos",
   dict(kick="X..x.xx.X..x.x..", snare="....X..x....X..x", hat=H16),
   "r..r.rr.r..r.r.5", "X..x.xx.X..x.x..", [(9, "m7"), (2, "m7"), (7, "7"), (0, "maj7")], solo=("dorico", 8), crash=4, cor="9")
_r("Jazz Waltz", GJ, "Jazz em 3/4 — ride em tercinas, baixo na primeira batida e acordes nas outras.",
   "jazz waltz, 3/4 swing, ride cymbal pattern, bass on one, comping on two and three",
   dict(kick="X...........", hat="....x...x...", ride="X..xX..xX..x"),
   "r...3...5...", "....X...X...", P_JAZZ, passos=12, batidas=3, solo=("maior", 4), baixo_dur=1.0, cor="7", energia=0.7)
_r("Gypsy Jazz", GJ, "Jazz manouche — 'la pompe' do violão em todos os tempos e baixo em dois.",
   "gypsy jazz, manouche, la pompe rhythm guitar on every beat, two-feel upright bass, minor swing",
   dict(shaker=H8, rim="....o.......o..."),
   "r...5...r...5...", "X.x.X.x.X.x.X.x.", [(9, "m"), (2, "m"), (4, "7"), (9, "m")], swing=0.1, solo=("pent_menor", 8), baixo_dur=0.9, cor="6", energia=0.85)
_r("Dixieland", GJ, "New Orleans — banjo martelando, tuba em dois tempos e todo mundo improvisando junto.",
   "Dixieland, New Orleans traditional jazz, banjo chords on every beat, tuba two-beat, collective improvisation",
   dict(kick="X.......X.......", snare="....x.......x...", hat=H8),
   "r.......5.......", "X.x.X.x.X.x.X.x.", P_IVV, swing=0.15, solo=("maior", 8), crash=4, baixo_dur=0.8, cor="tri", energia=0.9)
_r("Ragtime", GJ, "Piano de bar — baixo no 1 e 3, acorde no 2 e 4 (oom-pah) e melodia sincopada.",
   "ragtime, stride piano oom-pah left hand, syncopated melody, bouncy and playful",
   dict(kick="X...X...X...X..."),
   "r.......5.......", "..X...X...X...X.", [(0, "M"), (7, "7"), (0, "M"), (5, "M")], solo=("maior", 8), baixo_dur=0.8, cor="7d", energia=0.8)
_r("Balada de Jazz", GJ, "Balada lenta — vassourinha em círculos, acordes longos e muito espaço.",
   "jazz ballad, slow brushed swirl, sustained lush chords, spacious tender melody",
   dict(shaker="x.xx.xx.xx.x", kick="X.....o....."),
   "r.....5.....", "X_____X_____", P_JAZZ, passos=12, solo=("maior", 4), baixo_dur=1.0, cor="9", energia=0.55)

# ───────────────────────── Eletrônico e Dance ─────────────────────────
_r("Synthwave", GE, "Anos 80 retrô — baixo de sintetizador em oitavas, caixa com palmas e arpejos rápidos de teclado.",
   "synthwave, retro 1980s analog synths, driving octave bass, fast arpeggios, gated snare with claps, neon nostalgic",
   dict(kick="X.......X..x....", snare="....X.......X...", clap="....X.......X...", hat=H8, open="..............o."),
   "r.r.8.r.r.r.8.r.", "X.x.X.x.X.x.X.x.", P_VIIV, teclado="1234321412343214", crash=8, baixo_dur=0.6, cor="tri", energia=0.9)
_r("EDM", GE, "Pista grande — bumbo reto, palmas e chimbal na contratempo; baixo em notas longas.",
   "EDM, big room festival, four-on-the-floor kick, big claps, offbeat hi-hats, supersaw synth chords",
   dict(kick="X...X...X...X...", clap="....X.......X...", hat="..x...x...x...x.", crash="X..............."),
   "r.......r.......", "X.x.X.x.X.x.X.x.", P_VIIV, teclado=ARP, crash=4, baixo_dur=1.0, cor="tri", energia=1.0)
_r("Dubstep", GE, "Meio tempo pesado — caixa só no terceiro tempo e baixo gordo e sincopado.",
   "dubstep, half-time drums, heavy wobble bass, huge sub drops, snare on three",
   dict(kick="X.......X.......", snare="........X.......", hat=H8),
   "r.......r..r....", "X_______X_______", P_MET5, baixo_dur=0.9, cor="5", energia=1.0)
_r("Trance", GE, "Hipnótico — bumbo reto, baixo na contratempo e arpejos que não param.",
   "trance, hypnotic four-on-the-floor, rolling offbeat bass, fast arpeggiated leads, euphoric pads",
   dict(kick="X...X...X...X...", hat="..x...x...x...x.", open="..o...o...o...o."),
   "..r...r...r...r.", "X___X___X___X___", P_VIIV, teclado="1234321412343214", crash=8, baixo_dur=0.6, cor="tri", energia=1.0)
_r("Future Bass", GE, "Moderno e brilhante — meio tempo, stabs de acordes cheios de nona e baixo curto.",
   "future bass, half-time bounce, lush detuned chord stabs, wide supersaw drops, emotional and bright",
   dict(kick="X.......X..x....", snare="........X.......", clap="........x......."),
   "r.......r..r....", "X..x..x...x..x..", [(5, "maj7"), (7, "7"), (4, "m7"), (9, "m7")], teclado=ARP, baixo_dur=0.9, cor="9", energia=0.95)
_r("Deep House", GE, "Profundo e macio — bumbo reto, shaker, acordes de nona e baixo curto.",
   "deep house, warm four-on-the-floor, shaker groove, lush minor ninth chords, rolling bassline",
   dict(kick="X...X...X...X...", clap="....x.......x...", hat="..x...x...x...x.", shaker=H8),
   "r..r..r...r..r..", "X..x..x...x.x...", [(9, "m7"), (5, "maj7"), (0, "maj7"), (7, "7")], swing=0.08, cor="9", energia=0.85)
_r("Tech House", GE, "Enxuto e seco — bumbo reto, aro e chimbal picado, baixo curto e sincopado.",
   "tech house, stripped four-on-the-floor, rimshot groove, tight offbeat hats, short syncopated bass",
   dict(kick="X...X...X...X...", rim="..o..o....o..o..", hat="..x...x...x...x."),
   "r..r.r..r..r.r..", "x..x..x.x..x..x.", P_VIIV, baixo_dur=0.55, cor="tri", energia=0.9)
_r("Progressive House", GE, "Cresce devagar — bumbo reto, baixo contínuo em colcheias e pads longos.",
   "progressive house, slowly evolving four-on-the-floor, rolling eighth-note bass, long atmospheric pads, melodic builds",
   dict(kick="X...X...X...X...", clap="....x.......x...", hat="..x...x...x...x."),
   "r.r.r.r.r.r.r.r.", "X___X___X___X___", P_VIIV, teclado="1...2...3...2...", crash=8, baixo_dur=0.6, cor="add9", energia=0.9)
_r("Tropical House", GE, "Praia e pôr do sol — marimba em arpejo, palmas leves e bumbo suave.",
   "tropical house, sunny marimba plucks, light claps, soft four-on-the-floor, breezy chords",
   dict(kick="X...X...X...X...", clap="....x.......x...", shaker=H8),
   "r..r..r...r..r..", "X..x..x.X..x..x.", P_POP, swing=0.05, cor="add9", energia=0.8)
_r("Chillout", GE, "Calmo — batida miúda, acordes longos de nona, ideal para fundo e para cantar baixinho.",
   "chillout, downtempo lounge, soft minimal beat, sustained ninth chords, relaxed and warm",
   dict(kick="X.......X.......", rim="....o.......o...", shaker="x.x.x.x...x.x.x."),
   "r.......5.......", "X_______X_______", P_JAZZ, swing=0.1, baixo_dur=1.0, cor="9", energia=0.6)
_r("Trip-Hop", GE, "Bristol anos 90 — batida arrastada e grave, acordes sombrios e muito clima.",
   "trip-hop, slow dragging breakbeat, deep bass, moody minor seventh chords, smoky and cinematic",
   dict(kick="X.......X..x....", snare="....X.......X...", hat=H8),
   "r.......r..r....", "X_______X_______", [(9, "m7"), (5, "maj7"), (0, "maj7"), (7, "7")], swing=0.1, baixo_dur=1.0, cor="7", energia=0.7)
_r("Ambient", GE, "Paisagem sonora — quase sem batida, acordes que flutuam e notas soltas.",
   "ambient, atmospheric soundscape, barely-there pulse, floating sustained pads, sparse notes",
   dict(shaker="x..............."),
   "r...............", "X_______________", P_VIIV, teclado="1.......3.......", solo=("pent_maior", 4), baixo_dur=1.0, cor="add9", energia=0.5)
_r("Eurodance", GE, "Anos 90 — bumbo reto, palmas, baixo saltando em oitavas e teclado em arpejo.",
   "Eurodance, 1990s dance pop, four-on-the-floor, claps, bouncing octave bass, bright arpeggio synths, 2 Unlimited",
   dict(kick="X...X...X...X...", clap="....X.......X...", hat=H8, open="..o...o...o...o."),
   "r.r.8.8.r.r.8.8.", "X.x.X.x.X.x.X.x.", P_VIIV, teclado=ARP, cor="tri", energia=1.0)
_r("Nu-Disco", GE, "Disco moderno — bumbo reto, chimbal aberto e baixo estalado com acordes de nona.",
   "nu-disco, modern disco groove, four-on-the-floor, open hi-hats, funky slap bass, lush ninth chords",
   dict(kick="X...X...X...X...", clap="....x.......x...", hat=H16, open="..o...o...o...o."),
   "r.r.8.r.r.r.8.r.", "X..x..x...x.x...", P_JAZZ, baixo_dur=0.6, cor="9", energia=0.95)
_r("UK Garage", GE, "2-step londrino — bumbo quebrado, caixa deslocada, swing forte nos chimbais.",
   "UK garage, 2-step shuffled drums, skippy off-beat kick, swung hi-hats, warm sub bass",
   dict(kick="X.....x...x.....", snare="....x.......X...", hat=H16),
   "r.......r..r....", "X..x..x...x.x...", P_VIIV, swing=0.2, baixo_dur=0.9, cor="tri", energia=0.9)
_r("Breakbeat", GE, "Bateria quebrada — bumbo e caixa sincopados em ciclos tipo 'break' de funk.",
   "breakbeat, chopped funky drum breaks, syncopated kick and snare, sampled groove, big beat",
   dict(kick="X..x..x...x.x...", snare="....X..x.x..X...", hat=H8),
   "r..r..r...r.r...", "X..x..x...x.x...", P_VIIV, crash=8, cor="tri")
_r("Jungle", GE, "Quebrado e veloz — caixa picotada, chimbal rápido e baixo grave e longo.",
   "jungle, fast chopped amen breaks, rapid ghost snares, deep rolling sub bass, ragga influenced",
   dict(kick="X.....x.......x.", snare="....X..x.x..X..x", hat="x.xxx.xxx.xxx.xx"),
   "r.......r.......", "X_______X_______", P_VIIV, baixo_dur=1.0, cor="tri", energia=1.0)
_r("Electro Swing", GE, "Swing de 1930 com batida eletrônica — baixo caminhando e guitarra na contratempo.",
   "electro swing, 1930s swing meets electronic beats, walking bass, offbeat guitar chops, brass samples",
   dict(kick="X...X...X...X...", snare="....X.......X...", hat=H8),
   "r.r.5.r.6.r.5.r.", "X.x.X.x.X.x.X.x.", [(0, "6"), (9, "m"), (2, "m"), (7, "7")], swing=0.25, solo=("maior", 8), cor="6", energia=0.95)
_r("Hardstyle", GE, "Bumbo gigante e distorcido, chimbal na contratempo e baixo sob o bumbo.",
   "hardstyle, distorted pounding kick, offbeat reverse bass, euphoric screeches, 150 BPM festival energy",
   dict(kick="X...X...X...X...", clap="....x.......x...", hat="..x...x...x...x."),
   "..r...r...r...r.", "X.x.X.x.X.x.X.x.", P_VIIV, crash=4, baixo_dur=0.6, cor="tri", energia=1.0)
_r("Chillwave", GE, "Nostalgia embaçada — batida suave, acordes com nona e swing leve.",
   "chillwave, hazy nostalgic synths, soft drum machine, washed-out ninth chords, lo-fi warmth",
   dict(kick="X.......X.......", clap="....o.......o...", hat=H8),
   "r.......5.......", "X___..x_X___....", P_POP, swing=0.1, cor="add9", energia=0.65)

# ───────────────────────── Hip Hop e Urbano — Vertentes ─────────────────────────
_r("Boom Bap", GH, "Anos 90 — bumbo e caixa secos, swing de MPC e baixo de sample.",
   "boom bap, 1990s East Coast hip hop, hard dusty kick and snare, MPC swing, sampled jazzy bass",
   dict(kick="X.......X.x.....", snare="....X.......X..o", hat="x.x.x.x.x.x.xox."),
   "r.......r..r....", "X..x..x...x..x..", [(9, "m7"), (5, "maj7"), (0, "maj7"), (7, "7")], swing=0.18, cor="7", energia=0.9)
_r("Hip Hop Old School", GH, "Anos 80 — bateria eletrônica reta, cowbell e palmas, clima de festa de rua.",
   "old school hip hop, 1980s drum machine breaks, cowbell, handclaps, party block feel",
   dict(kick="X...x...X...x...", clap="....X.......X...", cowbell="x...x.......x...", hat=H8),
   "r.r.r.r.r.r.r.r.", "X..x..x...x.x...", P_7, cor="tri", energia=0.95)
_r("G-Funk", GH, "Costa Oeste — baixo de sintetizador cantante, palmas e groove preguiçoso.",
   "G-funk, West Coast gangsta funk, whining synth lead, melodic synth bass, laid-back groove",
   dict(kick="X.....x...x.....", snare="....X.......X...", clap="....x.......x...", hat=H8),
   "r..r..r..r.r....", "X..x..x...x.x...", [(0, "m7"), (5, "m7"), (0, "m7"), (7, "7")], swing=0.1, baixo_dur=0.9, cor="7", energia=0.9)
_r("Crunk", GH, "Pesado e festeiro — caixa com palmas e 808 longo, para gritar em coro.",
   "crunk, aggressive chant-friendly party beat, booming 808 kick, snare layered with claps",
   dict(kick="X.......X.......", snare="....X.......X...", clap="....X.......X...", hat=H8),
   "r.......r.......", "X.......X.......", P_MET5, baixo_dur=1.0, cor="5", energia=1.0)
_r("Drill", GH, "Sombrio e picado — caixa no terceiro tempo, chimbal em rajadas e baixo deslizando.",
   "drill, dark sliding 808 bass, snare on three, rapid hi-hat bursts, menacing minor melodies",
   dict(kick="X.......X..x....", snare="........X.......", hat="x.x.xxx.x.x.xxx."),
   "r.......r..r....", "X___..x_X___....", P_VIIV, baixo_dur=1.0, cor="tri", energia=0.9)
_r("Phonk", GH, "Cowbell que não para, bumbo sincopado e clima sombrio de Memphis.",
   "phonk, cowbell-driven Memphis rap, distorted 808s, dark eerie samples, drift phonk energy",
   dict(kick="X..x..x...x.x...", snare="....X.......X...", cowbell="x..x..x...x.x...", hat=H8),
   "r.......r..r....", "X..x..x...x.x...", P_VIIV, baixo_dur=1.0, cor="tri", energia=1.0)
_r("Cloud Rap", GH, "Flutuante e nebuloso — bumbo espaçado, chimbal em rajadas miúdas e pads longos.",
   "cloud rap, hazy floating atmosphere, sparse kick, tiny hi-hat flurries, washed pads, dreamy melodic flows",
   dict(kick="X.........x.....", clap="....o.......o...", hat="x.x.xxx.x.x.x.xx"),
   "r.......r..r....", "X_______X_______", P_VIIV, baixo_dur=1.0, cor="add9", energia=0.65)
_r("Grime", GH, "Londres — caixa no terceiro tempo, bumbo seco e baixo de sub grave.",
   "grime, London 140 BPM, snare on three, sparse kick, cold sub bass, icy synth stabs",
   dict(kick="X.......x.x.....", snare="........X.......", hat=H8),
   "r.......r..r....", "X..x..x...x..x..", P_VIIV, baixo_dur=1.0, cor="tri", energia=1.0)
_r("Rap Nacional", GH, "Rap brasileiro — boom bap com swing, baixo de sample e acordes de sétima.",
   "Brazilian rap, boom bap with swing, sampled bass, seventh chords, MPB and samba samples",
   dict(kick="X.....x...x.....", snare="....X.......X...", hat=H8, shaker="..x...x...x...x."),
   "r.......r..r....", "X..x..x...x..x..", [(9, "m7"), (5, "maj7"), (0, "maj7"), (7, "7")], swing=0.12, cor="7", energia=0.9)

# ───────────────────────── Brasil — Regional e Raiz ─────────────────────────
_r("Sertanejo Raiz", GB, "Caipira de raiz — viola e violão em arpejo e batida, percussão miúda e baixo em dois.",
   "sertanejo raiz, caipira, viola caipira and acoustic guitar, arpeggio then strum, light percussion, two-feel bass",
   dict(kick="X.......X.......", caixa="x.x.x.x.x.x.x.x."),
   "r.......5.......", "1.2.3.2.X.x.X.x.", P_IVV, solo=("pent_maior", 4), baixo_dur=1.0, cor="tri", energia=0.7)
_r("Sofrência", GB, "Sertanejo de dor de cotovelo — meio tempo lento, acordes longos e muita emoção.",
   "sofrência, slow heartbreak sertanejo, sustained chords, soft rimshot, accordion and acoustic guitar, emotional vocals",
   dict(kick="X.......X.......", rim="....o.......o...", shaker="x...x...x...x..."),
   "r.......r.......", "X_______X_______", P_VIIV, baixo_dur=1.0, cor="tri", energia=0.7)
_r("Vanerão", GB, "Gaúcho — dois por quatro animado, bumbo reto, pandeiro e acordeon em fole.",
   "vanerão, gaúcho dance, lively two-step, straight kick, pandeiro, accordion bellows chords",
   dict(kick="X...X...X...X...", caixa="x.x.x.x.x.x.x.x.", pandeiro="X.xoX.xoX.xoX.xo"),
   "r...5...r...5...", "X.xxX.xxX.xxX.xx", P_IVV, solo=("maior", 8), cor="tri", energia=1.0)
_r("Chamamé", GB, "Gaúcho e fronteira — balanço em 6/8, caixa em tercinas e acordeon.",
   "chamamé, rolling 6/8 compound feel, snare triplets, accordion and guitar, border folk, Argentine and Brazilian south",
   dict(kick="X.....X.....", caixa="x.xx.xx.xx.x"),
   "r..5..r..5..", "X.xX.xX.xX.x", P_IVV, passos=12, solo=("maior", 4), cor="tri", energia=0.85)
_r("Milonga", GB, "Pampa — habanera no bumbo, violão marcando e clima de saudade.",
   "milonga, pampa habanera rhythm on the bass drum, strummed guitar, nostalgic and earthy, Rio Grande do Sul",
   dict(surdo="X..x..X.X..x..X.", caixa="x.x.x.x.x.x.x.x."),
   "r..r..5.r..r..5.", "X..x..x.x..x..x.", P_VIIV, solo=("pent_menor", 4), cor="tri", energia=0.8)
_r("Rancheira", GB, "Gaúcho lento — passo largo, bumbo em dois e acordeon cantando.",
   "rancheira, slow gaúcho dance, wide step, two-feel bass drum, singing accordion, traditional bailão",
   dict(kick="X.......X.......", caixa="x.x.x.x.x.x.x.x."),
   "r.......5.......", "X..xX..xX..xX..x", P_IVV, cor="tri", energia=0.85)
_r("Forró Pé-de-Serra", GB, "Forró de raiz — zabumba, triângulo e sanfona; baixo marcando o compasso.",
   "forró pé-de-serra, traditional northeastern trio, zabumba, triangle, accordion, down-to-earth pulse",
   dict(zabumba="X..xX...X..xX...", triangulo="x.xxx.xxx.xxx.xx"),
   "r..5....r..5....", "X.xxX.xxX.xxX.xx", P_IVV, solo=("pent_maior", 4), cor="tri", energia=0.9)
_r("Forró Eletrônico", GB, "Forró de banda — bateria, zabumba e teclado juntos; refrão para cantar junto.",
   "forró eletrônico, big band forró, drum kit with zabumba, keyboards, brass, catchy choruses",
   dict(kick="X...X...X...X...", snare="....x.......x...", zabumba="X..xX..xX..xX..x", triangulo=H8),
   "r.r.5.r.r.r.5.r.", "X.x.X.x.X.x.X.x.", P_POP, teclado=ARP, cor="tri", energia=1.0)
_r("Tecnobrega", GB, "Pará — bumbo reto, congas e teclado em arpejo; festa de aparelhagem.",
   "tecnobrega, Pará electronic brega, straight kick, congas, keyboard arpeggios, aparelhagem party",
   dict(kick="X...X...X...X...", snare="....x.......x...", conga="x..x..x.x..x..x.", hat=H8),
   "r.r.r.r.r.r.r.r.", "X.x.X.x.X.x.X.x.", P_VIIV, teclado=ARP, cor="tri", energia=1.0)
_r("Guitarrada", GB, "Pará — guitarra solando sobre carimbó e merengue: congas, maracas e muito arpejo.",
   "guitarrada, Pará guitar music, fast lead guitar lines over carimbó and merengue, congas, maracas",
   dict(kick="X...X...X...X...", conga="x..x..x.x..x..x.", shaker=H16),
   "r..r..r.r..r..r.", ARP, P_IVV, solo=("pent_maior", 8), cor="tri", energia=0.95)
_r("Coco", GB, "Nordeste — zabumba, pandeiro e ganzá em roda; resposta e canto coletivo.",
   "coco de roda, northeastern circle dance, zabumba, pandeiro and ganzá, call and response chant",
   dict(zabumba="X..x....X..x....", pandeiro="x.xoX.xox.xoX.xo", shaker=H8, agogo="x...x...x.x.x..."),
   "r..r....r..r....", "X..xX.x.X..xX.x.", P_IVV, cor="tri", energia=1.0)
_r("Ciranda", GB, "Pernambuco — ritmo de roda, balanço suave, triângulo e zabumba.",
   "ciranda, Pernambuco ring dance, gentle swaying pulse, triangle and zabumba, sung in a circle",
   dict(zabumba="X.......X.x.....", triangulo="x...x...x...x...", pandeiro="x.xo..xo..xo..xo"),
   "r.......5.......", "X..x..x...x..x..", P_IVV, cor="tri", energia=0.8)
_r("Boi-Bumbá", GB, "Parintins — tambores e pandeirões fortes, canto de toada e energia de festival.",
   "boi-bumbá, Parintins folk festival, thunderous drums and pandeirões, toada chants, tribal energy",
   dict(zabumba="X.xxX.xxX.xxX.xx", pandeiro="x.x.x.x.x.x.x.x.", caixa=H16),
   "r.r.r.r.r.r.r.r.", "X.xxX.xxX.xxX.xx", P_VIIV, cor="tri", energia=1.0)
_r("Seresta", GB, "Serenata — violão em arpejo, pandeiro leve e voz cheia de saudade.",
   "seresta, romantic serenade, arpeggiated nylon guitar, light pandeiro, cavaquinho, nostalgic and tender",
   dict(kick="X.......X.......", pandeiro="o...x...o...x..."),
   "r.......5.......", "1.2.3.2.1.2.3.2.", P_DOOWOP, solo=("maior", 4), baixo_dur=1.0, cor="tri", energia=0.55)
_r("Samba de Gafieira", GB, "Salão — samba de gafieira com sopros, baixo caminhando e acordes de jazz.",
   "samba de gafieira, ballroom samba, brass section, walking bass, jazzy chords, surdo and pandeiro",
   dict(surdo="....X.......X...", pandeiro="X.xoX.xoX.xoX.xo", tamborim="x.x.xx.x.x.xx.x."),
   "r.r.5.r.6.r.5.a.", "X..xX..xX..xX..x", [(0, "6"), (9, "m7"), (2, "m7"), (7, "7")], swing=0.05, solo=("maior", 8), cor="7", energia=0.9)
_r("Samba-jazz", GB, "Anos 60 — trio de samba com ride e jazz: acordes de nona e baixo cantando.",
   "samba-jazz, 1960s Brazilian jazz trio, ride cymbal and rimshot clave feel, ninth chords, singing bass",
   dict(kick="X..x..x.X..x..x.", ride="x.x.xx.xx.x.xx.x", rim="x..x..x...x.x..."),
   "r..r..5.r..r..5.", "X..x..x...x.x...", P_JAZZ, swing=0.05, solo=("maior", 8), cor="9", energia=0.8)
_r("Partido-alto", GB, "Roda de samba — pandeiro e tamborim sincopados, agogô e surdo marcando.",
   "partido-alto, samba de roda improvisation, syncopated pandeiro and tamborim, agogô, surdo",
   dict(surdo="....X.......X...", pandeiro="x.xoX.xox.xoX.xo", tamborim="x..x..x.x..x.x..", agogo="x.x...x.x...x..."),
   "r..r..5.r..r..5.", "X..x..x.x..x..x.", [(0, "M"), (9, "m"), (2, "m"), (7, "M")], swing=0.08, cor="7", energia=1.0)
_r("Pagode Baiano", GB, "Bahia — bumbo reto, caixa, congas e cowbell; dança de roda e muito suingue.",
   "pagode baiano, Bahian party pagode, straight kick, snare, congas and cowbell, dance moves",
   dict(kick="X...X...X...X...", snare="....X.......X...", conga="x..x..x.x..x..x.", cowbell="x...x...x.x.x..."),
   "r..r..r.r..r..r.", "X..xX..xX..xX..x", P_VIIV, cor="tri", energia=1.0)
_r("Jovem Guarda", GB, "Anos 60 — iê-iê-iê brasileiro, pandeiro e guitarra limpa em refrão para dançar.",
   "jovem guarda, 1960s Brazilian beat, tambourine, clean twangy guitar, catchy dance choruses",
   dict(kick="X.......X.......", snare="....X.......X...", shaker=H8),
   "r.r.r.r.r.r.r.r.", "X.x.X.xxX.x.X.xx", P_DOOWOP, cor="tri", energia=0.9)
_r("Tropicália", GB, "Final dos anos 60 — baião, rock e psicodelia misturados; pandeiro e guitarra suja.",
   "tropicália, late 1960s Brazilian psychedelic rock, baião rhythm mixed with fuzz guitar, pandeiro, avant-garde pop",
   dict(kick="X.....x.X.......", snare="....x.......x...", pandeiro="x.xoX.xo...x.xo."),
   "r..r..5.r..r..5.", "X..x..x.x..x..x.", P_IVV, solo=("pent_maior", 8), cor="tri", energia=0.85)
_r("Rock Brasileiro 80", GB, "Anos 80 — o rock nacional: bateria seca, chimbal acentuado e guitarras abertas.",
   "Brazilian 1980s rock, dry punchy drums, accented hi-hat, open chiming guitars",
   dict(kick="X.....x.X.....x.", snare="....X.......X...", hat="X.x.X.x.X.x.X.x.", tom="..............o."),
   "r.r.8.r.r.r.8.r.", "X.xxX.x.X.xxX.x.", P_VIIV, crash=4, cor="tri")
_r("Soul Brasileiro", GB, "Anos 70 — soul e funk à brasileira: groove quente, congas e baixo cheio de notas.",
   "Brazilian soul, 1970s soul and funk with Brazilian percussion, warm groove, congas, busy melodic bass",
   dict(kick="X.....x.X.......", snare="....X.......X...", shaker=H16, conga="..x...x...x...x."),
   "r..r..r.r..r.5..", "X..x..x.X..x..x.", P_JAZZ, swing=0.08, cor="9d", energia=0.9)
_r("Funk Mandelão", GB, "Funk paulista — bumbo quebrado, cowbell e 808 longo; pouco enfeite, muito grave.",
   "funk mandelão, São Paulo funk, syncopated tamborzão kick, cowbell, booming long 808, minimal and heavy",
   dict(kick="X..x..x.X..x..x.", clap="....x.......x...", cowbell="x..x..x.x..x..x."),
   "r.......r..r....", "X_______X_______", P_VIIV, baixo_dur=1.0, cor="tri", energia=1.0)

# ───────────────────────── Country, Folk e Americana ─────────────────────────
_r("Bluegrass", GC, "Rápido e acústico — baixo em dois, violão 'boom-chuck' e banjo e bandolim picando.",
   "bluegrass, fast acoustic boom-chuck guitar, two-feel upright bass, banjo rolls and mandolin chop",
   dict(rim="....o.......o...", shaker="x...x...x...x..."),
   "r...5...r...5...", "x...X...x...X...", P_IVV, solo=("pent_maior", 8), baixo_dur=0.6, cor="tri", energia=0.95)
_r("Americana", GC, "Raízes americanas — meio tempo caloroso, violões e baixo simples.",
   "Americana, roots music, warm mid-tempo groove, acoustic and electric guitars, simple bass, honest storytelling",
   dict(kick="X.......X.......", snare="....x.......x...", shaker=H8),
   "r.......5.......", "X.xxX..xX.xxX..x", P_IVV, solo=("pent_maior", 8), cor="tri", energia=0.8)
_r("Alt-Country", GC, "Country de garagem — pegada de rock, violões abertos e solos tortos.",
   "alt-country, country with rock edge, strummed open guitars, loose drums, twang with distortion",
   dict(kick="X.....x.X.......", snare="....X.......X...", hat=H8),
   "r.r.5.r.r.r.5.r.", "X.x.X..xX.x.X..x", P_VIIV, solo=("pent_maior", 8), cor="tri", energia=0.85)
_r("Honky-Tonk", GC, "Bar do Texas — baixo em dois, caixa leve e guitarra nos contratempos.",
   "honky-tonk, Texas dance hall, two-step bass, light snare, offbeat guitar strums, steel guitar",
   dict(kick="X.......X.......", snare="....x.......x...", hat="x...x...x...x..."),
   "r.......5.......", "..X...X...X...X.", P_IVV, swing=0.05, solo=("pent_maior", 8), cor="tri", energia=0.9)
_r("Outlaw Country", GC, "Country fora da lei — pegada firme, baixo andando e voz rouca.",
   "outlaw country, gritty hard-driving groove, walking bass, raw twangy guitars, rebellious",
   dict(kick="X.....x.X.......", snare="....X.......X...", hat="x...x...x...x..."),
   "r..r..5.r..r..5.", "X.xxX.x.X.xxX.x.", P_IVV, solo=("pent_maior", 8), cor="tri", energia=0.9)
_r("Western Swing", GC, "Dança de salão do Texas — swing, baixo caminhando e violão em sextas.",
   "western swing, Texas dance hall swing, walking bass, sixth chords, fiddle and steel guitar",
   dict(kick="X.......X.......", snare="....x.......x...", hat=H8),
   "r.r.5.r.6.r.5.r.", "X.x.X.x.X.x.X.x.", [(0, "6"), (5, "6"), (0, "6"), (7, "7")], swing=0.15, solo=("maior", 8), cor="6", energia=0.9)
_r("Balada Country", GC, "Nashville lento — acordes longos, aro suave e coro no refrão.",
   "country ballad, slow Nashville waltz of the heart, sustained chords, soft rimshot, steel guitar, harmony choruses",
   dict(kick="X.......X.......", rim="....o.......o..."),
   "r.......r.......", "X_______X_______", P_POP, solo=("pent_maior", 4), baixo_dur=1.0, cor="tri", energia=0.65)
_r("Folk Celta (Jig)", GC, "Irlanda e Escócia — jig em 6/8, bodhrán marcando e acordes alegres.",
   "Celtic folk jig, 6/8 compound lilt, bodhrán, bouncing acoustic guitar, fiddle and whistle, Irish pub dance",
   dict(tom="X..x..X..x..", kick="X.....X....."),
   "r..5..r..5..", "X..x..X..x..", P_MIXO, passos=12, solo=("mixolidio", 8), cor="tri", energia=0.9)
_r("Folk Celta (Reel)", GC, "Irlanda e Escócia — reel rápido em colcheias, bodhrán e violão.",
   "Celtic folk reel, fast driving eighth-note pulse, bodhrán, strummed guitar, fiddle runs, Irish session",
   dict(tom="x.x.x.x.x.x.x.x.", kick="X.......X......."),
   "r...5...r...5...", "X.x.X.x.X.x.X.x.", P_MIXO, solo=("mixolidio", 8), cor="tri", energia=0.9)
_r("Cantor-Compositor", GC, "Voz e violão — dedilhado simples, sem bateria de verdade, para ouvir a letra.",
   "singer-songwriter, solo fingerpicked acoustic guitar, intimate voice-and-guitar, simple gentle bass, confessional lyrics",
   dict(kick="X.......X......."),
   "r.......5.......", "1.2.3.2.1.2.3.2.", P_POP, solo=("pent_maior", 4), baixo_dur=1.0, cor="add9", energia=0.6)

# ───────────────────────── Gospel e Espiritual ─────────────────────────
_r("Black Gospel", GG, "Gospel americano — palmas, órgão sustentado, caixa forte em 12/8 e coro respondendo.",
   "black gospel, church choir, handclaps, Hammond organ, powerful backbeat in 12/8, call and response",
   dict(kick="X..X..X..X..", snare="...X.....X..", clap="...x.....x..", tom="..........o."),
   "r..5..r..5..", "X_____X.xX.x", P_JAZZ, passos=12, solo=("pent_maior", 4), cor="7", energia=0.95)
_r("Gospel Shout", GG, "Gospel acelerado — palmas fortes, pandeiro sem parar e coro em festa.",
   "gospel shout, uptempo church celebration, loud handclaps, constant tambourine, driving drums, praise break",
   dict(kick="X...X...X...X...", snare="....X.......X...", clap="....X.......X...", shaker=H16),
   "r.r.5.r.r.r.5.r.", "X.x.X.x.X.x.X.x.", P_DOOWOP, cor="tri", energia=1.0)
_r("Spiritual", GG, "Espiritual negro — pisada e palmas, acordes longos e vozes em coro.",
   "negro spiritual, foot stomps and handclaps, sustained chords, rich choir harmonies, solemn and hopeful",
   dict(kick="X.......X.......", clap="....x.......x..."),
   "r.......5.......", "X_______X_______", P_IVV, baixo_dur=1.0, cor="tri", energia=0.6)
_r("Worship Contemporâneo", GG, "Louvor de igreja moderna — teclado em pad, bateria que cresce e refrão de entrega.",
   "contemporary worship, atmospheric pad keys, building drums, sustained chords, big congregational chorus",
   dict(kick="X.......X.......", snare="....X.......X...", hat=H8, shaker="..x...x...x...x."),
   "r.......r.......", "X_______X_______", P_POP, teclado="1.......3.......", solo=("pent_maior", 4), crash=4, baixo_dur=1.0, cor="add9", energia=0.85)
_r("Hino", GG, "Hino tradicional — marcha calma, acordes em bloco e baixo no primeiro e terceiro tempo.",
   "traditional hymn, calm stately march, block chords, bass on one and three, congregational singing, organ and piano",
   dict(kick="X.......X......."),
   "r.......5.......", "X.......X.......", P_IVV, baixo_dur=1.0, cor="tri", energia=0.5)

# ───────────────────────── Mundo — Caribe, África e Américas ─────────────────────────
_r("Son Cubano", GM1, "Cuba — clave 3-2, conga e cowbell com baixo em tumbao e violão tres em arpejo.",
   "son cubano, Cuban son, 3-2 clave, congas, cowbell, tumbao bass, tres guitar montuno",
   dict(clave="X..x..x...x.x...", conga="..x...x...x...x.", cowbell="x...x...x...x..."),
   "r.....5...r..5..", "x..x..x...x.x...", P_IVV, cor="tri", energia=0.9)
_r("Mambo", GM1, "Orquestra cubana — clave em 3-2, congas sem parar, metais e baixo em tumbao.",
   "mambo, big band Afro-Cuban, 3-2 clave, relentless congas, cowbell, brass stabs, tumbao bass",
   dict(clave="X..x..x...x.x...", conga="x.x.x.x.x.x.x.x.", cowbell="x...x...x...x..."),
   "r..r..5...r..5..", "X..x..x...x.x...", P_IVV, cor="tri", energia=1.0)
_r("Rumba Cubana", GM1, "Rumba de rua — clave de rumba, tambores em conversa e muito espaço.",
   "Cuban rumba, guaguancó, rumba clave, conversational congas, call and response, street percussion",
   dict(clave="X..x...x..x.x...", conga="x..x..x.x..x..x."),
   "r.......5.......", "x..x...x..x.x...", P_IVV, cor="tri", energia=0.95)
_r("Vallenato", GM1, "Colômbia — acordeon, caja e guacharaca em ritmo saltitante e baixo marcado.",
   "vallenato, Colombian accordion music, caja drum, guacharaca scraper, bouncy rhythm, storytelling songs",
   dict(kick="X.......X.......", tom="x.x...x.x.x...x.", shaker="x.xxx.xxx.xxx.xx"),
   "r.r.5.r.r.r.5.r.", "X.x.X.x.X.x.X.x.", P_IVV, cor="tri", energia=0.95)
_r("Soca", GM1, "Trinidad — carnaval acelerado: bumbo reto, ferro e chocalho sem parar.",
   "soca, Trinidad carnival, accelerated four-on-the-floor, iron bell, shakers, bright brass, power soca",
   dict(kick="X...X...X...X...", snare="....x.......x...", shaker=H16, cowbell=H8),
   "r.r.r.r.r.r.r.r.", "X.x.X.x.X.x.X.x.", P_IVV, cor="tri", energia=1.0)
_r("Calypso", GM1, "Caribe clássico — swing leve, caixa na contratempo e baixo caminhando.",
   "calypso, classic Caribbean, light swing, offbeat snare, walking bass, steelpan feel, witty storytelling",
   dict(kick="X.......X.......", snare="..x...x...x...x.", shaker=H8),
   "r..r..5.r..r..5.", "X.x.X..xX.x.X..x", P_IVV, swing=0.05, solo=("maior", 8), cor="tri", energia=0.9)
_r("Zouk", GM1, "Antilhas — balanço sensual e lento, conga e acordes com sétima.",
   "zouk, French Antilles sensual groove, slow swaying rhythm, congas, seventh chords, smooth guitar",
   dict(kick="X.......X..x....", rim="..x.....x.......", conga="x..x..x.x..x..x.", hat=H8),
   "r..r..r..r..r...", "X__x..x_X__x..x_", P_VIIV, baixo_dur=0.9, cor="7", energia=0.8)
_r("Rocksteady", GM1, "Jamaica anos 60 — mais lento que o ska e mais suave que o reggae, baixo cantando.",
   "rocksteady, 1960s Jamaican, slower than ska, melodic walking bass, offbeat guitar, sweet vocal harmonies",
   dict(kick="X.......X.......", snare="........x.......", hat=H8),
   "r..r.r..5.r.r...", "..X...X...X...X.", P_DOOWOP, cor="tri", energia=0.8)
_r("Dub", GM1, "Reggae esculpido — frases de dois compassos, o acorde some e volta e o baixo domina.",
   "dub reggae, two-bar phrases with chord drop-outs, heavy dominant bass, spacey echo, sparse one-drop",
   dict(kick="........X.......|........X.......", rim="........x.......|........x.......", hat="x.x.x.x.x.x.x.x.|..x...x...x...x."),
   "r..r.....r..5...|r.......r.......", "..X...X...X...X.|................", P_IVV, solo=("pent_maior", 4), baixo_dur=1.0, cor="tri", energia=0.85)
_r("Afrobeats", GM1, "Nigéria e Gana de hoje — bumbo quebrado, caixa deslocada e groove que balança.",
   "Afrobeats, modern West African pop, syncopated kick, shifting snare, shakers and congas, bouncy groove",
   dict(kick="X..x..x...x.x...", snare="....x..x....x..x", shaker=H16, conga="..x...x.x...x..."),
   "r..r..r..r.r....", "X..x..x...x.x...", P_VIIV, cor="9", energia=0.95)
_r("Amapiano", GM1, "África do Sul — baixo de 'log drum', shakers contínuos e pads de nona.",
   "amapiano, South African house, log drum bass, constant shakers, jazzy piano and pads, slow groove",
   dict(kick="X.......X.......", tom="..x...x...x..x..", shaker="x.xxx.xxx.xxx.xx", clap="....x.......x..."),
   "r..r..8..r..r.8.", "X_______X_______", [(9, "m7"), (5, "maj7"), (0, "maj7"), (7, "7")], cor="9", energia=0.85)
_r("Highlife", GM1, "Gana e Nigéria — guitarras brilhantes, cowbell e congas, swing leve e dançante.",
   "highlife, West African dance music, interlocking bright guitars, bell patterns, congas, light swing, brass",
   dict(kick="X.......X.......", cowbell="x.x..x.x..x.x...", conga="..x...x...x...x.", hat=H8),
   "r.r.5.r.r.r.5.r.", "X.x.X.x.X.x.X.x.", P_IVV, cor="tri", energia=0.9)
_r("Kuduro", GM1, "Angola — acelerado e eletrônico, bumbo reto, congas e chimbal em semicolcheias.",
   "kuduro, Angolan electronic dance, fast four-on-the-floor, congas, sixteenth-note hi-hats, aggressive energy",
   dict(kick="X...X...X...X...", clap="....x.......x...", conga="x..x..x.x..x..x.", hat=H16),
   "r..r..r.r..r..r.", "X..x..x.X..x..x.", P_VIIV, cor="tri", energia=1.0)
_r("Ranchera", GM1, "México — valsa de mariachi: baixo no um, violão nas outras batidas e canto aberto.",
   "ranchera, Mexican mariachi waltz, guitarrón bass on one, vihuela strums on two and three, trumpets, passionate singing",
   dict(kick="X...........", rim="....x...x..."),
   "r...5...5...", "....X.x.X.x.", P_IVV, passos=12, batidas=3, solo=("maior", 4), cor="tri", energia=0.85)
_r("Norteño", GM1, "México do norte — polca com acordeon e baixo sexteto: bumbo reto e acorde na contratempo.",
   "norteño, northern Mexican polka rhythm, accordion and bajo sexto, oom-pah bass, straight kick, offbeat chords",
   dict(kick="X...X...X...X...", snare="....x.......x..."),
   "r.......5.......", "..X...X...X...X.", P_IVV, baixo_dur=0.8, cor="tri", energia=1.0)

# ───────────────────────── Mundo — Europa e Ásia ─────────────────────────
_r("Fado", GM2, "Portugal — guitarra portuguesa em arpejo, baixo em dois e muita saudade.",
   "fado, Portuguese melancholic song, guitarra portuguesa arpeggios, two-feel bass, saudade",
   dict(shaker="o...o...o...o...", kick="X.......X......."),
   "r.......5.......", "1.2.3.4.3.2.1.2.", P_VIIV, solo=("pent_menor", 4), baixo_dur=1.0, cor="tri", energia=0.5)
_r("Polka", GM2, "Europa central — dois por quatro, bumbo no tempo e acorde na contratempo.",
   "polka, Central European dance, oom-pah two-beat, bass on the beat, offbeat chords, accordion and brass, lively",
   dict(kick="X...X...X...X...", snare="..x...x...x...x."),
   "r.......5.......", "..X...X...X...X.", P_IVV, baixo_dur=0.8, cor="tri", energia=1.0)
_r("Musette", GM2, "Paris — valsa francesa de acordeon, baixo suave e acordes com sexta.",
   "musette, French accordion waltz, light bass, sixth chords, café Paris atmosphere",
   dict(kick="X...........", hat="....x...x..."),
   "r...5.......", "....X.x.X..x", [(0, "6"), (9, "m"), (2, "m"), (7, "7")], passos=12, batidas=3, solo=("maior", 4), cor="6", energia=0.75)

# ───────────────────────── Apelidos (a busca ignora acento, espaço e hífen) ─────────────────────────
def _alias(nome, *apelidos):
    assert nome in R.RITMOS, f"apelido para estilo que não existe: {nome}"
    for a in apelidos:
        k = R._chave(a)
        dono = next((n for n in R.RITMOS if R._chave(n) == k), None)
        if dono is not None:
            assert dono == nome, f"apelido '{a}' é o NOME de outro estilo ('{dono}')"
            continue                                      # redundante: o nome já é reconhecido sozinho
        assert R.ALIASES.get(k, nome) == nome, f"apelido '{a}' já aponta para '{R.ALIASES[k]}'"
        R.ALIASES[k] = nome


_alias("Indie Rock", "indie", "rock indie", "indie alternativo")
_alias("Indie Pop", "pop indie")
_alias("Indie Folk", "folk indie")
_alias("Rock and Roll", "rock n roll", "rock e roll", "rock 50", "rock anos 50", "rock'n'roll")
_alias("Rock Progressivo", "prog", "prog rock", "progressive rock", "rock prog", "progressivo")
_alias("Rock Acústico", "acoustic rock", "unplugged")
_alias("Classic Rock", "rock classico")
_alias("Psychedelic Rock", "psicodelico", "rock psicodelico", "psychedelic")
_alias("Garage Rock", "garage")
_alias("Surf Rock", "surf")
_alias("Heavy Metal", "heavy", "metal tradicional", "metal classico")
_alias("Death Metal", "death")
_alias("Black Metal", "black")
_alias("Doom Metal", "doom")
_alias("Power Metal", "power")
_alias("Speed Metal", "speed")
_alias("Stoner Rock", "stoner")
_alias("Nu Metal", "numetal")
_alias("Metalcore", "metal core")
_alias("Hardcore Punk", "hardcore", "hc punk")
_alias("Thrash Metal", "thrash")
_alias("Pop Punk", "punk pop")
_alias("Post-Rock", "pos rock")
_alias("Post-Punk", "pos punk")
_alias("Dream Pop", "dreampop")
_alias("Britpop", "brit pop")
_alias("Math Rock", "math")
_alias("Rock Alternativo", "alternative rock", "rock alt", "alt rock", "alternativo")
_alias("Punk Rock", "punk")
_alias("Balada Rock", "rock ballad")
_alias("Synth-pop", "synthpop", "synth pop")
_alias("Dance-pop", "dance pop", "dance")
_alias("K-pop", "kpop")
_alias("J-pop", "jpop")
_alias("Pop Acústico", "acoustic pop")
_alias("Pop Suave", "adult contemporary", "soft pop")
_alias("Pop Latino", "latin pop")
_alias("Pop Anos 80", "pop 80", "pop 80s", "80s pop")
_alias("Pop Anos 60", "pop 60", "60s pop")
_alias("Delta Blues", "delta")
_alias("Chicago Blues", "chicago")
_alias("Texas Blues", "texas")
_alias("Slow Blues", "blues lento")
_alias("Jump Blues", "jump")
_alias("Boogie-Woogie", "boogie", "boogie woogie")
_alias("Electric Blues", "blues eletrico")
_alias("Country Blues", "piedmont blues", "piedmont")
_alias("Swamp Blues", "swamp")
_alias("British Blues", "blues britanico")
_alias("Balada de Blues", "blues ballad")
_alias("Blues Menor", "minor blues")
_alias("Blues Rápido (12 compassos)", "quick change", "blues quick change", "12 bar blues", "blues 12 compassos")
_alias("Blues", "blues classico")
_alias("Southern Soul", "stax", "memphis soul")
_alias("Philly Soul", "philadelphia soul")
_alias("Neo-Soul", "neosoul")
_alias("Slow Jam", "slowjam")
_alias("R&B Contemporâneo", "rnb contemporaneo", "r&b moderno", "r&b atual", "contemporary r&b", "rnb moderno")
_alias("R&B", "rnb", "r and b", "rhythm and blues")
_alias("New Jack Swing", "njs")
_alias("P-Funk", "pfunk", "parliament")
_alias("Go-Go", "gogo")
_alias("Hip Hop", "hiphop", "rap")
_alias("Hip Hop Old School", "old school", "rap old school")
_alias("G-Funk", "gfunk")
_alias("Rap Nacional", "rap brasileiro", "rap br")
_alias("Lo-fi", "lofi")
_alias("Drum and Bass", "dnb", "drum n bass", "drumnbass")
_alias("Synthwave", "retrowave", "outrun")
_alias("Trip-Hop", "triphop")
_alias("Chillout", "chill", "downtempo", "lounge")
_alias("UK Garage", "2 step", "garage uk")
_alias("Electro Swing", "electroswing")
_alias("Eletrônica", "electronic", "electro", "eletronico")
_alias("Cool Jazz", "cool")
_alias("Jazz Modal", "modal jazz", "modal")
_alias("Latin Jazz", "jazz latino")
_alias("Smooth Jazz", "smooth")
_alias("Jazz Fusion", "fusion")
_alias("Gypsy Jazz", "manouche", "jazz manouche", "jazz cigano")
_alias("Dixieland", "dixie")
_alias("Balada de Jazz", "jazz ballad")
_alias("Swing", "big band")
_alias("Sertanejo Raiz", "sertanejo de raiz", "moda de viola", "caipira", "musica caipira")
_alias("Sertanejo Universitário", "sertanejo pop")
_alias("Vanerão", "vaneira", "vanera")
_alias("Forró Pé-de-Serra", "pe de serra", "forro raiz")
_alias("Forró Eletrônico", "forro universitario")
_alias("Tecnobrega", "tecno brega")
_alias("Boi-Bumbá", "boi bumba", "boi", "parintins")
_alias("Samba de Gafieira", "gafieira")
_alias("Samba-jazz", "samba jazz")
_alias("Partido-alto", "partido alto")
_alias("Pagode Baiano", "pagodao", "pagode da bahia")
_alias("Jovem Guarda", "ie ie ie")
_alias("Tropicália", "tropicalismo")
_alias("Rock Brasileiro 80", "rock nacional", "rock brasil", "brock", "rock brasileiro")
_alias("Soul Brasileiro", "tim maia", "soul nacional")
_alias("Funk Mandelão", "funk 150", "funk 150 bpm", "funk paulista")
_alias("Funk Carioca", "baile funk", "funk brasileiro", "funk do rio")
_alias("Alt-Country", "alt country")
_alias("Honky-Tonk", "honky tonk")
_alias("Outlaw Country", "outlaw")
_alias("Balada Country", "country ballad", "nashville")
_alias("Folk Celta (Jig)", "jig", "irish jig", "celtic", "celta", "folk celta")
_alias("Folk Celta (Reel)", "reel", "irish reel")
_alias("Cantor-Compositor", "singer songwriter", "cantautor")
_alias("Black Gospel", "gospel americano", "gospel negro")
_alias("Spiritual", "negro spiritual", "espiritual")
_alias("Worship Contemporâneo", "worship", "louvor contemporaneo", "adoracao")
_alias("Hino", "hinos", "cantico", "hino cristao")
_alias("Son Cubano", "son")
_alias("Rumba Cubana", "rumba", "guaguanco")
_alias("Rocksteady", "rock steady")
_alias("Dub", "dub reggae")
_alias("Afrobeats", "afropop", "afro pop")
_alias("Ranchera", "mariachi", "musica ranchera")
_alias("Norteño", "musica nortena")
_alias("Musette", "valsa francesa")
_alias("Cha-cha-cha", "chacha", "cha cha")
_alias("Valsa", "waltz")
