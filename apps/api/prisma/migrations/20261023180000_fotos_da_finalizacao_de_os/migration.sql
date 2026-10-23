-- As fotos da finalização pelo celular: guardadas aqui até irem à OS no IXC.
CREATE TABLE "fotos_das_finalizacoes" (
    "id" TEXT NOT NULL,
    "finalizacao_id" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL,
    "nome" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "tamanho" INTEGER NOT NULL,
    "hash" TEXT NOT NULL,
    "conteudo" BYTEA,
    "enviada_em" TIMESTAMP(3),
    "erro" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fotos_das_finalizacoes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fotos_das_finalizacoes_finalizacao_id_hash_key" ON "fotos_das_finalizacoes"("finalizacao_id", "hash");

ALTER TABLE "fotos_das_finalizacoes" ADD CONSTRAINT "fotos_das_finalizacoes_finalizacao_id_fkey" FOREIGN KEY ("finalizacao_id") REFERENCES "finalizacoes_de_os"("id") ON DELETE CASCADE ON UPDATE CASCADE;
