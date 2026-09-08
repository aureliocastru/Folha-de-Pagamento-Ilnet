import { Transform } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MinLength,
} from 'class-validator';
import { FormaPagamento } from '@prisma/client';
import { TIPOS_CHAVE_PIX } from '../../ixc/ixc.financeiro';

/**
 * Um pagamento ao diarista: os dias trabalhados, a comissão das vendas que ele
 * fechou e o serviço por fora. Tudo somado sai num pagamento só — ver
 * `pagamento.calc`, compartilhado com o avulso.
 */
export class PagarDiariaDto {
  /** Dia trabalhado (AAAA-MM-DD). Vazio = hoje. */
  @IsOptional() @IsISO8601() data?: string;

  /** Zero quando o acerto é só de venda — aí não houve dia trabalhado. */
  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsNumber()
  @Min(0)
  quantidade?: number;

  /** Valor do dia. Vazio = o do cadastro do diarista. */
  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsNumber()
  @Min(0)
  valorDiaria?: number;

  /** Quantas vendas ele fechou no período que este pagamento cobre. */
  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsInt()
  @Min(0)
  vendas?: number;

  /** Quanto cada venda paga. Vazio = o do cadastro do diarista. */
  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsNumber()
  @Min(0)
  valorPorVenda?: number;

  /** Serviço feito por fora que rendeu um troco a mais no mesmo acerto. */
  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsNumber()
  @Min(0)
  valorExtra?: number;

  @IsOptional() @IsString() descricaoExtra?: string;

  /** O serviço feito — vira observação no IXC e histórico no caixa. */
  @IsString() @MinLength(3) descricao!: string;

  /** Vazio = a forma habitual do cadastro do diarista. */
  @IsOptional() @IsEnum(FormaPagamento) forma?: FormaPagamento;

  /**
   * Chave PIX a usar neste pagamento. Vazio = a do cadastro. O que vier aqui
   * fica gravado no cadastro, para não ter de digitar de novo.
   */
  @IsOptional() @IsString() chavePix?: string;

  /** Tipo da chave; também fica gravado no cadastro. */
  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : value))
  @IsIn([...TIPOS_CHAVE_PIX])
  tipoChavePix?: string;

  /**
   * A que se refere este acerto — a etiqueta desta casa, presa ao título.
   *
   * Vazio = a categoria do cadastro do diarista. A tela sempre manda a
   * escolhida, e o que vier aqui vira o padrão dele para a próxima vez, como já
   * acontece com a chave PIX. É o mesmo campo do pagamento avulso.
   */
  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : value))
  @IsUUID()
  categoriaId?: string;
}

export class QueryDiariasDto {
  @IsOptional() @IsString() diaristaId?: string;
}

/** Diárias a apagar de uma vez (a limpeza das que ficaram travadas). */
export class LoteDiariasDto {
  @IsArray() @IsString({ each: true }) ids!: string[];
}
