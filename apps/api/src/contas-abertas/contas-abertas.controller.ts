import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { ContasAbertasService } from './contas-abertas.service';
import { ParcelasService } from './parcelas.service';

/**
 * As contas a pagar da empresa, direto do IXC: o que está em aberto e o que já
 * foi pago no mês.
 *
 * A leitura é a mesma tabela que a folha alimenta — salário, diária e avulso
 * viram `fn_apagar` como qualquer despesa —, então o que sai daqui é todo o
 * dinheiro que sai da empresa, e não só o que foi lançado à mão.
 */
@Controller('contas-abertas')
export class ContasAbertasController {
  constructor(
    private readonly service: ContasAbertasService,
    private readonly parcelas: ParcelasService,
  ) {}

  @Get()
  listar() {
    return this.service.listar();
  }

  /**
   * O plano de contas do IXC — o código e o nome de cada conta contábil, para
   * as telas de pagamento poderem mostrar "Serviços de terceiros" em vez de
   * "324", e deixar escolher outra.
   */
  @Get('plano-de-contas')
  planoDeContas() {
    return this.service.planoDeContas();
  }

  /** As contas de onde o dinheiro sai — banco e caixa —, como o IXC as tem. */
  @Get('contas-pagamento')
  contasDePagamento() {
    return this.service.contasDePagamento();
  }

  /** Quanto já saiu no mês pelo contas a pagar do IXC. */
  @Get('pagas-no-mes')
  pagasNoMes(@Query('mes') mes?: string) {
    return this.service.pagasNoMes(
      /^\d{4}-\d{2}$/.test(mes ?? '') ? mes : undefined,
    );
  }

  /**
   * De que sequência de parcelas cada título faz parte — quantas já foram
   * pagas e quantas faltam.
   *
   * Vem por fornecedor porque é assim que o IXC deixa achar as parcelas de uma
   * compra: elas são títulos soltos, e o que as junta é serem do mesmo
   * fornecedor pelo mesmo valor. Ver `ParcelasService`.
   */
  @Get('parcelas')
  parcelasDosTitulos(@Query('fornecedores') fornecedores?: string) {
    return this.parcelas.doFornecedores(lerIds(fornecedores));
  }

  /**
   * Os campos crus do título no IXC. É o que responde "por que esta conta
   * aparece aqui?" sem depender de adivinhar o nome de coluna.
   */
  @Get(':idFnApagar/bruto')
  bruto(@Param('idFnApagar', ParseIntPipe) idFnApagar: number) {
    return this.service.registroBruto(idFnApagar);
  }
}

/**
 * "12,45,78" nos códigos que dá para usar.
 *
 * O que não for código inteiro cai fora em silêncio: a lista vem da tela, e um
 * fornecedor sem código no IXC é uma linha que simplesmente não tem parcela
 * para contar — não é erro que valha derrubar a consulta das outras.
 */
function lerIds(texto?: string): number[] {
  if (!texto) return [];
  return texto
    .split(',')
    .map((p) => Number(p.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
}
