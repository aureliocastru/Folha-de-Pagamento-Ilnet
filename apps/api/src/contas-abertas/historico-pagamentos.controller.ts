import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { ConferirPagamentoDto, PeriodoPagamentosDto } from './dto/historico-pagamentos.dto';
import {
  HistoricoPagamentosService,
  type Periodo,
} from './historico-pagamentos.service';

/** Quantos dias o histórico mostra quando ninguém escolheu período. */
const JANELA_PADRAO_DIAS = 30;

/**
 * O histórico do que a empresa já pagou, direto do IXC.
 *
 * Só leitura, como a tela de contas em aberto: dar baixa, estornar e cancelar
 * continua sendo no IXC. Aqui é para conferir — se o pagamento saiu, quando,
 * por quanto e de qual caixa.
 */
@Controller('pagamentos-feitos')
export class HistoricoPagamentosController {
  constructor(private readonly service: HistoricoPagamentosService) {}

  @Get()
  listar(@Query() query: PeriodoPagamentosDto) {
    return this.service.listar(resolverPeriodo(query));
  }

  /**
   * "Já conferi": a ressalva deste pagamento foi olhada e está de pé.
   *
   * As ressalvas vão no corpo porque é o que a pessoa tinha à vista quando
   * disse isso — é esse texto que a marca guarda. Ressalva nova, aviso de
   * volta.
   */
  @Post(':idFnApagar/conferido')
  @HttpCode(200)
  conferir(
    @Param('idFnApagar', ParseIntPipe) idFnApagar: number,
    @Body() dto: ConferirPagamentoDto,
    @Req() req: Request,
  ) {
    const quem = (req.user as { nome?: string } | undefined)?.nome ?? 'Alguém';
    return this.service.conferir(idFnApagar, dto.ressalvas ?? [], quem);
  }

  /** Desfaz: a ressalva volta a pedir atenção. */
  @Delete(':idFnApagar/conferido')
  @HttpCode(200)
  async desconferir(@Param('idFnApagar', ParseIntPipe) idFnApagar: number) {
    await this.service.desconferir(idFnApagar);
    return { ok: true };
  }
}

/**
 * O período pedido, ou o padrão.
 *
 * Sem nada escolhido, mostra os últimos trinta dias: é a pergunta que traz
 * alguém a esta tela ("o pagamento de ontem saiu?") e atravessa a virada do mês,
 * que é justamente quando um pagamento do dia 31 parece ter desaparecido.
 */
function resolverPeriodo(query: PeriodoPagamentosDto): Periodo {
  const hoje = new Date();
  const ate = query.ate ? diaUtc(query.ate) : diaUtc(iso(hoje));
  const de = query.de
    ? diaUtc(query.de)
    : new Date(ate.getTime() - (JANELA_PADRAO_DIAS - 1) * 86_400_000);

  if (de.getTime() > ate.getTime()) {
    throw new BadRequestException(
      'O início do período é depois do fim. Confira as datas.',
    );
  }
  return { de, ate };
}

/** "2026-08-17" na meia-noite UTC, que é como o resto do módulo trata datas. */
function diaUtc(texto: string): Date {
  const [ano, mes, dia] = texto.split('-').map(Number);
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  if (Number.isNaN(data.getTime())) {
    throw new BadRequestException(`"${texto}" não é uma data válida.`);
  }
  return data;
}

function iso(data: Date): string {
  const m = String(data.getMonth() + 1).padStart(2, '0');
  const d = String(data.getDate()).padStart(2, '0');
  return `${data.getFullYear()}-${m}-${d}`;
}
