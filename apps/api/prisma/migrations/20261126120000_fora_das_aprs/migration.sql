-- Quem não aparece como executante na análise de risco (pedido de 26/11/2026).
--
-- Tem login, mas não vai ao serviço: o escritório, a diretoria. Não aparece
-- na lista para escolher e não entra sozinho na equipe da APR que abre.
ALTER TABLE "funcionarios"
  ADD COLUMN "fora_das_aprs" BOOLEAN NOT NULL DEFAULT false;
