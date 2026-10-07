import { api, mensagemErro } from './api';

/**
 * Abre um arquivo que só sai com login.
 *
 * Não dá para apontar um `<a href>` para a rota: o endereço pede token, e o
 * navegador não o manda numa navegação comum — ele vive no localStorage e quem
 * o envia é o cliente HTTP daqui. O link levava a um 401 em tela branca.
 *
 * Então o arquivo é buscado com o token, vira um endereço temporário na memória
 * do navegador, e é esse que se abre (ver `abrirNumaAba`).
 */
export async function abrirArquivo(
  caminho: string,
  nomeParaBaixar: string,
  tipo = 'application/pdf',
): Promise<void> {
  await abrirNumaAba(async () => {
    try {
      const res = await api.get(caminho, { responseType: 'blob' });
      return new Blob([res.data as BlobPart], { type: tipo });
    } catch (erro) {
      throw new Error(await motivoDoErroEmArquivo(erro));
    }
  }, nomeParaBaixar);
}

/**
 * Abre numa aba um arquivo que ainda vai ser buscado.
 *
 * A aba é aberta **antes** do pedido, e não depois que o arquivo chega. O
 * navegador do celular só deixa abrir aba enquanto o toque da pessoa ainda está
 * de pé, e depois da espera ele já não está: a aba era recusada em silêncio, e
 * "Ver o recibo" não fazia nada. Foi a pasta do RH que aprendeu isso primeiro;
 * o recibo da diária, a nota do título e o PDF da APR abriam do jeito velho.
 *
 * Chame no clique, ou na primeira linha do que o clique dispara. Aba recusada
 * mesmo assim: o arquivo desce como download, que o telefone abre no
 * visualizador dele — pior que a aba, melhor que nada acontecer.
 */
export async function abrirNumaAba(
  buscar: () => Promise<Blob>,
  nomeParaBaixar: string,
): Promise<void> {
  const aba = window.open('', '_blank');

  let url: string;
  try {
    url = URL.createObjectURL(await buscar());
  } catch (e) {
    aba?.close();
    throw e;
  }

  if (aba && !aba.closed) {
    // O conteúdo é nosso, mas a aba não precisa de referência de volta.
    aba.opener = null;
    aba.location.replace(url);
  } else {
    const link = document.createElement('a');
    link.href = url;
    link.download = nomeParaBaixar;
    link.click();
  }

  // O endereço temporário segura o arquivo na memória enquanto existir.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Abre o Blob de erro para achar a mensagem que a API escreveu lá dentro.
 *
 * Pedindo um arquivo, o corpo do erro também vem como arquivo: sem isto a tela
 * mostraria "Request failed with status code 400" no lugar do motivo.
 */
export async function motivoDoErroEmArquivo(erro: unknown): Promise<string> {
  const corpo = (erro as { response?: { data?: unknown } })?.response?.data;
  if (corpo instanceof Blob) {
    try {
      const json = JSON.parse(await corpo.text()) as { message?: string };
      if (json.message) return json.message;
    } catch {
      // Não era JSON: cai na mensagem genérica abaixo.
    }
  }
  return mensagemErro(erro);
}
