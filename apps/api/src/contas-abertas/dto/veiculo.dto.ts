import { TipoVeiculo } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/** Vazio vira ausente — o campo em branco da tela não é um texto de zero letras. */
const semVazio = ({ value }: { value: unknown }) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

/** Um veículo da frota: como a casa o chama, e o que o identifica. */
export class CriarVeiculoDto {
  /** "Moto do Anderson", "Hilux", "Trator". */
  @IsString() @MinLength(2) @MaxLength(80) apelido!: string;

  @IsOptional() @IsEnum(TipoVeiculo) tipo?: TipoVeiculo;

  @IsOptional() @Transform(semVazio) @IsString() @MaxLength(12) placa?: string;

  /** Marca e modelo: "Honda CG 160". */
  @IsOptional() @Transform(semVazio) @IsString() @MaxLength(80) modelo?: string;

  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsInt()
  @Min(1950)
  @Max(2100)
  ano?: number;

  @IsOptional() @Transform(semVazio) @IsString() @MaxLength(500) observacao?: string;

  /** O funcionário que anda com ele e o abastece pelo portal. */
  @IsOptional() @Transform(semVazio) @IsUUID() responsavelId?: string;
}

/** O que muda num veículo que já existe. `ativo: false` o desliga. */
export class AtualizarVeiculoDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(80) apelido?: string;

  @IsOptional() @IsEnum(TipoVeiculo) tipo?: TipoVeiculo;

  /** `null` apaga; ausente não mexe. */
  @IsOptional() @IsString() @MaxLength(12) placa?: string | null;

  @IsOptional() @IsString() @MaxLength(80) modelo?: string | null;

  @IsOptional()
  @Transform(({ value }) => (value === '' ? null : value == null ? value : Number(value)))
  @IsInt()
  @Min(1950)
  @Max(2100)
  ano?: number | null;

  @IsOptional() @IsString() @MaxLength(500) observacao?: string | null;

  @IsOptional() @IsBoolean() ativo?: boolean;

  /** `null` tira o responsável; ausente não mexe. */
  @IsOptional() @IsUUID() responsavelId?: string | null;
}

/** O portal pede os veículos do CPF. */
export class VeiculosDoCpfDto {
  @IsString() @MaxLength(20) cpf!: string;
}

/** O abastecimento lançado pelo portal. */
export class LancarAbastecimentoDto {
  @IsString() @MaxLength(20) cpf!: string;

  @IsUUID() veiculoId!: string;

  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsNumber()
  @Min(0.01)
  valor!: number;

  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsInt()
  @Min(0)
  km!: number;

  /** A foto da nota, em data URL. O teto de tamanho de verdade é o do service. */
  @IsString() @MaxLength(5_000_000) foto!: string;
}
