-- Cartoes de credito da empresa.
--
-- A fatura do cartao e uma conta so no IXC -- um titulo para o banco, no dia
-- em que ela vence --, mas por dentro ela e um punhado de compras, e boa parte
-- delas parcelada. Ate agora a soma era feita fora do sistema e so o total
-- chegava ao IXC: ninguem conseguia responder o que havia dentro de uma fatura
-- paga, nem quanto das proximas ja estava comprometido.
CREATE TABLE "cartoes_credito" (
    "id" TEXT NOT NULL,

    -- Como a casa chama o cartao, e os quatro ultimos digitos para separar
    -- dois cartoes do mesmo banco.
    "apelido" TEXT NOT NULL,
    "final"   TEXT,

    -- Quem recebe a fatura: o banco, no cadastro de fornecedores do IXC.
    "id_fornecedor_ixc" INTEGER NOT NULL,
    "fornecedor_nome"   TEXT NOT NULL,

    -- A fatura de outubro vence neste dia de outubro. E pelo mes do
    -- vencimento que as parcelas sao contadas.
    "dia_de_vencimento" INTEGER NOT NULL,

    "conta_contabil"     INTEGER,
    "conta_pagamento"    INTEGER,
    "tipo_pagamento_ixc" TEXT,
    "categoria_id"       TEXT,

    -- Desligado some da tela. O que ele ja gerou continua de pe no IXC.
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    "criado_por" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cartoes_credito_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "cartoes_credito_ativo_idx" ON "cartoes_credito"("ativo");

ALTER TABLE "cartoes_credito"
  ADD CONSTRAINT "cartoes_credito_categoria_id_fkey"
  FOREIGN KEY ("categoria_id") REFERENCES "categorias_despesa"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Cada linha da fatura: uma compra, a vista ou parcelada.
--
-- A compra e guardada inteira, e nao parcela por parcela: as parcelas se
-- calculam -- o valor dividido, uma por fatura a partir da primeira --, e
-- guarda-las soltas deixaria dez linhas para corrigir quando alguem errasse o
-- valor de uma compra em dez vezes.
CREATE TABLE "compras_no_cartao" (
    "id" TEXT NOT NULL,
    "cartao_id" TEXT NOT NULL,

    "descricao" TEXT NOT NULL,

    -- A compra inteira, somadas as parcelas. Negativo e credito (estorno).
    "valor_total" DECIMAL(14,2) NOT NULL,

    -- Em quantas vezes, e que parcela cai na primeira fatura. A compra que ja
    -- vinha sendo paga antes deste cadastro entra pela parcela que a fatura
    -- mostra ("03/10"); as anteriores foram pagas fora daqui.
    "parcelas"        INTEGER NOT NULL DEFAULT 1,
    "parcela_inicial" INTEGER NOT NULL DEFAULT 1,
    "primeira_fatura" TEXT NOT NULL,

    "criado_por" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "compras_no_cartao_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "compras_no_cartao_cartao_id_primeira_fatura_idx"
  ON "compras_no_cartao"("cartao_id", "primeira_fatura");

ALTER TABLE "compras_no_cartao"
  ADD CONSTRAINT "compras_no_cartao_cartao_id_fkey"
  FOREIGN KEY ("cartao_id") REFERENCES "cartoes_credito"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- De que cartao e esta conta a pagar, e de que mes.
--
-- O par (cartao, competencia) e o que responde "a fatura de outubro ja foi
-- lancada?" -- e o que impede lanca-la duas vezes.
ALTER TABLE "contas_pagar" ADD COLUMN "cartao_credito_id" TEXT;

ALTER TABLE "contas_pagar"
  ADD CONSTRAINT "contas_pagar_cartao_credito_id_fkey"
  FOREIGN KEY ("cartao_credito_id") REFERENCES "cartoes_credito"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "contas_pagar_cartao_credito_id_competencia_idx"
  ON "contas_pagar"("cartao_credito_id", "competencia");
