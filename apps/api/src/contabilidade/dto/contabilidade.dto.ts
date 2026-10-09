import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PAPEIS } from '../configuracao.service';

const DIA = /^\d{4}-\d{2}-\d{2}$/;

export class AbrirPacoteDto {
  @Matches(DIA, { message: 'A data inicial precisa ser AAAA-MM-DD.' })
  de!: string;

  @Matches(DIA, { message: 'A data final precisa ser AAAA-MM-DD.' })
  ate!: string;
}

export class LerDeNovoDto {
  /** Vazio = tudo. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(20, { each: true })
  itens?: number[];
}

export class EnviarArquivoDto {
  @IsInt()
  @Min(1)
  @Max(20)
  item!: number;

  /** A vaga ("conta:14:ofx", "titulo:37225", "outros"). */
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  @Matches(/^[a-z0-9:_-]+$/i, { message: 'Vaga inválida.' })
  chave!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  nome!: string;

  /** O arquivo como data URL. */
  @IsString({ message: 'Escolha o arquivo.' })
  @Matches(/^data:[-\w.+]*\/?[-\w.+]*;base64,/, { message: 'O arquivo não chegou num formato que eu saiba ler.' })
  arquivo!: string;
}

export class MarcarDto {
  @IsInt()
  @Min(1)
  @Max(20)
  item!: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Matches(/^[a-z0-9:_-]*$/i, { message: 'Vaga inválida.' })
  chave?: string;

  @IsOptional()
  @IsBoolean()
  naoTeve?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  observacao?: string | null;

  /** O saldo contado de um caixa (item 11). Null apaga. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Valor inválido.' })
  @Min(-10_000_000)
  @Max(10_000_000)
  valor?: number | null;
}

export class EncerrarContratoDto {
  @Matches(DIA, { message: 'A data precisa ser AAAA-MM-DD.' })
  em!: string;
}

class FornecedorEscolhidoDto {
  @IsInt()
  @Min(1)
  id!: number;

  @IsString()
  @MaxLength(200)
  nome!: string;
}

export class SelecaoDto {
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  categorias!: string[];

  @IsArray()
  @ArrayMaxSize(200)
  @IsInt({ each: true })
  planos!: number[];

  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => FornecedorEscolhidoDto)
  fornecedores!: FornecedorEscolhidoDto[];
}

export class ConfiguracaoDto {
  /** Id da conta → papel. */
  @IsOptional()
  @IsObject()
  papelDasContas?: Record<string, string>;

  @IsOptional()
  @ValidateNested()
  @Type(() => SelecaoDto)
  lucros?: SelecaoDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => SelecaoDto)
  doacoes?: SelecaoDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => SelecaoDto)
  link?: SelecaoDto;
}

export function papelValido(papel: string): boolean {
  return (PAPEIS as readonly string[]).includes(papel);
}
