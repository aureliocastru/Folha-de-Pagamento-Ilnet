import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const numero = ({ value }: { value: unknown }) =>
  value === '' || value == null ? undefined : Number(value);

const COMPETENCIA = /^\d{4}-(0[1-9]|1[0-2])$/;
const MENSAGEM_COMPETENCIA = 'A fatura precisa ser um mês no formato AAAA-MM.';

/** Um cartão de crédito da empresa: de que banco, e que dia a fatura vence. */
export class CriarCartaoDto {
  @IsString() @MinLength(2) @MaxLength(80) apelido!: string;

  /** Os quatro últimos dígitos. Vazio = não informado. */
  @IsOptional()
  @IsString()
  @Matches(/^(\d{4})?$/, { message: 'O final do cartão são os quatro últimos dígitos.' })
  final?: string | null;

  @Transform(numero) @IsInt() @Min(1) idFornecedorIxc!: number;

  @IsString() @MinLength(2) @MaxLength(200) fornecedorNome!: string;

  @Transform(numero) @IsInt() @Min(1) @Max(31) diaDeVencimento!: number;

  @IsOptional() @Transform(numero) @IsInt() @Min(1) contaContabil?: number;

  @IsOptional() @Transform(numero) @IsInt() @Min(1) contaPagamento?: number;

  @IsOptional() @IsString() @MaxLength(40) tipoPagamentoIxc?: string;

  @IsOptional() @IsUUID() categoriaId?: string | null;
}

export class AtualizarCartaoDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(80) apelido?: string;

  @IsOptional()
  @IsString()
  @Matches(/^(\d{4})?$/, { message: 'O final do cartão são os quatro últimos dígitos.' })
  final?: string | null;

  @IsOptional() @Transform(numero) @IsInt() @Min(1) idFornecedorIxc?: number;

  @IsOptional() @IsString() @MinLength(2) @MaxLength(200) fornecedorNome?: string;

  @IsOptional() @Transform(numero) @IsInt() @Min(1) @Max(31) diaDeVencimento?: number;

  @IsOptional() @Transform(numero) @IsInt() @Min(1) contaContabil?: number;

  @IsOptional() @Transform(numero) @IsInt() @Min(1) contaPagamento?: number;

  @IsOptional() @IsString() @MaxLength(40) tipoPagamentoIxc?: string;

  @IsOptional() @IsUUID() categoriaId?: string | null;

  /** Desligado some da tela. O que ele já gerou continua no IXC. */
  @IsOptional() @IsBoolean() ativo?: boolean;
}

/**
 * Uma linha da fatura. O valor pode ser negativo: é o estorno, que abate da
 * soma. Zero é recusado pelo serviço.
 */
export class CriarCompraDto {
  @IsString() @MinLength(1) @MaxLength(200) descricao!: string;

  @Transform(numero) @IsNumber() valor!: number;

  /** O valor digitado é o de cada parcela (como a fatura imprime) ou o total. */
  @IsOptional() @IsIn(['TOTAL', 'PARCELA']) valorDe?: 'TOTAL' | 'PARCELA';

  @Transform(numero) @IsInt() @Min(1) @Max(99) parcelas!: number;

  /** A parcela que cai na `primeiraFatura` — 1 para compra nova. */
  @IsOptional() @Transform(numero) @IsInt() @Min(1) @Max(99) parcelaInicial?: number;

  /** A fatura (AAAA-MM do vencimento) em que a compra aparece primeiro. */
  @Matches(COMPETENCIA, { message: MENSAGEM_COMPETENCIA })
  primeiraFatura!: string;

  /** Cobra todo mês, sem parcelas, até ser encerrada. */
  @IsOptional() @IsBoolean() assinatura?: boolean;

  /** Com o que se gastou nesta compra. */
  @IsOptional() @IsUUID() categoriaId?: string | null;
}

export class AtualizarCompraDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) descricao?: string;

  @IsOptional() @Transform(numero) @IsNumber() valor?: number;

  @IsOptional() @IsIn(['TOTAL', 'PARCELA']) valorDe?: 'TOTAL' | 'PARCELA';

  @IsOptional() @Transform(numero) @IsInt() @Min(1) @Max(99) parcelas?: number;

  @IsOptional() @Transform(numero) @IsInt() @Min(1) @Max(99) parcelaInicial?: number;

  @IsOptional()
  @Matches(COMPETENCIA, { message: MENSAGEM_COMPETENCIA })
  primeiraFatura?: string;

  /**
   * Na assinatura: a fatura a partir da qual o preço novo vale. As anteriores
   * continuam com o preço de antes.
   */
  @IsOptional()
  @Matches(COMPETENCIA, { message: MENSAGEM_COMPETENCIA })
  aPartirDe?: string;

  /** Trocar a categoria não mexe em valor: vale até em fatura já lançada. */
  @IsOptional() @IsUUID() categoriaId?: string | null;
}

/** Encerrar a assinatura: ela sai desta fatura e das seguintes. */
export class EncerrarAssinaturaDto {
  @Matches(COMPETENCIA, { message: MENSAGEM_COMPETENCIA })
  aPartirDe!: string;
}

/** A fatura do mês vira uma conta a pagar só, no valor da soma. */
export class GerarFaturaDto {
  @Matches(COMPETENCIA, { message: MENSAGEM_COMPETENCIA })
  competencia!: string;

  /** Vazio = o dia de vencimento do cadastro, naquele mês. */
  @IsOptional() @IsISO8601() dataVencimento?: string;

  /** A linha digitável do boleto da fatura, ou o copia e cola do PIX. */
  @IsOptional() @IsString() @MaxLength(512) codigo?: string;
}
