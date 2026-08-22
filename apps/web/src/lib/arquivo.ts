import { api, mensagemErro } from './api';

/**
 * Abre um arquivo que só sai com login.
 *
 * Não dá para apontar um `<a href>` para a rota: o endereço pede token, e o
 * navegador não o manda numa navegação comum — ele vive no localStorage e quem
 * o envia é o cliente HTTP daqui. O link levava a um 401 em tela branca.
 *
 * Então o arquivo é buscado com o token, vira um endereço temporário na memória
 * do navegador, e é esse que se abre. Bloqueador de pop-up ativo? Em vez de não
 * acontecer nada, ele desce como download: ver ou salvar, mas nunca clicar e
 * ficar no vazio.
 */
export async function abrirArquivo(
  caminho: string,
  nomeParaBaixar: string,
  tipo = 'application/pdf',
): Promise<void> {
  let endereco: string;
  try {
    const res = await api.get(caminho, { responseType: 'blob' });
    endereco = URL.createObjectURL(new Blob([res.data as BlobPart], { type: tipo }));
  } catch (erro) {
    throw new Error(await motivoDoErroEmArquivo(erro));
  }

  const aba = window.open(endereco, '_blank');
  if (!aba) {
    const link = document.createElement('a');
    link.href = endereco;
    link.download = nomeParaBaixar;
    link.click();
  }

  // O endereço temporário segura o arquivo na memória enquanto existir.
  setTimeout(() => URL.revokeObjectURL(endereco), 60_000);
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
