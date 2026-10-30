# Mudar o sistema para outro servidor

Levar o ILNET FINANCE para outra máquina com EasyPanel. O guia de deploy
([DEPLOY-EASYPANEL.md](DEPLOY-EASYPANEL.md)) ensina a subir do zero; este trata
do que o outro não trata: trazer os dados e virar a chave sem duas cópias do
sistema escrevendo no IXC ao mesmo tempo.

> **Os dois endereços.** O servidor de hoje é **170.0.124.7**; o novo é
> **170.0.124.8**. Diferem no último dígito, e os comandos daqui apontam para um
> ou para o outro em passos diferentes — confira o número antes de cada `ssh` e
> antes de salvar o DNS. Errar o dígito no passo 9 é tirar o dump da máquina
> errada; no passo 12, é deixar o domínio onde já estava.
>
> O EasyPanel do 170.0.124.8 já está no ar (painel em `http://170.0.124.8:3000`)
> e os dois aceitam SSH, que é o que o passo 9 precisa.

### Um atalho, se o IP puder se mudar junto

Os dois endereços são do mesmo bloco `170.0.124.0/24`. Se quem controla esse
bloco é a própria ILNET (ou o provedor aceita reapontar o endereço entre as
máquinas), existe um caminho bem mais curto: **levar o 170.0.124.7 para o
servidor novo** depois de desligar o antigo.

Nesse caminho o DNS não muda, o TTL de quatro horas deixa de importar, o IP já
está liberado no banco e no IXC, e o certificado atual continua valendo — caem
os passos 1, 2 e a troca de DNS do 12. Sobra o que importa: o dump, o restore e
a conferência.

O preço é que a virada passa a depender de uma ação de rede no meio da janela
(o endereço só pode existir numa máquina de cada vez, então é desligar o
antigo, mover, subir o novo), e voltar atrás também. Vale perguntar antes de
seguir pelo caminho longo; o resto do guia supõe que o endereço não se mexe.

---

## O que viaja, e o que não

Três coisas, e só três:

| O quê                  | Como vai                                                     |
| ---------------------- | ------------------------------------------------------------ |
| O código               | Já está no GitHub. O EasyPanel novo constrói do `main`.      |
| As variáveis de ambiente | Copiadas à mão do painel antigo para o novo.                |
| O banco (Postgres)     | `pg_dump` no antigo, `pg_restore` no novo.                   |

**Nada mora no disco do servidor.** Os documentos do RH, os arquivos da
contabilidade, os contratos e arquivos dos patrocinados são colunas `Bytes` no
Postgres; as fotos de abastecimento, de nota e de pontos são data URLs, também
no Postgres; as fotos e a assinatura da finalização de OS vão direto para os
arquivos da OS no IXC. Fora o volume do próprio Postgres, não existe pasta de
uploads para copiar — o dump leva tudo.

Por isso o dump é **grande**. Confira antes (passo 4): é ele que define o
tamanho da janela de parada.

---

## Antes do dia (sem parar nada)

### 1. Libere o 170.0.124.8 no banco e no IXC

O que mais quebra numa troca de servidor não é o deploy, é o endereço. A
credencial do ModoBank é criada com o **IP do servidor liberado** (portal do
banco → Configurações → Credenciais → API CONTAS): do IP novo, o banco recusa a
autenticação e todo pagamento daqui para de sair. Libere o **170.0.124.8**
alguns dias antes, deixando o **170.0.124.7** liberado durante a transição —
são os dois ao mesmo tempo até você ter certeza de que não vai voltar.

No IXC (Configurações → Integrações → Tokens da API), veja se o token tem
restrição de IP. Se tiver, acrescente o novo.

### 2. Baixe o TTL do DNS

Hoje `telecom.ilnet.com.br` responde `170.0.124.7` com **TTL de 14400** — quatro
horas. Trocar o registro sem mexer nisso é deixar parte da equipe caindo no
servidor antigo pelas quatro horas seguintes, e lá a api vai estar parada.

No painel do domínio, ponha o TTL desse registro `A` em **300 segundos**. Quatro
horas antes da virada é o mínimo (é quanto o valor velho ainda vale nos
resolvedores); um dia antes é o certo. Com o TTL baixo, o passo 12 propaga em
minutos.

### 3. Copie as variáveis do servidor antigo

No EasyPanel antigo, serviço `api` → aba **Environment** → copie o texto inteiro
e guarde num lugar seguro (gerenciador de senhas, não o Git). Depois confira
contra esta lista:

| Variável                        | No servidor novo                                                   |
| ------------------------------- | ------------------------------------------------------------------ |
| `DATABASE_URL`                  | **Muda**: aponta para o Postgres novo (passo 5).                   |
| `JWT_SECRET`                    | **Tem de ser o mesmo.** Veja o aviso abaixo.                       |
| `SENHAS_CHAVE`                  | O mesmo, se existir no antigo.                                     |
| `JWT_EXPIRES_IN`                | Igual.                                                             |
| `API_PORT`                      | `3333`.                                                            |
| `CORS_ORIGINS`                  | O domínio público (`https://telecom.ilnet.com.br`).                |
| `IXC_HOST`, `IXC_TOKEN`         | Iguais.                                                            |
| `IXC_TIMEOUT_MS`                | Igual.                                                             |
| `SYNC_PAGAMENTOS_INTERVALO_MIN` | **`0` até a virada** (passo 6), depois o valor do antigo (`10`).   |
| `MODOBANK_*` (as nove)          | Iguais, inclusive os certificados em base64. **Vazias até a virada.** |
| `ADMIN_EMAIL`, `ADMIN_SENHA`    | Iguais, por completude — não serão usadas (passo 10).              |
| `IXC_SOMENTE_LEITURA`           | **`1` até a virada** (passo 6), depois vazia.                      |

> **O `JWT_SECRET` não é só do login.** Ele é também a chave da cópia cifrada
> das senhas que o administrador vê em **Usuários** (`senhaCifrada`, AES-256-GCM
> — veja `apps/api/src/usuarios/cifra-de-senha.ts`). Entrar no sistema continua
> funcionando com segredo novo, porque a conferência é pelo hash do bcrypt; mas
> com outro segredo a tela para de mostrar as senhas guardadas e passa a pedir
> que se gere uma nova para cada login. Copie o valor exato.

Os certificados do ModoBank são blocos longos de base64. Copie-os por inteiro,
sem quebra de linha no meio.

### 4. Confira a versão e o tamanho do banco

No EasyPanel antigo, **Console** do serviço `db`:

```bash
psql -U USUARIO -d BANCO -c "select version()"
psql -U USUARIO -d BANCO -c "select pg_size_pretty(pg_database_size(current_database()))"
```

(O usuário e o nome do banco estão na `DATABASE_URL` que você copiou.)

O Postgres novo tem de ser **da mesma versão maior ou mais novo** — restaurar um
dump do 16 num 15 não funciona. E o tamanho em disco é a sua estimativa de
tempo: um banco de 2 GB é coisa de poucos minutos entre dump, transferência e
restore; 20 GB é outra conversa, e aí vale fazer um ensaio antes (passo 7 inteiro
com um dump de véspera) para não descobrir no dia.

---

## Subir a pilha nova (com o antigo ainda no ar)

### 5. Projeto, banco, api e web

Siga o [DEPLOY-EASYPANEL.md](DEPLOY-EASYPANEL.md) do começo: **Create Project**
(ex.: `folha`), **+ Service → Postgres** (`db`), e os dois **App** (`api` e
`web`), ambos apontando para `https://github.com/aureliocastru/Folha-de-Pagamento-Ilnet.git`,
branch `main`, build por Dockerfile (`apps/api/Dockerfile` e
`apps/web/Dockerfile`, contexto `/` nos dois).

O nome do projeto entra nos hosts internos. Com o projeto chamado `folha`:

```
DATABASE_URL=postgresql://USUARIO:SENHA@folha_db:5432/BANCO?schema=public
API_UPSTREAM=folha_api:3333
```

Projeto com outro nome, hosts com outro prefixo — é a causa número um de "a api
não acha o banco" e de "o web dá 502".

O `web` não precisa de variável nenhuma além do `API_UPSTREAM`: o frontend chama
`/api` no próprio domínio e é o nginx dele que encaminha. A imagem não tem o
domínio embutido, então serve qualquer endereço sem rebuild.

### 6. Suba a api **sem** poder escrever

Esta é a parte que não pode ser pulada. Enquanto o servidor antigo está no ar,
dois sistemas idênticos estariam olhando o **mesmo IXC de produção** — e o que
roda aqui em segundo plano escreve:

- o `PagamentosNoBancoPoller` pergunta ao banco onde está cada pagamento e **dá
  a baixa no IXC** quando o banco diz que pagou;
- o `RecorrentesPoller`, a cada seis horas, **cria conta a pagar no IXC** a
  partir das despesas recorrentes.

Com uma cópia do banco restaurada, a instância nova acharia tudo isso pendente e
faria de novo: baixa duplicada, conta duplicada. Então, no serviço `api` novo:

```
IXC_SOMENTE_LEITURA=1
SYNC_PAGAMENTOS_INTERVALO_MIN=0
MODOBANK_CLIENT_ID=
MODOBANK_CLIENT_SECRET=
MODOBANK_CERTIFICADO=
MODOBANK_CERTIFICADO_SENHA=
MODOBANK_RECEBER_CERTIFICADO=
MODOBANK_RECEBER_API_URL=
```

`IXC_SOMENTE_LEITURA=1` existe exatamente para isto: toda gravação no IXC é
recusada antes de sair daqui. Sem credencial do ModoBank, os pollers do banco
nem ligam. Assim a pilha nova pode ser testada à vontade contra o IXC de
produção, lendo.

Deploy nos dois serviços. A api roda `prisma migrate deploy` no start e cria as
tabelas vazias — é o seu sinal de que a imagem subiu e o banco conectou.

### 7. Teste por um endereço provisório

No serviço `web`, adicione um domínio provisório (`novo.telecom.ilnet.com.br`,
ou o host que o EasyPanel oferece) e ative o SSL. Acrescente esse endereço ao
`CORS_ORIGINS` enquanto durar o teste.

Com as tabelas vazias você ainda não tem login. Dá para conferir o essencial —
a tela abre, o `/api` responde, o SSL subiu — e deixar o resto para depois do
restore, que é quando o teste fica real.

---

## A virada (janela curta)

### 8. Pare de escrever no antigo

Avise a equipe e feche o sistema. No EasyPanel antigo, **pare o serviço `api`**
(Stop). O `db` fica no ar — é dele que sai o dump. Com a api parada, nenhum
poller está no meio de uma baixa e o dump sai consistente.

### 9. Tire o dump

Do **servidor novo** (`170.0.124.8`), por SSH, puxando do antigo
(`170.0.124.7`) numa tacada — o `-Fc` já vem comprimido:

```bash
ssh root@170.0.124.7 "docker exec \$(docker ps -q -f name=folha_db) pg_dump -U USUARIO -d BANCO -Fc" > /root/folha.dump
```

O `.7` aqui é o antigo, de onde os dados saem. Trocado pelo `.8`, o comando tira
o dump do banco vazio que a api nova acabou de criar — e o restore do passo 10
apagaria o que você veio buscar.

Confira que o arquivo tem tamanho de gente (`ls -lh /root/folha.dump`) antes de
seguir. Em dois passos de propósito: se o restore falhar, você repete o restore
sem tirar o dump de novo.

Sem acesso SSH ao antigo, use o **Console** do serviço `db` no painel para gerar
o arquivo e os backups do EasyPanel para tirá-lo de lá.

### 10. Restaure no novo

A api já criou as tabelas vazias no passo 6, e dump por cima de tabela existente
dá conflito. Limpe o schema e restaure:

```bash
NOVO=$(docker ps -q -f name=folha_db)
docker exec -i $NOVO psql -U USUARIO -d BANCO -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
docker exec -i $NOVO pg_restore -U USUARIO -d BANCO --no-owner --no-privileges < /root/folha.dump
```

(`USUARIO` e `BANCO` aqui são os do Postgres **novo**; `--no-owner
--no-privileges` existe porque o dono das tabelas no antigo tem outro nome.)

Não rode o `db:seed`: os logins vêm no dump. Se rodar por engano não estraga
nada — o upsert não mexe em quem já existe.

### 11. Confira que os dados chegaram

Rode nos **dois** bancos e compare linha por linha:

```sql
SELECT 'users' t, count(*) FROM users
UNION ALL SELECT 'funcionarios', count(*) FROM funcionarios
UNION ALL SELECT 'contas_pagar', count(*) FROM contas_pagar
UNION ALL SELECT 'pagamentos_no_banco', count(*) FROM pagamentos_no_banco
UNION ALL SELECT 'documentos_rh', count(*) FROM documentos_rh
UNION ALL SELECT 'arquivos_contabeis', count(*) FROM arquivos_contabeis
UNION ALL SELECT 'registros_de_os', count(*) FROM registros_de_os
UNION ALL SELECT 'aprs', count(*) FROM aprs
UNION ALL SELECT 'diarias', count(*) FROM diarias
ORDER BY 1;
```

Números diferentes = pare aqui e resolva antes de mexer no DNS.

### 12. Ligue de verdade e vire o DNS

No serviço `api` novo, agora sim:

- apague `IXC_SOMENTE_LEITURA`;
- `SYNC_PAGAMENTOS_INTERVALO_MIN=10`;
- preencha as nove `MODOBANK_*` com os valores do antigo;
- `CORS_ORIGINS=https://telecom.ilnet.com.br` (tire o endereço de teste).

Deploy. **Confirme que a api antiga continua parada** — é o ponto em que duas
cópias escreveriam no IXC.

No serviço `web`, adicione `telecom.ilnet.com.br` em **Domains**. Então troque o
registro `A` do domínio de `170.0.124.7` para `170.0.124.8` e, depois de propagar
(minutos, com o TTL do passo 2), ative o **Let's Encrypt** nesse domínio — o certificado só é emitido
com o DNS já apontando para cá. Entre a troca do DNS e o certificado o site fica
alguns minutos fora; é o único buraco real da virada.

### 13. Roteiro de conferência

Cada item prova uma peça diferente:

- [ ] Login com um usuário real → o banco restaurado e o `JWT_SECRET`.
- [ ] **Usuários** mostra a senha guardada de alguém → o `JWT_SECRET`/`SENHAS_CHAVE`
      é o mesmo de antes.
- [ ] Uma tela que lê o IXC (Funcionários, Contas a Pagar) → `IXC_HOST`,
      `IXC_TOKEN` e o IP liberado lá.
- [ ] Abrir um documento da pasta do RH e um arquivo da contabilidade → as
      colunas `Bytes` vieram inteiras.
- [ ] Converter um Word em PDF no RH → o LibreOffice da imagem da api.
- [ ] Uma consulta ao ModoBank (saldo/extrato) → certificado e **IP liberado no
      banco**. Se der erro de autenticação, é o passo 1 faltando.
- [ ] `/campo` num celular → o PWA e o upload (24 MB de teto no nginx e na api).
- [ ] Nos logs da api, uma volta do poller de pagamentos sem erro.

---

## Depois

- **Backups automáticos** do Postgres no EasyPanel novo. O antigo tinha; o novo
  nasce sem.
- **Não destrua o servidor antigo por alguns dias.** Desligado, ele é o seu
  plano B — mas plano B com prazo: o que a equipe lançar no novo depois da
  virada não existe lá. Voltar o DNS só é limpo nos primeiros minutos, antes do
  primeiro lançamento novo.
- Passados os dias, tire o `170.0.124.7` da liberação no portal do banco e no
  IXC.
- Se o VPS antigo vai ser devolvido ou apagado, **rotacione** o token do IXC e a
  credencial do ModoBank: eles estiveram nas variáveis de ambiente de uma
  máquina que não é mais sua.

## Se precisar voltar

1. Troque o registro `A` de volta para `170.0.124.7`.
2. Inicie o serviço `api` no EasyPanel antigo.
3. Pare a `api` nova (ou ponha `IXC_SOMENTE_LEITURA=1` nela), para que as duas
   não escrevam no IXC.

E só então investigue o que deu errado no novo, com calma.
