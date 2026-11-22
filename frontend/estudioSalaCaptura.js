// Captura a entrada no mesmo relógio de amostras usado para agendar a base.
class EstudioSalaCaptura extends AudioWorkletProcessor {
  constructor({ processorOptions: { inicio, fim } }) {
    super();
    this.inicio = inicio;
    this.fim = fim;
    this.canais = [];
    this.usadas = 0;
    this.encerrada = false;
    this.port.onmessage = () => this.encerrar();
  }

  enviarParte() {
    if (!this.usadas) return;
    const canais = this.canais.map((dados) => dados.slice(0, this.usadas));
    this.port.postMessage({ canais }, canais.map((dados) => dados.buffer));
    this.usadas = 0;
  }

  encerrar() {
    if (this.encerrada) return;
    this.encerrada = true;
    this.enviarParte();
    this.port.postMessage({ concluida: true });
  }

  process([entrada], [saida]) {
    if (this.encerrada) return false;
    const fimDoBloco = currentFrame + saida[0].length;
    const inicio = Math.max(0, this.inicio - currentFrame);
    const fim = Math.min(fimDoBloco, this.fim) - currentFrame;
    if (fim > inicio) {
      if (!this.canais.length) this.canais = Array.from({ length: entrada.length || 1 }, () => new Float32Array(4096));
      let pos = inicio;
      while (pos < fim) {
        const n = Math.min(fim - pos, this.canais[0].length - this.usadas);
        for (const [c, dados] of this.canais.entries()) {
          if (entrada[c]) dados.set(entrada[c].subarray(pos, pos + n), this.usadas);
          else dados.fill(0, this.usadas, this.usadas + n);
        }
        pos += n;
        this.usadas += n;
        if (this.usadas === this.canais[0].length) this.enviarParte();
      }
    }
    if (fimDoBloco >= this.fim) this.encerrar();
    // A saída é silenciosa. O retorno da entrada passa pelo controle de fone.
    return !this.encerrada;
  }
}

registerProcessor("oh-sala-captura", EstudioSalaCaptura);
