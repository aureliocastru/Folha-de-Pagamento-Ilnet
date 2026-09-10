import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

const COMPETENCIA = /^\d{4}-(0[1-9]|1[0-2])$/;

/** O CPF digitado na porta do portal, com ou sem ponto e traço. */
export class IdentificarDto {
  @IsString() @MaxLength(20) cpf!: string;
}

export class EntrarDto {
  @IsString() @MaxLength(20) cpf!: string;
  @IsString() @MaxLength(12) senha!: string;
}

/** A tela do funcionário: o CPF dele e, se quiser, outro mês. */
export class MinhaPontuacaoDto {
  @IsString() @MaxLength(20) cpf!: string;

  @IsOptional()
  @Matches(COMPETENCIA, { message: 'O mês precisa estar no formato AAAA-MM.' })
  competencia?: string;
}

export class LancarPontosDto {
  @IsUUID() funcionarioId!: string;

  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsInt()
  pontos!: number;

  @IsString() @MinLength(3) @MaxLength(300) motivo!: string;

  /** O dia do que aconteceu (AAAA-MM-DD). Vazio = hoje. */
  @IsOptional() @IsISO8601() data?: string;
}

export class CriarCoordenadorDto {
  @IsString() @MinLength(2) @MaxLength(120) nome!: string;
  @IsString() @MaxLength(20) cpf!: string;
  @Matches(/^\d{4,6}$/, { message: 'A senha é de 4 a 6 números.' }) senha!: string;
}

export class AtualizarCoordenadorDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) nome?: string;

  @IsOptional()
  @Matches(/^\d{4,6}$/, { message: 'A senha é de 4 a 6 números.' })
  senha?: string;

  @IsOptional() @IsBoolean() ativo?: boolean;
}
