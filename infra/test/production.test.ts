import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it, vi } from 'vitest';
import { AppStack } from '../lib/app-stack';
import { CiStack } from '../lib/ci-stack';
import { loadDeploymentConfig, type DeploymentConfig } from '../lib/config';
import { FoundationStack } from '../lib/foundation-stack';
import { OpsStack } from '../lib/ops-stack';

const env = { account: '210987654321', region: 'ap-southeast-1' };

function productionConfig(overrides: Partial<DeploymentConfig> = {}): DeploymentConfig {
  return {
    environment: 'production',
    stackPrefix: 'OwmProd',
    namePrefix: 'owm-prod',
    domainName: 'openweightmodels.net',
    hostedZoneId: 'Z0123456789',
    hostedZoneName: 'openweightmodels.net',
    certificateArn: 'arn:aws:acm:ap-southeast-1:210987654321:certificate/abc',
    sesIdentity: 'openweightmodels.net',
    emailFrom: 'OpenWeightModels <no-reply@openweightmodels.net>',
    provider: 'openrouter',
    imageTag: 'v0.1.0',
    webDesiredCount: 2,
    minWebTasks: 2,
    maxWebTasks: 6,
    workerDesiredCount: 1,
    minWorkerTasks: 1,
    maxWorkerTasks: 4,
    workerMinHealthyPercent: 100,
    workerMaxPercent: 200,
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
    sentryEnvironment: 'production',
    githubEnvironment: 'production',
    sesProductionAccess: true,
    sentryDsn: 'https://key@o1.ingest.sentry.io/2',
    alarmEmail: 'owner@example.com',
    monthlyBudgetUsd: 400,
    monthlySpendCapUsd: 100,
    githubRepo: 'owner/repo',
    githubBranch: 'main',
    ...overrides,
  };
}

function synth(config = productionConfig()) {
  const app = new App();
  const foundation = new FoundationStack(app, 'Foundation', { config, env });
  const appStack = new AppStack(app, 'App', {
    config,
    env,
    vpc: foundation.vpc,
    cluster: foundation.cluster,
    albSecurityGroup: foundation.albSecurityGroup,
    webSecurityGroup: foundation.webSecurityGroup,
    workerSecurityGroup: foundation.workerSecurityGroup,
  });
  const ops = new OpsStack(app, 'Ops', {
    config,
    env,
    alb: appStack.alb,
    targetGroup: appStack.targetGroup,
    clusterName: foundation.cluster.clusterName,
    webServiceName: appStack.webServiceName,
    workerServiceName: appStack.workerServiceName,
    workerLogGroup: foundation.workerLogGroup,
    queueName: 'owm-runs',
  });
  return {
    foundation: Template.fromStack(foundation),
    app: Template.fromStack(appStack),
    ops: Template.fromStack(ops),
  };
}

function container(task: Record<string, any>, name: string) {
  const containerDefinitions: Array<Record<string, any>> = task.ContainerDefinitions;
  const found = containerDefinitions.find((candidate) => candidate.Name === name);
  if (!found) throw new Error(`container ${name} not found`);
  return found;
}

function envValue(definition: Record<string, any>, key: string) {
  const environment: Array<{ Name: string; Value: string }> = definition.Environment ?? [];
  return environment.find((entry) => entry.Name === key)?.Value;
}

describe('production foundation', () => {
  const { foundation } = synth();

  it('keeps state: Multi-AZ Postgres with retained automated backups', () => {
    const databases = foundation.findResources('AWS::RDS::DBInstance');
    expect(Object.keys(databases)).toHaveLength(1);
    const [database] = Object.values(databases) as Array<Record<string, any>>;

    expect(database.DeletionPolicy).toBe('Retain');
    expect(database.Properties).toMatchObject({
      Engine: 'postgres',
      MultiAZ: true,
      DeletionProtection: true,
      BackupRetentionPeriod: 14,
      DeleteAutomatedBackups: false,
      AllocatedStorage: '100',
      MaxAllocatedStorage: 500,
      DBInstanceClass: 'db.t4g.small',
      PubliclyAccessible: false,
      StorageEncrypted: true,
    });
    expect(foundation.toJSON().Outputs).toHaveProperty('DatabaseInstanceIdentifier');
  });

  it('runs a two-node Redis replication group with automatic failover', () => {
    foundation.hasResourceProperties('AWS::ElastiCache::ReplicationGroup', {
      Engine: 'redis',
      NumCacheClusters: 2,
      AutomaticFailoverEnabled: true,
      MultiAZEnabled: true,
      CacheNodeType: 'cache.t4g.small',
      TransitEncryptionEnabled: true,
      ClusterMode: 'disabled',
    });
  });

  it('runs one NAT gateway per AZ', () => {
    foundation.resourceCountIs('AWS::EC2::NatGateway', 2);
  });

  it('retains the image repositories', () => {
    const repositories = foundation.findResources('AWS::ECR::Repository');
    expect(Object.keys(repositories)).toHaveLength(2);
    for (const repository of Object.values(repositories) as Array<Record<string, any>>) {
      expect(repository.DeletionPolicy).toBe('Retain');
      expect(repository.Properties.EmptyOnDelete).toBe(false);
    }
  });

  it('keeps application logs for 90 days', () => {
    const groups = foundation.findResources('AWS::Logs::LogGroup');
    expect(Object.keys(groups)).toHaveLength(3);
    for (const group of Object.values(groups) as Array<Record<string, any>>) {
      expect(group.Properties.RetentionInDays).toBe(90);
      expect(group.DeletionPolicy).toBe('Retain');
    }
  });

  it('enables Container Insights and sizes the tasks for production', () => {
    foundation.hasResourceProperties('AWS::ECS::Cluster', {
      ClusterSettings: [
        Match.objectLike({ Name: 'containerInsights', Value: 'enabled' }),
      ],
    });

    const tasks = Object.values(
      foundation.findResources('AWS::ECS::TaskDefinition') as Record<string, any>,
    );
    const web = tasks.find((task) => task.Properties.Family === 'owm-prod-web')!;
    const worker = tasks.find((task) => task.Properties.Family === 'owm-prod-worker')!;
    expect(web.Properties).toMatchObject({ Cpu: '1024', Memory: '2048' });
    expect(worker.Properties).toMatchObject({ Cpu: '1024', Memory: '2048' });
  });

  it('tags Sentry with the production environment in both runtimes', () => {
    const tasks = Object.values(
      foundation.findResources('AWS::ECS::TaskDefinition') as Record<string, any>,
    );
    const web = tasks.find((task) => task.Properties.Family === 'owm-prod-web')!;
    const worker = tasks.find((task) => task.Properties.Family === 'owm-prod-worker')!;

    expect(envValue(container(web.Properties, 'web'), 'SENTRY_ENVIRONMENT')).toBe('production');
    expect(envValue(container(worker.Properties, 'worker'), 'SENTRY_ENVIRONMENT')).toBe(
      'production',
    );
  });

  it('narrows the SES grant to the sending identity after production access', () => {
    const roles = foundation.findResources('AWS::IAM::Role');
    const webTaskRoleId = Object.keys(roles).find((id) => id.startsWith('WebTaskRole'));
    expect(webTaskRoleId).toBeDefined();

    const policies = foundation.findResources('AWS::IAM::Policy');
    const webPolicy = Object.values(policies)
      .map((policy) => policy as Record<string, any>)
      .find((policy) => JSON.stringify(policy.Properties.Roles).includes(webTaskRoleId!));
    expect(webPolicy).toBeDefined();

    const sesResources = (
      webPolicy!.Properties.PolicyDocument.Statement as Array<Record<string, any>>
    )
      .filter((statement) => JSON.stringify(statement.Action).includes('ses:SendEmail'))
      .flatMap((statement) => [statement.Resource].flat());

    // The identity ARN is a token (`identity/` plus the SesIdentity ref), not a
    // wildcard. That is the narrowed grant.
    expect(JSON.stringify(sesResources)).toContain(':identity/');
    expect(JSON.stringify(sesResources)).toContain('SesIdentity');
    expect(JSON.stringify(sesResources)).not.toContain(':identity/*');
  });
});

describe('production app', () => {
  const { app } = synth();

  it('protects the ALB and writes access logs to a retained bucket', () => {
    const loadBalancers = app.findResources('AWS::ElasticLoadBalancingV2::LoadBalancer');
    expect(Object.keys(loadBalancers)).toHaveLength(1);
    const [loadBalancer] = Object.values(loadBalancers) as Array<Record<string, any>>;

    expect(loadBalancer.Properties.LoadBalancerAttributes).toEqual(
      expect.arrayContaining([
        { Key: 'deletion_protection.enabled', Value: 'true' },
        { Key: 'access_logs.s3.enabled', Value: 'true' },
        { Key: 'access_logs.s3.prefix', Value: 'alb' },
      ]),
    );

    const buckets = app.findResources('AWS::S3::Bucket');
    expect(Object.keys(buckets)).toHaveLength(1);
    const [bucket] = Object.values(buckets) as Array<Record<string, any>>;
    expect(bucket.DeletionPolicy).toBe('Retain');
    const rules = bucket.Properties.LifecycleConfiguration.Rules as Array<Record<string, any>>;
    expect(rules).toEqual(
      expect.arrayContaining([expect.objectContaining({ ExpirationInDays: 90 })]),
    );
  });

  it('keeps at least one worker running during a release', () => {
    const services = app.findResources('AWS::ECS::Service');
    const worker = Object.values(services)
      .map((service) => service as Record<string, any>)
      .find((service) => service.Properties.ServiceName === 'owm-prod-worker')!;

    expect(worker.Properties.DeploymentConfiguration).toMatchObject({
      MinimumHealthyPercent: 100,
      MaximumPercent: 200,
    });
  });
});

describe('production OIDC role', () => {
  it('trusts only the production GitHub environment', () => {
    const config = productionConfig();
    const app = new App();
    const stack = new CiStack(app, 'Ci', { config, env });
    const template = Template.fromStack(stack);

    const roles = template.findResources('AWS::IAM::Role');
    const deployRole = Object.values(roles).find(
      (role) => (role as Record<string, any>).Properties.RoleName === 'owm-prod-github-deploy',
    ) as Record<string, any> | undefined;
    expect(deployRole).toBeDefined();

    const condition = JSON.stringify(
      deployRole!.Properties.AssumeRolePolicyDocument.Statement[0].Condition,
    );
    expect(condition).toContain('repo:owner/repo:environment:production');
    expect(condition).not.toContain('ref:refs/heads/main');
    template.resourceCountIs('AWS::IAM::AccessKey', 0);
  });
});

describe('production deployment config', () => {
  function context(values: Record<string, string>) {
    return {
      node: { tryGetContext: (key: string) => values[key] },
    } as unknown as App;
  }

  const required = {
    domainName: 'openweightmodels.net',
    hostedZoneId: 'Z0123456789',
    alarmEmail: 'owner@example.com',
  };

  it('derives the production profile and safety defaults', () => {
    const config = loadDeploymentConfig(context({ ...required, environment: 'production' }));
    expect(config).toMatchObject({
      environment: 'production',
      stackPrefix: 'OwmProd',
      namePrefix: 'owm-prod',
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
      natGateways: 2,
      cacheNodeType: 'cache.t4g.small',
      webCpu: 1024,
      webMemoryMiB: 2048,
      workerCpu: 1024,
      workerMemoryMiB: 2048,
      webDesiredCount: 2,
      maxWebTasks: 6,
      workerDesiredCount: 1,
      maxWorkerTasks: 4,
      workerMinHealthyPercent: 100,
      workerMaxPercent: 200,
      ecrEmptyOnDelete: false,
      ecrRemovalPolicy: 'RETAIN',
      logRetentionDays: 90,
      logRemovalPolicy: 'RETAIN',
      containerInsightsEnabled: true,
      albDeletionProtection: true,
      albAccessLogs: true,
      sentryEnvironment: 'production',
      githubEnvironment: 'production',
      sesProductionAccess: false,
    });
  });

  it('rejects a prefix pair that belongs to the other environment', () => {
    expect(() =>
      loadDeploymentConfig(
        context({
          ...required,
          environment: 'production',
          stackPrefix: 'OwmStaging',
          namePrefix: 'owm-staging',
        }),
      ),
    ).toThrow(/requires stackPrefix "OwmProd"/);

    expect(() =>
      loadDeploymentConfig(
        context({
          ...required,
          environment: 'staging',
          stackPrefix: 'OwmProd',
          namePrefix: 'owm-prod',
        }),
      ),
    ).toThrow(/requires stackPrefix "OwmStaging"/);
  });

  it('accepts explicit SES production access and sizing overrides', () => {
    const config = loadDeploymentConfig(
      context({
        ...required,
        environment: 'production',
        sesProductionAccess: 'true',
        webCpu: '2048',
        webMemoryMiB: '4096',
        dbInstanceSize: 'MEDIUM',
        dbAllocatedStorage: '200',
        dbMaxAllocatedStorage: '1000',
      }),
    );
    expect(config).toMatchObject({
      sesProductionAccess: true,
      webCpu: 2048,
      webMemoryMiB: 4096,
      dbInstanceSize: 'MEDIUM',
      dbAllocatedStorage: 200,
      dbMaxAllocatedStorage: 1000,
    });
  });

  it('reads SES access and sizing from OWM_* environment variables', () => {
    vi.stubEnv('OWM_SES_PRODUCTION_ACCESS', 'true');
    vi.stubEnv('OWM_WEB_CPU', '2048');
    vi.stubEnv('OWM_WEB_MEMORY', '4096');
    vi.stubEnv('OWM_WEB_DESIRED_COUNT', '3');
    vi.stubEnv('OWM_MAX_WEB_TASKS', '8');
    vi.stubEnv('OWM_NAT_GATEWAYS', '3');
    vi.stubEnv('OWM_DB_INSTANCE_SIZE', 'MEDIUM');
    try {
      const config = loadDeploymentConfig(
        context({ ...required, environment: 'production' }),
      );
      expect(config).toMatchObject({
        sesProductionAccess: true,
        webCpu: 2048,
        webMemoryMiB: 4096,
        webDesiredCount: 3,
        maxWebTasks: 8,
        natGateways: 3,
        dbInstanceSize: 'MEDIUM',
        environment: 'production',
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('rejects an unknown environment', () => {
    expect(() =>
      loadDeploymentConfig(context({ ...required, environment: 'prod' })),
    ).toThrow(/staging" or "production/);
  });
});
