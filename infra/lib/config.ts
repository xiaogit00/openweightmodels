import type { App } from 'aws-cdk-lib';

export type StagingConfig = {
  /** CloudFormation stack prefix, e.g. `OwmStaging`. */
  stackPrefix: string;
  /** Lowercase resource prefix, e.g. `owm-staging`. */
  namePrefix: string;
  /** Public hostname; HTTPS is mandatory. */
  domainName: string;
  /** Route 53 zone used for the ACM certificate, ALB alias and SES DKIM. */
  hostedZoneId?: string;
  /** The zone's name (e.g. `example.com`), which may be a parent of the app hostname. */
  hostedZoneName?: string;
  /** Existing ACM certificate ARN in the ALB's region. */
  certificateArn?: string;
  /** Verified SES domain or address. Defaults to `domainName`. */
  sesIdentity: string;
  emailFrom: string;
  provider: string;
  /** Optional comma-separated sign-in allowlist; unset allows any address. */
  signinAllowedEmails?: string;
  imageTag: string;
  webDesiredCount: number;
  minWebTasks: number;
  maxWebTasks: number;
  workerDesiredCount: number;
  minWorkerTasks: number;
  maxWorkerTasks: number;
  cacheNodeType: string;
  /** The person who receives CloudWatch and budget alarms. Required. */
  alarmEmail: string;
  /** AWS infrastructure budget in USD; model spend is capped separately. */
  monthlyBudgetUsd: number;
  /** Runtime ceiling on provider-reported model spend in USD. `0` disables. */
  monthlySpendCapUsd: number;
  /** Sentry DSN for application errors. Unset logs structured errors only. */
  sentryDsn?: string;
  /** `owner/repo` for the GitHub OIDC deploy role; unset skips the CI stack. */
  githubRepo?: string;
  /** Branch allowed to assume the deploy role. */
  githubBranch: string;
  /** Existing GitHub OIDC provider ARN, when the account already has one. */
  githubOidcProviderArn?: string;
  account?: string;
  region?: string;
};

type Context = {
  tryGetContext: (key: string) => unknown;
};

function stringContext(context: Context, key: string): string | undefined {
  const value = context.tryGetContext(key);
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') {
    throw new Error(`CDK context "${key}" must be a string`);
  }
  return value.trim();
}

function intContext(context: Context, key: string, fallback: number): number {
  const value = stringContext(context, key);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`CDK context "${key}" must be a non-negative integer`);
  }
  return parsed;
}

function positiveNumberContext(context: Context, key: string, fallback: number): number {
  const value = stringContext(context, key);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`CDK context "${key}" must be a positive number`);
  }
  return parsed;
}

/**
 * Reads deployment shape from CDK context (`-c key=value`) so no account ID,
 * domain or secret is committed. The deploy script passes the same variables.
 */
export function loadStagingConfig(app: App): StagingConfig {
  const context = app.node;
  const domainName = stringContext(context, 'domainName') ?? process.env.OWM_DOMAIN_NAME;
  if (!domainName) {
    throw new Error(
      'Set -c domainName=staging.example.com (or OWM_DOMAIN_NAME); HTTPS cannot be provisioned without a hostname',
    );
  }
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(domainName)) {
    throw new Error(`domainName "${domainName}" must be a bare hostname without a scheme or path`);
  }

  const hostedZoneId =
    stringContext(context, 'hostedZoneId') ?? process.env.OWM_HOSTED_ZONE_ID;
  const certificateArn =
    stringContext(context, 'certificateArn') ?? process.env.OWM_CERTIFICATE_ARN;
  if (!hostedZoneId && !certificateArn) {
    throw new Error(
      'Provide -c hostedZoneId=Z... so CDK can create the ACM certificate and DNS records, or -c certificateArn=arn:aws:acm:... for an existing certificate',
    );
  }

  const sesIdentity =
    stringContext(context, 'sesIdentity') ??
    process.env.OWM_SES_IDENTITY ??
    domainName;
  const hostedZoneName =
    stringContext(context, 'hostedZoneName') ??
    process.env.OWM_HOSTED_ZONE_NAME ??
    domainName;
  const zoneName = hostedZoneName.replace(/\.$/, '');
  if (hostedZoneId) {
    if (domainName !== zoneName && !domainName.endsWith(`.${zoneName}`)) {
      throw new Error(
        `domainName "${domainName}" must be inside hostedZoneName "${zoneName}"`,
      );
    }
    if (
      !sesIdentity.includes('@') &&
      sesIdentity !== zoneName &&
      !sesIdentity.endsWith(`.${zoneName}`)
    ) {
      throw new Error(
        `sesIdentity "${sesIdentity}" must be inside hostedZoneName "${zoneName}" so DKIM records can be created`,
      );
    }
  }
  const defaultFrom = sesIdentity.includes('@')
    ? sesIdentity
    : `OpenWeightModels <no-reply@${domainName}>`;

  const alarmEmail = stringContext(context, 'alarmEmail') ?? process.env.OWM_ALARM_EMAIL;
  if (!alarmEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(alarmEmail)) {
    throw new Error(
      'Set -c alarmEmail=ops@example.com (or OWM_ALARM_EMAIL); alarms need a named owner',
    );
  }

  const githubRepo = stringContext(context, 'githubRepo') ?? process.env.OWM_GITHUB_REPO;
  if (githubRepo && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(githubRepo)) {
    throw new Error('CDK context "githubRepo" must look like owner/repository');
  }

  const webDesiredCount = intContext(context, 'webDesiredCount', 2);
  const minWebTasks = intContext(context, 'minWebTasks', 2);
  const maxWebTasks = intContext(context, 'maxWebTasks', 4);
  const workerDesiredCount = intContext(context, 'workerDesiredCount', 1);
  const minWorkerTasks = intContext(context, 'minWorkerTasks', 1);
  const maxWorkerTasks = intContext(context, 'maxWorkerTasks', 2);

  for (const [label, desired, min, max] of [
    ['web', webDesiredCount, minWebTasks, maxWebTasks],
    ['worker', workerDesiredCount, minWorkerTasks, maxWorkerTasks],
  ] as const) {
    if (!(min <= desired && desired <= max)) {
      throw new Error(
        `${label} counts must satisfy min <= desired <= max (got ${min}, ${desired}, ${max})`,
      );
    }
  }

  return {
    stackPrefix: stringContext(context, 'stackPrefix') ?? 'OwmStaging',
    namePrefix: stringContext(context, 'namePrefix') ?? 'owm-staging',
    domainName,
    hostedZoneId,
    hostedZoneName: hostedZoneId ? zoneName : undefined,
    certificateArn,
    sesIdentity,
    emailFrom: stringContext(context, 'emailFrom') ?? defaultFrom,
    provider: stringContext(context, 'provider') ?? 'openrouter',
    signinAllowedEmails: stringContext(context, 'signinAllowedEmails'),
    imageTag: stringContext(context, 'imageTag') ?? 'bootstrap',
    webDesiredCount,
    minWebTasks,
    maxWebTasks,
    workerDesiredCount,
    minWorkerTasks,
    maxWorkerTasks,
    cacheNodeType: stringContext(context, 'cacheNodeType') ?? 'cache.t4g.micro',
    alarmEmail,
    monthlyBudgetUsd: positiveNumberContext(context, 'monthlyBudgetUsd', 200),
    monthlySpendCapUsd: positiveNumberContext(context, 'monthlySpendCapUsd', 100),
    sentryDsn: stringContext(context, 'sentryDsn') ?? process.env.OWM_SENTRY_DSN,
    githubRepo,
    githubBranch: stringContext(context, 'githubBranch') ?? 'main',
    githubOidcProviderArn:
      stringContext(context, 'githubOidcProviderArn') ??
      process.env.OWM_GITHUB_OIDC_PROVIDER_ARN,
    account: stringContext(context, 'account') ?? process.env.CDK_DEFAULT_ACCOUNT,
    region: stringContext(context, 'region') ?? process.env.CDK_DEFAULT_REGION,
  };
}
