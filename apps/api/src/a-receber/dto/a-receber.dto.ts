import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

const numero = ({ value }: { value: unknown }) =>
  value === '' || value == null ? undefined : Number(value);

/** Alguém que ficou devendo: quem e quanto. */
export class CriarAReceberDto {
  @IsString() @MinLength(2) @MaxLength(120) pessoa!: string;

  @Transform(numero) @IsNumber() @Min(0.01) valor!: number;

  @IsOptional() @IsString() @MaxLength(500) observacao?: string;
}

/** Corrigir o nome, o valor (pagou uma parte) ou a observação. */
export class EditarAReceberDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) pessoa?: string;

  @IsOptional() @Transform(numero) @IsNumber() @Min(0.01) valor?: number;

  /** `null` apaga a observação. */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(500)
  observacao?: string | null;
}

/** Pagou (ou desfaz o "pagou", quando foi engano). */
export class RecebidoDto {
  @IsBoolean() recebido!: boolean;
}
