-- A aba Controle: quem deve a quem está logado, e quanto. Só lembrete — não
-- tem data, não soma em lugar nenhum e não vai ao IXC.
CREATE TABLE "dinheiro_a_receber" (
    "id" TEXT NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "pessoa" TEXT NOT NULL,
    "valor" DECIMAL(14,2) NOT NULL,
    "observacao" TEXT,
    "recebido_em" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dinheiro_a_receber_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "dinheiro_a_receber_usuario_id_recebido_em_idx"
  ON "dinheiro_a_receber"("usuario_id", "recebido_em");

ALTER TABLE "dinheiro_a_receber"
  ADD CONSTRAINT "dinheiro_a_receber_usuario_id_fkey"
  FOREIGN KEY ("usuario_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
