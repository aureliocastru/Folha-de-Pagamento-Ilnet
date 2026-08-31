-- O lancamento que nao entra na conta da gaveta.
--
-- Existe para o lancamento de acerto: a saida criada no IXC so para corrigir um
-- saldo que ja estava errado la. O dinheiro dela saiu da gaveta antes, por
-- outro caminho -- descontar de novo tira duas vezes o mesmo dinheiro, e a
-- contagem passa a nunca fechar.
--
-- O caso que trouxe isto: R$ 300,00 sairam da gaveta e a saida nunca chegou ao
-- IXC. O caixa de la ficava R$ 300,00 acima do real, e foi lancada uma saida a
-- mao para acerta-lo. Do lado do app, que le as saidas do IXC, aquela saida
-- virou um segundo desconto de um dinheiro que ja tinha saido.
--
-- O lancamento nao some de lugar nenhum: continua na lista e na fila de
-- conferencia, porque ele e uma saida que aconteceu. O que ele deixa de fazer e
-- pesar no saldo esperado.
--
-- O motivo e coluna, e nao comentario solto: valor que some da conta sem
-- explicacao escrita e o comeco de uma contagem que ninguem confia.
ALTER TABLE "conferencias_caixa"
  ADD COLUMN "fora_da_gaveta" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "motivo_fora_da_gaveta" TEXT;
