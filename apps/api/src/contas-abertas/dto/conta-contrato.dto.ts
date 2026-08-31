import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
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
  ValidateNested,
} from 'class-validator';

/**
 * Uma unidade consumidora: o endereço e o número da conta contrato dele.
 *
 * O que se cadastra é o que não muda de um mês para o outro. O valor da fatura
 * não está aqui de propósito — ele só se sabe quando a conta chega, e é
 * digitado na hora de gerar.
 */
export class CriarContaContratoDto {
  /** Como a casa chama o endereço: "Lago Verde", "Garagem", "Loja". */
  @IsString() @MinLength(2) @MaxLength(120) apelido!: string;

  /** O número na distribuidora. Ponto e traço podem vir: só os dígitos ficam. */
  @IsString() @MinLength(4) @MaxLength(40) numero!: string;

  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  idFornecedorIxc!: number;

  @IsString() @MinLength(2) @MaxLength(200) fornecedorNome!: string;

  /** Dia do mês em que a fatura costuma chegar. */
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  @Max(31)
  diaDeChegada!: number;

  /** Dia do mês em que ela costuma vencer. */
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  @Max(31)
  diaDeVencimento!: number;

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

  @IsOptional() @IsString() @MaxLength(500) observacao?: string;
}

/** O que dá para mudar num cadastro que já existe. */
export class AtualizarContaContratoDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) apelido?: string;

  @IsOptional() @IsString() @MinLength(4) @MaxLength(40) numero?: string;

  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  idFornecedorIxc?: number;

  @IsOptional() @IsString() @MinLength(2) @MaxLength(200) fornecedorNome?: string;

  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  @Max(31)
  diaDeChegada?: number;

  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  @Max(31)
  diaDeVencimento?: number;

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

  @IsOptional() @IsString() @MaxLength(500) observacao?: string;

  @IsOptional() @IsBoolean() ativa?: boolean;
}

/** Uma fatura que chegou: de que endereço é, e quanto veio nela. */
export class LancamentoDeContratoDto {
  @IsUUID() id!: string;

  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsNumber()
  @Min(0.01)
  valor!: number;

  /** Vencimento desta fatura (AAAA-MM-DD). Vazio = o dia de sempre do cadastro. */
  @IsOptional() @IsISO8601() dataVencimento?: string;

  /** Linha digitável, quando a fatura vem com código de barras. */
  @IsOptional() @IsString() @MaxLength(60) codigoBarras?: string;

  /** Substitui a observação montada ("Energia Garagem agosto/2026"). */
  @IsOptional() @IsString() @MaxLength(500) observacao?: string;
}

/**
 * Lançar as faturas do mês: uma, algumas ou todas.
 *
 * O teto de 100 é folgado de propósito — são onze endereços hoje, e o limite
 * está aí só para uma tela nova não mandar o cadastro inteiro por engano.
 */
export class GerarContasContratoDto {
  /** O mês das faturas (AAAA-MM). */
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, {
    message: 'A competência precisa ser um mês no formato AAAA-MM.',
  })
  competencia!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => LancamentoDeContratoDto)
  lancamentos!: LancamentoDeContratoDto[];
}
