-- Os motivos de um toque, cadastrados pelo ADMIN, e a foto de cada lancamento.
--
-- Os pontos passam a ser sempre +1 ou -1: o que se escolhe e o motivo, e nao
-- a quantidade.

-- A foto mora numa tabela a parte: sao centenas de KB cada, e o painel le os
-- lancamentos do mes inteiro para somar pontos.
CREATE TABLE "fotos_dos_pontos" (
    "id" TEXT NOT NULL,
    "lancamento_id" TEXT NOT NULL,
    "foto" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fotos_dos_pontos_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fotos_dos_pontos_lancamento_id_key" ON "fotos_dos_pontos"("lancamento_id");

ALTER TABLE "fotos_dos_pontos"
  ADD CONSTRAINT "fotos_dos_pontos_lancamento_id_fkey"
  FOREIGN KEY ("lancamento_id") REFERENCES "lancamentos_de_pontos"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "motivos_de_pontos" (
    "id" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "positivo" BOOLEAN NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "motivos_de_pontos_pkey" PRIMARY KEY ("id")
);

-- Os motivos que ja apareciam na tela, para a lista nao comecar vazia. O ADMIN
-- troca, apaga e acrescenta a partir daqui.
INSERT INTO "motivos_de_pontos" ("id", "texto", "positivo") VALUES
  ('5a1f0c3e-0001-4000-8000-000000000001', 'Pontualidade', true),
  ('5a1f0c3e-0001-4000-8000-000000000002', 'Elogio de cliente', true),
  ('5a1f0c3e-0001-4000-8000-000000000003', 'Serviço bem feito', true),
  ('5a1f0c3e-0001-4000-8000-000000000004', 'Ajudou a equipe', true),
  ('5a1f0c3e-0001-4000-8000-000000000005', 'Atraso', false),
  ('5a1f0c3e-0001-4000-8000-000000000006', 'Falta sem aviso', false),
  ('5a1f0c3e-0001-4000-8000-000000000007', 'Retrabalho', false),
  ('5a1f0c3e-0001-4000-8000-000000000008', 'Material perdido', false);
