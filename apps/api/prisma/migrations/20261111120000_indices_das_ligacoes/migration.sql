-- Indices das ligacoes entre tabelas que ainda nao tinham um.
--
-- O Postgres nao cria indice sozinho na coluna que aponta para outra tabela.
-- Sem ele, abrir "as contas desta recorrente" ou apagar um cadastro (que
-- precisa achar quem aponta para ele) le a tabela inteira. Sao tabelas que so
-- crescem: contas, abastecimentos, pontos, APRs.

-- CreateIndex
CREATE INDEX IF NOT EXISTS "contas_pagar_recorrente_id_idx" ON "contas_pagar"("recorrente_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "contas_pagar_beneficiario_avulso_id_idx" ON "contas_pagar"("beneficiario_avulso_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "abastecimentos_funcionario_id_idx" ON "abastecimentos"("funcionario_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "lancamentos_de_pontos_coordenador_id_idx" ON "lancamentos_de_pontos"("coordenador_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ferias_marcadas_funcionario_id_idx" ON "ferias_marcadas"("funcionario_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "itens_previsao_ferias_funcionario_id_idx" ON "itens_previsao_ferias"("funcionario_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "aprs_modelo_id_idx" ON "aprs"("modelo_id");
