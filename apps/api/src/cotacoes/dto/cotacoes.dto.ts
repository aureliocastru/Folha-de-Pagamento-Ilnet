import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * As unidades que um produto pode ter. Espelha o enum `UnidadeProduto` do
 * schema — repetido aqui porque o `class-validator` precisa da lista em tempo
 * de execução, e o enum do Prisma só existe depois do `generate`.
 */
export const UNIDADES = [
  'UN',
  'M',
  'KM',
  'CX',
  'ROLO',
  'PCT',
  'KG',
  'L',
  'PAR',
] as const;

/** Tira os espaços das pontas e transforma string vazia em `null`. */
const textoOuNulo = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const limpo = value.trim();
  return limpo === '' ? null : limpo;
};

const texto = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

// ---------------------------------------------------------------------------
// Fornecedor
// ---------------------------------------------------------------------------

export class CriarFornecedorDto {
  @Transform(texto)
  @IsString()
  @MinLength(2, { message: 'O nome do fornecedor é curto demais.' })
  @MaxLength(120)
  nome!: string;

  @IsOptional() @Transform(textoOuNulo) @IsString() @MaxLength(120)
  nomeFantasia?: string | null;

  @IsOptional() @Transform(textoOuNulo) @IsString() @MaxLength(20)
  cnpj?: string | null;

  @IsOptional() @Transform(textoOuNulo) @IsString() @MaxLength(120)
  contato?: string | null;

  @IsOptional() @Transform(textoOuNulo) @IsString() @MaxLength(40)
  telefone?: string | null;

  @IsOptional() @Transform(textoOuNulo) @IsString() @MaxLength(160)
  email?: string | null;

  @IsOptional() @Transform(textoOuNulo) @IsString() @MaxLength(200)
  site?: string | null;

  @IsOptional() @Transform(textoOuNulo) @IsString() @MaxLength(2000)
  observacao?: string | null;
}

export class AtualizarFornecedorDto {
  @IsOptional()
  @Transform(texto)
  @IsString()
  @MinLength(2, { message: 'O nome do fornecedor é curto demais.' })
  @MaxLength(120)
  nome?: string;

  @IsOptional() @Transform(textoOuNulo) @IsString() @MaxLength(120)
  nomeFantasia?: string | null;

  @IsOptional() @Transform(textoOuNulo) @IsString() @MaxLength(20)
  cnpj?: string | null;

  @IsOptional() @Transform(textoOuNulo) @IsString() @MaxLength(120)
  contato?: string | null;

  @IsOptional() @Transform(textoOuNulo) @IsString() @MaxLength(40)
  telefone?: string | null;

  @IsOptional() @Transform(textoOuNulo) @IsString() @MaxLength(160)
  email?: string | null;

  @IsOptional() @Transform(textoOuNulo) @IsString() @MaxLength(200)
  site?: string | null;

  @IsOptional() @Transform(textoOuNulo) @IsString() @MaxLength(2000)
  observacao?: string | null;

  @IsOptional() @IsBoolean() ativo?: boolean;
}

// ---------------------------------------------------------------------------
// Produto
// ---------------------------------------------------------------------------

export class CriarProdutoDto {
  @Transform(texto)
  @IsString()
  @MinLength(2, { message: 'O nome do produto é curto demais.' })
  @MaxLength(120)
  nome!: string;

  @IsOptional() @Transform(textoOuNulo) @IsString() @MaxLength(60)
  codigo?: string | null;

  @IsOptional()
  @IsIn(UNIDADES, { message: 'Unidade que não existe no cadastro.' })
  unidade?: (typeof UNIDADES)[number];

  @IsOptional() @Transform(textoOuNulo) @IsString() @MaxLength(2000)
  observacao?: string | null;
}

export class AtualizarProdutoDto {
  @IsOptional()
  @Transform(texto)
  @IsString()
  @MinLength(2, { message: 'O nome do produto é curto demais.' })
  @MaxLength(120)
  nome?: string;

  @IsOptional() @Transform(textoOuNulo) @IsString() @MaxLength(60)
  codigo?: string | null;

  @IsOptional()
  @IsIn(UNIDADES, { message: 'Unidade que não existe no cadastro.' })
  unidade?: (typeof UNIDADES)[number];

  @IsOptional() @Transform(textoOuNulo) @IsString() @MaxLength(2000)
  observacao?: string | null;

  @IsOptional() @IsBoolean() ativo?: boolean;
}

// ---------------------------------------------------------------------------
// Preço
// ---------------------------------------------------------------------------

/**
 * O valor chega como número — a tela usa o `CampoDinheiro`, que emite
 * `"0.4750"` canônico — e é aqui que ele vira `Number`. `enableImplicitConversion`
 * está desligado no `main.ts`, então sem este `Transform` o `IsNumber` recusaria
 * a string.
 */
const numero = ({ value }: { value: unknown }) => {
  if (value === '' || value === null || value === undefined) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : value;
};

export class CriarPrecoDto {
  @IsUUID() produtoId!: string;
  @IsUUID() fornecedorId!: string;

  /**
   * O preço de uma unidade. Quatro casas, porque drop sai a R$ 0,4750 o metro.
   *
   * Zero é recusado: "de graça" não é cotação, é campo esquecido em branco — e
   * um zero aqui ganharia a comparação de todos os fornecedores para sempre.
   */
  @Transform(numero)
  @IsNumber({ maxDecimalPlaces: 4 }, { message: 'O preço tem no máximo 4 casas decimais.' })
  @Min(0.0001, { message: 'O preço precisa ser maior que zero.' })
  valor!: number;

  /** O dia da cotação (AAAA-MM-DD). Vazio = hoje. */
  @IsOptional() @IsISO8601() data?: string;

  /** A partir de quanto este preço vale. Vazio = qualquer quantidade. */
  @IsOptional()
  @Transform(numero)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  quantidadeMinima?: number | null;

  @IsOptional() @Transform(textoOuNulo) @IsString() @MaxLength(2000)
  observacao?: string | null;
}

export class AtualizarPrecoDto {
  @IsOptional()
  @Transform(numero)
  @IsNumber({ maxDecimalPlaces: 4 }, { message: 'O preço tem no máximo 4 casas decimais.' })
  @Min(0.0001, { message: 'O preço precisa ser maior que zero.' })
  valor?: number;

  @IsOptional() @IsISO8601() data?: string;

  @IsOptional()
  @Transform(numero)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  quantidadeMinima?: number | null;

  @IsOptional() @Transform(textoOuNulo) @IsString() @MaxLength(2000)
  observacao?: string | null;
}
