import { Combustivel, TipoVeiculo } from '@prisma/client';
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

  /** O que ele põe no tanque — e, no galão, o que ele carrega. */
  @IsOptional() @IsEnum(Combustivel) combustivel?: Combustivel;

  /** Quanto cabe no galão, em litros. */
  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  @Max(100_000)
  capacidadeLitros?: number;

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

  @IsOptional() @IsEnum(Combustivel) combustivel?: Combustivel | null;

  @IsOptional()
  @Transform(({ value }) => (value === '' ? null : value == null ? value : Number(value)))
  @IsInt()
  @Min(1)
  @Max(100_000)
  capacidadeLitros?: number | null;

  @IsOptional() @IsBoolean() ativo?: boolean;

  /** `null` tira o responsável; ausente não mexe. */
  @IsOptional() @IsUUID() responsavelId?: string | null;
}

/** O portal pede os veículos do CPF. */
export class VeiculosDoCpfDto {
  @IsString() @MaxLength(20) cpf!: string;
}

/**
 * O abastecimento lançado pelo portal.
 *
 * Dois lançamentos com a mesma cara, e o galão é quem os separa: sem ele é a
 * ida ao posto, com nota e foto; com ele é o combustível saindo do galão para
 * uma máquina, que não tem nota nenhuma. Por isso quase tudo aqui é opcional —
 * quem cobra o que falta, sabendo de que caso se trata, é o service.
 */
export class LancarAbastecimentoDto {
  @IsString() @MaxLength(20) cpf!: string;

  @IsUUID() veiculoId!: string;

  /** O km do painel. Nos veículos que andam. */
  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsInt()
  @Min(0)
  km?: number;

  /** O horímetro, nas máquinas: as horas que ela já trabalhou. */
  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsInt()
  @Min(0)
  horimetro?: number;

  /** Quantos litros entraram. No galão é o estoque; no carro, o da bomba. */
  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsNumber()
  @Min(0)
  litros?: number;

  /** Preenchido, estes litros saem deste galão — e não do posto. */
  @IsOptional() @IsUUID() galaoId?: string;

  /** A foto da nota, em data URL. O teto de tamanho de verdade é o do service. */
  @IsOptional() @IsString() @MaxLength(5_000_000) foto?: string;
}

/** O mesmo lançamento, pela tela do colaborador: quem é a pessoa vem do login. */
export class LancarMeuAbastecimentoDto {
  @IsUUID() veiculoId!: string;

  /** O km do painel. Nos veículos que andam. */
  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsInt()
  @Min(0)
  km?: number;

  /** O horímetro, nas máquinas: as horas que ela já trabalhou. */
  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsInt()
  @Min(0)
  horimetro?: number;

  /** Quantos litros entraram. No galão é o estoque; no carro, o da bomba. */
  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsNumber()
  @Min(0)
  litros?: number;

  /** Preenchido, estes litros saem deste galão — e não do posto. */
  @IsOptional() @IsUUID() galaoId?: string;

  @IsOptional() @IsString() @MaxLength(5_000_000) foto?: string;
}

/** O abastecimento lançado por dentro, na ficha do veículo. O valor é opcional. */
export class LancarAbastecimentoNoSistemaDto {

  /** O km do painel. Nos veículos que andam. */
  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsInt()
  @Min(0)
  km?: number;

  /** O horímetro, nas máquinas: as horas que ela já trabalhou. */
  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsInt()
  @Min(0)
  horimetro?: number;

  /** Quantos litros entraram. No galão é o estoque; no carro, o da bomba. */
  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsNumber()
  @Min(0)
  litros?: number;

  /** Preenchido, estes litros saem deste galão — e não do posto. */
  @IsOptional() @IsUUID() galaoId?: string;

  @IsString() @MaxLength(5_000_000) foto!: string;

  /** O valor da nota, quando quem lança já a tem na mão. */
  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsNumber()
  @Min(0)
  valor?: number;
}

/** O valor que o administrador leu na nota. */
export class ConferirAbastecimentoDto {
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsNumber()
  @Min(0.01)
  valor!: number;
}
