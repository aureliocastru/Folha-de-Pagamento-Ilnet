-- A marca de que o preco base de um produto (no IXC) foi conferido.

-- CreateTable
CREATE TABLE "precos_conferidos" (
    "id_produto_ixc" INTEGER NOT NULL,
    "preco" DECIMAL(14,2) NOT NULL,
    "conferido_por" TEXT NOT NULL,
    "conferido_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "precos_conferidos_pkey" PRIMARY KEY ("id_produto_ixc")
);
