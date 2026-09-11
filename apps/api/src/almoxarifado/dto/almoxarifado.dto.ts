import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

const textoOuNulo = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const limpo = value.trim();
  return limpo === '' ? null : limpo;
};

const texto = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

const inteiroOuNulo = ({ value }: { value: unknown }) => {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : value;
};

export class CriarFerramentaDto {
  @Transform(texto)
  @IsString()
  @MinLength(2, { message: 'O nome da ferramenta é curto demais.' })
  @MaxLength(120)
  nome!: string;

  /** A etiqueta de patrimônio. É ela que separa duas máquinas de fusão iguais. */
  @IsOptional() @Transform(textoOuNulo) @IsString() @MaxLength(40)
  patrimonio?: string | null;

  @IsOptional() @Transform(textoOuNulo) @IsString() @MaxLength(2000)
  descricao?: string | null;

  /** O produto correspondente no IXC, quando ela também é item de estoque lá. */
  @IsOptional() @Transform(inteiroOuNulo) @IsInt() @Min(1)
  ixcProdutoId?: number | null;
}

export class AtualizarFerramentaDto {
  @IsOptional()
  @Transform(texto)
  @IsString()
  @MinLength(2, { message: 'O nome da ferramenta é curto demais.' })
  @MaxLength(120)
  nome?: string;

  @IsOptional() @Transform(textoOuNulo) @IsString() @MaxLength(40)
  patrimonio?: string | null;

  @IsOptional() @Transform(textoOuNulo) @IsString() @MaxLength(2000)
  descricao?: string | null;

  @IsOptional() @Transform(inteiroOuNulo) @IsInt() @Min(1)
  ixcProdutoId?: number | null;

  @IsOptional() @IsBoolean() ativa?: boolean;
}

/**
 * Entregar a ferramenta a alguém.
 *
 * `funcionarioId` e `quem` não são alternativas excludentes: com o funcionário,
 * o nome dele é escrito na linha do mesmo jeito — é o que sobra quando o
 * cadastro muda. Sem ele, o `quem` é o único registro, e é o que permite
 * entregar ao terceirizado que não está em cadastro nenhum.
 */
export class EmprestarDto {
  @IsOptional() @IsUUID() funcionarioId?: string;

  @IsOptional() @Transform(texto) @IsString() @MaxLength(120)
  quem?: string;

  /** Para quando ficou de voltar (AAAA-MM-DD). Vazio = ninguém combinou dia. */
  @IsOptional() @IsISO8601() previsaoDeVolta?: string;

  @IsOptional() @Transform(textoOuNulo) @IsString() @MaxLength(2000)
  observacao?: string | null;
}

const numero = ({ value }: { value: unknown }) =>
  value === '' || value === null || value === undefined ? undefined : Number(value);

// --- Produtos do estoque (escritos no IXC) ---

export class EditarProdutoDto {
  @IsOptional() @Transform(texto) @IsString() @MinLength(2) @MaxLength(100)
  descricao?: string;

  @IsOptional() @Transform(numero) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  precoBase?: number;

  @IsOptional() @IsBoolean() ativo?: boolean;

  @IsOptional() @Transform(numero) @IsInt() @Min(1)
  unidadeId?: number;

  /** Produto parecido de onde sai o fiscal que falta (NCM, subgrupo…). */
  @IsOptional() @Transform(numero) @IsInt() @Min(1)
  modeloId?: number;
}

export class CriarProdutoDto {
  @Transform(texto) @IsString() @MinLength(2) @MaxLength(100)
  descricao!: string;

  @Transform(numero) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  precoBase!: number;

  @Transform(numero) @IsInt() @Min(1)
  unidadeId!: number;

  /** O produto de onde saem subgrupo, NCM, classificação fiscal e contas. */
  @Transform(numero) @IsInt() @Min(1)
  modeloId!: number;
}

// --- Almoxarifados (cadastro, escrito no IXC) ---

export class CriarAlmoxarifadoDto {
  @Transform(texto) @IsString() @MinLength(2) @MaxLength(100)
  descricao!: string;

  @Transform(numero) @IsInt() @Min(1)
  filialId!: number;

  /** O usuário do IXC do técnico dono, quando é a van de um técnico. */
  @IsOptional() @Transform(numero) @IsInt() @Min(1)
  tecnicoUsuarioId?: number;
}

export class EditarAlmoxarifadoDto {
  @IsOptional() @Transform(texto) @IsString() @MinLength(2) @MaxLength(100)
  descricao?: string;

  @IsOptional() @Transform(numero) @IsInt() @Min(1)
  filialId?: number;

  @IsOptional() @IsBoolean() ativo?: boolean;
}

/** Mover tudo o que um almoxarifado tem para outro. */
export class MoverTudoDto {
  @Transform(numero) @IsInt() @Min(1) para!: number;

  @IsOptional() @Transform(texto) @IsString() @MaxLength(200)
  observacao?: string;
}

export class ProdutoDaTransferenciaDto {
  @Transform(numero) @IsInt() @Min(1) produtoId!: number;

  @Transform(numero) @IsNumber({ maxDecimalPlaces: 5 }) @Min(0.00001)
  quantidade!: number;
}

/** Transferência de vários itens: produtos com quantidade e patrimônios pelo id. */
export class TransferenciaDto {
  @Transform(numero) @IsInt() @Min(1) de!: number;
  @Transform(numero) @IsInt() @Min(1) para!: number;

  @IsOptional() @Transform(texto) @IsString() @MaxLength(200)
  observacao?: string;

  @IsOptional() @IsArray() @ArrayMaxSize(2000)
  @ValidateNested({ each: true }) @Type(() => ProdutoDaTransferenciaDto)
  produtos?: ProdutoDaTransferenciaDto[];

  @IsOptional() @IsArray() @ArrayMaxSize(5000) @IsInt({ each: true }) @Min(1, { each: true })
  patrimonios?: number[];
}

export class TransferirProdutoDto {
  @Transform(numero) @IsInt() @Min(1) de!: number;
  @Transform(numero) @IsInt() @Min(1) para!: number;

  @Transform(numero) @IsNumber({ maxDecimalPlaces: 5 }) @Min(0.00001)
  quantidade!: number;

  @IsOptional() @Transform(texto) @IsString() @MaxLength(200)
  observacao?: string;
}

export class EntradaDeCompraDto {
  @Transform(numero) @IsInt() @Min(1) almoxId!: number;

  @Transform(numero) @IsNumber({ maxDecimalPlaces: 5 }) @Min(0.00001)
  quantidade!: number;

  @Transform(numero) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  valorUnitario!: number;

  @Transform(numero) @IsInt() @Min(1) fornecedorId!: number;
  @Transform(numero) @IsInt() @Min(1) tipoDocumentoId!: number;
  @Transform(numero) @IsInt() @Min(1) condicaoPagamentoId!: number;

  @IsOptional() @Transform(texto) @IsString() @MaxLength(40)
  numeroNota?: string;
}

export class DevolverDto {
  /** Em que estado ela voltou. */
  @IsOptional() @Transform(textoOuNulo) @IsString() @MaxLength(2000)
  observacao?: string | null;
}
