-- O número da nota fiscal de cada título do IXC: o "Número da nota" de lá
-- guarda a parcela nesta base, e a contabilidade pede o número da nota.

-- CreateTable
CREATE TABLE "notas_fiscais_dos_titulos" (
    "id_fn_apagar" INTEGER NOT NULL,
    "numero" TEXT NOT NULL,
    "copiado_de" INTEGER,
    "atualizado_por" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notas_fiscais_dos_titulos_pkey" PRIMARY KEY ("id_fn_apagar")
);
