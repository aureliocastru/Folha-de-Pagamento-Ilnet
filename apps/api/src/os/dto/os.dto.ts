import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
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

/** Vários aparelhos retirados de uma vez, todos na mesma condição. */
export class AnotarRetiradasDto {
  /** As linhas de comodato do contrato que foram retiradas. */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsInt({ each: true })
  @Min(1, { each: true })
  comodatoIds!: number[];

  @IsOptional() @IsIn(['FUNCIONANDO', 'DEFEITO', 'NAO_TESTADO'])
  condicao?: 'FUNCIONANDO' | 'DEFEITO' | 'NAO_TESTADO';

  @IsOptional() @Transform(texto) @IsString() @MaxLength(500)
  observacao?: string;
}

/** Onde o celular estava ao finalizar, como o navegador diz. */
export class GpsDto {
  @IsNumber() @Min(-90) @Max(90)
  latitude!: number;

  @IsNumber() @Min(-180) @Max(180)
  longitude!: number;

  /** Em metros. */
  @IsOptional() @IsNumber() @Min(0) @Max(100000)
  precisao?: number;

  @IsISO8601()
  em!: string;
}

/** O passo a passo de finalizar. O que cada assunto exige está em `FinalizacaoService.finalizar`. */
export class FinalizarDto {
  /** O relatório do técnico: o que foi feito. */
  @Transform(texto) @IsString() @MinLength(5) @MaxLength(2000)
  relato!: string;

  /** A hora em que o serviço começou. Opcional: sem ela, vale a da primeira anotação na OS. */
  @IsOptional() @IsISO8601()
  inicio?: string;

  /** Sem permissão ou sem resposta do GPS, a OS se finaliza sem ele. */
  @IsOptional() @ValidateNested() @Type(() => GpsDto)
  gps?: GpsDto;

  /** Quem assinou. A assinatura já foi para os arquivos da OS, no passo dela. */
  @IsOptional() @Transform(texto) @IsString() @MinLength(3) @MaxLength(100)
  assinadaPor?: string;

  /** Por que o cliente não assinou — só vale no assunto que não exige assinatura. */
  @IsOptional() @Transform(texto) @IsString() @MinLength(3) @MaxLength(300)
  semAssinatura?: string;
}

/** A assinatura do cliente, direto para a aba "Arquivos" da OS no IXC. */
export class AnexarAssinaturaDto {
  /** Data URL em PNG, já com o nome e a hora carimbados embaixo. */
  @IsString() @MinLength(1)
  assinatura!: string;

  /** Quem assinou — nem sempre o titular. Vai na descrição do arquivo. */
  @Transform(texto) @IsString() @MinLength(3) @MaxLength(80)
  nome!: string;
}

/** Uma foto, direto para a aba "Arquivos" da OS no IXC. O tipo e o teto estão em `FinalizacaoService.anexarFoto`. */
export class AnexarFotoDto {
  /** Data URL, já reduzida no celular. */
  @IsString() @MinLength(1)
  foto!: string;

  /** O que a foto mostra — é o que a aba de arquivos da OS lista no IXC. */
  @IsOptional() @Transform(texto) @IsString() @MaxLength(100)
  descricao?: string;
}

/** O veredito do chefe do almoxarifado sobre uma OS fechada. O resto confere `motivoParaRecusarVeredito`. */
export class ConferirOsDto {
  @IsIn(['CONFERIDA', 'PROBLEMA'])
  situacao!: 'CONFERIDA' | 'PROBLEMA';

  /** O código do motivo (`MOTIVOS_DE_PROBLEMA`), quando é problema. */
  @IsOptional() @IsString() @MaxLength(40)
  motivo?: string;

  /** No problema, o que está errado; na conferida, uma nota; no problema resolvido, como se resolveu. */
  @IsOptional() @Transform(texto) @IsString() @MaxLength(1000)
  observacao?: string;
}

/** O técnico responde, do celular, a OS que voltou da conferência. */
export class ResponderConferenciaDto {
  @Transform(texto) @IsString() @MinLength(3) @MaxLength(1000)
  texto!: string;
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
