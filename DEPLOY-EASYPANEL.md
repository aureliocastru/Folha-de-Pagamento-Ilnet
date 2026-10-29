# Deploy no EasyPanel

Guia para subir a aplicação no seu servidor com EasyPanel. Você vai criar
**3 serviços** dentro de um projeto: `db` (Postgres), `api` e `web`.

Pré-requisito: o código versionado num repositório Git acessível pelo EasyPanel
(GitHub/GitLab), ou faça o deploy por upload/Docker.

> Trocando de servidor, com o sistema já rodando em outro? Então o que você quer
> é **[MIGRAR-DE-SERVIDOR.md](MIGRAR-DE-SERVIDOR.md)**: estes mesmos passos, mais
> o banco e a virada do domínio.

---

## 1. Criar o projeto e o banco

1. **Create Project** → nome, ex.: `folha`.
2. Dentro do projeto: **+ Service → Postgres**.
   - Nome do serviço: `db`
   - Anote usuário, senha e nome do banco gerados.
   - O host interno será algo como `folha_db` (nome do projeto + serviço).
3. A connection string ficará assim:
   ```
   postgresql://USUARIO:SENHA@folha_db:5432/NOME_DB?schema=public
   ```

## 2. Serviço da API

**+ Service → App**, nome `api`.

- **Source:** aponte para o repositório Git (branch `main`).
- **Build:** _Dockerfile_ → caminho `apps/api/Dockerfile`, contexto `/` (raiz).
- **Environment** (aba Environment):
  ```
  DATABASE_URL=postgresql://USUARIO:SENHA@folha_db:5432/NOME_DB?schema=public
  API_PORT=3333
  CORS_ORIGINS=https://folha.seudominio.com.br
  JWT_SECRET=<gere-uma-chave-aleatoria-longa>
  JWT_EXPIRES_IN=8h
  IXC_HOST=provedor.seudominio.com.br
  IXC_TOKEN=41:5a63...      # id:hash do token do IXC
  IXC_TIMEOUT_MS=30000
  ADMIN_EMAIL=voce@empresa.com
  ADMIN_SENHA=<senha-forte-do-admin>
  ```
- **Port:** exponha a porta `3333` (interna). Não precisa de domínio público se
  o `web` fizer o proxy (recomendado).
- O container roda `prisma migrate deploy` automaticamente no start — as tabelas
  são criadas/atualizadas sozinhas.

### Criar o usuário admin (uma vez)

Após o primeiro deploy da API, abra o **Console** do serviço `api` e rode:

```bash
npm run db:seed
```

Isso cria o admin com `ADMIN_EMAIL` / `ADMIN_SENHA`. Daí em diante os demais
logins saem pela própria aplicação, em **Usuários** (só administradores veem a
tela) — o seed serve só para o primeiro acesso.

### Abrir os logins de campo da equipe

A equipe inteira precisa entrar para preencher a APR antes de subir no poste, e
abrir trinta logins na tela, um a um, é meia hora de digitação com um erro de
e-mail no meio. No **Console** do serviço `api`:

```bash
npm run logins:campo -- --previa
```

Isso mostra quem ganharia login e com que endereço, sem escrever nada. A lista
vem do cadastro: entra quem está **ativo** e ainda não tem login, com perfil
**Técnico de campo** (abre a Segurança do Trabalho e mais nada). O endereço é o
primeiro nome + `@ilnet.com.br`; quando duas pessoas dividem o primeiro nome,
cada uma leva o segundo junto (`marco.aurelio@`), porque um `marco@` só serviria
a um dos três.

Conferida a lista, tire o `--previa`:

```bash
npm run logins:campo
```

A senha inicial é `12345678` para todos, e cada um troca a sua em **Minha
conta**. Dá para rodar de novo quantas vezes quiser — quem já tem login é
pulado, e ninguém tem a senha mexida. `SENHA_PADRAO=...` troca a senha inicial e
`PULAR="fulano@ilnet.com.br"` deixa alguém de fora.

## 3. Serviço Web

**+ Service → App**, nome `web`.

- **Source:** mesmo repositório.
- **Build:** _Dockerfile_ → caminho `apps/web/Dockerfile`, contexto `/` (raiz).
- **Environment:**
  ```
  API_UPSTREAM=folha_api:3333
  ```
  > Use o host interno do serviço da API (nome do projeto + `_api`). É o nginx do
  > `web` que encaminha `/api/*` para a API — assim não há CORS nem exposição
  > direta da API.
- **Port:** `80`.
- **Domains:** adicione seu domínio (ex.: `folha.seudominio.com.br`) e ative o
  SSL (Let's Encrypt) no EasyPanel.

## 4. Ajuste o CORS

No serviço `api`, garanta que `CORS_ORIGINS` contém o domínio público do `web`
(ex.: `https://folha.seudominio.com.br`). Como o `web` faz proxy same-origin, o
CORS quase não é exercitado, mas mantenha correto por segurança.

---

## Fluxo de atualização

A cada `git push` na branch configurada, use **Deploy** no EasyPanel (ou ative o
auto-deploy). A API aplica migrações pendentes automaticamente no start.

## Checklist de segurança

- [ ] `JWT_SECRET` aleatório e longo (não use o valor de exemplo).
- [ ] `ADMIN_SENHA` forte; troque a senha padrão.
- [ ] `IXC_TOKEN` só nas variáveis de ambiente do EasyPanel — **nunca** no Git.
- [ ] Rotacione o token do IXC que apareceu na coleção Postman de Downloads.
- [ ] Backups automáticos do Postgres habilitados no EasyPanel.
