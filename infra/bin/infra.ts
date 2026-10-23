#!/usr/bin/env tsx
import { App } from 'aws-cdk-lib';
import { StagingAppStack } from '../lib/app-stack';
import { loadStagingConfig } from '../lib/config';
import { StagingFoundationStack } from '../lib/foundation-stack';

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

new StagingAppStack(app, `${config.stackPrefix}App`, {
  config,
  env,
  description: 'OpenWeightModels staging: ALB, HTTPS and ECS services',
  vpc: foundation.vpc,
  cluster: foundation.cluster,
  albSecurityGroup: foundation.albSecurityGroup,
  webSecurityGroup: foundation.webSecurityGroup,
  workerSecurityGroup: foundation.workerSecurityGroup,
});
