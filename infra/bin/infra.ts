#!/usr/bin/env tsx
import { App } from 'aws-cdk-lib';
import { AppStack } from '../lib/app-stack';
import { CiStack } from '../lib/ci-stack';
import { loadDeploymentConfig } from '../lib/config';
import { FoundationStack } from '../lib/foundation-stack';
import { OpsStack } from '../lib/ops-stack';

const app = new App();
const config = loadDeploymentConfig(app);
const env = config.account && config.region
  ? { account: config.account, region: config.region }
  : undefined;
const label = config.environment;

const foundation = new FoundationStack(app, `${config.stackPrefix}Foundation`, {
  config,
  env,
  description: `OpenWeightModels ${label}: network, data, images, secrets and task definitions`,
});

const appStack = new AppStack(app, `${config.stackPrefix}App`, {
  config,
  env,
  description: `OpenWeightModels ${label}: ALB, HTTPS and ECS services`,
  vpc: foundation.vpc,
  cluster: foundation.cluster,
  albSecurityGroup: foundation.albSecurityGroup,
  webSecurityGroup: foundation.webSecurityGroup,
  workerSecurityGroup: foundation.workerSecurityGroup,
});

new OpsStack(app, `${config.stackPrefix}Ops`, {
  config,
  env,
  description: `OpenWeightModels ${label}: CloudWatch alarms, alarm owner and budgets`,
  alb: appStack.alb,
  targetGroup: appStack.targetGroup,
  clusterName: foundation.cluster.clusterName,
  webServiceName: appStack.webServiceName,
  workerServiceName: appStack.workerServiceName,
  workerLogGroup: foundation.workerLogGroup,
  queueName: 'owm-runs',
});

if (config.githubRepo) {
  new CiStack(app, `${config.stackPrefix}Ci`, {
    config,
    env,
    description: `OpenWeightModels ${label}: GitHub Actions OIDC deploy role`,
  });
}
