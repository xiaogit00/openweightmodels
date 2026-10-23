import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  type StackProps,
} from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as ses from 'aws-cdk-lib/aws-ses';
import * as route53 from 'aws-cdk-lib/aws-route53';
import type { Construct } from 'constructs';
import type { StagingConfig } from './config';

export type StagingFoundationProps = StackProps & {
  config: StagingConfig;
};

function containerHealthCheck(url: string): ecs.HealthCheck {
  return {
    command: [
      'CMD-SHELL',
      `node -e "fetch('${url}').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"`,
    ],
    interval: Duration.seconds(30),
    timeout: Duration.seconds(5),
    retries: 3,
    startPeriod: Duration.seconds(90),
  };
}

/**
 * Stateful/foundation half of staging: network, data, images, secrets, SES,
 * task definitions and logs. The App stack owns the ALB and the ECS services,
 * which lets a release run the migration task between registering new task
 * definitions and rolling the services.
 */
export class StagingFoundationStack extends Stack {
  readonly vpc: ec2.Vpc;
  readonly cluster: ecs.Cluster;
  readonly albSecurityGroup: ec2.SecurityGroup;
  readonly webSecurityGroup: ec2.SecurityGroup;
  readonly workerSecurityGroup: ec2.SecurityGroup;
  readonly webTaskDefinition: ecs.FargateTaskDefinition;
  readonly workerTaskDefinition: ecs.FargateTaskDefinition;
  readonly migrateTaskDefinition: ecs.FargateTaskDefinition;
  readonly webRepository: ecr.Repository;
  readonly workerRepository: ecr.Repository;

  constructor(scope: Construct, id: string, props: StagingFoundationProps) {
    super(scope, id, props);
    const { config } = props;
    const name = config.namePrefix;
    const appUrl = `https://${config.domainName}`;

    this.vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        { name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: 'private', subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24 },
      ],
    });

    this.albSecurityGroup = new ec2.SecurityGroup(this, 'AlbSecurityGroup', {
      vpc: this.vpc,
      description: 'Public HTTP/HTTPS for the staging ALB',
      allowAllOutbound: true,
    });
    this.albSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'HTTP redirect');
    this.albSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'HTTPS');

    this.webSecurityGroup = new ec2.SecurityGroup(this, 'WebSecurityGroup', {
      vpc: this.vpc,
      description: 'Next.js web tasks; reachable only from the ALB',
      allowAllOutbound: true,
    });
    this.webSecurityGroup.addIngressRule(
      this.albSecurityGroup,
      ec2.Port.tcp(3000),
      'ALB to web',
    );

    this.workerSecurityGroup = new ec2.SecurityGroup(this, 'WorkerSecurityGroup', {
      vpc: this.vpc,
      description: 'BullMQ worker tasks; no inbound traffic',
      allowAllOutbound: true,
    });

    const databaseSecurityGroup = new ec2.SecurityGroup(this, 'DatabaseSecurityGroup', {
      vpc: this.vpc,
      description: 'RDS Postgres, reachable only by the app tasks',
      allowAllOutbound: false,
    });
    databaseSecurityGroup.addIngressRule(this.webSecurityGroup, ec2.Port.tcp(5432), 'web');
    databaseSecurityGroup.addIngressRule(
      this.workerSecurityGroup,
      ec2.Port.tcp(5432),
      'worker and migration task',
    );

    const redisSecurityGroup = new ec2.SecurityGroup(this, 'RedisSecurityGroup', {
      vpc: this.vpc,
      description: 'ElastiCache Redis, reachable only by the app tasks',
      allowAllOutbound: false,
    });
    redisSecurityGroup.addIngressRule(this.webSecurityGroup, ec2.Port.tcp(6379), 'web');
    redisSecurityGroup.addIngressRule(this.workerSecurityGroup, ec2.Port.tcp(6379), 'worker');

    const database = new rds.DatabaseInstance(this, 'Postgres', {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_17_5,
      }),
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.BURSTABLE4_GRAVITON,
        ec2.InstanceSize.MICRO,
      ),
      vpc: this.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [databaseSecurityGroup],
      databaseName: 'openweightmodels',
      credentials: rds.Credentials.fromGeneratedSecret('owm', {
        secretName: `${name}/database`,
      }),
      allocatedStorage: 20,
      maxAllocatedStorage: 50,
      storageEncrypted: true,
      backupRetention: Duration.days(7),
      // Staging is disposable and single-AZ; production should raise both.
      multiAz: false,
      autoMinorVersionUpgrade: true,
      deletionProtection: false,
      deleteAutomatedBackups: true,
      removalPolicy: RemovalPolicy.DESTROY,
      publiclyAccessible: false,
    });

    const redisSubnetGroup = new elasticache.CfnSubnetGroup(this, 'RedisSubnetGroup', {
      description: `${name} private subnets`,
      subnetIds: this.vpc.privateSubnets.map((subnet) => subnet.subnetId),
      cacheSubnetGroupName: `${name}-redis`,
    });
    const redisParameterGroup = new elasticache.CfnParameterGroup(
      this,
      'RedisParameterGroup',
      {
        cacheParameterGroupFamily: 'redis7',
        description: `${name} Redis: BullMQ requires noeviction`,
        properties: { 'maxmemory-policy': 'noeviction' },
      },
    );
    const redis = new elasticache.CfnCacheCluster(this, 'Redis', {
      clusterName: `${name}-redis`,
      engine: 'redis',
      engineVersion: '7.1',
      cacheNodeType: config.cacheNodeType,
      numCacheNodes: 1,
      azMode: 'single-az',
      cacheSubnetGroupName: redisSubnetGroup.ref,
      cacheParameterGroupName: redisParameterGroup.ref,
      vpcSecurityGroupIds: [redisSecurityGroup.securityGroupId],
      // In-transit TLS; access is additionally limited by the security group.
      transitEncryptionEnabled: true,
      snapshotRetentionLimit: 0,
    });

    const repository = (id: string, suffix: string) =>
      new ecr.Repository(this, id, {
        repositoryName: `${name}-${suffix}`,
        imageScanOnPush: true,
        lifecycleRules: [
          {
            tagStatus: ecr.TagStatus.UNTAGGED,
            maxImageAge: Duration.days(14),
            description: 'Expire untagged images',
          },
        ],
        removalPolicy: RemovalPolicy.DESTROY,
      });

    this.webRepository = repository('WebRepository', 'web');
    this.workerRepository = repository('WorkerRepository', 'worker');

    const authSecret = new secretsmanager.Secret(this, 'AuthSecret', {
      secretName: `${name}/auth-secret`,
      description: 'Better Auth session signing secret',
      generateSecretString: { passwordLength: 48, excludePunctuation: true },
    });
    const providerKey = new secretsmanager.Secret(this, 'ProviderApiKey', {
      secretName: `${name}/openrouter-api-key`,
      description:
        'Set with: aws secretsmanager put-secret-value --secret-id <arn> --secret-string <key>',
    });

    const hostedZone = config.hostedZoneId
      ? route53.PublicHostedZone.fromPublicHostedZoneAttributes(this, 'HostedZone', {
          hostedZoneId: config.hostedZoneId,
          zoneName: config.hostedZoneName ?? config.domainName,
        })
      : undefined;
    const sesIdentity = new ses.EmailIdentity(this, 'SesIdentity', {
      identity: config.sesIdentity.includes('@')
        ? ses.Identity.email(config.sesIdentity)
        : ses.Identity.domain(config.sesIdentity),
    });
    if (hostedZone && !config.sesIdentity.includes('@')) {
      // Publish the identity's DKIM tokens in the configured zone, even when
      // the identity is a parent or sibling of the app hostname.
      sesIdentity.dkimRecords.forEach((record, index) => {
        new route53.CnameRecord(this, `SesDkimRecord${index + 1}`, {
          zone: hostedZone,
          recordName: record.name,
          domainName: record.value,
        });
      });
    }

    this.cluster = new ecs.Cluster(this, 'Cluster', {
      vpc: this.vpc,
      clusterName: `${name}-cluster`,
      containerInsightsV2: ecs.ContainerInsights.DISABLED,
    });

    const logGroup = (id: string, segment: string) =>
      new logs.LogGroup(this, id, {
        logGroupName: `/aws/ecs/${name}/${segment}`,
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.DESTROY,
      });

    const webLogs = logGroup('WebLogs', 'web');
    const workerLogs = logGroup('WorkerLogs', 'worker');
    const migrateLogs = logGroup('MigrateLogs', 'migrate');

    const executionRole = new iam.Role(this, 'TaskExecutionRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AmazonECSTaskExecutionRolePolicy',
        ),
      ],
      description: 'Pulls images and injects Secrets Manager values',
    });
    authSecret.grantRead(executionRole);
    providerKey.grantRead(executionRole);
    database.secret?.grantRead(executionRole);

    const runtimePlatform = {
      cpuArchitecture: ecs.CpuArchitecture.ARM64,
      operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
    };
    const databaseEnvironment = {
      DB_HOST: database.dbInstanceEndpointAddress,
      DB_PORT: database.dbInstanceEndpointPort,
      DB_NAME: 'openweightmodels',
      DB_SSL: 'true',
    };
    const redisEnvironment = {
      REDIS_HOST: redis.attrRedisEndpointAddress,
      REDIS_PORT: redis.attrRedisEndpointPort,
      REDIS_TLS: 'true',
    };
    const databaseSecrets = {
      DB_USER: ecs.Secret.fromSecretsManager(database.secret!, 'username'),
      DB_PASSWORD: ecs.Secret.fromSecretsManager(database.secret!, 'password'),
    };
    const taskDefinition = (
      id: string,
      family: string,
      cpu: number,
      memoryLimitMiB: number,
      taskRole?: iam.IRole,
    ) =>
      new ecs.FargateTaskDefinition(this, id, {
        family: `${name}-${family}`,
        cpu,
        memoryLimitMiB,
        executionRole,
        taskRole,
        runtimePlatform,
      });

    const webTaskRole = new iam.Role(this, 'WebTaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      description: 'Next.js runtime; may send magic-link mail through SES',
    });
    sesIdentity.grantSendEmail(webTaskRole);

    this.webTaskDefinition = taskDefinition('WebTask', 'web', 512, 1024, webTaskRole);
    this.webTaskDefinition.addContainer('web', {
      image: ecs.ContainerImage.fromEcrRepository(this.webRepository, config.imageTag),
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'web', logGroup: webLogs }),
      environment: {
        NODE_ENV: 'production',
        PORT: '3000',
        HOSTNAME: '0.0.0.0',
        APP_URL: appUrl,
        // Fargate has no instance metadata service; the SDK needs a region.
        AWS_REGION: this.region,
        EMAIL_TRANSPORT: 'ses',
        EMAIL_FROM: config.emailFrom,
        ...databaseEnvironment,
        ...redisEnvironment,
      },
      secrets: {
        ...databaseSecrets,
        BETTER_AUTH_SECRET: ecs.Secret.fromSecretsManager(authSecret),
      },
      portMappings: [{ containerPort: 3000, protocol: ecs.Protocol.TCP }],
      healthCheck: containerHealthCheck('http://127.0.0.1:3000/api/health'),
      stopTimeout: Duration.seconds(30),
    });

    const workerTaskRole = new iam.Role(this, 'WorkerTaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      description: 'BullMQ worker; calls the model provider',
    });
    this.workerTaskDefinition = taskDefinition('WorkerTask', 'worker', 512, 1024, workerTaskRole);
    this.workerTaskDefinition.addContainer('worker', {
      image: ecs.ContainerImage.fromEcrRepository(this.workerRepository, config.imageTag),
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'worker', logGroup: workerLogs }),
      environment: {
        NODE_ENV: 'production',
        WORKER_HEALTH_PORT: '3001',
        APP_URL: appUrl,
        PROVIDER: config.provider,
        MAX_CHALLENGERS: '4',
        JOBS_PER_HOUR: '10',
        RUNS_PER_DAY: '50',
        PROVIDER_CONCURRENCY: '4',
        ...databaseEnvironment,
        ...redisEnvironment,
      },
      secrets: {
        ...databaseSecrets,
        OPENROUTER_API_KEY: ecs.Secret.fromSecretsManager(providerKey),
      },
      healthCheck: containerHealthCheck('http://127.0.0.1:3001/healthz'),
      stopTimeout: Duration.seconds(30),
    });

    this.migrateTaskDefinition = taskDefinition('MigrateTask', 'migrate', 256, 512);
    this.migrateTaskDefinition.addContainer('migrate', {
      image: ecs.ContainerImage.fromEcrRepository(this.workerRepository, config.imageTag),
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'migrate', logGroup: migrateLogs }),
      command: [
        '/app/apps/worker/node_modules/.bin/tsx',
        'packages/core/src/db/bootstrap.ts',
      ],
      environment: {
        NODE_ENV: 'production',
        ...databaseEnvironment,
      },
      secrets: databaseSecrets,
    });

    new CfnOutput(this, 'VpcId', { value: this.vpc.vpcId });
    new CfnOutput(this, 'PrivateSubnetIds', {
      value: this.vpc.privateSubnets.map((subnet) => subnet.subnetId).join(','),
    });
    new CfnOutput(this, 'ClusterName', { value: this.cluster.clusterName });
    new CfnOutput(this, 'WebRepositoryUri', { value: this.webRepository.repositoryUri });
    new CfnOutput(this, 'WorkerRepositoryUri', {
      value: this.workerRepository.repositoryUri,
    });
    new CfnOutput(this, 'WebTaskDefinitionFamily', {
      value: this.webTaskDefinition.family,
    });
    new CfnOutput(this, 'WorkerTaskDefinitionFamily', {
      value: this.workerTaskDefinition.family,
    });
    new CfnOutput(this, 'MigrateTaskDefinitionFamily', {
      value: this.migrateTaskDefinition.family,
    });
    new CfnOutput(this, 'MigrateTaskDefinitionArn', {
      value: this.migrateTaskDefinition.taskDefinitionArn,
    });
    new CfnOutput(this, 'MigrateSecurityGroupId', {
      value: this.workerSecurityGroup.securityGroupId,
    });
    new CfnOutput(this, 'DatabaseEndpoint', {
      value: `${database.dbInstanceEndpointAddress}:${database.dbInstanceEndpointPort}`,
    });
    new CfnOutput(this, 'RedisEndpoint', {
      value: `${redis.attrRedisEndpointAddress}:${redis.attrRedisEndpointPort}`,
    });
    new CfnOutput(this, 'WebLogGroupName', { value: webLogs.logGroupName });
    new CfnOutput(this, 'WorkerLogGroupName', { value: workerLogs.logGroupName });
    new CfnOutput(this, 'MigrateLogGroupName', { value: migrateLogs.logGroupName });
    new CfnOutput(this, 'DatabaseSecretArn', {
      value: database.secret?.secretArn ?? '',
    });
    new CfnOutput(this, 'ProviderKeySecretArn', { value: providerKey.secretArn });
    new CfnOutput(this, 'SesIdentityArn', { value: sesIdentity.emailIdentityArn });
    new CfnOutput(this, 'SesDkimName1', { value: sesIdentity.dkimDnsTokenName1 });
    new CfnOutput(this, 'SesDkimValue1', { value: sesIdentity.dkimDnsTokenValue1 });
    new CfnOutput(this, 'SesDkimName2', { value: sesIdentity.dkimDnsTokenName2 });
    new CfnOutput(this, 'SesDkimValue2', { value: sesIdentity.dkimDnsTokenValue2 });
    new CfnOutput(this, 'SesDkimName3', { value: sesIdentity.dkimDnsTokenName3 });
    new CfnOutput(this, 'SesDkimValue3', { value: sesIdentity.dkimDnsTokenValue3 });
  }
}
