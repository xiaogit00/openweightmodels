import { CfnOutput, Stack, type StackProps } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import type { Construct } from 'constructs';
import type { DeploymentConfig } from './config';

export type CiStackProps = StackProps & {
  config: DeploymentConfig;
};

/**
 * Short-lived credentials for GitHub Actions. No access key is stored in the
 * repository or in GitHub: the workflow exchanges its OIDC token for this role.
 *
 * Staging trusts the repository branch and the `staging` environment. Production
 * trusts only its GitHub environment, so a push to `main` can never assume it.
 * The role is deliberately broad because `cdk deploy` creates and updates every
 * resource; narrow it to the deploy surface once that surface settles.
 */
export class CiStack extends Stack {
  readonly deployRoleArn: string;

  constructor(scope: Construct, id: string, props: CiStackProps) {
    super(scope, id, props);
    const { config } = props;
    if (!config.githubRepo) {
      throw new Error('CiStack needs OWM_GITHUB_REPO (or -c githubRepo=owner/repo)');
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

    const subjectPrefix = config.githubSubjectPrefix ?? `repo:${config.githubRepo}`;
    const environmentSubject = `${subjectPrefix}:environment:${config.githubEnvironment}`;
    const subjects =
      config.environment === 'production'
        ? // A tag deploy runs in the `production` GitHub environment. Do not add
          // a branch subject here: pushing to main must never assume this role.
          [environmentSubject]
        : [
            `${subjectPrefix}:ref:refs/heads/${config.githubBranch}`,
            environmentSubject,
          ];

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
            'token.actions.githubusercontent.com:sub': subjects,
          },
        },
        'sts:AssumeRoleWithWebIdentity',
      ),
      // Accepted for now: `cdk deploy` manages the whole environment. Production
      // should move to a narrower permission set once the deploy surface stops
      // changing (ticket 28).
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
