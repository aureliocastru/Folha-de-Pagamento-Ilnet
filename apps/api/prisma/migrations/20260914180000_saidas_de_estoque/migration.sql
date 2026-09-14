-- Almoxarifado: a saída de material — pra onde foi, quem pegou, quando.
--
-- O saldo continua sendo do IXC: a saída vai para lá como transferência para o
-- almoxarifado "Saídas". O que se guarda aqui é o que o IXC não tem onde
-- escrever, e é o histórico de cada produto.

CREATE TABLE "saidas_de_estoque" (
    "id" TEXT NOT NULL,
    "produto_id" INTEGER NOT NULL,
    "descricao" TEXT NOT NULL,
    "unidade" TEXT,
    "almox_id" INTEGER NOT NULL,
    "almoxarifado" TEXT NOT NULL,
    "quantidade" DECIMAL(18,5) NOT NULL,
    "destino" TEXT NOT NULL,
    "quem_pegou" TEXT NOT NULL,
    "observacao" TEXT,
    "data" TIMESTAMP(3) NOT NULL,
    "transferencia_ixc_id" INTEGER,
    "registrado_por" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saidas_de_estoque_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "saidas_de_estoque_produto_id_data_idx" ON "saidas_de_estoque"("produto_id", "data");
