-- Seguranca do Trabalho: a Analise Preliminar de Risco (APR).
--
-- O papel que o tecnico preenche antes de subir no poste, exigido pela NR-35 e
-- pela NR-10. Duas metades, e a divisa entre elas e o que faz o modulo crescer
-- sem codigo novo: o **modelo** e o formulario em branco (os riscos que se
-- marcam, os EPIs que se conferem, as perguntas do relato), e a **APR** e uma
-- vez em que ele foi preenchido.
--
-- Quase tudo na APR e retrato congelado -- titulo, nome da empresa, orientacoes,
-- o texto de cada item marcado. E a mesma regra do recibo da diaria: reimprimir
-- a APR de marco tem de dar o papel que a equipe assinou em marco, mesmo que a
-- lista de riscos tenha mudado desde entao.

-- O perfil de quem trabalha em campo. E o unico cujo modulo nao se distribui
-- pela tela: ele abre a Seguranca do Trabalho e mais nada, sempre. Ver o
-- ModulosGuard -- a lista de modulos e de restricao (vazia = todos), e um login
-- de campo criado sem que alguem lembrasse de preenche-la enxergaria a folha de
-- pagamento inteira.
ALTER TYPE "UserRole" ADD VALUE 'TECNICO';

CREATE TYPE "CategoriaItemApr" AS ENUM ('NORMA', 'ATIVIDADE', 'RISCO', 'FERRAMENTA', 'PROTECAO', 'RELATO');
CREATE TYPE "GravidadeApr" AS ENUM ('BAIXA', 'MEDIA', 'ALTA');
CREATE TYPE "RespostaRelato" AS ENUM ('SIM', 'NAO', 'NAO_SE_APLICA');
CREATE TYPE "StatusApr" AS ENUM ('RASCUNHO', 'LIBERADA', 'CANCELADA');

-- O numero do documento, para achar uma APR pelo papel.
--
-- Sequencia do proprio banco, e nao MAX(numero)+1 na aplicacao: duas equipes
-- abrindo a APR do dia no mesmo minuto e o caso comum aqui, nao o raro, e o
-- MAX daria o mesmo numero as duas. A sequencia nao volta atras nem se a
-- transacao for desfeita -- um buraco na numeracao e barato; dois documentos
-- com o mesmo numero, nao.
CREATE SEQUENCE "apr_numero_seq" START 1;

-- O formulario em branco.
CREATE TABLE "modelos_apr" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "tipo_trabalho" TEXT NOT NULL,
    -- As orientacoes de seguranca e o plano de resgate, em texto corrido. Nao
    -- sao campos a preencher: sao o que a empresa manda fazer, e vao no papel
    -- para quem assina ter lido. Ficam aqui, editaveis, porque procedimento
    -- muda -- e quem escreve a versao nova e a seguranca do trabalho, nao quem
    -- tem acesso ao codigo.
    "orientacoes" TEXT NOT NULL,
    "plano_resgate" TEXT NOT NULL,
    "telefones_emergencia" TEXT NOT NULL DEFAULT '',
    -- O modelo que a tela abre quando ninguem escolhe. So um fica marcado.
    "padrao" BOOLEAN NOT NULL DEFAULT false,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "modelos_apr_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "modelos_apr_nome_key" ON "modelos_apr"("nome");

-- Uma linha do formulario: um risco, um EPI, uma ferramenta, uma pergunta.
CREATE TABLE "itens_apr" (
    "id" TEXT NOT NULL,
    "modelo_id" TEXT NOT NULL,
    "categoria" "CategoriaItemApr" NOT NULL,
    "texto" TEXT NOT NULL,
    -- Sobra espaco entre os valores (10, 20, 30...) para caber um item novo no
    -- meio sem renumerar a lista toda.
    "ordem" INTEGER NOT NULL,
    -- Marcar este item abre um campo de texto ("Outros, quais?").
    "pede_detalhe" BOOLEAN NOT NULL DEFAULT false,
    -- So para o relato: responder "Nao" obriga a escrever o que foi feito a
    -- respeito. E o unico acrescimo desta versao ao papel -- nele o "Nao" cabe
    -- num quadradinho e vai embora.
    "exige_providencia" BOOLEAN NOT NULL DEFAULT true,
    -- Item desativado some do formulario em branco, mas continua respondendo
    -- pelas APRs em que ja foi marcado -- elas guardam o texto que viram.
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "itens_apr_pkey" PRIMARY KEY ("id")
);

-- O mesmo risco nao entra duas vezes na mesma lista. O papel de origem repetia
-- "Umidade", "Calor" e "Quedas" em colunas diferentes; aqui a repeticao e
-- recusada pelo banco, e nao pela boa memoria de quem cadastra.
CREATE UNIQUE INDEX "itens_apr_modelo_id_categoria_texto_key" ON "itens_apr"("modelo_id", "categoria", "texto");
CREATE INDEX "itens_apr_modelo_id_categoria_ordem_idx" ON "itens_apr"("modelo_id", "categoria", "ordem");

-- Uma APR preenchida: um servico, um dia, uma equipe.
CREATE TABLE "aprs" (
    "id" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "modelo_id" TEXT NOT NULL,
    "status" "StatusApr" NOT NULL DEFAULT 'RASCUNHO',
    -- O cabecalho do papel, congelado
    "empresa_nome" TEXT NOT NULL,
    "empresa_cnpj" TEXT,
    "titulo" TEXT NOT NULL,
    "tipo_trabalho" TEXT NOT NULL,
    -- O campo que responde "onde eles estavam?"
    "local" TEXT NOT NULL,
    "coordenador" TEXT NOT NULL,
    "previsao_inicio" DATE,
    "previsao_fim" DATE,
    -- O comeco de verdade, com hora. O fim fica vazio ate a equipe encerrar.
    "inicio_em" TIMESTAMP(3) NOT NULL,
    "fim_em" TIMESTAMP(3),
    -- 0, 1 ou 2 -- as duas prorrogacoes que o papel preve.
    "prorrogacoes" INTEGER NOT NULL DEFAULT 0,
    "motivo_prorrogacao" TEXT,
    "descricao_etapas" TEXT NOT NULL,
    "gravidade" "GravidadeApr" NOT NULL,
    -- O texto fixo, congelado junto
    "orientacoes" TEXT NOT NULL,
    "plano_resgate" TEXT NOT NULL,
    "telefones_emergencia" TEXT NOT NULL DEFAULT '',
    -- Sem chave estrangeira de proposito: apagar um login nao pode levar junto
    -- a APR que ele abriu, e o nome congelado responde pelo documento mesmo
    -- depois de a pessoa sair da empresa.
    "criado_por_id" TEXT,
    "criado_por_nome" TEXT NOT NULL,
    "supervisor_nome" TEXT,
    "supervisor_assinatura" TEXT,
    "supervisor_em" TIMESTAMP(3),
    -- Cancelar sem dizer o motivo e apagar sem apagar.
    "motivo_cancelamento" TEXT,
    "cancelada_em" TIMESTAMP(3),
    -- O PDF desta APR arquivado na estante do RH. A APR liberada e um documento
    -- da casa, e a casa ja tem um lugar onde se procura documento: a pasta da
    -- empresa. O papel continua sendo gerado sob demanda a partir do retrato
    -- congelado -- o arquivo de la e copia, para quem procura pelo caminho de la.
    "documento_rh_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "aprs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "aprs_numero_key" ON "aprs"("numero");
-- Uma copia por APR: rearquivar troca o documento, nao acumula copias velhas.
CREATE UNIQUE INDEX "aprs_documento_rh_id_key" ON "aprs"("documento_rh_id");
CREATE INDEX "aprs_status_idx" ON "aprs"("status");
CREATE INDEX "aprs_inicio_em_idx" ON "aprs"("inicio_em");
CREATE INDEX "aprs_criado_por_id_idx" ON "aprs"("criado_por_id");

-- O que foi marcado (ou respondido), com o texto que estava na tela.
CREATE TABLE "respostas_apr" (
    "id" TEXT NOT NULL,
    "apr_id" TEXT NOT NULL,
    "item_id" TEXT,
    -- Denormalizados de proposito: sao eles que imprimem o papel, e e por eles
    -- que se pergunta "em quantos servicos marcaram descarga eletrica?" sem
    -- depender de o item ainda existir.
    "categoria" "CategoriaItemApr" NOT NULL,
    "texto" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL,
    "marcado" BOOLEAN NOT NULL DEFAULT false,
    "resposta" "RespostaRelato",
    -- O "quais?" de quem marcou "Outros", e a providencia de quem respondeu
    -- "Nao" a uma pergunta do relato.
    "detalhe" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "respostas_apr_pkey" PRIMARY KEY ("id")
);

-- Uma resposta por item em cada APR. A chave e o texto, e nao o id do item:
-- e o texto que o papel imprime, e e ele que nao pode aparecer duas vezes na
-- mesma folha.
CREATE UNIQUE INDEX "respostas_apr_apr_id_categoria_texto_key" ON "respostas_apr"("apr_id", "categoria", "texto");
CREATE INDEX "respostas_apr_apr_id_idx" ON "respostas_apr"("apr_id");
CREATE INDEX "respostas_apr_item_id_idx" ON "respostas_apr"("item_id");
CREATE INDEX "respostas_apr_categoria_idx" ON "respostas_apr"("categoria");

-- Quem executou o servico, e a assinatura de cada um.
CREATE TABLE "executantes_apr" (
    "id" TEXT NOT NULL,
    "apr_id" TEXT NOT NULL,
    -- Vazio e o terceirizado que apareceu no servico: o nome digitado responde
    -- por ele.
    "funcionario_id" TEXT,
    "nome" TEXT NOT NULL,
    "cpf" TEXT,
    -- PNG da assinatura, em data URL. Vazio ate a pessoa assinar.
    "assinatura_png" TEXT,
    "assinado_em" TIMESTAMP(3),
    -- Desenhada com o dedo, ou gerada a partir do nome de quem nao assina de
    -- proprio punho. Sai impresso: um papel que aparenta punho proprio sem ser
    -- vale menos que um sem assinatura nenhuma.
    "modo" "ModoAssinatura" NOT NULL DEFAULT 'DESENHADA',
    -- De onde veio a assinatura, para o caso de alguem contestar.
    "ip" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "executantes_apr_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "executantes_apr_apr_id_idx" ON "executantes_apr"("apr_id");
CREATE INDEX "executantes_apr_funcionario_id_idx" ON "executantes_apr"("funcionario_id");

-- CASCADE de dentro para fora: apagar uma APR leva junto o que so existe
-- dentro dela (as respostas e as assinaturas). RESTRICT no modelo: um
-- formulario que ja gerou documento nao se apaga por engano -- desativa-se.
ALTER TABLE "itens_apr"
  ADD CONSTRAINT "itens_apr_modelo_id_fkey"
  FOREIGN KEY ("modelo_id") REFERENCES "modelos_apr"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "aprs"
  ADD CONSTRAINT "aprs_modelo_id_fkey"
  FOREIGN KEY ("modelo_id") REFERENCES "modelos_apr"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "respostas_apr"
  ADD CONSTRAINT "respostas_apr_apr_id_fkey"
  FOREIGN KEY ("apr_id") REFERENCES "aprs"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- SET NULL: apagar um risco da lista nao pode apagar o registro de que ele foi
-- marcado num servico.
ALTER TABLE "respostas_apr"
  ADD CONSTRAINT "respostas_apr_item_id_fkey"
  FOREIGN KEY ("item_id") REFERENCES "itens_apr"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "executantes_apr"
  ADD CONSTRAINT "executantes_apr_apr_id_fkey"
  FOREIGN KEY ("apr_id") REFERENCES "aprs"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "executantes_apr"
  ADD CONSTRAINT "executantes_apr_funcionario_id_fkey"
  FOREIGN KEY ("funcionario_id") REFERENCES "funcionarios"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Quem apagar a copia pela tela do RH nao desfaz a APR, so desfaz a copia. A
-- proxima mudanca arquiva de novo.
ALTER TABLE "aprs"
  ADD CONSTRAINT "aprs_documento_rh_id_fkey"
  FOREIGN KEY ("documento_rh_id") REFERENCES "documentos_rh"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
