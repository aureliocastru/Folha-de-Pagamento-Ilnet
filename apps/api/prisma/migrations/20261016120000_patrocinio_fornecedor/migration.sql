-- Patrocínio: o patrocinado passa a receber como o fornecedor que ele já é no
-- IXC, e não mais por um cadastro de diarista. O pagamento vira conta a pagar
-- para esse fornecedor, e o que já se mandou é lido dos títulos dele.

-- AlterTable
ALTER TABLE "patrocinados" ADD COLUMN "id_fornecedor_ixc" INTEGER,
ADD COLUMN "fornecedor_nome" TEXT;

-- Quem já estava ligado a um diarista com fornecedor no IXC leva o fornecedor
-- dele. Dois patrocinados no mesmo fornecedor: fica o cadastrado primeiro, e o
-- outro aparece sem fornecedor, para ligar pela tela.
UPDATE "patrocinados" p
SET "id_fornecedor_ixc" = x."id_fornecedor_ixc",
    "fornecedor_nome" = x."nome"
FROM (
    SELECT DISTINCT ON (d."id_fornecedor_ixc")
        p2."id" AS "patrocinado_id",
        d."id_fornecedor_ixc",
        d."nome"
    FROM "patrocinados" p2
    JOIN "diaristas" d ON d."id" = p2."diarista_id"
    WHERE d."id_fornecedor_ixc" IS NOT NULL
    ORDER BY d."id_fornecedor_ixc", p2."created_at"
) x
WHERE p."id" = x."patrocinado_id";

-- DropForeignKey
ALTER TABLE "patrocinados" DROP CONSTRAINT "patrocinados_diarista_id_fkey";

-- DropIndex
DROP INDEX "patrocinados_diarista_id_key";

-- AlterTable
ALTER TABLE "patrocinados" DROP COLUMN "diarista_id";

-- CreateIndex
CREATE UNIQUE INDEX "patrocinados_id_fornecedor_ixc_key" ON "patrocinados"("id_fornecedor_ixc");
