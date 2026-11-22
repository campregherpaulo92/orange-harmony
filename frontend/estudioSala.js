// Sala de Gravação. O retorno e as tomadas usam o relógio do AudioContext do Studio.
(function () {
  "use strict";

  const urlCaptura = new URL("estudioSalaCaptura.js?v=1", document.currentScript.src).href;

  function criar(dialog, motor) {
    const { ctx, ic, esc } = motor;
    const $ = (id) => dialog.querySelector("#" + id);
    const projetos = new Map();
    let projeto = null, sessao = null, entrada = null, ativando = null, gravacao = null;
    let transporte = null, frame = 0, operacao = "", contador = 0, moduloCaptura;
    const nomePadrao = (n) => "Tomada " + n;
    const duracaoMinima = 0.05;
    const ganhoBase = ctx.createGain(), ganhoClique = ctx.createGain(), ganhoEntrada = ctx.createGain(), ganhoTomada = ctx.createGain();
    const busFone = ctx.createDynamicsCompressor();
    busFone.threshold.value = -3; busFone.knee.value = 0; busFone.ratio.value = 16;
    [ganhoBase, ganhoClique, ganhoEntrada, ganhoTomada].forEach((n) => n.connect(busFone));
    busFone.connect(ctx.destination);

    dialog.innerHTML = `
      <header class="ds-topo">
        <div class="ds-marca">${ic("mic")}</div>
        <div><h2 id="dsTitulo">Sala de Gravação</h2><p id="dsProjeto"></p></div>
        <button type="button" class="dw-btn peq" id="dsFechar">Voltar ao Studio</button>
      </header>
      <div class="ds-corpo">
        <aside class="ds-controles" aria-label="Configuração">
          <fieldset class="ds-bloco" id="dsEntradaConfig">
            <legend>Entrada</legend>
            <label for="dsDispositivo">Interface ou microfone</label>
            <select id="dsDispositivo"></select>
            <div class="ds-nivel"><meter id="dsMedidor" min="0" max="60" low="28" high="59" optimum="52" value="0" aria-label="Nível de entrada"></meter><output id="dsPico">−∞ dBFS</output></div>
            <div class="ds-linha"><button type="button" class="dw-btn peq" id="dsAtivar">${ic("mic")} Ativar entrada</button><button type="button" class="dw-btn peq" id="dsTeste" disabled>Teste de 3 s</button></div>
          </fieldset>
          <fieldset class="ds-bloco">
            <legend>Retorno no fone</legend>
            <label class="ds-slider">Base <input type="range" id="dsVolBase" min="0" max="100" value="70"><output id="dsPctBase">70%</output></label>
            <label class="ds-slider">Minha entrada <input type="range" id="dsVolEntrada" min="0" max="100" value="35" disabled><output id="dsPctEntrada">35%</output></label>
            <label class="ds-slider">Clique <input type="range" id="dsVolClique" min="0" max="100" value="45"><output id="dsPctClique">45%</output></label>
            <label for="dsMonitor">Ouvir minha entrada por</label>
            <select id="dsMonitor"><option value="interface">Interface / retorno externo</option><option value="app">App / usar fone</option><option value="off">Retorno desligado no app</option></select>
            <p class="ds-dica" id="dsMonitorInfo"></p>
          </fieldset>
          <fieldset class="ds-bloco" id="dsRitmoConfig">
            <legend>Metrônomo e alinhamento</legend>
            <label>Pré-contagem <select id="dsConta"><option value="0">Nenhuma</option><option value="1">1 compasso</option><option value="2">2 compassos</option></select></label>
            <label>Clique <select id="dsClique"><option value="contagem">Só na contagem</option><option value="sempre">Durante a gravação também</option></select></label>
            <label title="Compensação de captura, iniciada com o último valor calibrado no Studio">Atraso (ms) <input id="dsAtraso" type="number" value="0" step="1" min="0" max="500" required></label>
          </fieldset>
        </aside>
        <main class="ds-principal">
          <fieldset class="ds-bloco" id="dsReferenciaConfig">
            <legend>Referência do projeto</legend>
            <div class="ds-faixas" id="dsFaixas"></div>
            <div class="ds-linha ds-tempos">
              <label>Gravar a partir de (s) <input id="dsInicio" type="number" min="0" step="0.001" required></label>
              <label>Até (s) <input id="dsFim" type="number" min="0" step="0.001" placeholder="—"></label>
              <label><input id="dsLoop" type="checkbox"> Repetir ao ouvir</label>
            </div>
            <div class="ds-linha"><button type="button" class="dw-btn peq" id="dsOuvirBase">${ic("play")} Ouvir base</button></div>
          </fieldset>
          <div class="ds-transporte">
            <div><output id="dsPos">0:00.0</output><span id="dsFase">Pronto para gravar</span></div>
            <div class="ds-linha"><button type="button" class="dw-btn peq" id="dsParar" disabled>${ic("stop")} Parar</button><button type="button" class="dw-btn cheio" id="dsGravar">${ic("rec")} Gravar tomada</button></div>
          </div>
          <section class="ds-bloco ds-tomadas" aria-labelledby="dsTituloTomadas">
            <h3 id="dsTituloTomadas">Tomadas</h3>
            <p id="dsSemTomadas" class="ds-dica">Grave uma tomada para ouvir, recortar ou enviar ao Studio.</p>
            <div id="dsEditor" hidden>
              <div class="ds-linha ds-tomada-campos">
                <label>Tomada <select id="dsTomada"></select></label>
                <button type="button" class="dw-btn peq" id="dsExcluirTomada" title="Excluir tomada selecionada" aria-label="Excluir tomada selecionada">${ic("lixeira")}</button>
                <label>Nome da faixa <input id="dsNome" type="text" maxlength="60"></label>
                <button type="button" class="dw-btn peq" id="dsOuvirTomada">${ic("play")} Ouvir com a base</button>
              </div>
              <div class="ds-onda"><canvas id="dsOnda" width="900" height="94" aria-label="Forma de onda da tomada. Clique para posicionar a divisão." title="Clique para posicionar a divisão"></canvas><i id="dsCursorOnda" hidden></i></div>
              <div class="ds-linha ds-tempos">
                <label>Início do recorte (s) <input id="dsCorteA" type="number" min="0" step="0.001" required></label>
                <label>Fim do recorte (s) <input id="dsCorteB" type="number" min="0" step="0.001" required></label>
                <label>Dividir em (s) <input id="dsDivisao" type="number" min="0" step="0.001" required></label>
                <button type="button" class="dw-btn peq" id="dsDividir">${ic("tes")} Dividir</button>
              </div>
              <div class="ds-linha ds-tempos" id="dsAlinharLinha">
                <label title="Adiante ou atrase a tomada na linha do tempo para conferir com a referência">Alinhamento (ms) <input id="dsAlinhar" type="number" step="1" value="0" required></label>
              </div>
              <div class="ds-envio">
                <p id="dsDestino" class="ds-dica"></p>
                <div class="ds-linha"><button type="button" class="dw-btn peq" id="dsWav">${ic("baixar")} WAV</button><button type="button" class="dw-btn cheio" id="dsEnviar">${ic("mais")} Enviar ao projeto</button></div>
              </div>
            </div>
          </section>
        </main>
      </div>
      <footer class="ds-status" id="dsStatus" role="status" aria-live="polite"></footer>`;

    const texto = (id, valor) => { $(id).textContent = valor; };
    const estado = (msg) => texto("dsStatus", msg);
    const segundos = (valor) => String(+valor.toFixed(3));
    const relogio = (t) => {
      const d = Math.floor(Math.max(0, t) * 10);
      return Math.floor(d / 600) + ":" + String(Math.floor(d / 10) % 60).padStart(2, "0") + "." + d % 10;
    };
    const inicioDaTomada = (t) => t.inicio + t.deslocamento + t.a;
    const tomadaAtual = () => sessao?.tomadas.find((t) => t.id === sessao.selecionada);
    const faixasMarcadas = () => [...dialog.querySelectorAll("#dsFaixas input:checked")].map((el) => el.value);
    const ocupado = () => !!gravacao || !!operacao;
    const pararStream = (stream) => stream?.getTracks().forEach((track) => track.stop());

    function atualizarMix() {
      for (const [tipo, node] of [["Base", ganhoBase], ["Entrada", ganhoEntrada], ["Clique", ganhoClique]]) {
        const valor = Number($("dsVol" + tipo).value);
        texto("dsPct" + tipo, valor + "%");
        const mudo = tipo === "Entrada" && $("dsMonitor").value !== "app";
        node.gain.setTargetAtTime(mudo ? 0 : valor / 100, ctx.currentTime, 0.012);
      }
      $("dsVolEntrada").disabled = $("dsMonitor").value !== "app";
      const dicas = {
        interface: "Ajuste o retorno da sua voz ou instrumento na interface.",
        app: "Use fone e desligue o retorno direto da interface para evitar som dobrado.",
        off: "O app toca apenas a referência e o clique.",
      };
      texto("dsMonitorInfo", dicas[$("dsMonitor").value]);
    }

    function controles() {
      const travado = ocupado();
      ["dsEntradaConfig", "dsRitmoConfig", "dsReferenciaConfig"].forEach((id) => { $(id).disabled = travado; });
      $("dsAtivar").disabled = !!ativando || !!entrada;
      $("dsTeste").disabled = !entrada;
      $("dsGravar").disabled = travado;
      $("dsFechar").disabled = travado;
      const finalizando = !!gravacao?.encerrando;
      $("dsParar").disabled = finalizando || !(operacao || gravacao || transporte);
      const editor = $("dsEditor");
      editor.inert = travado;
      $("dsOuvirBase").disabled = !faixasMarcadas().length;
      const tomada = tomadaAtual();
      $("dsEnviar").disabled = !tomada || tomada.enviada || tomada.teste;
      $("dsExcluirTomada").disabled = travado || !tomada;
    }

    async function listarEntradas() {
      const seletor = $("dsDispositivo"), valor = seletor.value, atual = sessao;
      let dispositivos;
      try { dispositivos = await navigator.mediaDevices.enumerateDevices(); } catch (_) { return; }
      if (!dialog.open || sessao !== atual || seletor.value !== valor) return;
      const entradas = dispositivos.filter((d) => d.kind === "audioinput" && d.deviceId && d.deviceId !== "default");
      seletor.replaceChildren(new Option("Padrão do sistema", ""));
      entradas.forEach((d, i) => seletor.add(new Option(d.label || "Entrada " + (i + 1), d.deviceId)));
      if (valor && !entradas.some((d) => d.deviceId === valor)) seletor.add(new Option("Entrada selecionada", valor));
      seletor.value = valor;
    }

    function fecharEntrada() {
      ativando = null;
      if (entrada) {
        entrada.fonte.disconnect();
        entrada.analisador.disconnect();
        pararStream(entrada.stream);
        entrada = null;
      }
      $("dsMedidor").value = 0;
      $("dsMedidor").classList.remove("ds-pico");
      texto("dsPico", "−∞ dBFS");
    }

    async function ativarEntrada() {
      if (entrada) return entrada;
      if (ativando) return ativando;
      const atual = sessao;
      const pedido = (async () => {
        let stream;
        try {
          await ctx.resume();
          stream = await motor.pedirEntrada($("dsDispositivo").value);
          if (!dialog.open || sessao !== atual || ativando !== pedido) { pararStream(stream); return null; }
          const fonte = ctx.createMediaStreamSource(stream), analisador = ctx.createAnalyser();
          analisador.fftSize = 1024;
          fonte.connect(analisador);
          fonte.connect(ganhoEntrada);
          const item = { stream, fonte, analisador, dados: new Float32Array(analisador.fftSize) };
          entrada = item;
          stream.getAudioTracks()[0]?.addEventListener("ended", () => {
            if (entrada !== item) return;
            if (gravacao) pararGravacao();
            fecharEntrada();
            estado("A entrada foi desconectada.");
            controles();
          }, { once: true });
          estado("Entrada ativa. Toque ou cante para conferir o nível.");
          listarEntradas();
          return item;
        } catch (erro) {
          pararStream(stream);
          if (dialog.open && sessao === atual && ativando === pedido) estado(motor.erroEntrada(erro));
          return null;
        } finally {
          if (ativando === pedido) ativando = null;
          controles();
        }
      })();
      ativando = pedido;
      controles();
      return pedido;
    }

    function mostrarNivel() {
      if (!entrada) return;
      entrada.analisador.getFloatTimeDomainData(entrada.dados);
      let pico = 0;
      for (const v of entrada.dados) pico = Math.max(pico, Math.abs(v));
      const db = pico > 0 ? Math.round(20 * Math.log10(pico)) : -Infinity;
      $("dsMedidor").value = Math.max(0, Math.min(60, db + 60));
      texto("dsPico", db > -60 ? db + " dBFS" : "−∞ dBFS");
      $("dsMedidor").classList.toggle("ds-pico", db >= -1);
    }

    function intervalo() {
      const inicio = $("dsInicio").valueAsNumber;
      const limite = $("dsFim").valueAsNumber;
      if (!Number.isFinite(inicio) || inicio < 0 || ($("dsFim").value && !Number.isFinite(limite))) throw new Error("Informe um início válido.");
      if (Number.isFinite(limite) && limite - inicio < duracaoMinima) throw new Error("O fim deve vir depois do início.");
      return { inicio, fim: Number.isFinite(limite) ? limite : Infinity };
    }
    function pararTransporte() {
      if (!transporte) return;
      transporte.parar();
      transporte = null;
      atualizarMarcador();
    }

    function iniciarBase(inicio, fim, quando, repetir = false) {
      const ids = faixasMarcadas();
      const ate = Math.min(fim, projeto.fim);
      let parar = () => {};
      if (ids.length && ate > inicio) parar = motor.tocarReferencia(ids, inicio, ate, quando, ganhoBase);
      transporte = { tipo: "base", inicio, fim: ate, quando, parar, repetir };
    }

    function agendarClique(g) {
      g.clickBus = ctx.createGain();
      g.clickBus.connect(ganhoClique);
      const { tempos, passo } = projeto;
      for (let i = 0; i < g.pre; i++) motor.cliqueEm(g.primeiro + i * passo, i % tempos === 0, g.clickBus);
      if ($("dsClique").value !== "sempre") return;
      let batida = Math.ceil(g.inicio / passo - 0.00001);
      const avancar = () => {
        let t = g.quando + batida * passo - g.inicio;
        while (t < ctx.currentTime + 0.18 && batida * passo < g.fim) {
          if (t >= ctx.currentTime) motor.cliqueEm(t, batida % tempos === 0, g.clickBus);
          t = g.quando + ++batida * passo - g.inicio;
        }
      };
      avancar();
      g.metro = setInterval(avancar, 30);
    }

    function pararRetornoCaptura(g) {
      clearInterval(g.metro);
      g.clickBus?.disconnect();
      g.clickBus = null;
      pararTransporte();
    }

    function limparCaptura(g) {
      pararRetornoCaptura(g);
      if (entrada?.fonte === g.fonte) g.fonte.disconnect(g.captura);
      g.captura.disconnect();
      g.captura.port.close();
      gravacao = null;
    }

    function cancelarAbertura() {
      if (!operacao) return;
      operacao = "";
      fecharEntrada();
      estado("Abertura da gravação cancelada.");
      controles();
    }

    function pararGravacao() {
      const g = gravacao;
      if (!g || g.encerrando) return;
      g.encerrando = true;
      g.parou = ctx.currentTime;
      pararRetornoCaptura(g);
      estado("Finalizando a gravação…");
      controles();
      g.captura.port.postMessage("parar");
    }

    async function iniciarGravacao(teste) {
      if (ocupado()) return;
      const pedido = {};
      try {
        const intervaloAtual = teste ? { inicio: 0, fim: 3 } : intervalo();
        const atraso = $("dsAtraso").valueAsNumber;
        if (!teste && (!Number.isFinite(atraso) || atraso < 0 || atraso > 500)) throw new Error("Informe um atraso entre 0 e 500 ms.");
        pararTransporte();
        operacao = pedido;
        controles();
        const dispositivo = await ativarEntrada();
        if (operacao !== pedido || !dispositivo || !dialog.open) return;
        if (!ctx.audioWorklet) throw new Error("Abra a Sala por HTTPS em um navegador com suporte à captura de áudio.");
        try {
          moduloCaptura ??= ctx.audioWorklet.addModule(urlCaptura);
          await moduloCaptura;
        } catch (_) {
          moduloCaptura = null;
          throw new Error("O módulo de gravação não carregou. Recarregue a página e tente novamente.");
        }
        if (operacao !== pedido || !dialog.open || entrada !== dispositivo) return;
        const g = { ...intervaloAtual, teste, partes: [], amostras: 0, sessao, fonte: dispositivo.fonte,
          pre: teste ? 0 : Number($("dsConta").value) * projeto.tempos };
        g.primeiro = ctx.currentTime + 0.12;
        const inicio = Math.round((g.primeiro + g.pre * projeto.passo) * ctx.sampleRate);
        g.quando = inicio / ctx.sampleRate;
        g.inicioCaptura = inicio + Math.round((teste ? 0 : atraso / 1000) * ctx.sampleRate);
        const fim = g.inicioCaptura + Math.round((g.fim - g.inicio) * ctx.sampleRate);
        g.captura = new AudioWorkletNode(ctx, "oh-sala-captura", {
          outputChannelCount: [1], processorOptions: { inicio: g.inicioCaptura, fim },
        });
        dispositivo.fonte.connect(g.captura);
        g.captura.connect(ctx.destination);
        gravacao = g;
        g.captura.port.onmessage = ({ data }) => {
          if (gravacao !== g) return;
          if (data.concluida) concluirGravacao(g);
          else {
            g.partes.push(data.canais);
            g.amostras += data.canais[0].length;
          }
        };
        g.captura.onprocessorerror = () => {
          if (gravacao !== g) return;
          limparCaptura(g);
          estado("O navegador interrompeu a captura. Tente gravar novamente.");
          controles();
        };
        if (!teste) { iniciarBase(g.inicio, g.fim, g.quando); agendarClique(g); }
        estado(teste ? "Gravando o teste de entrada." : "Preparando a tomada…");
      } catch (erro) {
        if (operacao === pedido) {
          if (gravacao) limparCaptura(gravacao);
          estado(erro.message || "Não consegui iniciar a gravação.");
        }
      } finally {
        if (operacao === pedido) operacao = "";
        controles();
      }
    }

    function concluirGravacao(g) {
      if (gravacao !== g) return;
      limparCaptura(g);
      const limite = g.parou === undefined ? g.amostras : Math.round(g.parou * ctx.sampleRate) - g.inicioCaptura;
      const amostras = Math.min(limite, g.amostras);
      if (amostras < duracaoMinima * ctx.sampleRate) {
        estado("Gravação cancelada antes de haver uma tomada.");
        controles();
        return;
      }
      try {
        const fonte = ctx.createBuffer(g.partes[0].length, amostras, ctx.sampleRate);
        let pos = 0;
        for (const canais of g.partes) {
          const n = Math.min(canais[0].length, amostras - pos);
          canais.forEach((dados, c) => fonte.copyToChannel(dados.subarray(0, n), c, pos));
          pos += n;
          if (pos === amostras) break;
        }
        const tomada = {
          id: ++contador, nome: g.teste ? "Teste de entrada" : nomePadrao(++g.sessao.numero),
          fonte, comprimento: amostras, a: 0, b: amostras / fonte.sampleRate,
          inicio: g.inicio, deslocamento: 0, enviada: false, teste: g.teste,
        };
        g.sessao.tomadas.push(tomada);
        g.sessao.selecionada = tomada.id;
        if (dialog.open) {
          renderTomadas();
          estado(g.teste ? "Teste pronto. Use Ouvir teste para conferir a entrada." : "Tomada pronta. Ouça, ajuste o recorte ou envie ao projeto.");
        }
      } catch (erro) {
        estado(erro.message || "Não consegui ler a tomada gravada.");
      } finally {
        controles();
      }
    }

    function animar() {
      if (!dialog.open) return;
      mostrarNivel();
      const agora = ctx.currentTime;
      if (gravacao && !gravacao.encerrando && Number.isFinite(gravacao.quando)) {
        const g = gravacao;
        const falta = g.quando - agora;
        texto("dsFase", falta > 0 && g.pre ? "Pré-contagem · " + Math.min(g.pre, Math.ceil(falta / projeto.passo))
          : agora >= g.quando ? (g.teste ? "Teste de entrada" : "Gravando") : "Preparando entrada");
        texto("dsPos", relogio(Math.min(g.fim, g.inicio + Math.max(0, -falta))));
      } else if (transporte && !gravacao) {
        const { tipo, quando, inicio, fim, repetir, tomada } = transporte;
        const pos = inicio + Math.max(0, agora - quando);
        texto("dsFase", tipo === "base" ? "Ouvindo a referência" : "Ouvindo a tomada");
        texto("dsPos", relogio(Math.min(fim, pos)));
        if (tomada) {
          atualizarMarcador(pos - tomada.inicio - tomada.deslocamento);
        }
        if (pos >= fim) {
          pararTransporte();
          if (repetir && fim > inicio) iniciarBase(inicio, fim, agora + 0.026, true);
          controles();
        }
      } else {
        texto("dsFase", gravacao?.encerrando ? "Finalizando gravação" : ocupado() ? "Preparando entrada" : "Pronto para gravar");
      }
      frame = requestAnimationFrame(animar);
    }

    function copiarAudio(t) {
      const sr = t.fonte.sampleRate;
      const a = Math.round(t.a * sr), b = Math.min(t.comprimento, Math.round(t.b * sr));
      const buffer = ctx.createBuffer(t.fonte.numberOfChannels, b - a, sr);
      for (let c = 0; c < buffer.numberOfChannels; c++) {
        buffer.copyToChannel(t.fonte.getChannelData(c).subarray(a, b), c);
      }
      return buffer;
    }

    function desenharOnda(t) {
      const cv = $("dsOnda"), g = cv.getContext("2d"), W = cv.width, H = cv.height;
      const total = t.comprimento / t.fonte.sampleRate;
      g.fillStyle = "#14100c"; g.fillRect(0, 0, W, H);
      g.fillStyle = "#512d18"; g.fillRect(W * t.a / total, 0, W * (t.b - t.a) / total, H);
      const canais = Array.from({ length: t.fonte.numberOfChannels }, (_, c) => t.fonte.getChannelData(c));
      const passo = t.comprimento / W;
      g.fillStyle = "#ffac6a";
      for (let x = 0; x < W; x++) {
        const a = Math.floor(x * passo), b = Math.min(t.comprimento, Math.floor((x + 1) * passo));
        let pico = 0;
        for (const canal of canais) {
          for (let i = a; i < b; i += Math.max(1, Math.floor(passo / 20))) pico = Math.max(pico, Math.abs(canal[i]));
        }
        const h = Math.max(1, pico * H * 0.94);
        g.fillRect(x, (H - h) / 2, 1, h);
      }
    }

    function renderTomadas() {
      const t = tomadaAtual();
      $("dsEditor").hidden = !t;
      $("dsSemTomadas").hidden = !!t;
      $("dsTomada").replaceChildren(...sessao.tomadas.map((x) => new Option(x.nome + (x.enviada ? " · enviada" : ""), x.id)));
      if (!t) { controles(); return; }
      $("dsTomada").value = t.id;
      $("dsNome").value = t.nome;
      $("dsCorteA").value = segundos(t.a);
      $("dsCorteB").value = segundos(t.b);
      $("dsDivisao").value = segundos((t.a + t.b) / 2);
      $("dsAlinharLinha").hidden = t.teste;
      $("dsAlinhar").value = Math.round(t.deslocamento * 1000);
      $("dsOuvirTomada").innerHTML = ic("play") + (t.teste ? " Ouvir teste" : " Ouvir com a base");
      atualizarDestino(t);
    }

    function excluirTomada() {
      const tomada = tomadaAtual();
      if (!tomada || ocupado() || !window.confirm(`Excluir “${tomada.nome}” da Sala de Gravação?`)) return;
      pararTransporte();
      const indice = sessao.tomadas.indexOf(tomada);
      sessao.tomadas.splice(indice, 1);
      sessao.selecionada = (sessao.tomadas[indice] || sessao.tomadas[indice - 1])?.id ?? null;
      renderTomadas();
      (tomadaAtual() ? $("dsTomada") : $("dsGravar")).focus();
      estado(`“${tomada.nome}” excluída da sala.`);
    }

    function atualizarMarcador(tempo = $("dsDivisao").valueAsNumber) {
      const t = tomadaAtual(), marcador = $("dsCursorOnda");
      marcador.hidden = !t || !Number.isFinite(tempo);
      if (!marcador.hidden) marcador.style.left = Math.max(0, Math.min(100, tempo * t.fonte.sampleRate / t.comprimento * 100)) + "%";
    }

    function atualizarDestino(t) {
      const pos = inicioDaTomada(t);
      $("dsAlinhar").min = Math.ceil(-(t.inicio + t.a) * 1000);
      texto("dsDestino", t.enviada ? "Enviada ao projeto em " + segundos(pos) + " s."
        : (t.teste ? "Teste de entrada · " : "Entrada na linha do tempo em " + segundos(pos) + " s · ") + segundos(t.b - t.a) + " s de áudio");
      desenharOnda(t);
      atualizarMarcador();
      controles();
    }

    function editarRecorte() {
      const t = tomadaAtual();
      const a = $("dsCorteA").valueAsNumber, b = $("dsCorteB").valueAsNumber;
      const total = t.comprimento / t.fonte.sampleRate;
      if (!Number.isFinite(a) || !Number.isFinite(b) || a < 0 || t.inicio + t.deslocamento + a < -0.0005 || b > total + 0.0005 || b - a < duracaoMinima) {
        estado("Escolha um recorte válido dentro da tomada.");
        $("dsCorteA").value = segundos(t.a);
        $("dsCorteB").value = segundos(t.b);
        return;
      }
      pararTransporte();
      t.a = a; t.b = Math.min(b, total); t.enviada = false;
      atualizarDestino(t);
      estado("Recorte ajustado.");
    }

    function dividir() {
      const t = tomadaAtual(), corte = $("dsDivisao").valueAsNumber;
      if (!Number.isFinite(corte) || corte - t.a < duracaoMinima || t.b - corte < duracaoMinima) return estado("Escolha um ponto de divisão dentro do recorte.");
      pararTransporte();
      const direita = { ...t, id: ++contador, nome: t.nome + " · parte 2", a: corte, enviada: false };
      t.nome += " · parte 1"; t.b = corte; t.enviada = false;
      sessao.tomadas.splice(sessao.tomadas.indexOf(t) + 1, 0, direita);
      renderTomadas();
      estado("Tomada dividida. Escolha a parte que quer ouvir ou enviar.");
    }

    function tocarTomada() {
      const t = tomadaAtual();
      if (!t || ocupado()) return;
      pararTransporte();
      ctx.resume();
      const inicio = inicioDaTomada(t), fim = inicio + t.b - t.a, quando = ctx.currentTime + 0.05;
      if (!t.teste) iniciarBase(inicio, fim, quando);
      const pararBase = transporte?.parar;
      const src = ctx.createBufferSource();
      src.buffer = t.fonte;
      src.connect(ganhoTomada);
      src.start(quando, t.a, t.b - t.a);
      transporte = { tipo: "tomada", inicio, fim, quando, tomada: t, parar() { pararBase?.(); src.stop(); src.disconnect(); } };
      controles();
    }

    function fechar() {
      cancelarAbertura();
      pararTransporte();
      if (gravacao) pararGravacao();
      fecharEntrada();
      cancelAnimationFrame(frame);
    }

    function abrir(dados) {
      if (dialog.open || ocupado()) return;
      projeto = dados;
      if (!projetos.has(dados.projeto)) projetos.set(dados.projeto, { tomadas: [], selecionada: null, numero: 0, dispositivo: dados.entrada, referencias: null });
      sessao = projetos.get(dados.projeto);
      texto("dsProjeto", `${dados.nome} · ${dados.bpm} BPM · ${dados.compasso}`);
      const referencias = dados.selecao ? null : sessao.referencias;
      const validar = referencias && (!referencias.length || dados.faixas.some((f) => referencias.includes(f.id)));
      $("dsFaixas").innerHTML = dados.faixas.length ? dados.faixas.map((f) => {
        const marcada = validar ? referencias.includes(f.id) : f.marcada;
        return `<label><input type="checkbox" value="${esc(f.id)}" ${marcada ? "checked" : ""}> ${esc(f.nome)}</label>`;
      }).join("") : '<p class="ds-dica">O projeto está vazio. Você pode gravar sem referência.</p>';
      sessao.referencias = dados.faixas.length ? faixasMarcadas() : null;
      $("dsInicio").value = segundos(dados.selecao?.inicio ?? dados.cursor);
      $("dsFim").value = dados.selecao ? segundos(dados.selecao.fim) : "";
      $("dsConta").value = dados.contagem;
      $("dsAtraso").value = dados.atraso;
      $("dsDispositivo").replaceChildren(new Option("Padrão do sistema", ""));
      if (sessao.dispositivo) $("dsDispositivo").add(new Option("Entrada selecionada", sessao.dispositivo));
      $("dsDispositivo").value = sessao.dispositivo;
      texto("dsPos", relogio(dados.selecao?.inicio ?? dados.cursor));
      estado("Escolha a referência e confira o sinal antes de gravar.");
      dialog.showModal();
      listarEntradas();
      atualizarMix();
      renderTomadas();
      controles();
      frame = requestAnimationFrame(animar);
    }

    $("dsFechar").onclick = () => { if (!ocupado()) dialog.close(); };
    dialog.addEventListener("cancel", (e) => { if (ocupado()) e.preventDefault(); });
    dialog.addEventListener("close", fechar);
    $("dsDispositivo").onchange = (e) => { fecharEntrada(); sessao.dispositivo = e.target.value; estado("Ative a entrada escolhida para conferir o sinal."); controles(); };
    $("dsAtivar").onclick = ativarEntrada;
    $("dsGravar").onclick = () => iniciarGravacao(false);
    $("dsTeste").onclick = () => iniciarGravacao(true);
    $("dsParar").onclick = () => {
      if (gravacao) pararGravacao();
      else if (operacao) cancelarAbertura();
      else { pararTransporte(); controles(); }
    };
    $("dsFaixas").onchange = () => { pararTransporte(); sessao.referencias = faixasMarcadas(); controles(); };
    ["dsInicio", "dsFim", "dsLoop"].forEach((id) => { $(id).onchange = () => { pararTransporte(); controles(); }; });
    $("dsOuvirBase").onclick = () => {
      try {
        const { inicio, fim } = intervalo();
        if (inicio >= Math.min(fim, projeto.fim)) return estado("Escolha um intervalo dentro da referência.");
        pararTransporte();
        ctx.resume();
        iniciarBase(inicio, fim, ctx.currentTime + 0.05, $("dsLoop").checked);
        controles();
      } catch (erro) { estado(erro.message); }
    };
    ["dsVolBase", "dsVolEntrada", "dsVolClique", "dsMonitor"].forEach((id) => { $(id).oninput = atualizarMix; });
    $("dsExcluirTomada").onclick = excluirTomada;
    $("dsTomada").onchange = (e) => { pararTransporte(); sessao.selecionada = +e.target.value; renderTomadas(); };
    $("dsNome").onchange = (e) => { const t = tomadaAtual(); t.nome = e.target.value.trim() || nomePadrao(t.id); renderTomadas(); };
    $("dsCorteA").onchange = $("dsCorteB").onchange = editarRecorte;
    $("dsDividir").onclick = dividir;
    $("dsDivisao").oninput = () => atualizarMarcador();
    $("dsOnda").onclick = (e) => {
      const t = tomadaAtual();
      if (!t || ocupado()) return;
      const area = e.currentTarget.getBoundingClientRect();
      const tempo = (e.clientX - area.left) / area.width * t.comprimento / t.fonte.sampleRate;
      const ponto = Math.max(t.a, Math.min(t.b, tempo));
      $("dsDivisao").value = segundos(ponto);
      atualizarMarcador(ponto);
    };
    $("dsAlinhar").onchange = () => {
      const t = tomadaAtual(), ms = $("dsAlinhar").valueAsNumber;
      if (!Number.isFinite(ms) || ms < Number($("dsAlinhar").min)) {
        $("dsAlinhar").value = Math.round(t.deslocamento * 1000);
        return estado("O alinhamento precisa deixar a tomada dentro da linha do tempo.");
      }
      pararTransporte();
      t.deslocamento = ms / 1000; t.enviada = false;
      atualizarDestino(t);
      estado("Posição ajustada. Ouça a tomada com a base para conferir.");
    };
    $("dsOuvirTomada").onclick = tocarTomada;
    $("dsWav").onclick = () => {
      try { const t = tomadaAtual(); motor.exportar(copiarAudio(t), t.nome); } catch (erro) { estado(erro.message); }
    };
    $("dsEnviar").onclick = () => {
      try {
        const t = tomadaAtual();
        if (t.enviada) return;
        if (t.teste) return estado("Grave uma tomada para enviar ao projeto. O teste pode ser salvo em WAV.");
        pararTransporte();
        motor.receberTomada(projeto.projeto, t.nome, copiarAudio(t), inicioDaTomada(t));
        t.enviada = true;
        dialog.close();
      } catch (erro) { estado(erro.message); }
    };
    new MutationObserver(() => {
      if (dialog.open && !dialog.closest("#page-estudio").classList.contains("oh-page-ativa")) dialog.close();
    }).observe(dialog.closest("#page-estudio"), { attributes: true, attributeFilter: ["class", "hidden"] });

    return { abrir, temRascunhos: () => [...projetos.values()].some((p) => p.tomadas.some((t) => !t.enviada && !t.teste)) };
  }

  window.EstudioSala = { criar };
})();
