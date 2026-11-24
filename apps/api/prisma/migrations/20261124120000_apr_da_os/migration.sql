-- A APR vem com a ordem de serviço do IXC (pedido de 24/11/2026).
--
-- O técnico não abre mais APR solta: cada OS que o IXC encaminha a ele traz a
-- sua, e ao liberar o PDF vai para a aba "Arquivos" da OS no IXC.
ALTER TABLE "aprs"
  ADD COLUMN "os_ixc_id" INTEGER,
  ADD COLUMN "arquivo_na_os_ixc_id" INTEGER,
  ADD COLUMN "arquivo_na_os_em" TIMESTAMP(3),
  ADD COLUMN "arquivo_na_os_erro" TEXT;

CREATE INDEX "aprs_os_ixc_id_idx" ON "aprs"("os_ixc_id");

-- Uma APR valendo por OS.
--
-- Índice parcial, que o Prisma não sabe declarar — por isso ele mora aqui e há
-- um comentário no schema apontando para cá. A cancelada fica de fora: o
-- serviço que não aconteceu, ou a OS que passou para outro técnico, deixa a
-- OS pronta para receber uma APR nova. Sem ele, dois toques em "Continuar" no
-- primeiro passo abririam duas APRs para a mesma OS.
CREATE UNIQUE INDEX "aprs_uma_por_os"
  ON "aprs"("os_ixc_id")
  WHERE "os_ixc_id" IS NOT NULL AND "status" <> 'CANCELADA';
