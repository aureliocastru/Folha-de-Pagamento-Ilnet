import { z } from 'zod';

/**
 * Validação e tipagem das variáveis de ambiente.
 * Falha cedo (no boot) se algo obrigatório estiver ausente/mal formado.
 */
const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),

  DATABASE_URL: z.string().url().or(z.string().startsWith('postgres')),

  API_PORT: z.coerce.number().int().positive().default(3333),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),

  JWT_SECRET: z.string().min(16, 'JWT_SECRET deve ter ao menos 16 caracteres'),
  JWT_EXPIRES_IN: z.string().default('8h'),

  // Integração IXC — opcional no boot para permitir subir a API sem o IXC
  // configurado ainda; o IxcClient valida na primeira chamada.
  IXC_HOST: z.string().optional().default(''),
  IXC_TOKEN: z.string().optional().default(''),
  IXC_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  // "1" = o app só lê o IXC: toda escrita é recusada antes de sair daqui. Para
  // subir um ambiente de teste apontando para o IXC de produção sem risco.
  IXC_SOMENTE_LEITURA: z
    .enum(['0', '1', 'true', 'false', ''])
    .optional()
    .default('')
    .transform((v) => v === '1' || v === 'true'),

  // Intervalo (minutos) do polling de retorno do banco; 0 desliga.
  SYNC_PAGAMENTOS_INTERVALO_MIN: z.coerce.number().int().min(0).default(10),

  // API do ModoBank (plataforma ONZ) — pagar boleto e Pix direto daqui. Sem as
  // quatro primeiras o pagamento pelo ModoBank continua como era: o app aprova
  // e o pagamento sai pela tela do banco no IXC. A URL é a da instância do
  // banco, mostrada no portal junto da credencial.
  MODOBANK_CLIENT_ID: z.string().optional().default(''),
  MODOBANK_CLIENT_SECRET: z.string().optional().default(''),
  // O arquivo .pfx da credencial, em base64 (é binário: não cabe numa variável
  // de outro jeito).
  MODOBANK_CERTIFICADO: z.string().optional().default(''),
  MODOBANK_CERTIFICADO_SENHA: z.string().optional().default(''),
  MODOBANK_API_URL: z
    .string()
    .url()
    .default('https://secureapi.sulcredi1-prod.onz.software/api/v2'),
  // APPROVAL_REQUIRED = o banco só paga depois que alguém aprovar lá; INSTANT
  // = paga na hora. Começa pedindo aprovação.
  MODOBANK_FLUXO: z.enum(['APPROVAL_REQUIRED', 'INSTANT']).default('APPROVAL_REQUIRED'),
  MODOBANK_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),

  // O recebimento pelo ModoBank (cash in: cobrança Pix, QR Code). É outro
  // certificado — o do zip CASH_IN — e outra URL, mostrada no portal junto da
  // credencial de recebimento. ID e segredo em branco = os mesmos da conta.
  // Sem certificado e URL, o recebimento fica desligado.
  MODOBANK_RECEBER_CLIENT_ID: z.string().optional().default(''),
  MODOBANK_RECEBER_CLIENT_SECRET: z.string().optional().default(''),
  MODOBANK_RECEBER_CERTIFICADO: z.string().optional().default(''),
  MODOBANK_RECEBER_CERTIFICADO_SENHA: z.string().optional().default(''),
  MODOBANK_RECEBER_API_URL: z.string().optional().default(''),

  // A plataforma de rastreamento da frota (GPSMOBILE / Waysis), que o mapa de
  // serviço mostra ao lado das OS. Só tem HTTP. O hash é o preferido; com
  // e-mail e senha o servidor gera o hash sozinho e o renova quando expira.
  // Sem nenhum dos dois, o mapa mostra só as OS.
  RASTREIO_URL: z.string().optional().default('http://plataformarastreamento.com.br/api'),
  RASTREIO_API_HASH: z.string().optional().default(''),
  RASTREIO_EMAIL: z.string().optional().default(''),
  RASTREIO_SENHA: z.string().optional().default(''),
  // Idioma das respostas da plataforma (o endereço do veículo vem nele).
  RASTREIO_IDIOMA: z.string().optional().default('en'),
  RASTREIO_TIMEOUT_MS: z.coerce.number().int().positive().default(20000),

  // O que entra no mapa: as OS não finalizadas abertas nos últimos N dias (0 =
  // todas), dos tipos listados (C cliente, E estrutura).
  MAPA_OS_DIAS: z.coerce.number().int().min(0).default(90),
  MAPA_OS_TIPOS: z.string().optional().default('C,E'),
  // De quantos em quantos segundos a tela atualiza a frota e as OS.
  MAPA_INTERVALO_FROTA: z.coerce.number().int().positive().default(15),
  MAPA_INTERVALO_OS: z.coerce.number().int().positive().default(60),
  // Onde o mapa abre antes de chegar o primeiro dado ("lat,lng") e com que
  // zoom; depois ele enquadra sozinho o que veio.
  MAPA_CENTRO: z.string().optional().default('-15.78,-47.93'),
  MAPA_ZOOM: z.coerce.number().int().min(1).max(19).default(5),
});

export type AppEnv = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): AppEnv {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Variáveis de ambiente inválidas:\n${issues}`);
  }
  return parsed.data;
}

/**
 * Fábrica de configuração usada pelo @nestjs/config.
 * Retorna um objeto tipado e agrupado por domínio.
 */
export function configuration() {
  const env = validateEnv(process.env);
  return {
    nodeEnv: env.NODE_ENV,
    port: env.API_PORT,
    // O Prisma lê a sua sozinho; esta é a do `pg_dump` do backup.
    databaseUrl: env.DATABASE_URL,
    corsOrigins: env.CORS_ORIGINS.split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    jwt: {
      secret: env.JWT_SECRET,
      expiresIn: env.JWT_EXPIRES_IN,
    },
    ixc: {
      host: env.IXC_HOST,
      token: env.IXC_TOKEN,
      timeoutMs: env.IXC_TIMEOUT_MS,
      somenteLeitura: env.IXC_SOMENTE_LEITURA,
    },
    pollPagamentosMin: env.SYNC_PAGAMENTOS_INTERVALO_MIN,
    modobank: {
      clientId: env.MODOBANK_CLIENT_ID.trim(),
      clientSecret: env.MODOBANK_CLIENT_SECRET.trim(),
      certificado: env.MODOBANK_CERTIFICADO,
      senhaDoCertificado: env.MODOBANK_CERTIFICADO_SENHA,
      url: env.MODOBANK_API_URL.replace(/\/+$/, ''),
      fluxo: env.MODOBANK_FLUXO,
      timeoutMs: env.MODOBANK_TIMEOUT_MS,
    },
    modobankReceber: {
      clientId: (env.MODOBANK_RECEBER_CLIENT_ID || env.MODOBANK_CLIENT_ID).trim(),
      clientSecret: (env.MODOBANK_RECEBER_CLIENT_SECRET || env.MODOBANK_CLIENT_SECRET).trim(),
      certificado: env.MODOBANK_RECEBER_CERTIFICADO,
      senhaDoCertificado: env.MODOBANK_RECEBER_CERTIFICADO_SENHA,
      url: env.MODOBANK_RECEBER_API_URL.trim().replace(/\/+$/, ''),
      fluxo: env.MODOBANK_FLUXO,
      timeoutMs: env.MODOBANK_TIMEOUT_MS,
    },
    rastreio: {
      url: env.RASTREIO_URL.trim().replace(/\/+$/, ''),
      apiHash: env.RASTREIO_API_HASH.trim(),
      email: env.RASTREIO_EMAIL.trim(),
      senha: env.RASTREIO_SENHA,
      idioma: env.RASTREIO_IDIOMA.trim() || 'en',
      timeoutMs: env.RASTREIO_TIMEOUT_MS,
    },
    mapa: {
      osDias: env.MAPA_OS_DIAS,
      osTipos: env.MAPA_OS_TIPOS.split(',')
        .map((t) => t.trim().toUpperCase())
        .filter(Boolean),
      // Menos que isso e várias telas abertas viram martelo no IXC e no
      // rastreador — o cache divide a consulta, mas não abaixo do intervalo.
      intervalos: {
        frota: Math.max(5, env.MAPA_INTERVALO_FROTA),
        os: Math.max(15, env.MAPA_INTERVALO_OS),
      },
      centro: centroDoMapa(env.MAPA_CENTRO),
      zoom: env.MAPA_ZOOM,
    },
  };
}

/** "lat,lng" → [lat, lng]; o centro do Brasil quando não dá para ler. */
export function centroDoMapa(texto: string): [number, number] {
  const [lat, lng] = texto.split(',').map((p) => Number(p.trim()));
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
    ? [lat, lng]
    : [-15.78, -47.93];
}

export type AppConfig = ReturnType<typeof configuration>;
