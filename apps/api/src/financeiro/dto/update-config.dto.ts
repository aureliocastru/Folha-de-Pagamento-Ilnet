import { IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export class UpdateConfigFinanceiraDto {
  @IsOptional() @IsInt() @Min(1) contaPagamentoId?: number;
  @IsOptional() @IsInt() @Min(1) contaPagamentoCaixaId?: number;
  @IsOptional() @IsInt() @Min(1) filialId?: number;
  @IsOptional() @IsInt() @Min(1) contaContabilSalario?: number;
  @IsOptional() @IsInt() @Min(1) contaContabilAdiantamento?: number;
  @IsOptional() @IsInt() @Min(1) contaContabilBonus?: number;
  @IsOptional() @IsInt() @Min(1) contaContabilFerias?: number;
  @IsOptional() @IsInt() @Min(1) contaContabilDiaria?: number;
  @IsOptional() @IsInt() @Min(1) contaContabilAvulso?: number;
  @IsOptional() @IsInt() @Min(1) cidadePadraoId?: number;
  /**
   * A etiqueta que todo pagamento da folha recebe sozinho. Vazio desliga a
   * automação: a folha volta a nascer sem categoria.
   */
  @IsOptional() @IsUUID() categoriaFolhaId?: string | null;
  // Quem paga, como sai impresso no recibo assinado da diária
  @IsOptional() @IsString() empresaNome?: string;
  @IsOptional() @IsString() empresaCnpj?: string;
  @IsOptional() @IsInt() @Min(0) @Max(100) percentualAdiantamento?: number;
  @IsOptional() @IsString() tipoPagamentoPadrao?: string;
  // Rádio "Tipo da chave Pix" do fn_apagar (vazio = aprender do próprio IXC)
  @IsOptional() @IsString() pixCampoTipoChave?: string;
  @IsOptional() @IsString() pixCodigosTipoChave?: string;
  @IsOptional() @IsString() obsSalarioTemplate?: string;
  @IsOptional() @IsString() obsAdiantamentoTemplate?: string;
  @IsOptional() @IsString() obsBonusTemplate?: string;
  @IsOptional() @IsString() obsFeriasTemplate?: string;
  // Filtro fornecedor → funcionário (vazio no campo = detecção automática)
  @IsOptional() @IsString() fornecedorCampoIcms?: string;
  @IsOptional() @IsString() fornecedorIcmsIsento?: string;
  @IsOptional() @IsString() fornecedorTabelaBanco?: string;
  // Filtro fornecedor → diarista (tipo de pessoa "Estrangeiro")
  @IsOptional() @IsString() fornecedorCampoTipoPessoa?: string;
  @IsOptional() @IsString() fornecedorTipoEstrangeiro?: string;
  // Caixa do pagamento em mãos (0 = procurar pelo nome; tabelas vazias =
  // descobrir sozinho)
  @IsOptional() @IsInt() @Min(0) caixaEmMaosId?: number;
  @IsOptional() @IsString() caixaEmMaosNome?: string;
  @IsOptional() @IsString() caixaTabelaContas?: string;
  @IsOptional() @IsString() caixaTabelaMovimento?: string;
}
