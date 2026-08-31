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

/** Uma linha da lista colada: o nome do endereço e o número na distribuidora. */
export class NumeroParaDescobrirDto {
  @IsString() @MinLength(4) @MaxLength(40) numero!: string;

  @IsOptional() @IsString() @MaxLength(120) apelido?: string;
}

/**
 * Procurar no histórico do IXC o que já se sabe sobre estas contas contrato.
 *
 * Só lê. O que volta é uma proposta de cadastro — o dia em que cada endereço
 * vence, para quem se paga, quanto costuma custar — para alguém conferir.
 */
export class DescobrirContasContratoDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => NumeroParaDescobrirDto)
  numeros!: NumeroParaDescobrirDto[];
}

/** Um endereço a cadastrar, como a tela o mostrou depois da descoberta. */
export class ItemDaImportacaoDto {
  @IsString() @MinLength(2) @MaxLength(120) apelido!: string;

  @IsString() @MinLength(4) @MaxLength(40) numero!: string;

  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  @Max(31)
  diaDeChegada!: number;

  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  @Max(31)
  diaDeVencimento!: number;

  /** A média que o histórico mostrou, para a tela já saber estranhar valor. */
  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsNumber()
  @Min(0)
  valorDeReferencia?: number;
}

/**
 * Cadastrar de uma vez os endereços descobertos.
 *
 * O que é igual em todos — a distribuidora, a conta contábil, a conta de onde
 * se paga, a categoria — vem uma vez só, em `padroes`: são onze contas da
 * mesma companhia, e repetir isso linha a linha só criaria onze chances de
 * digitar diferente.
 */
export class ImportarContasContratoDto {
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  idFornecedorIxc!: number;

  @IsString() @MinLength(2) @MaxLength(200) fornecedorNome!: string;

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

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ItemDaImportacaoDto)
  itens!: ItemDaImportacaoDto[];
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

  /**
   * O código com que a fatura se paga: a linha digitável do boleto ou o copia
   * e cola do PIX. O serviço distingue os dois — o teto de 512 cabe o payload
   * inteiro de um QR Code.
   */
  @IsOptional() @IsString() @MaxLength(512) codigo?: string;

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
