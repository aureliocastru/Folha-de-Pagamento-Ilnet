# Roadmap — Folha de Pagamento

Evolução planejada por fases. Cada fase entrega valor de forma incremental.

## ✅ Fase 1 — Fatia vertical: IXC + Cadastro (entregue)

- [x] Monorepo (NestJS + React) com infra Docker/EasyPanel
- [x] Cliente do webservice IXC (auth por token, paginação, parsing pt-BR)
- [x] Sincronização idempotente de **funcionários** e **adiantamentos**
- [x] API REST de funcionários (listar, buscar, editar, resumo)
- [x] Autenticação JWT (rotas protegidas por padrão)
- [x] Frontend: login, lista com busca/filtro, sync com IXC, detalhe
- [x] Migration inicial + seed do admin
- [x] Testes unitários do núcleo de integração

## ✅ Fase 2 — Folha → Contas a pagar no IXC (entregue)

- [x] Config financeira parametrizável (conta pagamento 18, filial 1, contas
      contábeis: salário 2420 / adiantamento 2662 / bônus 13916, templates de obs)
- [x] Cadastro de funcionário com **carteira assinada** e **recebe adiantamento**,
      salário e **lançamentos fixos** (descontos/adiantamentos/bônus recorrentes)
- [x] Regra do adiantamento dia 25: CLT não desconta do saldo (contabilidade já
      fez); não-CLT desconta
- [x] Motor de cálculo do saldo salarial + prévia da folha por competência
- [x] Geração de **contas a pagar** no IXC (`fn_apagar`): emissão/vencimento hoje,
      valor da folha, conta contábil por tipo, filial 1, observações padronizadas
- [x] Fornecedor criado/vinculado automaticamente por pessoa (`fornecedor`)
- [x] Fluxo: salvar → **aprovar na auditoria** (`fn_apagar_auditoria`) →
      pagar com ModoBank (no IXC) → **monitorar retorno do banco** (polling do status)
- [x] **Pagamentos avulsos** (ex.: patrocínio a quem não é funcionário)
- [x] **Diaristas**: cadastro de quem recebe por diária e histórico das diárias
      pagas, com duas formas — conta a pagar no IXC ou **em mãos**, descontando
      do caixa configurado (movimentação financeira, "CX - Werick")
- [x] Telas: Gerar Folha, Contas a Pagar (com ações), Avulsos, Diaristas,
      Configurações

- [x] Lançamentos **avulsos** por funcionário (competência específica), além dos fixos
- [x] Polling automático do retorno do banco (SYNC_PAGAMENTOS_INTERVALO_MIN, padrão 10 min)
- [x] PIX no fn_apagar (chave do beneficiário) + tipo de pagamento configurável
- [x] **Tipo da chave PIX** vem do tipo preferencial do fornecedor (aba "Dados
      bancários"): a conta a pagar marca o mesmo que está no cadastro
- [x] **Ações em massa** em Contas a Pagar: aprovar, reprovar e excluir várias
      de uma vez, com relatório de quem ficou de fora e por quê
- [x] Reuso de fornecedor existente no IXC por CPF/CNPJ
- [x] **Diaristas importados do fornecedor**: fornecedor ativo com "Tipo de
      pessoa" = **Estrangeiro** é diarista (assim como ICMS Isento é
      funcionário). Traz nome fantasia — que também entra na busca — e os dados
      de pagamento da aba "Dados bancários". Quem já é funcionário fica de fora:
      é um ou outro, nunca os dois. O que está escrito aqui vence o IXC, para
      correção feita na tela não ser desfeita na sincronização seguinte
- [x] **Tipo da chave Pix descoberto sozinho**: o rádio em branco no fn_apagar
      trava o pagamento, e o nome da coluna/código varia por base. O app aprende
      das contas feitas na tela do IXC (ignorando as que ele mesmo criou, para
      não confirmar o próprio erro), com override em Configurações e diagnóstico
      em `GET /contas-pagar/diagnostico-pix`
- [x] **E não esquece mais**: o que foi aprendido fica guardado no banco, um
      código por tipo de chave (CPF/CNPJ, celular, e-mail, aleatória) — cada um
      descoberto de um exemplo diferente, acumulando. Sobrevive ao reinício da
      API e a a conta-exemplo sair das 200 mais recentes do IXC; só se volta lá
      quando falta justamente o código do tipo que vai ser enviado. O que está
      em Configurações continua vencendo, e o decorado aparece na tela
- [x] **Erro do IXC aparece na hora** ao pagar uma diária, em vez da mensagem
      fixa de sucesso — a conta a pagar sempre ficou salva, mas só a tela de
      Contas a Pagar mostrava o motivo
- [x] **"Já pago" só conta o que saiu**: em mãos conta na hora; pelo IXC, só
      quando o banco confirma. O que está a caminho e o que o IXC recusou
      aparecem separados, para a tela não dizer que alguém recebeu o que não
      recebeu

### Pendências desta fase (dependem de você)
- [ ] Automatizar o clique "pagar com ModoBank" — só se o IXC expuser esse
      endpoint (hoje é ação manual na tela do IXC; o app cria/aprova/monitora)
- [ ] **Nome da tabela da movimentação financeira no IXC** (para o lançamento
      no caixa do pagamento em mãos sair sozinho). O app tenta descobrir e, se
      não achar, a diária fica registrada com a pendência; peça o nome ao
      suporte do IXC e informe em Configurações
- [ ] Confirmar a **conta contábil das diárias** (hoje nasce igual à do salário)
- [ ] Confirmar `cidade` padrão para criação de fornecedores no seu IXC
- [ ] Conferir o rótulo exato do tipo de pagamento PIX no seu IXC (Configurações)
- [ ] **Código de "Estrangeiro"** no `tipo_pessoa` do fornecedor: o padrão
      (`E,ESTRANGEIRO`) é uma aposta e o filtro é fail-closed — na dúvida importa
      zero. Confirme em `GET /sync/diaristas/preview`, que mostra a distribuição
      real dos valores da base, antes da primeira importação
- [ ] **Ensinar o tipo da chave Pix, uma vez por tipo**: se nenhuma conta a
      pagar tiver sido feita na tela do IXC com PIX e o tipo marcado, não há de
      quem aprender. Marque o tipo à mão numa conta lá (destrava aquele
      pagamento) e a próxima conta gerada aqui já sai com o formato certo — daí
      em diante aquele tipo fica decorado. Cada tipo de chave (celular, CPF,
      e-mail, aleatória) precisa de um exemplo, e só na primeira vez que
      aparecer; o que já está decorado aparece em Configurações

## 🚧 Fase 2b — Réplica completa da planilha (proventos/descontos detalhados)

- [x] **Comissão de vendas**: valor por venda no cadastro (R$ 5 / R$ 50 / outro)
      e quantidade de vendas por mês trabalhado
- [x] **Horas extras** por mês trabalhado, só para quem **não** tem carteira
      assinada (quem tem recebe pela contabilidade)
- [x] **Vales e acertos** nos dois sentidos (funcionário paga a empresa ×
      empresa paga o funcionário), avulsos ou parcelados, com opção de lançar
      ou não na folha
- [x] Saldo salarial = base + comissão + horas extras + acertos − descontos −
      vales − adiantamento, detalhado na observação da conta a pagar
      (`HORAS EXTRAS: R$ …· COMISSÃO: 12 x R$ 50,00 · VALE: -R$ …`)
- [x] **Dashboard** com folha base, situação da competência, série de 1/3/6/12
      meses, saldos de vales e pontos de atenção
- [x] **Guias da contabilidade lidas do PDF**: DARF previdenciário, guia do
      FGTS Digital, DAS do Simples e DARE do ICMS. O leitor se ancora nos
      rótulos impressos, e não na posição das colunas — que sai embaralhada da
      extração. Nada é gravado direto: a tela mostra o que foi lido, aponta
      quando a soma dos itens não fecha com o total e deixa corrigir a
      classificação de código desconhecido
- [x] **Cada item nasce com uma classe**, senão o número mente em mais de 100%:
      o INSS descontado do segurado é dinheiro do trabalhador só passando pela
      conta, o consignado do FGTS é empréstimo dele, dentro do DAS só o 1006
      (INSS) é custo de pessoal, e o ICMS do DARE é tributo sobre faturamento.
      Custo com pessoal = folha + diaristas + patronal, nunca o retido
- [x] **As guias são conjuntos mensais**, não uma lista: todo mês chegam os três
      fixos (DARF, FGTS, DAS) mais o DARE quando houve ICMS a pagar. A tela diz
      de que mês é o arquivo que está sendo lançado e mostra, mês a mês, o que
      ainda falta chegar
- [x] **Diária travada sai do gasto**: conta a pagar reprovada, cancelada,
      recusada pelo IXC ou apagada de lá nunca virou dinheiro — a série da folha
      já as deixava de fora e a das diárias contava, prendendo a dashboard num
      "ainda não saiu" que não tinha pagamento pendente nenhum por trás. Continua
      visível à parte, na tela de diaristas, com o que é preciso para apagar as
      que foram teste ou refazer as que eram de verdade
- [x] **Guia digitada à mão**: a contabilidade às vezes manda o documento
      digitalizado — uma foto dentro do PDF, sem texto nenhum. Ler aquilo por OCR
      seria adivinhar dígito de imposto; quem tem o papel na mão lê melhor. A
      composição já vem classificada por tipo de guia, que é o que decide o que
      é custo com pessoal
- [x] **Pagamentos avulsos viram cadastro**, como o de diarista, em vez de um
      formulário que digita tudo de novo a cada serviço: mão de obra contratada,
      serviço pontual, patrocínio. Pagamento pelo IXC (com chave PIX e o tipo da
      chave, sem o qual o banco recusa) ou em mãos, saindo do caixa. Conta
      contábil 324, parametrizável
- [x] **CPF/CNPJ que já é fornecedor no IXC é perguntado, não decidido**:
      reaproveitar o cadastro é quase sempre o certo — é lá que estão os dados
      bancários —, mas pode ser homônimo ou documento digitado errado. A tela
      mostra quem achou e deixa escolher entre usar o que existe e criar outro
- [ ] **Proventos** que faltam: bônus de metas, férias, 13º, salário família
- [ ] **Descontos** que faltam: INSS, faltas (tabela de horas/periculosidade),
      celular, internet
- [ ] Parâmetros de hora (normal/50%/100%) e falta/periculosidade
- [ ] Divisão do pagamento: **depositar** × **pagar em mãos** + receitas extras
- [ ] Tela de fechamento mensal consolidado por competência

## 🔜 Fase 3 — Importação do histórico

- [ ] Importar as 14 abas da planilha `.xlsx` (JAN/25 → FEV/26)
- [ ] Conciliação com os funcionários sincronizados do IXC
- [ ] Validação e relatório de divergências

## 🔜 Fase 4 — Comissões e provisões via IXC

- [ ] Puxar vendas por vendedor (`vd_saida`) e contratos ativados
- [ ] Cálculo automático de comissões
- [ ] Provisão de férias e 13º
- [ ] Enviar adiantamentos de volta ao IXC (`fl_adto_salario` POST)

## 🔜 Fase 5 — Relatórios, holerite e governança

- [ ] Holerite/recibo em PDF por funcionário
- [ ] Relatórios e exportações (Excel/CSV) por competência
- [ ] Remessa bancária / lista de PIX para pagamento
- [x] **Gerenciamento de logins**: criar/editar/desativar usuários (só ADMIN),
      troca da própria senha em "Minha conta"
- [x] Perfis de acesso aplicados por rota: `RolesGuard` global — VISUALIZADOR
      só lê (bloqueia POST/PUT/PATCH/DELETE), `@Roles()` para exceções
- [ ] Log de auditoria (quem alterou o quê)
- [ ] Agendamento automático da sincronização com o IXC

## ✅ Módulo Segurança do Trabalho — a APR (entregue)

O papel que o técnico preenche antes de subir no poste, exigido pela NR-35 e
pela NR-10. Transcrito do formulário impresso da casa, sem tirar nada dele.

- [x] **Catálogo editável pela tela**: os riscos que se marcam, os EPIs que se
      conferem, as ferramentas e as perguntas do relato situacional. É o que
      faz o módulo crescer sem release — norma nova e EPI novo não esperam
      ninguém mexer no código
- [x] **Formulário por modelo**: o de trabalho em altura nasce com o sistema;
      outro tipo de trabalho (espaço confinado, poda) entra como outro modelo,
      copiando os itens do primeiro
- [x] **Tela única do técnico** (`/campo`): sem barra lateral e sem escolha de
      módulo. Cinco passos que cabem numa tela de celular, salvando a cada
      passo — o sinal cai onde se trabalha
- [x] **Assinatura de cada executante** no próprio aparelho, com a saída para
      quem não assina de próprio punho (o papel diz qual das duas foi)
- [x] **Conferência de liberação**: a APR só libera o serviço com norma,
      atividade, risco e EPI marcados, o relato inteiro respondido e todo mundo
      assinado. As pendências voltam todas de uma vez
- [x] **Providência obrigatória** em quem responde "Não" no relato — o único
      acréscimo ao papel, onde esse "Não" ia embora sem deixar dito o que foi
      feito
- [x] **PDF timbrado** gerado do retrato congelado, e arquivado sozinho na
      pasta da empresa no RH (`Empresa / Análises de Risco (APR) / AAAA-MM`)
- [x] **Perfil TECNICO**, cujo módulo não se distribui pela tela: ele abre a
      Segurança do Trabalho e mais nada, sempre
- [ ] Prazo de validade dos treinamentos (NR-10/NR-35) por funcionário, com
      recusa de quem está vencido na hora de montar a equipe
- [ ] Painel de riscos por período: o que mais se marca, onde, com que equipe

## Notas técnicas / decisões

- **PostgreSQL + Prisma**: valores monetários em `Decimal(14,2)`; migrations
  versionadas.
- **IXC como fonte de verdade** do cadastro; a folha é calculada e armazenada
  localmente (o IXC não cobre todo o modelo de proventos/descontos da planilha).
- **Idempotência**: sync por `upsert(ixc_id)`; payload cru salvo em `ixc_raw`.
- **Escala**: apps stateless (API e Web) atrás do EasyPanel; podem ser
  replicados horizontalmente com o Postgres como estado compartilhado.
