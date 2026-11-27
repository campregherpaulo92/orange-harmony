const PREFIXO = "/api/estudio/projetos-nuvem";
const SDK = "https://www.gstatic.com/firebasejs/13.4.0/";

async function pedir(caminho, opcoes) {
  const resposta = await fetch(PREFIXO + caminho, { cache: "no-store", ...opcoes });
  if (!resposta.ok) {
    const erro = await resposta.json().catch(() => null);
    throw new Error(typeof erro?.detail === "string" ? erro.detail : "O servidor não conseguiu acessar o projeto na nuvem.");
  }
  return resposta;
}

export async function prepararNuvem() {
  const { firebase, limite } = await (await pedir("/config")).json();
  const [app, login] = await Promise.all([
    import(SDK + "firebase-app.js"),
    import(SDK + "firebase-auth.js"),
  ]);
  const sessao = login.getAuth(app.initializeApp(firebase, "orange-estudio-nuvem"));
  await sessao.authStateReady();

  async function autenticado(caminho, opcoes = {}) {
    const usuario = sessao.currentUser;
    if (!usuario) throw new Error("Entre com sua conta Google para acessar a nuvem.");
    const token = await usuario.getIdToken();
    return pedir(caminho, {
      ...opcoes,
      headers: { ...opcoes.headers, Authorization: `Bearer ${token}` },
    });
  }

  return {
    email: () => sessao.currentUser?.email,
    entrar: () => login.signInWithPopup(sessao, new login.GoogleAuthProvider()),
    sair: () => login.signOut(sessao),
    async listar() {
      return (await (await autenticado("")).json()).projetos;
    },
    async salvar(id, nome, geracao, arquivo) {
      if (arquivo.size > limite) throw new Error(`Este projeto excede ${limite / 1048576} MB. Use Salvar projeto em arquivo.`);
      const { url } = await (await autenticado(`/${encodeURIComponent(id)}/envio`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome: nome.slice(0, 140) || "Meu projeto", geracao, tamanho: arquivo.size }),
      })).json();
      const destino = new URL(url);
      if (destino.origin !== "https://storage.googleapis.com" || !destino.pathname.startsWith("/upload/storage/v1/")) {
        throw new Error("O Firebase retornou um endereço de envio inválido.");
      }
      const envio = await fetch(destino, {
        method: "PUT", credentials: "omit", redirect: "error",
        headers: { "Content-Type": "application/zip" },
        body: arquivo,
      });
      if (envio.status === 412) throw new Error("Há uma versão mais recente na nuvem. Abra essa versão antes de salvar por cima.");
      if (!envio.ok) throw new Error("O Firebase não confirmou o envio. Confira a lista da nuvem antes de tentar de novo.");
      const gravado = await envio.json();
      if (Number(gravado.size) !== arquivo.size || !/^\d+$/.test(gravado.generation)) {
        throw new Error("O Firebase não confirmou o tamanho do arquivo. Confira a lista da nuvem.");
      }
      return String(gravado.generation);
    },
    async baixar(id) {
      const resposta = await autenticado(`/${encodeURIComponent(id)}/arquivo`);
      const geracao = resposta.headers.get("X-Projeto-Geracao");
      const tamanho = Number(resposta.headers.get("X-Projeto-Tamanho"));
      if (!geracao || !Number.isSafeInteger(tamanho) || tamanho <= 0 || tamanho > limite) {
        throw new Error("O servidor retornou dados inválidos para este projeto.");
      }
      const arquivo = await resposta.blob();
      if (arquivo.size !== tamanho) throw new Error("O download veio incompleto. Tente abrir o projeto novamente.");
      return { arquivo, geracao };
    },
  };
}
