import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const texto = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

const numeroOuNulo = ({ value }: { value: unknown }) => {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(String(value).replace(',', '.'));
  return Number.isFinite(n) ? n : value;
};

const inteiro = ({ value }: { value: unknown }) => {
  if (value === '' || value === null || value === undefined) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : value;
};

/** Um item anotado na OS pelo técnico. O que cada tipo pede está em `OsService.anotar`. */
export class AnotarItemDto {
  @IsIn(['INSTALADO', 'RETIRADO', 'MATERIAL', 'DIVERGENCIA'])
  tipo!: 'INSTALADO' | 'RETIRADO' | 'MATERIAL' | 'DIVERGENCIA';

  /** O MAC, a série ou o nº patrimonial — bipado ou digitado. */
  @IsOptional() @Transform(texto) @IsString() @MaxLength(80)
  codigo?: string;

  /** A peça escolhida na lista, conferida contra o código. */
  @IsOptional() @Transform(inteiro) @IsInt() @Min(1)
  patrimonioId?: number;

  /** A linha de comodato do contrato que foi retirada. */
  @IsOptional() @Transform(inteiro) @IsInt() @Min(1)
  comodatoId?: number;

  @IsOptional() @IsIn(['FUNCIONANDO', 'DEFEITO', 'NAO_TESTADO'])
  condicao?: 'FUNCIONANDO' | 'DEFEITO' | 'NAO_TESTADO';

  @IsOptional() @Transform(inteiro) @IsInt() @Min(1)
  produtoId?: number;

  @IsOptional() @Transform(numeroOuNulo) @IsNumber() @Min(0.001) @Max(100000)
  quantidade?: number;

  /** Na divergência: o que o aparelho é, quando não há código. */
  @IsOptional() @Transform(texto) @IsString() @MaxLength(200)
  descricao?: string;

  @IsOptional() @Transform(texto) @IsString() @MaxLength(500)
  observacao?: string;
}

/** A base diz o que viu no IXC sobre um item que ficou em conferência. */
export class ConferidoDto {
  @IsBoolean()
  gravou!: boolean;

  /** O número da linha no IXC, quando se achou. */
  @IsOptional() @Transform(inteiro) @IsInt() @Min(1)
  ixcId?: number;
}

export class ReceberRecolhidosDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @IsUUID('4', { each: true })
  itens!: string[];

  /** Para onde vão. Vazio = "Recolhidos (triagem)". */
  @IsOptional() @Transform(inteiro) @IsInt() @Min(1)
  destinoAlmoxId?: number;

  /** Só marca como recebido, sem transferência no IXC. */
  @IsOptional() @IsBoolean()
  semTransferir?: boolean;
}

export class FixarAlmoxDto {
  @Transform(inteiro) @IsInt() @Min(1)
  almoxId!: number;
}

export class IncluirMaterialDto {
  @Transform(inteiro) @IsInt() @Min(1)
  produtoId!: number;

  @IsOptional() @Transform(numeroOuNulo) @IsNumber() @Min(0.001)
  maximoPorOs?: number | null;

  /** Modelo de aparelho de cliente (ONU, roteador), e não material. */
  @IsOptional() @IsBoolean()
  aparelho?: boolean;
}

export class EditarMaterialDto {
  /** `null` tira o teto. */
  @IsOptional() @Transform(numeroOuNulo) @IsNumber() @Min(0.001)
  maximoPorOs?: number | null;

  @IsOptional() @IsBoolean()
  ativo?: boolean;

  @IsOptional() @Transform(inteiro) @IsInt() @Min(0)
  ordem?: number;
}
