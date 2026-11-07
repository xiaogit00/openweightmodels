import type { App } from 'aws-cdk-lib';
import { InstanceClass, InstanceSize } from 'aws-cdk-lib/aws-ec2';

export type Environment = 'staging' | 'production';

export type DeploymentConfig = {
  /** Which profile produced the values below. */
  environment: Environment;
  /** CloudFormation stack prefix, e.g. `OwmStaging` or `OwmProd`. */
  stackPrefix: string;
  /** Lowercase resource prefix, e.g. `owm-staging` or `owm-prod`. */
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
  /** Worker rolling-deploy floor. Production never stops the only consumer. */
  workerMinHealthyPercent: number;
  workerMaxPercent: number;
  /** Fargate CPU units (1024 = 1 vCPU) and memory in MiB. */
  webCpu: number;
  webMemoryMiB: number;
  workerCpu: number;
  workerMemoryMiB: number;
  cacheNodeType: string;
  /** Number of NAT gateways; production runs one per AZ. */
  natGateways: number;
  dbInstanceClass: string;
  dbInstanceSize: string;
  dbAllocatedStorage: number;
  dbMaxAllocatedStorage: number;
  dbBackupRetentionDays: number;
  dbMultiAz: boolean;
  dbDeletionProtection: boolean;
  dbDeleteAutomatedBackups: boolean;
  /** `DESTROY` for disposable staging data, `RETAIN` once production holds users. */
  dbRemovalPolicy: 'DESTROY' | 'RETAIN';
  redisNumCacheClusters: number;
  redisAutomaticFailover: boolean;
  redisMultiAz: boolean;
  ecrEmptyOnDelete: boolean;
  ecrRemovalPolicy: 'DESTROY' | 'RETAIN';
  logRetentionDays: number;
  logRemovalPolicy: 'DESTROY' | 'RETAIN';
  containerInsightsEnabled: boolean;
  albDeletionProtection: boolean;
  albAccessLogs: boolean;
  /** Sentry environment tag; defaults to `environment`. */
  sentryEnvironment: string;
  /** GitHub Actions environment allowed to assume the deploy role. */
  githubEnvironment: string;
  /** SES production access; when false the web task keeps the sandbox `identity/*` grant. */
  sesProductionAccess: boolean;
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
  /** Branch allowed to assume the deploy role in staging. */
  githubBranch: string;
  /**
   * The `sub` claim prefix GitHub issues for this repository. Repositories
   * created after 15 July 2026 use immutable IDs, for example
   * `repo:owner@123/repo@456`; older repositories use `repo:owner/repo`.
   * Defaults to the non-immutable form.
   */
  githubSubjectPrefix?: string;
  /** Existing GitHub OIDC provider ARN, when the account already has one. */
  githubOidcProviderArn?: string;
  account?: string;
  region?: string;
};

type Profile = Pick<
  DeploymentConfig,
  | 'stackPrefix'
  | 'namePrefix'
  | 'webDesiredCount'
  | 'minWebTasks'
  | 'maxWebTasks'
  | 'workerDesiredCount'
  | 'minWorkerTasks'
  | 'maxWorkerTasks'
  | 'workerMinHealthyPercent'
  | 'workerMaxPercent'
  | 'webCpu'
  | 'webMemoryMiB'
  | 'workerCpu'
  | 'workerMemoryMiB'
  | 'cacheNodeType'
  | 'natGateways'
  | 'dbInstanceClass'
  | 'dbInstanceSize'
  | 'dbAllocatedStorage'
  | 'dbMaxAllocatedStorage'
  | 'dbBackupRetentionDays'
  | 'dbMultiAz'
  | 'dbDeletionProtection'
  | 'dbDeleteAutomatedBackups'
  | 'dbRemovalPolicy'
  | 'redisNumCacheClusters'
  | 'redisAutomaticFailover'
  | 'redisMultiAz'
  | 'ecrEmptyOnDelete'
  | 'ecrRemovalPolicy'
  | 'logRetentionDays'
  | 'logRemovalPolicy'
  | 'containerInsightsEnabled'
  | 'albDeletionProtection'
  | 'albAccessLogs'
>;

/**
 * The table in ticket 28. Staging stays cheap and disposable; production is
 * highly available and retains data. Sizing and count values are overridable
 * through CDK context, safety properties are not.
 */
const PROFILES: Record<Environment, Profile> = {
  staging: {
    stackPrefix: 'OwmStaging',
    namePrefix: 'owm-staging',
    webDesiredCount: 2,
    minWebTasks: 2,
    maxWebTasks: 4,
    workerDesiredCount: 1,
    minWorkerTasks: 1,
    maxWorkerTasks: 2,
    workerMinHealthyPercent: 0,
    workerMaxPercent: 100,
    webCpu: 512,
    webMemoryMiB: 1024,
    workerCpu: 512,
    workerMemoryMiB: 1024,
    cacheNodeType: 'cache.t4g.micro',
    natGateways: 1,
    dbInstanceClass: 'BURSTABLE4_GRAVITON',
    dbInstanceSize: 'MICRO',
    dbAllocatedStorage: 20,
    dbMaxAllocatedStorage: 50,
    dbBackupRetentionDays: 7,
    dbMultiAz: false,
    dbDeletionProtection: false,
    dbDeleteAutomatedBackups: true,
    dbRemovalPolicy: 'DESTROY',
    redisNumCacheClusters: 1,
    redisAutomaticFailover: false,
    redisMultiAz: false,
    ecrEmptyOnDelete: true,
    ecrRemovalPolicy: 'DESTROY',
    logRetentionDays: 30,
    logRemovalPolicy: 'DESTROY',
    containerInsightsEnabled: false,
    albDeletionProtection: false,
    albAccessLogs: false,
  },
  production: {
    stackPrefix: 'OwmProd',
    namePrefix: 'owm-prod',
    webDesiredCount: 2,
    minWebTasks: 2,
    maxWebTasks: 6,
    workerDesiredCount: 1,
    minWorkerTasks: 1,
    maxWorkerTasks: 4,
    workerMinHealthyPercent: 100,
    workerMaxPercent: 200,
    // Provisional sizing; docs/DECISIONS.md decision 32 is still open.
    webCpu: 1024,
    webMemoryMiB: 2048,
    workerCpu: 1024,
    workerMemoryMiB: 2048,
    cacheNodeType: 'cache.t4g.small',
    natGateways: 2,
    dbInstanceClass: 'BURSTABLE4_GRAVITON',
    dbInstanceSize: 'SMALL',
    dbAllocatedStorage: 100,
    dbMaxAllocatedStorage: 500,
    dbBackupRetentionDays: 14,
    dbMultiAz: true,
    dbDeletionProtection: true,
    dbDeleteAutomatedBackups: false,
    dbRemovalPolicy: 'RETAIN',
    redisNumCacheClusters: 2,
    redisAutomaticFailover: true,
    redisMultiAz: true,
    ecrEmptyOnDelete: false,
    ecrRemovalPolicy: 'RETAIN',
    logRetentionDays: 90,
    logRemovalPolicy: 'RETAIN',
    containerInsightsEnabled: true,
    albDeletionProtection: true,
    albAccessLogs: true,
  },
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

function contextOrEnv(
  context: Context,
  key: string,
  envName?: string,
): string | undefined {
  const value = stringContext(context, key);
  if (value !== undefined) return value;
  if (!envName) return undefined;
  const env = process.env[envName];
  return env === undefined || env === '' ? undefined : env.trim();
}

function intContext(
  context: Context,
  key: string,
  fallback: number,
  envName?: string,
): number {
  const value = contextOrEnv(context, key, envName);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`"${key}" must be a non-negative integer`);
  }
  return parsed;
}

function positiveIntContext(
  context: Context,
  key: string,
  fallback: number,
  envName?: string,
): number {
  const value = intContext(context, key, fallback, envName);
  if (value <= 0) {
    throw new Error(`"${key}" must be a positive integer`);
  }
  return value;
}

function positiveNumberContext(
  context: Context,
  key: string,
  fallback: number,
  envName?: string,
): number {
  const value = contextOrEnv(context, key, envName);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`"${key}" must be a positive number`);
  }
  return parsed;
}

function booleanContext(
  context: Context,
  key: string,
  fallback: boolean,
  envName?: string,
): boolean {
  const value = contextOrEnv(context, key, envName);
  if (value === undefined) return fallback;
  if (/^(true|1|yes)$/i.test(value)) return true;
  if (/^(false|0|no)$/i.test(value)) return false;
  throw new Error(`"${key}" must be true or false`);
}

function resolved(
  context: Context,
  key: string,
  envName: string,
  fallback: string | undefined,
): string | undefined {
  return contextOrEnv(context, key, envName) ?? fallback;
}

/**
 * Reads the deployment profile and shape from CDK context (`-c key=value`) or
 * `OWM_*` environment variables, so no account ID, domain or secret is
 * committed. The deploy script passes the same variables.
 */
export function loadDeploymentConfig(app: App): DeploymentConfig {
  const context = app.node;

  const environmentValue = contextOrEnv(context, 'environment', 'OWM_ENVIRONMENT') ?? 'staging';
  if (environmentValue !== 'staging' && environmentValue !== 'production') {
    throw new Error(
      `environment must be "staging" or "production" (got "${environmentValue}")`,
    );
  }
  const environment = environmentValue;
  const profile = PROFILES[environment];

  const stackPrefix = resolved(context, 'stackPrefix', 'OWM_STACK_PREFIX', profile.stackPrefix)!;
  const namePrefix = resolved(context, 'namePrefix', 'OWM_NAME_PREFIX', profile.namePrefix)!;
  if (stackPrefix !== profile.stackPrefix || namePrefix !== profile.namePrefix) {
    throw new Error(
      `environment "${environment}" requires stackPrefix "${profile.stackPrefix}" and namePrefix ` +
        `"${profile.namePrefix}" (got "${stackPrefix}" and "${namePrefix}")`,
    );
  }

  const domainName = resolved(context, 'domainName', 'OWM_DOMAIN_NAME', undefined);
  if (!domainName) {
    throw new Error(
      'Set -c domainName=staging.example.com (or OWM_DOMAIN_NAME); HTTPS cannot be provisioned without a hostname',
    );
  }
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(domainName)) {
    throw new Error(`domainName "${domainName}" must be a bare hostname without a scheme or path`);
  }

  const hostedZoneId = resolved(context, 'hostedZoneId', 'OWM_HOSTED_ZONE_ID', undefined);
  const certificateArn = resolved(context, 'certificateArn', 'OWM_CERTIFICATE_ARN', undefined);
  if (!hostedZoneId && !certificateArn) {
    throw new Error(
      'Provide -c hostedZoneId=Z... so CDK can create the ACM certificate and DNS records, or -c certificateArn=arn:aws:acm:... for an existing certificate',
    );
  }

  const sesIdentity =
    resolved(context, 'sesIdentity', 'OWM_SES_IDENTITY', undefined) ?? domainName;
  const hostedZoneName =
    resolved(context, 'hostedZoneName', 'OWM_HOSTED_ZONE_NAME', undefined) ?? domainName;
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

  const alarmEmail = resolved(context, 'alarmEmail', 'OWM_ALARM_EMAIL', undefined);
  if (!alarmEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(alarmEmail)) {
    throw new Error(
      'Set -c alarmEmail=ops@example.com (or OWM_ALARM_EMAIL); alarms need a named owner',
    );
  }

  const githubRepo = resolved(context, 'githubRepo', 'OWM_GITHUB_REPO', undefined);
  if (githubRepo && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(githubRepo)) {
    throw new Error('CDK context "githubRepo" must look like owner/repository');
  }

  // GitHub switched new repositories to immutable OIDC subjects in July 2026:
  // repo:owner@ownerId/repo@repoId instead of repo:owner/repo. A trust policy
  // written for one form never matches the other, so the deploy script detects
  // the prefix and passes it in.
  const githubSubjectPrefix =
    resolved(context, 'githubSubjectPrefix', 'OWM_GITHUB_SUBJECT_PREFIX', undefined) ??
    (githubRepo ? `repo:${githubRepo}` : undefined);
  if (githubSubjectPrefix && !/^repo:[^:]+$/.test(githubSubjectPrefix)) {
    throw new Error(
      'githubSubjectPrefix must look like repo:owner/repo or repo:owner@id/repo@id',
    );
  }

  const webDesiredCount = intContext(
    context,
    'webDesiredCount',
    profile.webDesiredCount,
    'OWM_WEB_DESIRED_COUNT',
  );
  const minWebTasks = intContext(
    context,
    'minWebTasks',
    profile.minWebTasks,
    'OWM_MIN_WEB_TASKS',
  );
  const maxWebTasks = intContext(
    context,
    'maxWebTasks',
    profile.maxWebTasks,
    'OWM_MAX_WEB_TASKS',
  );
  const workerDesiredCount = intContext(
    context,
    'workerDesiredCount',
    profile.workerDesiredCount,
    'OWM_WORKER_DESIRED_COUNT',
  );
  const minWorkerTasks = intContext(
    context,
    'minWorkerTasks',
    profile.minWorkerTasks,
    'OWM_MIN_WORKER_TASKS',
  );
  const maxWorkerTasks = intContext(
    context,
    'maxWorkerTasks',
    profile.maxWorkerTasks,
    'OWM_MAX_WORKER_TASKS',
  );

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

  const dbInstanceClass = resolved(
    context,
    'dbInstanceClass',
    'OWM_DB_INSTANCE_CLASS',
    profile.dbInstanceClass,
  )!;
  const dbInstanceSize = resolved(
    context,
    'dbInstanceSize',
    'OWM_DB_INSTANCE_SIZE',
    profile.dbInstanceSize,
  )!;
  if (!(dbInstanceClass in InstanceClass)) {
    throw new Error(`CDK context "dbInstanceClass" must be a CDK InstanceClass name`);
  }
  if (!(dbInstanceSize in InstanceSize)) {
    throw new Error(`CDK context "dbInstanceSize" must be a CDK InstanceSize name`);
  }

  const dbAllocatedStorage = positiveIntContext(
    context,
    'dbAllocatedStorage',
    profile.dbAllocatedStorage,
    'OWM_DB_ALLOCATED_STORAGE',
  );
  const dbMaxAllocatedStorage = positiveIntContext(
    context,
    'dbMaxAllocatedStorage',
    profile.dbMaxAllocatedStorage,
    'OWM_DB_MAX_ALLOCATED_STORAGE',
  );
  if (dbMaxAllocatedStorage < dbAllocatedStorage) {
    throw new Error('dbMaxAllocatedStorage must be >= dbAllocatedStorage');
  }
  const dbBackupRetentionDays = intContext(
    context,
    'dbBackupRetentionDays',
    profile.dbBackupRetentionDays,
    'OWM_DB_BACKUP_RETENTION_DAYS',
  );
  if (dbBackupRetentionDays > 35) {
    throw new Error('dbBackupRetentionDays must be between 0 and 35');
  }

  return {
    environment,
    stackPrefix,
    namePrefix,
    domainName,
    hostedZoneId,
    hostedZoneName: hostedZoneId ? zoneName : undefined,
    certificateArn,
    sesIdentity,
    emailFrom: resolved(context, 'emailFrom', 'OWM_EMAIL_FROM', defaultFrom)!,
    provider: resolved(context, 'provider', 'OWM_PROVIDER', 'openrouter')!,
    signinAllowedEmails: resolved(
      context,
      'signinAllowedEmails',
      'OWM_SIGNIN_ALLOWED_EMAILS',
      undefined,
    ),
    imageTag: resolved(context, 'imageTag', 'IMAGE_TAG', 'bootstrap')!,
    webDesiredCount,
    minWebTasks,
    maxWebTasks,
    workerDesiredCount,
    minWorkerTasks,
    maxWorkerTasks,
    workerMinHealthyPercent: profile.workerMinHealthyPercent,
    workerMaxPercent: profile.workerMaxPercent,
    webCpu: positiveIntContext(context, 'webCpu', profile.webCpu, 'OWM_WEB_CPU'),
    webMemoryMiB: positiveIntContext(
      context,
      'webMemoryMiB',
      profile.webMemoryMiB,
      'OWM_WEB_MEMORY',
    ),
    workerCpu: positiveIntContext(context, 'workerCpu', profile.workerCpu, 'OWM_WORKER_CPU'),
    workerMemoryMiB: positiveIntContext(
      context,
      'workerMemoryMiB',
      profile.workerMemoryMiB,
      'OWM_WORKER_MEMORY',
    ),
    cacheNodeType:
      resolved(context, 'cacheNodeType', 'OWM_CACHE_NODE_TYPE', profile.cacheNodeType)!,
    natGateways: positiveIntContext(
      context,
      'natGateways',
      profile.natGateways,
      'OWM_NAT_GATEWAYS',
    ),
    dbInstanceClass,
    dbInstanceSize,
    dbAllocatedStorage,
    dbMaxAllocatedStorage,
    dbBackupRetentionDays,
    dbMultiAz: profile.dbMultiAz,
    dbDeletionProtection: profile.dbDeletionProtection,
    dbDeleteAutomatedBackups: profile.dbDeleteAutomatedBackups,
    dbRemovalPolicy: profile.dbRemovalPolicy,
    redisNumCacheClusters: profile.redisNumCacheClusters,
    redisAutomaticFailover: profile.redisAutomaticFailover,
    redisMultiAz: profile.redisMultiAz,
    ecrEmptyOnDelete: profile.ecrEmptyOnDelete,
    ecrRemovalPolicy: profile.ecrRemovalPolicy,
    logRetentionDays: profile.logRetentionDays,
    logRemovalPolicy: profile.logRemovalPolicy,
    containerInsightsEnabled: profile.containerInsightsEnabled,
    albDeletionProtection: profile.albDeletionProtection,
    albAccessLogs: profile.albAccessLogs,
    sentryEnvironment:
      resolved(context, 'sentryEnvironment', 'OWM_SENTRY_ENVIRONMENT', environment)!,
    githubEnvironment:
      resolved(context, 'githubEnvironment', 'OWM_GITHUB_ENVIRONMENT', environment)!,
    sesProductionAccess: booleanContext(
      context,
      'sesProductionAccess',
      false,
      'OWM_SES_PRODUCTION_ACCESS',
    ),
    alarmEmail,
    monthlyBudgetUsd: positiveNumberContext(
      context,
      'monthlyBudgetUsd',
      200,
      'OWM_MONTHLY_BUDGET_USD',
    ),
    monthlySpendCapUsd: positiveNumberContext(
      context,
      'monthlySpendCapUsd',
      100,
      'OWM_MONTHLY_SPEND_CAP_USD',
    ),
    sentryDsn: resolved(context, 'sentryDsn', 'OWM_SENTRY_DSN', undefined),
    githubRepo,
    githubBranch: resolved(context, 'githubBranch', 'OWM_GITHUB_BRANCH', 'main')!,
    githubSubjectPrefix,
    githubOidcProviderArn: resolved(
      context,
      'githubOidcProviderArn',
      'OWM_GITHUB_OIDC_PROVIDER_ARN',
      undefined,
    ),
    account: resolved(context, 'account', 'CDK_DEFAULT_ACCOUNT', undefined),
    region: resolved(context, 'region', 'CDK_DEFAULT_REGION', undefined),
  };
}
