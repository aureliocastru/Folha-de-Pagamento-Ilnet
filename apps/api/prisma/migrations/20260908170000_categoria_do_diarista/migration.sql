-- A categoria do acerto do diarista.
--
-- O pagamento avulso ganhou categoria no cadastro em agosto, e a folha se
-- etiqueta sozinha desde antes disso. A diária ficou de fora das duas coisas:
-- o tipo DIARIA não entra na etiquetagem automática da folha (ver
-- `TIPOS_DA_FOLHA`, e o motivo escrito lá — "a diária é de diarista"), e a tela
-- de pagar diarista nunca teve o campo. Resultado: todo acerto de semana caía
-- em "Sem categoria" no painel do Contas a Pagar, que é justamente onde ele
-- seria procurado.
--
-- Mesma solução do avulso: a escolha mora no cadastro de quem recebe, o
-- pagamento seguinte já abre marcado, e trocá-la na hora de pagar regrava o
-- padrão.
ALTER TABLE "diaristas" ADD COLUMN "categoria_id" TEXT;

ALTER TABLE "diaristas"
  ADD CONSTRAINT "diaristas_categoria_id_fkey"
  FOREIGN KEY ("categoria_id") REFERENCES "categorias_despesa"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- O padrão de quem já recebeu sai do que já foi etiquetado à mão.
--
-- Sem isto, "já vem marcado" só valeria do próximo pagamento em diante, e a
-- primeira vez de cada diarista continuaria sendo a que escapa. A etiqueta do
-- título mais recente daquela pessoa é a melhor aposta que existe aqui: é a
-- última decisão que alguém tomou sobre ela.
--
-- É aposta, e não lei: é só o que a tela mostra escolhido, e quem discordar
-- troca no ato de pagar.
UPDATE "diaristas" d
SET "categoria_id" = (
  SELECT cc."categoria_id"
    FROM "contas_pagar" c
    JOIN "classificacoes_conta" cc ON cc."id_fn_apagar" = c."id_fn_apagar_ixc"
   WHERE c."diarista_id" = d."id"
   ORDER BY c."created_at" DESC
   LIMIT 1
)
WHERE d."categoria_id" IS NULL;
