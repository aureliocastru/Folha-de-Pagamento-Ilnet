import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MinLength,
} from 'class-validator';
import { FormaPagamento } from '@prisma/client';
import { TIPOS_CHAVE_PIX } from '../../ixc/ixc.financeiro';

export class CriarDiaristaDto {
  @IsString() @MinLength(2) nome!: string;

  /** Como a pessoa é conhecida no dia a dia; também é buscável. */
  @IsOptional() @IsString() nomeFantasia?: string;

  @IsOptional() @IsString() cpfCnpj?: string;
  @IsOptional() @IsString() telefone?: string;
  @IsOptional() @IsString() banco?: string;
  @IsOptional() @IsString() agencia?: string;
  @IsOptional() @IsString() conta?: string;
  @IsOptional() @IsString() chavePix?: string;

  /** Tipo da chave PIX; vazio = deduzir pelo formato. */
  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? null : value))
  @IsIn([...TIPOS_CHAVE_PIX])
  tipoChavePix?: string | null;

  /** Valor combinado por dia; só sugere o valor na hora de pagar. */
  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? null : Number(value)))
  @IsNumber()
  @Min(0)
  valorDiaria?: number | null;

  /** Quanto ganha por venda — diarista também é vendedor externo. */
  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? null : Number(value)))
  @IsNumber()
  @Min(0)
  valorPorVenda?: number | null;

  @IsOptional() @IsEnum(FormaPagamento) formaPagamento?: FormaPagamento;

  /**
   * Categoria em que os acertos dessa pessoa costumam entrar. Vazio limpa o
   * padrão — cadastro que não tem um faz a tela perguntar, que é o certo.
   */
  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? null : value))
  @IsUUID()
  categoriaId?: string | null;

  @IsOptional() @IsString() observacoes?: string;

  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  cidadeIxc?: number;
}

export class UpdateDiaristaDto extends CriarDiaristaDto {
  @IsOptional() @IsString() @MinLength(2) declare nome: string;
  @IsOptional() @IsBoolean() ativo?: boolean;
}
