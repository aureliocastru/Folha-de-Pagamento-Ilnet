import { Transform } from 'class-transformer';
import {
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

/** Vazio vira nulo: apagar o campo é tirar aquele intervalo. */
const inteiroOuNulo = ({ value }: { value: unknown }) => {
  if (value === '' || value === null) return null;
  if (value === undefined) return undefined;
  return Number(typeof value === 'string' ? value.replace(/\./g, '').replace(',', '.') : value);
};

/** "123.456,7" ou "123456.7": o km como se digita. */
const medidorDaTela = ({ value }: { value: unknown }) => {
  if (value === '' || value === null) return null;
  if (value === undefined) return undefined;
  if (typeof value !== 'string') return Number(value);
  const t = value.trim();
  // Com vírgula, o ponto é milhar; sem vírgula, o ponto é decimal (1261.9).
  return Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
};

/** Um item da manutenção: o que se troca, e de quanto em quanto. */
export class CriarItemDeManutencaoDto {
  @IsString() @MinLength(2) @MaxLength(80) nome!: string;

  /** Km (horas, na máquina) entre uma troca e outra. */
  @IsOptional()
  @Transform(inteiroOuNulo)
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(1)
  @Max(2_000_000)
  intervaloMedidor?: number | null;

  @IsOptional()
  @Transform(inteiroOuNulo)
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(1)
  @Max(240)
  intervaloMeses?: number | null;

  @IsOptional() @IsString() @MaxLength(300) observacao?: string;
}

export class AtualizarItemDeManutencaoDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(80) nome?: string;

  @IsOptional()
  @Transform(inteiroOuNulo)
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(1)
  @Max(2_000_000)
  intervaloMedidor?: number | null;

  @IsOptional()
  @Transform(inteiroOuNulo)
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(1)
  @Max(240)
  intervaloMeses?: number | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(300)
  observacao?: string | null;
}

/** Uma troca feita. Sem km, vale o de agora; sem data, hoje. */
export class RegistrarTrocaDto {
  @IsOptional()
  @Transform(medidorDaTela)
  @ValidateIf((_, v) => v !== null)
  @IsNumber()
  @Min(0)
  medidor?: number | null;

  @IsOptional() @IsISO8601() data?: string;

  @IsOptional() @IsString() @MaxLength(300) observacao?: string;
}
