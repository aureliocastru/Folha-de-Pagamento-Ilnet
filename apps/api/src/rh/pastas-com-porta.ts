/**
 * As pastas da estante que têm porta própria no menu do RH.
 *
 * Empresa, Licitações e Notas Fiscais são pastas de verdade — moram no primeiro
 * nível como qualquer outra —, mas quem quer entrar nelas clica no menu da
 * esquerda, não na estante. Aparecer nos dois lugares é oferecer duas portas
 * para a mesma sala: a estante fica com quatro cartões dos quais três são
 * atalhos repetidos, e o único que não é (a gaveta dos funcionários) some no
 * meio deles.
 *
 * Os nomes vivem aqui, e não em cada serviço, porque quem lista a estante
 * precisa deles e importá-los de lá fecharia um ciclo — `licitacoes.service`
 * já importa de `documentos.service`.
 */
export const PASTA_DAS_LICITACOES = 'Licitações';
export const PASTA_DAS_NOTAS = 'Notas Fiscais';

/** Os nomes que o menu já abre, para a estante não repeti-los. */
export const PASTAS_COM_PORTA_PROPRIA = [
  PASTA_DAS_LICITACOES,
  PASTA_DAS_NOTAS,
] as const;

/** true quando esta pasta de primeiro nível já tem um item no menu do RH. */
export function temPortaPropria(pasta: {
  nome: string;
  daEmpresa: boolean;
  paiId: string | null;
}): boolean {
  if (pasta.paiId) return false;
  if (pasta.daEmpresa) return true;
  return PASTAS_COM_PORTA_PROPRIA.some(
    (nome) => nome.localeCompare(pasta.nome, 'pt-BR', { sensitivity: 'base' }) === 0,
  );
}
