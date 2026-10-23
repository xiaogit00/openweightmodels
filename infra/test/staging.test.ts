import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { StagingAppStack } from '../lib/app-stack';
import { loadStagingConfig, type StagingConfig } from '../lib/config';
import { StagingFoundationStack } from '../lib/foundation-stack';

const env = { account: '123456789012', region: 'eu-west-1' };

function testConfig(overrides: Partial<StagingConfig> = {}): StagingConfig {
  return {
    stackPrefix: 'TestStaging',
    namePrefix: 'test-staging',
    domainName: 'staging.example.com',
    hostedZoneId: 'Z0123456789',
    hostedZoneName: 'example.com',
    certificateArn: 'arn:aws:acm:eu-west-1:123456789012:certificate/abc',
    sesIdentity: 'staging.example.com',
    emailFrom: 'OpenWeightModels <no-reply@staging.example.com>',
    provider: 'openrouter',
    imageTag: 'test',
    webDesiredCount: 2,
    minWebTasks: 2,
    maxWebTasks: 4,
    workerDesiredCount: 1,
    minWorkerTasks: 1,
    maxWorkerTasks: 2,
    cacheNodeType: 'cache.t4g.micro',
    ...overrides,
  };
}

function synth(config = testConfig()) {
  const app = new App();
  const foundation = new StagingFoundationStack(app, 'Foundation', { config, env });
  const appStack = new StagingAppStack(app, 'App', {
    config,
    env,
    vpc: foundation.vpc,
    cluster: foundation.cluster,
    albSecurityGroup: foundation.albSecurityGroup,
    webSecurityGroup: foundation.webSecurityGroup,
    workerSecurityGroup: foundation.workerSecurityGroup,
  });
  return {
    foundation: Template.fromStack(foundation),
    app: Template.fromStack(appStack),
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

describe('staging foundation', () => {
  const { foundation } = synth();

  it('runs web, worker and migration as separate ARM64 Fargate task definitions', () => {
    const tasks = foundation.findResources('AWS::ECS::TaskDefinition');
    expect(Object.keys(tasks)).toHaveLength(3);

    for (const task of Object.values(tasks) as Array<Record<string, any>>) {
      expect(task.Properties.RequiresCompatibilities).toEqual(['FARGATE']);
      expect(task.Properties.RuntimePlatform).toEqual({
        CpuArchitecture: 'ARM64',
        OperatingSystemFamily: 'LINUX',
      });
    }

    foundation.hasResourceProperties('AWS::ECS::TaskDefinition', {
      Family: 'test-staging-web',
    });
    foundation.hasResourceProperties('AWS::ECS::TaskDefinition', {
      Family: 'test-staging-worker',
    });
    foundation.hasResourceProperties('AWS::ECS::TaskDefinition', {
      Family: 'test-staging-migrate',
    });
  });

  it('injects runtime configuration and keeps secrets in Secrets Manager', () => {
    const tasks = foundation.findResources('AWS::ECS::TaskDefinition');
    const taskList = Object.values(tasks) as Array<Record<string, any>>;
    const web = taskList.find((task) => task.Properties.Family === 'test-staging-web')!;
    const worker = taskList.find((task) => task.Properties.Family === 'test-staging-worker')!;
    const migrate = taskList.find((task) => task.Properties.Family === 'test-staging-migrate')!;
    const webContainer = container(web.Properties, 'web');
    const workerContainer = container(worker.Properties, 'worker');
    const migrateContainer = container(migrate.Properties, 'migrate');

    expect(envValue(webContainer, 'NODE_ENV')).toBe('production');
    expect(envValue(webContainer, 'APP_URL')).toBe('https://staging.example.com');
    expect(envValue(webContainer, 'AWS_REGION')).toBe('eu-west-1');
    expect(envValue(webContainer, 'EMAIL_TRANSPORT')).toBe('ses');
    expect(envValue(webContainer, 'DB_SSL')).toBe('true');
    expect(envValue(webContainer, 'REDIS_TLS')).toBe('true');
    expect(envValue(webContainer, 'DATABASE_URL')).toBeUndefined();
    expect(envValue(webContainer, 'BETTER_AUTH_SECRET')).toBeUndefined();
    expect(envValue(webContainer, 'OPENROUTER_API_KEY')).toBeUndefined();

    const webSecrets = (webContainer.Secrets as Array<{ Name: string }>).map((s) => s.Name);
    expect(webSecrets).toEqual(
      expect.arrayContaining(['DB_USER', 'DB_PASSWORD', 'BETTER_AUTH_SECRET']),
    );
    expect(webSecrets).not.toContain('OPENROUTER_API_KEY');

    expect(envValue(workerContainer, 'PROVIDER')).toBe('openrouter');
    expect(envValue(workerContainer, 'WORKER_HEALTH_PORT')).toBe('3001');
    const workerSecrets = (workerContainer.Secrets as Array<{ Name: string }>).map((s) => s.Name);
    expect(workerSecrets).toEqual(expect.arrayContaining(['DB_PASSWORD', 'OPENROUTER_API_KEY']));
    expect(workerSecrets).not.toContain('BETTER_AUTH_SECRET');

    expect(migrateContainer.Command).toEqual([
      '/app/apps/worker/node_modules/.bin/tsx',
      'packages/core/src/db/bootstrap.ts',
    ]);
    expect(envValue(migrateContainer, 'DATABASE_URL')).toBeUndefined();
  });

  it('never puts a provider key in the template', () => {
    expect(JSON.stringify(foundation.toJSON())).not.toMatch(/sk-or-/);
    expect(JSON.stringify(foundation.toJSON())).not.toMatch(/openrouter\.ai\/api\/v1/);
  });

  it('provisions encrypted Postgres and a non-evicting Redis node', () => {
    foundation.hasResourceProperties('AWS::RDS::DBInstance', {
      Engine: 'postgres',
      PubliclyAccessible: false,
      StorageEncrypted: true,
      DeletionProtection: false,
      MultiAZ: false,
      BackupRetentionPeriod: 7,
    });
    foundation.hasResourceProperties('AWS::ElastiCache::CacheCluster', {
      Engine: 'redis',
      NumCacheNodes: 1,
      TransitEncryptionEnabled: true,
      AZMode: 'single-az',
    });
    foundation.hasResourceProperties('AWS::ElastiCache::ParameterGroup', {
      CacheParameterGroupFamily: 'redis7',
      Properties: { 'maxmemory-policy': 'noeviction' },
    });
  });

  it('verifies the configured SES identity and publishes its DKIM records', () => {
    foundation.resourceCountIs('AWS::SES::EmailIdentity', 1);
    foundation.hasResourceProperties('AWS::SES::EmailIdentity', {
      EmailIdentity: 'staging.example.com',
    });
    const records = foundation.findResources('AWS::Route53::RecordSet');
    const cnames = (Object.values(records) as Array<Record<string, any>>).filter(
      (record) => record.Properties.Type === 'CNAME',
    );
    expect(cnames).toHaveLength(3);

    const policies = foundation.findResources('AWS::IAM::Policy');
    const sesPolicies = (Object.values(policies) as Array<Record<string, any>>).filter(
      (policy) =>
        JSON.stringify(policy.Properties.PolicyDocument).includes('ses:SendEmail'),
    );
    expect(sesPolicies).toHaveLength(1);
    expect(JSON.stringify(sesPolicies[0]?.Properties.Roles)).toContain('WebTaskRole');
  });

  it('keeps application logs for 30 days', () => {
    const groups = foundation.findResources('AWS::Logs::LogGroup');
    const retention = (Object.values(groups) as Array<Record<string, any>>).map(
      (group) => group.Properties.RetentionInDays,
    );
    expect(retention).toEqual([30, 30, 30]);
  });

  it('outputs what the release script needs', () => {
    const outputs = foundation.toJSON().Outputs ?? {};
    for (const key of [
      'PrivateSubnetIds',
      'ClusterName',
      'MigrateTaskDefinitionFamily',
      'MigrateTaskDefinitionArn',
      'MigrateSecurityGroupId',
      'WebTaskDefinitionFamily',
      'WorkerTaskDefinitionFamily',
      'WebRepositoryUri',
      'WorkerRepositoryUri',
    ]) {
      expect(outputs, key).toHaveProperty(key);
    }
  });
});

describe('staging app', () => {
  const { app } = synth();

  it('serves HTTPS with a long idle timeout so SSE survives', () => {
    app.hasResourceProperties('AWS::ElasticLoadBalancingV2::LoadBalancer', {
      Scheme: 'internet-facing',
      Type: 'application',
      LoadBalancerAttributes: Match.arrayWith([
        Match.objectLike({ Key: 'idle_timeout.timeout_seconds', Value: '4000' }),
      ]),
    });
    app.hasResourceProperties('AWS::ElasticLoadBalancingV2::Listener', {
      Port: 443,
      Protocol: 'HTTPS',
      SslPolicy: 'ELBSecurityPolicy-TLS13-1-2-2021-06',
    });
    app.hasResourceProperties('AWS::ElasticLoadBalancingV2::Listener', {
      Port: 80,
      Protocol: 'HTTP',
      DefaultActions: [
        Match.objectLike({
          Type: 'redirect',
          RedirectConfig: Match.objectLike({
            Protocol: 'HTTPS',
            Port: '443',
            StatusCode: 'HTTP_301',
          }),
        }),
      ],
    });
  });

  it('health-checks the web task through the dependency-aware endpoint', () => {
    app.hasResourceProperties('AWS::ElasticLoadBalancingV2::TargetGroup', {
      Port: 3000,
      Protocol: 'HTTP',
      TargetType: 'ip',
      HealthCheckPath: '/api/health',
      HealthCheckIntervalSeconds: 15,
    });
  });

  it('runs web and worker services with circuit breakers and scaling minima', () => {
    const services = app.findResources('AWS::ECS::Service');
    expect(Object.keys(services)).toHaveLength(2);
    for (const service of Object.values(services) as Array<Record<string, any>>) {
      expect(service.Properties.LaunchType).toBe('FARGATE');
      expect(service.Properties.DeploymentConfiguration.DeploymentCircuitBreaker).toEqual({
        Enable: true,
        Rollback: true,
      });
    }
    app.hasResourceProperties('AWS::ECS::Service', {
      ServiceName: 'test-staging-web',
      DesiredCount: 2,
      TaskDefinition: 'test-staging-web',
    });
    app.hasResourceProperties('AWS::ECS::Service', {
      ServiceName: 'test-staging-worker',
      DesiredCount: 1,
      TaskDefinition: 'test-staging-worker',
    });

    const targets = app.findResources('AWS::ApplicationAutoScaling::ScalableTarget');
    const capacities = (Object.values(targets) as Array<Record<string, any>>).map(
      (target) => target.Properties,
    );
    expect(capacities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ MinCapacity: 2, MaxCapacity: 4 }),
        expect.objectContaining({ MinCapacity: 1, MaxCapacity: 2 }),
      ]),
    );
  });

  it('points DNS at the ALB', () => {
    app.hasResourceProperties('AWS::Route53::RecordSet', {
      Name: 'staging.example.com.',
      Type: 'A',
    });
  });
});

describe('deployment config', () => {
  function context(values: Record<string, string>) {
    return {
      node: { tryGetContext: (key: string) => values[key] },
    } as unknown as App;
  }

  it('requires a hostname and a way to obtain HTTPS', () => {
    expect(() => loadStagingConfig(context({}))).toThrow(/domainName/);
    expect(() => loadStagingConfig(context({ domainName: 'staging.example.com' }))).toThrow(
      /hostedZoneId|certificateArn/,
    );
    expect(() =>
      loadStagingConfig(
        context({ domainName: 'https://staging.example.com', certificateArn: 'arn:cert' }),
      ),
    ).toThrow(/bare hostname/);
  });

  it('derives safe defaults and validates task counts', () => {
    const config = loadStagingConfig(
      context({
        domainName: 'staging.example.com',
        hostedZoneId: 'Z0123456789',
      }),
    );
    expect(config).toMatchObject({
      stackPrefix: 'OwmStaging',
      namePrefix: 'owm-staging',
      hostedZoneName: 'staging.example.com',
      sesIdentity: 'staging.example.com',
      emailFrom: 'OpenWeightModels <no-reply@staging.example.com>',
      provider: 'openrouter',
      webDesiredCount: 2,
      workerDesiredCount: 1,
    });

    expect(() =>
      loadStagingConfig(
        context({
          domainName: 'staging.example.com',
          hostedZoneId: 'Z0123456789',
          webDesiredCount: '5',
          maxWebTasks: '4',
        }),
      ),
    ).toThrow(/min <= desired <= max/);

    expect(() =>
      loadStagingConfig(
        context({
          domainName: 'staging.example.com',
          hostedZoneId: 'Z0123456789',
          hostedZoneName: 'other.example.com',
        }),
      ),
    ).toThrow(/inside hostedZoneName/);
  });
});
