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
  };
}

export type AppConfig = ReturnType<typeof configuration>;
