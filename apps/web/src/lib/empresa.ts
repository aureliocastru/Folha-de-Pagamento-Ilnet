/**
 * Os dados da casa que as telas mostram.
 *
 * Cópia do `EMPRESA_DO_PAPEL` do servidor (`apps/api/src/apr/modelo-ilnet.ts`),
 * e não uma busca na API: é o dado mais estável que existe neste sistema — o
 * CNPJ de uma empresa não muda —, e uma requisição para descobri-lo faria a
 * tela abrir com o campo em branco enquanto ela volta.
 */
export const EMPRESA = {
  nome: 'M A CASTRO SERVIÇOS DE COMUNICAÇÃO MULTIMÍDIA LTDA',

  /**
   * Sem máscara, e é de propósito.
   *
   * Este número existe aqui para ser copiado e colado no portal da
   * concessionária, não para ser lido: o campo de lá formata sozinho enquanto
   * se digita, e o que se cola nele tem de ser só o número. Com máscara ele
   * ficaria mais bonito na tela e daria trabalho no único lugar onde é usado.
   */
  cnpj: '86876109000102',
};
