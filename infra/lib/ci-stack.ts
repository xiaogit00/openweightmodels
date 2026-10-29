import { CfnOutput, Stack, type StackProps } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import type { Construct } from 'constructs';
import type { StagingConfig } from './config';

export type StagingCiProps = StackProps & {
  config: StagingConfig;
};

/**
 * Short-lived credentials for GitHub Actions. No access key is stored in the
 * repository or in GitHub: the workflow exchanges its OIDC token for this role.
 *
 * The role is deliberately broad because `cdk deploy` creates and updates every
 * resource in the staging stacks. It exists only in the staging account and is
 * fenced to one repository, one branch and the `staging` environment.
 */
export class StagingCiStack extends Stack {
  readonly deployRoleArn: string;

  constructor(scope: Construct, id: string, props: StagingCiProps) {
    super(scope, id, props);
    const { config } = props;
    if (!config.githubRepo) {
      throw new Error('StagingCiStack needs OWM_GITHUB_REPO (or -c githubRepo=owner/repo)');
    }

    const provider = config.githubOidcProviderArn
      ? iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn(
          this,
          'GitHubOidcProvider',
          config.githubOidcProviderArn,
        )
      : new iam.OpenIdConnectProvider(this, 'GitHubOidcProvider', {
          url: 'https://token.actions.githubusercontent.com',
          clientIds: ['sts.amazonaws.com'],
        });

    const role = new iam.Role(this, 'DeployRole', {
      roleName: `${config.namePrefix}-github-deploy`,
      description: `GitHub Actions deploy role for ${config.githubRepo} (OIDC, no access keys)`,
      assumedBy: new iam.FederatedPrincipal(
        provider.openIdConnectProviderArn,
        {
          StringEquals: {
            'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
          },
          StringLike: {
            'token.actions.githubusercontent.com:sub': [
              `repo:${config.githubRepo}:ref:refs/heads/${config.githubBranch}`,
              `repo:${config.githubRepo}:environment:staging`,
            ],
          },
        },
        'sts:AssumeRoleWithWebIdentity',
      ),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AdministratorAccess'),
      ],
    });

    this.deployRoleArn = role.roleArn;

    new CfnOutput(this, 'DeployRoleArn', { value: role.roleArn });
    new CfnOutput(this, 'OidcProviderArn', {
      value: provider.openIdConnectProviderArn,
    });
  }
}
