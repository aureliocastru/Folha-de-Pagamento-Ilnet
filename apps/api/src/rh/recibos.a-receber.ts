/**
 * O líquido do recibo vira o "A receber na folha" — de quem, e se muda.
 *
 * Até 04/11/2026 o valor só trocava como efeito colateral de guardar o recibo
 * na pasta: pasta sem ligação com o cadastro, recibo já guardado no mês ou
 * linha desmarcada, e o valor ficava o velho sem ninguém saber. O pedido foi o
 * contrário: "jogou o recibo, atualizou". Por isso o dono aqui é achado no
 * cadastro da folha pelo CPF impresso no recibo, e a pasta é só o plano B, para
 * o cadastro que veio do IXC sem CPF.
 */

/** Um funcionário do cadastro, com o que serve para casar com um recibo. */
export interface FuncionarioDaFolha {
  id: string;
  nome: string;
  /** Só os dígitos; vazio quando o cadastro não tem. */
  cpf: string;
  ativo: boolean;
  /**
   * Marcado como funcionário (o `isentoIcms` do sync). O cadastro guarda
   * também fornecedor que não é gente da casa, e só quem tem a marca entra na
   * folha.
   */
  naFolha: boolean;
  carteiraAssinada: boolean;
  /** O "A receber na folha" de agora. */
  aReceber: number | null;
}

/**
 * Quem, no cadastro da folha, é o dono deste recibo.
 *
 * Pelo CPF, que a contabilidade e o IXC escrevem igual. O mesmo CPF em dois
 * cadastros (quem saiu e voltou, ou o fornecedor repetido no IXC) fica com o
 * que está na folha; persistindo o empate, com o da pasta escolhida na tela,
 * senão com o único ativo — sem isso não há como saber, e nenhum é atualizado.
 *
 * A pasta só decide quando o CPF não achou ninguém, e só para um cadastro sem
 * CPF: cadastro com outro CPF é outra pessoa, ainda que com o mesmo nome.
 */
export function donoNaFolha(
  cpf: string,
  funcionarioDaPasta: string | null,
  funcionarios: FuncionarioDaFolha[],
): FuncionarioDaFolha | null {
  let porCpf = cpf ? funcionarios.filter((f) => f.cpf === cpf) : [];
  if (porCpf.some((f) => f.naFolha)) porCpf = porCpf.filter((f) => f.naFolha);
  if (porCpf.length === 1) return porCpf[0];
  if (porCpf.length > 1) {
    const daPasta = porCpf.find((f) => f.id === funcionarioDaPasta);
    if (daPasta) return daPasta;
    const ativos = porCpf.filter((f) => f.ativo);
    return ativos.length === 1 ? ativos[0] : null;
  }
  const daPasta = funcionarios.find((f) => f.id === funcionarioDaPasta);
  return daPasta && !daPasta.cpf ? daPasta : null;
}

/**
 * O que pede atenção num recibo:
 * - `sem-liquido`, `sem-cadastro` e `fora-da-folha`: o valor fica o velho;
 * - `sem-carteira`: o valor troca, mas a folha de quem não tem carteira
 *   assinada paga pelo salário base e não o usa. Fica gravado mesmo assim:
 *   marcar a carteira depois já o encontra.
 */
export type MotivoDoAReceber =
  | 'sem-liquido'
  | 'sem-cadastro'
  | 'fora-da-folha'
  | 'sem-carteira';

const AVISO: Record<MotivoDoAReceber, string> = {
  'sem-liquido': 'o recibo não trouxe o líquido',
  'sem-cadastro': 'ninguém na folha com este CPF',
  'fora-da-folha': 'o cadastro deste CPF não está marcado como funcionário',
  'sem-carteira': 'sem carteira assinada no cadastro: a folha paga pelo salário base',
};

/** Os motivos em que o valor fica o velho. */
export function naoAtualiza(motivo: MotivoDoAReceber | null): boolean {
  return motivo !== null && motivo !== 'sem-carteira';
}

/** O que acontece com o "A receber na folha" do dono de um recibo. */
export interface AReceberDoRecibo {
  funcionarioId: string | null;
  /** O valor de agora no cadastro. */
  antes: number | null;
  /** O valor que fica. Null = não muda. */
  depois: number | null;
  /** Null = nada a dizer: troca normal, já igual, ou mês velho (a tela avisa
      do mês uma vez só). */
  motivo: MotivoDoAReceber | null;
  aviso: string | null;
}

export function aReceberDoRecibo(
  liquido: number | null,
  dono: FuncionarioDaFolha | null,
  mesMaisNovo: boolean,
): AReceberDoRecibo {
  const antes = dono?.aReceber ?? null;
  const resultado = (depois: number | null, motivo: MotivoDoAReceber | null) => ({
    funcionarioId: dono?.id ?? null,
    antes,
    depois,
    motivo,
    aviso: motivo ? AVISO[motivo] : null,
  });

  if (!mesMaisNovo) return resultado(null, null);
  if (liquido === null || liquido <= 0) return resultado(null, 'sem-liquido');
  if (!dono) return resultado(null, 'sem-cadastro');
  if (!dono.naFolha) return resultado(null, 'fora-da-folha');

  const muda = antes === null || Math.round(antes * 100) !== Math.round(liquido * 100);
  return resultado(muda ? liquido : null, dono.carteiraAssinada ? null : 'sem-carteira');
}
