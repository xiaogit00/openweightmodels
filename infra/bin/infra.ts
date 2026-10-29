#!/usr/bin/env tsx
import { App } from 'aws-cdk-lib';
import { StagingAppStack } from '../lib/app-stack';
import { StagingCiStack } from '../lib/ci-stack';
import { loadStagingConfig } from '../lib/config';
import { StagingFoundationStack } from '../lib/foundation-stack';
import { StagingOpsStack } from '../lib/ops-stack';

const app = new App();
const config = loadStagingConfig(app);
const env = config.account && config.region
  ? { account: config.account, region: config.region }
  : undefined;

const foundation = new StagingFoundationStack(app, `${config.stackPrefix}Foundation`, {
  config,
  env,
  description: 'OpenWeightModels staging: network, data, images, secrets and task definitions',
});

const appStack = new StagingAppStack(app, `${config.stackPrefix}App`, {
  config,
  env,
  description: 'OpenWeightModels staging: ALB, HTTPS and ECS services',
  vpc: foundation.vpc,
  cluster: foundation.cluster,
  albSecurityGroup: foundation.albSecurityGroup,
  webSecurityGroup: foundation.webSecurityGroup,
  workerSecurityGroup: foundation.workerSecurityGroup,
});

new StagingOpsStack(app, `${config.stackPrefix}Ops`, {
  config,
  env,
  description: 'OpenWeightModels staging: CloudWatch alarms, alarm owner and budgets',
  alb: appStack.alb,
  targetGroup: appStack.targetGroup,
  clusterName: foundation.cluster.clusterName,
  webServiceName: appStack.webServiceName,
  workerServiceName: appStack.workerServiceName,
  workerLogGroup: foundation.workerLogGroup,
  queueName: 'owm-runs',
});

if (config.githubRepo) {
  new StagingCiStack(app, `${config.stackPrefix}Ci`, {
    config,
    env,
    description: 'OpenWeightModels staging: GitHub Actions OIDC deploy role',
  });
}
