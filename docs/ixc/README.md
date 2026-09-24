# Webservice do IXC — o que este app chama

A coleção Postman oficial está aqui em `API-IXC-Provedor.postman_collection.json`,
com **1.067 chamadas documentadas**. Ela vive no repositório porque a falta dela
já custou caro: a baixa de conta a pagar apontava para um recurso inexistente e
ninguém tinha como saber, porque o IXC responde a isso do mesmo jeito que
responde a uma requisição malformada.

> A credencial que vinha embutida na coleção foi retirada — os campos de auth
> saem como `{{IXC_TOKEN}}`. Ao importar no Postman, preencha com o seu token.

## Como procurar um endpoint aqui

```bash
node -e "const d=require('./docs/ixc/API-IXC-Provedor.postman_collection.json');(function a(n,c){for(const i of n.item??[]){const p=[...c,i.name];const u=i.request?.url?.raw??i.request?.url??'';if(u&&/BUSCA/i.test(p.join(' ')+u))console.log(i.request.method,u,'<-',p.join(' > '));if(i.item)a(i,p)}})(d,[])"
```

Troque `BUSCA` pelo que procura (`baixa`, `fornecedor`, `auditoria`…).

## O que o app usa, e o que foi conferido contra a base real

| Uso | Recurso | Situação |
| --- | --- | --- |
| Contas a pagar (ler, criar, editar, apagar) | `fn_apagar` | documentado |
| Aprovar/reprovar na auditoria | `fn_apagar_auditoria` | documentado |
| **Quitar uma conta a pagar** | `botao_pagar_26409` | documentado — "Baixa manual (Pagar)"; confirmado quitando um título real |
| Estornar uma baixa | `fn_apagar_baixas/{id}` (DELETE) | documentado, ainda não usado aqui |
| Ler as baixas (o dia em que o dinheiro saiu) | `fn_apagar_baixas` (GET) | **não documentado**; sondado em tempo de execução (ver abaixo) |
| Fornecedores | `fornecedor` | documentado |
| Funcionários | `funcionarios` | documentado |
| Adiantamento de salário | `fl_adto_salario` | documentado |
| Contas de pagamento (banco/caixa) | `contas` | documentado |
| Dados bancários e PIX do fornecedor | `dados_bancarios` | **não documentado**, confirmado na base |
| Movimento de uma conta (banco e caixa) | `fn_movim_finan` (GET) | documentado como "Contabilidade"; é daqui que o Fechamento de Caixa lê |
| Marcar uma linha como conciliada | — | **não dá**: o campo é ignorado em toda escrita (ver abaixo) |
| Lançamento na movimentação financeira | — | **não existe** (ver abaixo) |
| Conferência de estoque: o que faltou | `transf_almox_top` + `transf_almox_item` para "Perdas e Falhas" | documentado; é a transferência que já andava |
| Conferência de estoque: o que sobrou | `entrada` + `movimento_produtos` (compra de acerto) | documentado; o saldo sobe com a compra ainda aberta |
| Inventário do IXC (ajustar saldo ao contado) | `inventario_estoque` | **não documentado; grava errado pela API** (ver abaixo) |
| OS do técnico (ler) | `su_oss_chamado` por `id_tecnico` | documentado; `id_tecnico` é o `funcionarios.id` (o `ixcId` daqui) |
| Aparelho instalado na OS | `su_oss_mov_comodato_wiz` (POST) | documentado — **ainda não conferido contra a base** (ver abaixo) |
| Aparelho retirado do cliente | `baixar_comodato_23069` | documentado — **ainda não conferido contra a base** |
| Material gasto na OS | `su_oss_mov_produto` (POST) | documentado — **ainda não conferido contra a base** |
| O almoxarifado do técnico | `usuarios.funcionario` → `almox_usuario` (padrão) | documentado (fluxo "Produtos do técnico") |

### As escritas da OS ainda não foram provadas nesta base

O módulo Ordens de Serviço (`apps/api/src/os`) escreve em três recursos que
este app nunca tinha usado, e **nenhum deles foi testado contra o IXC de
verdade** quando o módulo foi escrito — os corpos seguem a coleção campo a
campo (`os/os-ixc.ts`), mas a coleção já errou antes (ver o Inventário acima).

**O que a leitura da base já mostrou** (24/09/2026, só leitura, pelas linhas que
o próprio IXC grava quando o técnico mexe na OS):

- **O comodato vale quando a linha nasce, e não ao finalizar a OS.** Na OS
  92279, ainda encaminhada, a linha 1016480 de `su_oss_mov_comodato_wiz` já
  tinha a ONU em comodato (situação 4), fora da van.
- **O `tipo` do exemplo da documentação está errado.** O exemplo manda `"C"`; a
  linha real tem `tipo: "S"` (o tipo do movimento — saída), `tipo_produto:
  "P"`, `garantia_oss: "N"` e `ultima_situacao_patrimonio` com a situação de
  antes ("7"). O corpo daqui segue a linha real (`os/os-ixc.ts`).
- **A listagem de `su_oss_mov_produto` ignora o filtro por OS** — devolve zero
  até para a OS que tem linha. Quem precisa das linhas de uma OS lê
  `movimento_produtos` com `movimento_produtos.id_oss_chamado` (esse filtra
  certo, mas não devolve `id_oss_chamado` nem `status_comodato` nas colunas).
  `su_oss_mov_comodato_wiz` filtra certo e devolve tudo.

- **Filtro de data em `grid_param` é "AAAA-MM-DD HH:MM:SS".** Os exemplos da
  coleção ("OS finalizadas por técnico/mês") usam "DD/MM/AAAA"; com esse
  formato o IXC não reclama, mas não filtra — devolveu 7.392 OS finalizadas de
  um técnico, contra 17 com a data no formato certo.
- **A ferramenta da van é patrimônio igual à ONU**, no mesmo subgrupo (7):
  escada, caneta de limpeza, carrinho de drop. Não há campo do IXC que separe;
  quem separa é a lista de aparelhos que a base monta na tela "Lista da OS".

Continua sem prova o `baixar_comodato_23069` e o material na OS, que nenhuma
linha lida mostrou.

**Como testar sem risco.** Com `IXC_SOMENTE_LEITURA=1` no `.env`, toda escrita é
recusada antes de sair do app (`ixc/ixc.http.ts`). Foi assim que o módulo
inteiro rodou contra a base real em 24/09/2026: técnicos, vans, OS, comodato
do contrato, anotações, e o "Enviar ao IXC" recusado pela trava — com a
releitura do IXC confirmando, item a item, que nada foi gravado. Por isso cada escrita é **relida** logo depois
(`OsService.conferirDepoisDeGravar`): a peça instalada tem de aparecer em
comodato (situação 4), a retirada de volta na van, e o saldo do material mais
baixo. O que não bater fica gravado **com aviso**, visível na OS e na tela da
base — nunca em silêncio.

**Antes de soltar para a equipe**, faça uma troca de teste numa OS e num
contrato de teste, e confira no IXC: o comodato na aba da OS e na do contrato,
a peça nova fora da van, a velha de volta na van, o conector saindo do saldo.
Se o IXC gravar diferente do esperado, os avisos dizem o quê — e o corpo a
acertar está em `os/os-ixc.ts`.

### `data_pagamento` não é o dia em que o dinheiro saiu

Em `fn_apagar`, essa coluna guarda o dia em que a **baixa foi registrada**. Quem
paga o boleto pelo aplicativo do banco e só depois vem lançar registra sempre
depois: uma compra vencida em 15/08 e paga no dia, lançada no dia 16, fica lá
com `data_pagamento = 16/08` — e o histórico daqui acusava "pago 1 dia depois"
de um pagamento feito no vencimento.

O dia informado por quem baixou está na **linha de baixa**, a mesma que a aba
"Pagamentos" do título mostra na tela do IXC (ID, Documento, Conta/Caixa, Data,
Valor, Histórico). Ela não tem leitura documentada do lado do pagar: a coleção
traz a listagem do lado do receber (`fn_areceber_baixas`, filtrando por
`fn_movim_finan.*`) e, do lado do pagar, só o DELETE de estorno —
`fn_apagar_baixas/{id_movim_finan}`, que é de onde saem o nome do recurso e a
tabela por trás dele.

Por isso `baixas-do-ixc.service.ts` **pergunta à base** em vez de confiar num
nome: testa `fn_apagar_baixas` e `fn_movim_finan`, nos dois formatos de data, e
guarda o que responder com linhas reconhecíveis — linha que não aponte um título
não serve, mesmo vindo sem erro. Não achando caminho, o histórico mostra a data
do registro e diz na tela que é ela.

### A conciliação bancária não passa pelo webservice

Fica registrado porque custou uma investigação inteira, e porque a resposta é
"não dá" — que é exatamente o tipo de coisa que alguém tenta de novo daqui a um
ano. O app **não tem** tela de conciliação por causa disto.

**A marca por linha existe e é legível.** `fn_movim_finan.conciliado` vale `S`
ou `N` — 154 mil linhas conciliadas nesta base. Ela não vem na listagem (o `GET`
devolve 25 colunas e ela não é uma delas, assim como `id_pagar` e `id_receber`),
mas **funciona como filtro**: uma consulta traz as linhas do período, outra as
mesmas com `conciliado = 'S'`, e o cruzamento é por `id`. Coluna que não existe
faz o webservice devolver uma página de erro em HTML — o que serve de sonda para
descobrir se uma coluna existe.

**Escrever nela não funciona, em nenhum verbo.** Testado numa linha criada e
apagada em seguida, numa conta inativa:

```
POST fn_movim_finan  { conciliado: 'S', … }        → linha nasce com conciliado = N
PUT  /{id}  registro inteiro + conciliado          → continua N
PUT  /{id}  ixcsoft: alterar | editar | atualizar  → continua N
POST /{id}  registro inteiro + conciliado          → continua N  (e CRIA outra linha)
```

O campo é ignorado pelo mapa de campos do endpoint. E cuidado com o `PUT`: ele
apaga toda coluna que não for no corpo — mandando o registro inteiro que a
listagem devolve, o que sobrevive é só isso, e `id_pagar`, `id_receber` e
`data2` não vêm na listagem para poderem ser devolvidos. É a família de estrago
do commit `b3d9780`.

**A tela de lá tem tabela própria, e ela não é servida.** Descoberta no tráfego
da interface do IXC:

| O que | Nome |
| --- | --- |
| A grade das conciliações | `fn_conciliacao_lote` |
| O assistente de 4 passos | `fn_conciliacao_lote_wizard` |
| O botão da tela | `botaoAjax_31544` (id da tela: 31544) |

O padrão do botão é o mesmo do `botao_pagar_26409`, que o webservice **serve** e
este app usa para dar baixa. Ainda assim, `fn_conciliacao_lote`,
`fn_conciliacao_lote_wizard` e todas as variações de `botao_*_31544` respondem
"não está disponível" — junto com outros 427 nomes prováveis testados antes de a
interface entregar o nome certo.

**"Não está disponível" não quer dizer que não existe.** `vd_produtos`, que está
na coleção oficial, responde a mesma coisa nesta instalação. A resposta é do
registro de recursos do webservice, não do banco — ou seja, é liberação.

**O que pedir ao suporte do IXC**, se um dia isto voltar à mesa: liberar no
webservice os recursos `fn_conciliacao_lote` (listar/inserir/alterar) e
`fn_conciliacao_lote_wizard` com o botão da tela 31544, e a escrita do campo
`fn_movim_finan.conciliado`.

Enquanto isso, o que o app faz do lado da conciliação é o que importa e já é
escrito lá: **a baixa do título** (`botao_pagar_26409`) e **a despesa lançada**
(`fn_apagar`). Achado o pagamento que faltava, ele é resolvido no IXC — e a
conciliação de lá fecha sozinha, porque não falta mais lançamento.

### Duas armadilhas que já morderam

**A coleção documenta dois nomes para a mesma baixa, e um deles está aposentado.**
`botao_pagar_26409` (Sistema > Pagar > Botões) e `fn_apagar_pagamentos_baixas`
(🔘 Botões > Pagar) aparecem com o mesmo corpo. Só o primeiro é servido por esta
instalação — o segundo responde `Erro inesperado, tente novamente!` a qualquer
chamada, até a uma leitura, enquanto um recurso realmente desconhecido responde
`Recurso X não está disponível!`. Ou seja, o endpoint aposentado se disfarça de
requisição malformada. **Se um endpoint retornar "erro inesperado" sempre,
desconfie do nome antes do payload** — e prefira o que a base responde ao que a
documentação lista primeiro.

**O motivo do erro nem sempre vem em `message`.** Nas baixas ele vem em `valor`:

```json
{"type":"error","valor":"Erro inesperado, tente novamente!"}
```

`IxcClient` lê `message`, `valor` e `mensagem`, nessa ordem.

### O caixa que não dá para lançar

A movimentação financeira (Financeiro > Movimentação > Financeira) **não tem
endpoint no webservice**. Os oito nomes prováveis foram testados um a um contra
o IXC e todos responderam "não está disponível"; a coleção também não traz
equivalente — o que ela tem de "caixa" é caixa de fibra, do mapa da rede.

Por isso o pagamento em mãos não lança a saída do caixa sozinho: ele marca o
pagamento como "lançar no IXC à mão". Não é bug, é o limite do webservice — e
está assim documentado em `ixc.caixa.ts`.

**Mas há uma pista aberta, achada no teste da conciliação.** `fn_movim_finan` —
o recurso que a coleção chama de "Contabilidade" — **aceita `POST`**, e sem os
`id_entrada`/`id_saida` que a documentação marca como obrigatórios: um corpo com
`id_conta`, `data`, `historico`, `debito`, `tipo_lanc` e `filial_id` criou a
linha, que voltou na listagem com `id_movim_finan` igual ao próprio id, e o
`DELETE` a apagou em seguida.

Isso não foi transformado em funcionalidade, e o motivo é o desenho do livro: um
lançamento é um **par** de linhas com o mesmo `id_movim_finan` — o dinheiro
saindo da conta e a despesa entrando. Escrever uma linha só é meio lançamento, e
meio lançamento é pior que nenhum: foi assim que três títulos ficaram tortos
(commit `b3d9780`). Quem for pegar esta ponta precisa gravar o par, e provar em
base de teste que o IXC costura os dois.

### O Inventário do IXC existe no webservice, e grava o movimento errado

Fica registrado porque é a primeira coisa que alguém tenta quando precisa
acertar o estoque ao que foi contado — e a resposta é "não por aqui".

**O recurso existe.** Não está na coleção, mas `inventario_estoque` responde à
listagem (os filtros usam a tabela `inventario.*`; `inventario_estoque.id`
devolve a página de erro em HTML). Cada linha é produto × almoxarifado:
`estoque_atual`, `novo_estoque`, `custo_medio_atual`, `novo_custo_medio`,
`data_inventario`. Esta base tem 468 linhas, a última de 18/08/2021, e cada uma
gerou um `movimento_produtos` com `tipo = I` e `id_inventario` apontando para
ela — pela tela do IXC, o movimento sai certo (0 → 1 vira entrada de 1; 411 → 0
vira saída de 411) e o IXC calcula a diferença pelo saldo real, não pelo
`estoque_atual` mandado (a linha 840 diz `999999.999999999` e o movimento foi
de 1).

**Pela API, não.** Testado em 13/09/2026, com autorização, no produto 624 e no
almoxarifado "Perdas e Falhas" (vazio):

```
POST inventario_estoque { id_produto: 624, id_almox: 43, estoque_atual: 0, novo_estoque: 1, … }
  → {"type":"success","id":894}
  → movimento 1012409: tipo I, qtde_saida 1, id_almox 1   ← SAÍDA, no Almoxarifado Principal
```

O almoxarifado veio errado (o Principal, e não o mandado) e o sinal também. O
`DELETE inventario_estoque/894` apagou a linha **e o movimento junto**, e o
saldo voltou ao que era. Não se tentou adivinhar outros nomes de campo: cada
tentativa é um movimento torto em produção.

**Por isso a conferência de estoque** (`almoxarifado/conferencia.ts`) lança pelo
que já anda: o que faltou vai por transferência para "Perdas e Falhas", e o que
sobrou volta de lá ou entra por compra de acerto (documento
`CONFERENCIA DE ESTOQUE (sistema)`). O saldo de Perdas e Falhas continua no IXC
— aqui ele não soma no total da casa. Zerar Perdas e Falhas de vez é pela tela
de Inventário do IXC, que grava certo.

**O que pedir ao suporte do IXC**, se isto voltar à mesa: quais campos o
`inventario_estoque` precisa receber na inserção para gerar o movimento no
almoxarifado da linha, e com o sinal de `novo_estoque − saldo`.
