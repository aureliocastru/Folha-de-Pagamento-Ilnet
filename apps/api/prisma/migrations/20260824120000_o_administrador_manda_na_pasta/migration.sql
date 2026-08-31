-- O administrador manda na pasta: renomear a que veio do cadastro.
--
-- A estante seguia o cadastro sem excecao -- quem trocou de sobrenome no IXC
-- nao pode ficar com o nome antigo aqui. So que "M A CASTRO" e como a casa
-- chama a pasta da empresa, e a razao social inteira nao e nome de pasta.
-- Renomear era escrever num campo que a tela nunca lia de volta.
--
-- Com esta marca, a pasta escolhe: sem ela o cadastro manda, como sempre
-- mandou; com ela vale o que esta em "nome". O nome do cadastro nao se perde --
-- ele continua no funcionario, e desmarcar devolve a pasta a ele.
ALTER TABLE "pastas_rh"
  ADD COLUMN "nome_manual" BOOLEAN NOT NULL DEFAULT false;
