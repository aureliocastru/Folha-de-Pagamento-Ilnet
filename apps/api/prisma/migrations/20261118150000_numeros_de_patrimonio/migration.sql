-- O tombo que o sistema da a cada peca de patrimonio (de 37871 em diante).

-- CreateTable
CREATE TABLE "numeros_de_patrimonio" (
    "numero" INTEGER NOT NULL,
    "id_patrimonio_ixc" INTEGER NOT NULL,
    "id_produto_ixc" INTEGER NOT NULL,
    "produto" TEXT NOT NULL,
    "codigo_anterior" TEXT,
    "id_entrada_ixc" INTEGER,
    "dado_por" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "numeros_de_patrimonio_pkey" PRIMARY KEY ("numero")
);

-- CreateIndex
CREATE UNIQUE INDEX "numeros_de_patrimonio_id_patrimonio_ixc_key" ON "numeros_de_patrimonio"("id_patrimonio_ixc");

-- CreateIndex
CREATE INDEX "numeros_de_patrimonio_id_produto_ixc_idx" ON "numeros_de_patrimonio"("id_produto_ixc");
