import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

const TIPOS = ['DARF_INSS', 'FGTS', 'DAS_SIMPLES', 'DARE_ICMS', 'OUTRA'];
const CLASSES = ['FOLHA_PATRONAL', 'FOLHA_RETIDO', 'FATURAMENTO'];

export class ItemGuiaDto {
  @IsOptional() @IsString() codigo?: string;

  @IsString() @MinLength(2) denominacao!: string;

  @IsNumber() @Min(0) valor!: number;

  /**
   * Pode vir diferente do que o leitor sugeriu: a tela deixa corrigir, e a
   * correção é o que vale — ela é que decide se aquilo é custo de pessoal.
   */
  @IsIn(CLASSES) classe!: string;
}

/**
 * A guia lida da imagem pelo navegador: o texto do OCR e o que saiu do código
 * de barras e do QR Code. Nada disto é confiado — a API confere os códigos e o
 * leitor das guias confere o resto, como faz com o PDF de texto.
 */
export class LerTextoDaGuiaDto {
  @IsString() @MinLength(20) @MaxLength(100_000) texto!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(1000, { each: true })
  codigos?: string[];

  @IsString() @MinLength(1) @MaxLength(255) arquivoNome!: string;
}

/** Uma guia conferida na tela, pronta para gravar. */
export class GravarGuiaDto {
  @IsIn(TIPOS) tipo!: string;

  /** Período de apuração, "AAAA-MM". */
  @Matches(/^\d{4}-\d{2}$/, { message: 'competencia deve ser AAAA-MM' })
  competencia!: string;

  @IsISO8601() vencimento!: string;

  @IsNumber() @Min(0.01) valorTotal!: number;

  @IsOptional() @IsString() numeroDocumento?: string;
  @IsOptional() @IsString() cnpj?: string;
  @IsOptional() @IsString() razaoSocial?: string;

  @IsOptional() @IsInt() @Min(0) trabalhadores?: number;

  @IsString() @MinLength(1) arquivoNome!: string;

  /** Texto extraído do PDF, guardado para reconferir a leitura depois. */
  @IsOptional() @IsString() textoOriginal?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ItemGuiaDto)
  itens!: ItemGuiaDto[];
}
