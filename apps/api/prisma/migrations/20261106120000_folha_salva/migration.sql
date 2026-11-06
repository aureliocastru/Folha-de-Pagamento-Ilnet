-- A folha do mês salva: as mudanças feitas na prévia, uma por pagamento e mês.
CREATE TABLE "folhas_salvas" (
    "id" TEXT NOT NULL,
    "modo" TEXT NOT NULL,
    "mes_trabalhado" TEXT NOT NULL,
    "ajustes" JSONB NOT NULL DEFAULT '{}',
    "salvo_por" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "folhas_salvas_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "folhas_salvas_modo_mes_trabalhado_key" ON "folhas_salvas"("modo", "mes_trabalhado");
