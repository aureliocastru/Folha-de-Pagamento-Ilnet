-- As notas fiscais de entrada, o que a casa comprou no mês.
--
-- O arquivo continua sendo um documento da estante, numa pasta por mês dentro
-- de "Notas Fiscais". Esta tabela guarda o que o PDF não responde sem ser
-- aberto um a um — de quem é a nota, que número tem, quanto deu —, que é
-- justamente o que se confere com a contabilidade no fim do mês.
--
-- A competência mora aqui, e não no `competencia` do documento, porque aquele
-- campo entra na chave (pasta, tipo, competência): ela existe para impedir o
-- mesmo recibo de pagamento de ser guardado duas vezes, e recusaria a segunda
-- nota de setembro.
CREATE TABLE "notas_fiscais" (
    "id" TEXT NOT NULL,
    "documento_id" TEXT NOT NULL,
    "competencia" TEXT NOT NULL,
    "fornecedor" TEXT NOT NULL,
    "numero" TEXT,
    "valor" DECIMAL(14,2) NOT NULL,
    "criado_por" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notas_fiscais_pkey" PRIMARY KEY ("id")
);

-- Um documento é uma nota só: a linha é o mesmo papel visto de outro ângulo.
CREATE UNIQUE INDEX "notas_fiscais_documento_id_key" ON "notas_fiscais"("documento_id");

-- A pergunta que a tela faz sempre: o que entrou neste mês.
CREATE INDEX "notas_fiscais_competencia_idx" ON "notas_fiscais"("competencia");

-- `CASCADE` porque a nota é o documento: apagado o arquivo pela estante, o que
-- sobraria aqui seria um valor sem nota nenhuma atrás dele, e o total do mês
-- passaria a mentir para quem confere.
ALTER TABLE "notas_fiscais"
  ADD CONSTRAINT "notas_fiscais_documento_id_fkey"
  FOREIGN KEY ("documento_id") REFERENCES "documentos_rh"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
