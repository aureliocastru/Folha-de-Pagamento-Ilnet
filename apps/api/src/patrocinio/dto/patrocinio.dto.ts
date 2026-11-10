import { TipoDePatrocinio } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

/** Data de calendário, sem hora e sem fuso: "AAAA-MM-DD". */
const DIA = /^\d{4}-\d{2}-\d{2}$/;

/** Campo de texto opcional: vazio vira null, que é o que apaga no banco. */
const vazioViraNulo = ({ value }: { value: unknown }) =>
  typeof value === 'string' && value.trim() === '' ? null : value;

/** Os dados do patrocinado — comuns a cadastrar e a corrigir. */
export class DadosDoPatrocinadoDto {
  /** Fixo em dinheiro, fixo em desconto na mensalidade, ou avulso. Vazio = fixo. */
  @IsOptional()
  @IsEnum(TipoDePatrocinio, { message: 'Escolha se o patrocínio é fixo, desconto ou avulso.' })
  tipo?: TipoDePatrocinio;

  @IsOptional() @Transform(vazioViraNulo) @IsString() @MaxLength(160) projeto?: string | null;
  @IsOptional() @Transform(vazioViraNulo) @IsString() @MaxLength(30) cpfCnpj?: string | null;
  @IsOptional() @Transform(vazioViraNulo) @IsString() @MaxLength(160) responsavel?: string | null;
  @IsOptional() @Transform(vazioViraNulo) @IsString() @MaxLength(40) telefone?: string | null;

  @IsOptional()
  @Transform(vazioViraNulo)
  @IsEmail({}, { message: 'O e-mail não parece um e-mail.' })
  email?: string | null;

  @IsOptional() @Transform(vazioViraNulo) @IsString() @MaxLength(80) instagram?: string | null;
  @IsOptional() @Transform(vazioViraNulo) @IsString() @MaxLength(80) cidade?: string | null;

  /**
   * Quanto se combinou por mês — no desconto, o tamanho do desconto. Vazio =
   * não se combinou valor fixo. O avulso não tem: o serviço o apaga.
   */
  @IsOptional()
  @Transform(({ value }) => (value === '' || value == null ? null : Number(value)))
  @IsNumber({}, { message: 'O valor mensal precisa ser um número.' })
  @Min(0)
  valorMensal?: number | null;

  @IsOptional()
  @Transform(vazioViraNulo)
  @Matches(DIA, { message: 'O início precisa ser AAAA-MM-DD.' })
  inicio?: string | null;

  @IsOptional()
  @Transform(vazioViraNulo)
  @Matches(DIA, { message: 'O fim precisa ser AAAA-MM-DD.' })
  fim?: string | null;

  @IsOptional() @Transform(vazioViraNulo) @IsString() @MaxLength(2000) observacoes?: string | null;
}

/** O fornecedor do IXC por onde ele recebe, escolhido na busca. */
const idDoFornecedor = ({ value }: { value: unknown }) =>
  value === '' || value == null ? undefined : Number(value);

/** O fornecedor só é obrigatório para quem recebe dinheiro. */
const recebeDinheiro = (o: { tipo?: TipoDePatrocinio; idFornecedorIxc?: unknown }) =>
  o.tipo !== TipoDePatrocinio.DESCONTO || o.idFornecedorIxc != null;

/**
 * O cadastro novo. Por onde ele recebe é obrigatório: o fornecedor que ele já
 * é no IXC. Um patrocinado sem isso é alguém que não dá para pagar — menos o
 * do desconto na mensalidade, que não recebe dinheiro nenhum.
 */
export class CriarPatrocinadoDto extends DadosDoPatrocinadoDto {
  @IsString({ message: 'Diga como o patrocinado se chama.' })
  @MinLength(2, { message: 'O nome ficou curto demais.' })
  @MaxLength(160)
  nome!: string;

  @ValidateIf(recebeDinheiro)
  @Transform(idDoFornecedor)
  @IsInt({ message: 'Escolha o fornecedor no IXC.' })
  @Min(1, { message: 'Escolha o fornecedor no IXC.' })
  idFornecedorIxc?: number;

  /** Como o fornecedor se chama no IXC, guardado para a tela. */
  @ValidateIf(recebeDinheiro)
  @IsString({ message: 'Escolha o fornecedor no IXC.' })
  @MinLength(1)
  @MaxLength(200)
  fornecedorNome?: string;
}

export class AtualizarPatrocinadoDto extends DadosDoPatrocinadoDto {
  @IsOptional()
  @IsString({ message: 'Diga como o patrocinado se chama.' })
  @MinLength(2, { message: 'O nome ficou curto demais.' })
  @MaxLength(160)
  nome?: string;

  @IsOptional() @IsBoolean() ativo?: boolean;

  /** Trocar (ou ligar) o fornecedor por onde ele recebe. Vem com o nome. */
  @IsOptional()
  @Transform(idDoFornecedor)
  @IsInt({ message: 'Escolha o fornecedor no IXC.' })
  @Min(1, { message: 'Escolha o fornecedor no IXC.' })
  idFornecedorIxc?: number;

  @IsOptional() @IsString() @MaxLength(200) fornecedorNome?: string;
}

/** Um arquivo chegando: como ele se chama na lista, e o arquivo em si. */
export class GuardarArquivoDto {
  @IsOptional() @IsString() @MaxLength(160) titulo?: string;

  @IsString() @MinLength(1) @MaxLength(255) arquivoNome!: string;

  /**
   * O arquivo inteiro, como data URL ("data:application/pdf;base64,…") — o
   * caminho de todo arquivo desta casa. O tipo vem daqui e é conferido no
   * serviço.
   */
  @IsString({ message: 'Escolha o arquivo.' })
  @Matches(/^data:[-\w.+]+\/[-\w.+]+;base64,/, {
    message: 'O arquivo não chegou num formato que eu saiba ler.',
  })
  arquivo!: string;
}

/** O contrato físico, escaneado. */
export class GuardarEscaneadoDto {
  @IsString() @MinLength(1) @MaxLength(255) arquivoNome!: string;

  @IsString({ message: 'Escolha o arquivo do contrato.' })
  @Matches(/^data:[-\w.+]+\/[-\w.+]+;base64,/, {
    message: 'O arquivo não chegou num formato que eu saiba ler.',
  })
  arquivo!: string;

  /** O dia escrito no papel, quando se sabe. */
  @IsOptional()
  @Transform(vazioViraNulo)
  @Matches(DIA, { message: 'A data da assinatura precisa ser AAAA-MM-DD.' })
  assinadoEm?: string | null;
}

/** O pagamento cuja nota de recebimento se vai assinar: o título no IXC. */
export class GerarNotaDto {
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsInt({ message: 'Diga de que pagamento é a nota.' })
  @Min(1, { message: 'Diga de que pagamento é a nota.' })
  idFnApagar!: number;
}
