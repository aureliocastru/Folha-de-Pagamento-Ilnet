-- A cidade do fornecedor novo: São Mateus, 637.
--
-- "Cidade" é um dos cinco campos que o IXC exige para criar um fornecedor
-- (junto de ativo, tipo de pessoa, razão social e data de cadastro), e o app
-- mandava o `1` que era o padrão da coluna desde que ela nasceu — um número
-- escolhido por ser o primeiro, e não por existir nesta base. Toda tentativa de
-- criar fornecedor batia nele.
--
-- Só mexe em quem ainda está no padrão: a instalação que já configurou a cidade
-- pela tela (Folha > Configurações > "Cidade padrão do fornecedor") escolheu, e
-- escolha de gente não se sobrescreve por migração.
UPDATE "config_financeira"
SET "cidade_padrao_id" = 637
WHERE "cidade_padrao_id" = 1;

-- E o padrão da coluna acompanha, para a próxima instalação não repetir o 1.
ALTER TABLE "config_financeira"
  ALTER COLUMN "cidade_padrao_id" SET DEFAULT 637;
