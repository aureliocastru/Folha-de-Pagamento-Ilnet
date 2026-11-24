import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { ContasAbertasService } from './contas-abertas.service';
import { AcertarVencimentosDto, ExcluirLoteDto } from './dto/despesa.dto';
import { PagamentosService } from './pagamentos.service';
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
    private readonly pagamentos: PagamentosService,
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

  /** Quanto saiu em cada mês do ano — as colunas do dashboard. */
  @Get('pagas-no-ano')
  pagasNoAno(@Query('ano') ano?: string) {
    return this.service.pagasNoAno(
      /^\d{4}$/.test(ano ?? '') ? Number(ano) : undefined,
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
   * Tira títulos da lista de contas em aberto. No IXC nada muda — a conta
   * continua devida e somada nos totais.
   */
  @Post('ocultar-lote')
  @HttpCode(200)
  async ocultar(@Body() dto: ExcluirLoteDto, @Req() req: Request) {
    const ocultadas = await this.service.ocultar(
      dto.idsFnApagar,
      (req.user as { id?: string } | undefined)?.id,
    );
    return { ok: true, ocultadas };
  }

  /**
   * As contas cujo vencimento não é o que o código de barras diz, com o dia
   * certo de cada uma (já no dia útil). Só lê — é a prévia do acerto.
   */
  @Get('vencimentos-pelo-codigo')
  vencimentosPeloCodigo() {
    return this.service.vencimentosPeloCodigo();
  }

  /**
   * O que o Atualizar vai mexer, sem mexer: o vencimento pelo código de barras e
   * a conta de pagamento que passa a ser a do banco. É a prévia do POST abaixo.
   */
  @Get('acertos-pelo-codigo')
  acertosPeloCodigo() {
    return this.service.acertosPeloCodigo();
  }

  /**
   * Põe no IXC o que o código de pagamento de cada conta diz — o botão Atualizar
   * da lista chama isto:
   *  - o vencimento do código de barras, no dia útil;
   *  - a conta de pagamento do banco (ModoBank), onde há linha de boleto ou
   *    chave Pix preenchida.
   * Cada conta vai pela mesma edição da tela (reprova, muda, reaprova), uma vez
   * só mesmo quando precisa dos dois acertos.
   *
   * Para em ~20 s e diz quantas faltam: muitas de uma vez passariam do tempo
   * do proxy, e a tela chama de novo até zerar.
   */
  @Post('vencimentos-pelo-codigo')
  @HttpCode(200)
  async acertarVencimentos(@Body() dto: AcertarVencimentosDto) {
    const pular = new Set(dto.pular ?? []);
    const { vencimentos, contas } = await this.service.acertosPeloCodigo();
    const doVencimento = new Map(
      vencimentos.filter((a) => !pular.has(a.idFnApagar)).map((a) => [a.idFnApagar, a]),
    );
    const daConta = new Map(
      contas.filter((a) => !pular.has(a.idFnApagar)).map((a) => [a.idFnApagar, a]),
    );
    const ids = [...new Set([...doVencimento.keys(), ...daConta.keys()])];

    const feitos: typeof vencimentos = [];
    const contasFeitas: typeof contas = [];
    const falhas: Array<{ idFnApagar: number; fornecedor: string; para: string; erro: string }> = [];
    const limite = Date.now() + 20_000;
    for (const id of ids) {
      if (Date.now() > limite) break;
      const v = doVencimento.get(id);
      const c = daConta.get(id);
      try {
        await this.pagamentos.editar(id, {
          ...(v ? { dataVencimento: v.para } : {}),
          ...(c ? { contaPagamento: c.para } : {}),
        });
        if (v) feitos.push(v);
        if (c) contasFeitas.push(c);
      } catch (err) {
        falhas.push({
          idFnApagar: id,
          fornecedor: (v ?? c)?.fornecedor ?? '',
          para: v?.para ?? '',
          erro: err instanceof Error ? err.message : String(err),
        });
      }
    }
    const feitosIds = new Set([...feitos, ...contasFeitas].map((a) => a.idFnApagar));
    return {
      feitos,
      contas: contasFeitas,
      falhas,
      faltam: ids.length - feitosIds.size - falhas.length,
    };
  }

  /** Devolve à lista tudo o que foi ocultado. */
  @Post('mostrar-ocultas')
  @HttpCode(200)
  async mostrarOcultas() {
    const devolvidas = await this.service.mostrarOcultas();
    return { ok: true, devolvidas };
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
