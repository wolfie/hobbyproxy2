import { configDotenv } from "dotenv";
import z from "zod/v4";

configDotenv();

const ENV = z.object({
  HTTP_PORT: z
    .string()
    .transform((x) => parseInt(x, 10))
    .catch(8080),
  HTTPS_PORT: z
    .string()
    .transform((x) => parseInt(x, 10))
    .catch(8443),
  EMAIL: z.email(),
  LETSENCRYPT_TOS_AGREED: z.stringbool().optional(),
  CLOUDFLARE_API_TOKEN: z.string().optional(),
  CLOUDFLARE_ZONE_ID: z.string().optional(),
  DOMAIN_NAME: z.string(),
  NTFY_SERVER: z.url().optional(),
  NTFY_TOPIC: z.string().min(1).optional(),
});

let resolvedEnv: undefined | z.infer<typeof ENV> = undefined;
const env = () => {
  if (resolvedEnv) return resolvedEnv;

  const result = ENV.safeParse(process.env);
  if (result.success) {
    resolvedEnv = result.data;
    return resolvedEnv;
  }

  console.error("Error(s) parsing ENV:");
  console.error(z.prettifyError(result.error));
  process.exit(1);
};
export default env;
