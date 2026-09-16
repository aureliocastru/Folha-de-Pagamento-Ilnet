import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * Uma despesa que se repete todo mês. O que se guarda é a regra; a conta a
 * pagar de cada mês nasce sozinha, poucos dias antes de vencer.
 */
export class CriarRecorrenteDto {
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  idFornecedorIxc!: number;

  @IsString() @MinLength(2) @MaxLength(200) fornecedorNome!: string;

  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsNumber()
  @Min(0.01)
  valor!: number;

  @IsString() @MinLength(3) @MaxLength(500) observacao!: string;

  /** Vencimento da próxima conta a ser gerada (AAAA-MM-DD). */
  @IsISO8601() proximoVencimento!: string;

  /**
   * Com quantos dias de antecedência a conta nasce. O teto de 45 evita que
   * alguém peça uma antecedência maior que o próprio ciclo mensal, o que faria
   * duas contas nascerem quase juntas.
   */
  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsInt()
  @Min(0)
  @Max(45)
  diasDeAntecedencia?: number;

  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  contaContabil?: number;

  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  contaPagamento?: number;

  @IsOptional() @IsString() @MaxLength(40) tipoPagamentoIxc?: string;

  @IsOptional() @IsUUID() categoriaId?: string | null;

  /** Vencimento em sabado, domingo ou feriado anda para o proximo dia util. */
  @IsOptional() @IsBoolean() apenasDiasUteis?: boolean;

  /** "Todo dia 14" — o dia a que o vencimento volta a cada mês. */
  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  @Max(31)
  diaDoVencimento?: number;

  /**
   * Preenchido, é consórcio. De 2 a 360 porque é o que a lista de contas lê
   * como parcela: fora disso o "(12/60)" não viraria "parcela 12/60" lá.
   */
  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsInt()
  @Min(2)
  @Max(360)
  totalParcelas?: number;

  /** Quantas já saíram: as pagas e as já lançadas no IXC. */
  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsInt()
  @Min(0)
  @Max(360)
  parcelasLancadas?: number;

  /** Quantas vencem juntas no mesmo mês. */
  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  @Max(12)
  parcelasPorMes?: number;

  /**
   * Quantas já tinham sido antecipadas, contadas do fim, quando o contrato
   * entrou aqui. Num consórcio de 50 com 5 antecipadas, a próxima do fim é a
   * 45. As daqui para a frente são lançadas uma a uma, pelo botão Antecipar.
   */
  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsInt()
  @Min(0)
  @Max(360)
  parcelasAntecipadas?: number;

  /** O veículo que este financiamento paga. */
  @IsOptional() @IsUUID() veiculoId?: string | null;
}

export class AtualizarRecorrenteDto {
  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsNumber()
  @Min(0.01)
  valor?: number;

  @IsOptional() @IsString() @MinLength(3) @MaxLength(500) observacao?: string;

  @IsOptional() @IsISO8601() proximoVencimento?: string;

  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsInt()
  @Min(0)
  @Max(45)
  diasDeAntecedencia?: number;

  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  contaContabil?: number;

  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  contaPagamento?: number;

  @IsOptional() @IsString() @MaxLength(40) tipoPagamentoIxc?: string;

  @IsOptional() @IsUUID() categoriaId?: string | null;

  /** Desligada, para de gerar. O que já gerou continua de pé. */
  @IsOptional() @IsBoolean() ativa?: boolean;

  /** Vencimento em sábado, domingo ou feriado anda para o próximo dia útil. */
  @IsOptional() @IsBoolean() apenasDiasUteis?: boolean;

  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  @Max(31)
  diaDoVencimento?: number;

  /** Preenchido numa recorrente comum, ela vira consórcio. */
  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsInt()
  @Min(2)
  @Max(360)
  totalParcelas?: number;

  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsInt()
  @Min(0)
  @Max(360)
  parcelasLancadas?: number;

  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  @Max(12)
  parcelasPorMes?: number;

  /**
   * Quantas já tinham sido antecipadas, contadas do fim, quando o contrato
   * entrou aqui. Num consórcio de 50 com 5 antecipadas, a próxima do fim é a
   * 45. As daqui para a frente são lançadas uma a uma, pelo botão Antecipar.
   */
  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsInt()
  @Min(0)
  @Max(360)
  parcelasAntecipadas?: number;

  /** O veículo que este financiamento paga. */
  @IsOptional() @IsUUID() veiculoId?: string | null;
}

/**
 * Uma parcela paga fora da ordem, registrada depois que a conta já nasceu no
 * IXC. O valor é o do boleto — com o desconto já dentro.
 */
export class AnteciparParcelaDto {
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  @Max(360)
  numero!: number;

  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsNumber()
  @Min(0.01)
  valor!: number;

  /** Quanto ela valeria no vencimento — a diferença é a economia. */
  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsNumber()
  @Min(0.01)
  valorDeTabela?: number;

  /** A conta a pagar que nasceu disto, nesta base e no IXC. */
  @IsOptional() @IsUUID() contaId?: string | null;

  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  idFnApagarIxc?: number | null;

  /** O dia em que foi antecipada. Sem ele, hoje. */
  @IsOptional() @IsISO8601() data?: string;
}
