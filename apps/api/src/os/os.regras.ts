/**
 * As regras do que o técnico pode anotar numa OS — sem banco e sem IXC, para
 * poderem ser provadas uma a uma. O serviço junta o que elas precisam (a peça
 * lida do IXC, o saldo da van, o que já está anotado) e pergunta aqui.
 *
 * Cada regra devolve o motivo da recusa, escrito para o técnico ler no
 * celular, ou null quando pode. Nada aqui lança exceção: quem decide se a
 * recusa vira erro na tela ou aviso na lista é quem chamou.
 */

import type { ComodatoDoContrato } from './os-ixc';

/** A peça como `TransferenciasService.acharPeca` a devolve — só o que se confere. */
export interface PecaLida {
  patrimonioId: number;
  descricao: string;
  almoxId: number;
  almoxarifado: string;
  situacao: string;
  podeMover: boolean;
  impedimento: string | null;
}

/** Um item que já está anotado em alguma OS. */
export interface ItemJaAnotado {
  tipo: 'INSTALADO' | 'RETIRADO' | 'MATERIAL' | 'DIVERGENCIA';
  situacao: 'PENDENTE' | 'GRAVANDO' | 'GRAVADO' | 'FALHOU' | 'CONFERIR';
  osIxcId: number;
  produtoId: number | null;
  patrimonioId: number | null;
  comodatoIxcId: number | null;
  quantidade: number;
  /** RETIRADO: já chegou na base. */
  recebido?: boolean;
  cliente?: string | null;
  /** "AAAA-MM-DD". */
  dia?: string | null;
}

/**
 * Pode instalar esta peça, saindo do almoxarifado deste técnico?
 *
 * Na ordem em que a pergunta aparece na rua:
 *
 * 1. **A peça está com ele?** Aparelho que o IXC diz estar noutro almoxarifado
 *    não sai do dele — o comodato gravaria de onde a peça não está, e o saldo
 *    dos dois ficaria errado. O conserto é a transferência para a van dele.
 * 2. **Está na prateleira?** Vendida, em comodato, presa numa transferência:
 *    o IXC recusaria, e a razão que ele dá é pior que a daqui.
 * 3. **É um aparelho recolhido que não passou pela base?** Voltou de um
 *    cliente e está na van, mas ninguém conferiu se funciona e se foi
 *    resetado — instalar noutro cliente é levar o defeito junto.
 * 4. **Já está anotada?** Nesta OS ou noutra que ainda não terminou de ir.
 */
export function motivoParaNaoInstalar(
  peca: PecaLida,
  almoxDoTecnico: { id: number; nome: string },
  anotados: ItemJaAnotado[],
): string | null {
  if (peca.almoxId !== almoxDoTecnico.id) {
    return peca.almoxId
      ? `Este aparelho está em "${peca.almoxarifado}" no IXC, e não no seu almoxarifado ` +
          `("${almoxDoTecnico.nome}"). Peça a transferência para o seu antes de instalar.`
      : 'Este aparelho não está em almoxarifado nenhum no IXC. Confira com a base.';
  }
  if (!peca.podeMover) {
    return `Não dá para instalar: ${peca.impedimento ?? `a peça está ${peca.situacao}`}.`;
  }

  const recolhido = anotados.find(
    (i) =>
      i.tipo === 'RETIRADO' &&
      i.patrimonioId === peca.patrimonioId &&
      i.situacao === 'GRAVADO' &&
      !i.recebido,
  );
  if (recolhido) {
    return (
      'Este aparelho foi retirado de um cliente' +
      (recolhido.cliente ? ` (${recolhido.cliente})` : '') +
      ` na OS ${recolhido.osIxcId}` +
      (recolhido.dia ? `, em ${diaNaTela(recolhido.dia)}` : '') +
      ', e ainda não passou pela base. Entregue na base para conferir antes de instalar de novo.'
    );
  }

  const instalado = anotados.find(
    (i) =>
      i.tipo === 'INSTALADO' &&
      i.patrimonioId === peca.patrimonioId &&
      i.situacao !== 'GRAVADO',
  );
  if (instalado) {
    return `Este aparelho já está anotado para instalar na OS ${instalado.osIxcId}.`;
  }
  return null;
}

/**
 * O produto da peça é aparelho de cliente? No IXC a ferramenta da van (escada,
 * caneta de limpeza, carrinho de drop) é patrimônio igual à ONU, e no mesmo
 * subgrupo — visto na base em 24/09/2026. Quem separa uma coisa da outra é a
 * lista de aparelhos que a base monta; sem ela, não se instala nada.
 */
export function motivoForaDosAparelhos(
  produtoId: number,
  descricao: string,
  aparelhos: Array<{ produtoId: number; ativo: boolean }>,
): string | null {
  const ativos = aparelhos.filter((a) => a.ativo);
  if (ativos.length === 0) {
    return (
      'A base ainda não montou a lista de aparelhos de OS (os modelos de ONU e roteador). ' +
      'Sem ela não dá para saber o que é aparelho e o que é ferramenta.'
    );
  }
  if (!ativos.some((a) => a.produtoId === produtoId)) {
    return (
      `"${descricao}" não está na lista de aparelhos de cliente — é ferramenta? Se é ` +
      'aparelho de cliente, peça à base para incluir o modelo.'
    );
  }
  return null;
}

/**
 * Pode anotar a retirada desta linha de comodato? Ela tem de estar no contrato
 * da OS e emprestada ("E") — é só isso que a baixa do IXC aceita —, e não
 * pode estar anotada duas vezes.
 */
export function motivoParaNaoRetirar(
  comodato: ComodatoDoContrato | undefined,
  anotados: ItemJaAnotado[],
): string | null {
  if (!comodato) {
    return (
      'Este aparelho não está em comodato no contrato desta OS no IXC. Se ele está com o ' +
      'cliente mesmo assim, anote como "não está na lista" — a base confere.'
    );
  }
  if (comodato.status !== 'E') {
    return 'Este comodato já foi baixado no IXC.';
  }
  const ja = anotados.find(
    (i) => i.tipo === 'RETIRADO' && i.comodatoIxcId === comodato.comodatoId,
  );
  if (ja) return `A retirada deste aparelho já está anotada na OS ${ja.osIxcId}.`;
  return null;
}

/** O material do catálogo, no que a conferência usa. */
export interface MaterialDoCatalogo {
  produtoId: number;
  descricao: string;
  unidade: string | null;
  ativo: boolean;
  maximoPorOs: number | null;
}

/**
 * Pode anotar este material? Três perguntas:
 *
 *  - **está no catálogo?** A lista curta é o que o técnico escolhe; material
 *    fora dela é pedido à base, que o inclui (e decide o teto);
 *  - **tem na van?** O que já está anotado e ainda não foi ao IXC conta como
 *    saído — senão dois lançamentos seguidos passariam cada um pelo saldo
 *    inteiro, e o segundo deixaria a van negativa;
 *  - **passa do teto por OS?** Passar pode (a rua tem surpresa), mas com o
 *    porquê escrito: é essa frase que o relatório do mês mostra ao lado.
 */
export function motivoParaNaoGastar(dados: {
  material: MaterialDoCatalogo | undefined;
  quantidade: number;
  /** O saldo do produto no almoxarifado do técnico, lido agora do IXC. */
  saldo: number;
  /** Deste produto, o que está anotado nesta OS e noutras e ainda não foi ao IXC. */
  pendentes: number;
  /** Deste produto, o que já está nesta OS (gravado ou não). */
  jaNestaOs: number;
  observacao?: string | null;
}): string | null {
  const { material, quantidade } = dados;
  if (!material || !material.ativo) {
    return 'Este produto não está na lista de materiais de OS. Peça à base para incluir.';
  }
  if (!(quantidade > 0)) return 'A quantidade tem de ser maior que zero.';
  if (quantidade > 100_000) return 'Quantidade grande demais — confira o número.';

  const unidade = material.unidade ? ` ${material.unidade}` : '';
  const livre = arredondar(dados.saldo - dados.pendentes);
  if (quantidade > livre + 1e-9) {
    return (
      `Você tem ${formatar(Math.max(0, livre))}${unidade} de "${material.descricao}" no seu ` +
      'almoxarifado no IXC' +
      (dados.pendentes > 0 ? ` (já tirando ${formatar(dados.pendentes)} anotados e não enviados)` : '') +
      `, e não ${formatar(quantidade)}. Se tem na van, falta a transferência para o seu.`
    );
  }

  const teto = material.maximoPorOs;
  const total = arredondar(dados.jaNestaOs + quantidade);
  if (teto !== null && total > teto + 1e-9 && (dados.observacao ?? '').trim().length < 5) {
    return (
      `Numa OS o normal é até ${formatar(teto)}${unidade} de "${material.descricao}", e aqui ` +
      `ficariam ${formatar(total)}. Escreva o porquê na observação.`
    );
  }
  return null;
}

/**
 * A ordem em que os itens vão ao IXC: primeiro o aparelho novo, depois o
 * retirado, por último o material.
 *
 * O instalado vai antes porque, se o IXC o recusar, a troca continua sendo
 * verdade na rua — e é melhor a base ver "instalação recusada, retirada
 * gravada" do que o contrário, em que o contrato ficaria sem aparelho nenhum
 * no IXC enquanto o cliente navega com um.
 */
const ORDEM: Record<ItemJaAnotado['tipo'], number> = {
  INSTALADO: 0,
  RETIRADO: 1,
  MATERIAL: 2,
  DIVERGENCIA: 3,
};

export function naOrdemDeGravar<T extends { tipo: ItemJaAnotado['tipo']; createdAt?: Date }>(
  itens: T[],
): T[] {
  return [...itens].sort(
    (a, b) =>
      ORDEM[a.tipo] - ORDEM[b.tipo] ||
      (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0),
  );
}

function arredondar(n: number): number {
  return Math.round(n * 100_000) / 100_000;
}

function formatar(n: number): string {
  return arredondar(n).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
}

function diaNaTela(dia: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dia);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : dia;
}
