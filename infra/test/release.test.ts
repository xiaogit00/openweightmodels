import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (file: string) => readFileSync(join(root, file), 'utf8');

describe('production images', () => {
  const dockerfile = read('Dockerfile');

  it('builds a Next standalone web image and a worker image', () => {
    expect(dockerfile).toMatch(/FROM base AS web/);
    expect(dockerfile).toMatch(/FROM base AS worker/);
    expect(dockerfile).toContain(
      'COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./',
    );
    expect(dockerfile).toContain(
      'COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static',
    );
    expect(dockerfile).toContain('USER node');
    expect(dockerfile).toMatch(/CMD \["node", "apps\/web\/server\.js"\]/);
  });

  it('runs the worker from a production-only dependency tree', () => {
    expect(dockerfile).toContain('pnpm install --frozen-lockfile --prod');
    expect(dockerfile).toContain(
      'CMD ["apps/worker/node_modules/.bin/tsx", "apps/worker/src/index.ts"]',
    );
    expect(dockerfile).toContain('COPY --chown=node:node packages/core/drizzle');
  });
});

describe('release script', () => {
  const script = read('infra/scripts/deploy.sh');

  it('runs the migration task before any service update', () => {
    const migration = script.indexOf('aws ecs run-task');
    const serviceUpdate = script.indexOf('aws ecs update-service');
    expect(migration).toBeGreaterThan(-1);
    expect(serviceUpdate).toBeGreaterThan(-1);
    expect(migration).toBeLessThan(serviceUpdate);
    expect(script).toContain('aws ecs wait tasks-stopped');
    expect(script).toContain('aws ecs wait services-stable');
  });

  it('refuses an empty provider key before releasing the worker', () => {
    expect(script).toContain('get-secret-value');
    expect(script).toContain('The provider key secret is empty');
    expect(script.indexOf('The provider key secret is empty')).toBeLessThan(
      script.indexOf('aws ecs run-task'),
    );
  });

  it('validates the hosted zone before creating any resources', () => {
    expect(script).toContain('aws route53 get-hosted-zone');
    expect(script).toContain('was not found');
    expect(script.indexOf('get-hosted-zone')).toBeLessThan(
      script.indexOf('deploy "$FOUNDATION"'),
    );
  });

  it('pins the image tag and the ARM64 platform', () => {
    expect(script).toContain('linux/arm64');
    expect(script).toContain('--target web');
    expect(script).toContain('--target worker');
    expect(script).toContain('IMAGE_TAG');
  });

  it('requires a named alarm owner and a positive spend cap', () => {
    expect(script).toContain('OWM_ALARM_EMAIL');
    expect(script).toContain('it is required');
    expect(script).toContain('OWM_MONTHLY_SPEND_CAP_USD');
    expect(script).toContain('must be a positive number');
  });

  it('deploys the alerts and budget stack after the app stack', () => {
    expect(script).toContain('OPS="${STACK_PREFIX}Ops"');
    expect(script).toContain('Creating the Ops stack');
    expect(script.indexOf('deploy "$OPS"')).toBeGreaterThan(
      script.indexOf('deploy "$APP"'),
    );
  });

  it('derives the production prefixes and platform from the environment', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    expect(pkg.scripts['deploy:prod']).toBe(
      'OWM_ENVIRONMENT=production bash infra/scripts/deploy.sh',
    );

    expect(script).toContain('OWM_ENVIRONMENT');
    expect(script).toContain('DEFAULT_STACK_PREFIX=OwmProd');
    expect(script).toContain('DEFAULT_NAME_PREFIX=owm-prod');
    expect(script).toContain('Refusing to deploy');
    expect(script).toContain('PLATFORM="${PLATFORM:-linux/arm64}"');
    expect(script).toContain('-c "environment=$ENVIRONMENT"');
  });

  it('takes a production snapshot before the migration and aborts on failure', () => {
    // The bare name also appears in the function definition; match the call.
    const snapshot = script.indexOf('\nsnapshot_database\n');
    const migration = script.indexOf('aws ecs run-task');
    expect(snapshot).toBeGreaterThan(-1);
    expect(snapshot).toBeLessThan(migration);

    expect(script).toContain('aws rds create-db-snapshot');
    expect(script).toContain('aws rds wait db-snapshot-completed');
    expect(script).toContain('DatabaseInstanceIdentifier');
    expect(script).toContain('-pre-');
    expect(script).toContain('SKIP_SNAPSHOT');
    expect(script).toContain('aborting before the migration task');
  });

  it('can verify and reuse an existing image tag for a hotfix', () => {
    expect(script).toContain('SKIP_BUILD');
    expect(script).toContain('aws ecr describe-images');
    expect(script).toContain('cannot use SKIP_BUILD=1');
  });

  it('passes the production sizing, SES and count context values', () => {
    for (const key of [
      'OWM_SES_PRODUCTION_ACCESS',
      'OWM_WEB_DESIRED_COUNT',
      'OWM_WORKER_DESIRED_COUNT',
      'OWM_WEB_CPU',
      'OWM_WEB_MEMORY',
      'OWM_WORKER_CPU',
      'OWM_WORKER_MEMORY',
      'OWM_DB_INSTANCE_CLASS',
      'OWM_DB_INSTANCE_SIZE',
      'OWM_DB_ALLOCATED_STORAGE',
      'OWM_DB_MAX_ALLOCATED_STORAGE',
      'OWM_DB_BACKUP_RETENTION_DAYS',
      'OWM_CACHE_NODE_TYPE',
      'OWM_NAT_GATEWAYS',
    ]) {
      expect(script, key).toContain(key);
    }
  });

  it('reports the environment with prefix-derived messages', () => {
    expect(script).toContain('$STACK_PREFIX is deployed');
    expect(script).not.toContain('Staging is deployed');
  });
});

describe('CI delivery', () => {
  const ci = read('.github/workflows/ci.yml');
  const verify = read('.github/workflows/verify.yml');
  const setup = read('infra/scripts/setup-ci.sh');

  it('runs typecheck, tests and a build in a reusable verify workflow', () => {
    expect(verify).toContain('on:');
    expect(verify).toContain('workflow_call');
    expect(verify).toContain('pnpm typecheck');
    expect(verify).toContain('pnpm test');
    expect(verify).toContain('pnpm build');
    expect(verify).toContain('pnpm db:bootstrap');
    expect(verify).toContain('postgres:17');
    expect(verify).toContain('redis:7');
  });

  it('keeps the staging deploy on main and calls verify', () => {
    expect(ci).toContain('uses: ./.github/workflows/verify.yml');
    expect(ci).toContain('needs: verify');
    expect(ci).toContain('pnpm deploy:staging');
  });

  it('deploys with a GitHub OIDC token, not stored AWS keys', () => {
    expect(ci).toContain('id-token: write');
    expect(ci).toContain('aws-actions/configure-aws-credentials@v4');
    expect(ci).toContain('role-to-assume: ${{ vars.AWS_DEPLOY_ROLE_ARN }}');
    expect(ci).not.toContain('aws-access-key-id');
    expect(ci).not.toContain('AWS_SECRET_ACCESS_KEY');
  });

  it('creates the deploy role from a one-time OIDC bootstrap', () => {
    expect(setup).toContain('cdk deploy "$CI_STACK"');
    expect(setup).toContain('OWM_GITHUB_REPO');
    expect(setup).toContain('DeployRoleArn');
    expect(setup).not.toContain('create-access-key');
    expect(setup).toContain('DEFAULT_STACK_PREFIX=OwmProd');
    expect(setup).toContain('OWM_GITHUB_ENVIRONMENT');
    expect(setup).toContain('githubEnvironment=$GITHUB_ENVIRONMENT');
  });
});

describe('production release workflow', () => {
  const workflow = read('.github/workflows/deploy-production.yml');

  it('is tag-triggered and can redeploy an explicit image', () => {
    expect(workflow).toContain("tags: ['v*']");
    expect(workflow).toContain('workflow_dispatch');
    expect(workflow).toContain('image_tag');
    expect(workflow).toContain('SKIP_BUILD=1');
    expect(workflow).toContain('pnpm deploy:prod');
  });

  it('is environment-gated, verified first and never cancelled mid-flight', () => {
    expect(workflow).toContain('environment: production');
    expect(workflow).toContain('needs: verify');
    expect(workflow).toContain('uses: ./.github/workflows/verify.yml');
    expect(workflow).toContain('group: deploy-production');
    expect(workflow).toContain('cancel-in-progress: false');
    expect(workflow).toMatch(/timeout-minutes:\s*(9[0-9]|[1-9][0-9]{2,})/);
  });

  it('guards the tag against main', () => {
    expect(workflow).toContain('fetch-depth: 0');
    expect(workflow).toContain('git fetch --no-tags origin main');
    expect(workflow).toContain('git merge-base --is-ancestor');
    expect(workflow).toContain('not an ancestor of origin/main');
  });

  it('assumes the production role without stored keys and keeps the launch invite-only', () => {
    expect(workflow).toContain('permissions:');
    expect(workflow).toContain('id-token: write');
    expect(workflow).toContain('role-to-assume: ${{ vars.AWS_DEPLOY_ROLE_ARN }}');
    expect(workflow).toContain('role-session-name: owm-prod-${{ github.run_id }}');
    expect(workflow).not.toContain('aws-access-key-id');
    expect(workflow).not.toContain('AWS_SECRET_ACCESS_KEY');
    expect(workflow).toContain('OWM_ALLOW_SEARCH_INDEXING');
    expect(workflow).toContain("OWM_ALLOW_SEARCH_INDEXING: 'false'");
    expect(workflow).toContain('OWM_ENVIRONMENT: production');
    expect(workflow).toContain('OWM_SES_PRODUCTION_ACCESS');
  });
});

describe('production owner wizard', () => {
  const wizard = read('infra/scripts/prod-wizard.sh');

  it('supports checkpoints, a read-only check and the same-account override', () => {
    expect(wizard).toContain('--check');
    expect(wizard).toContain('--from');
    expect(wizard).toContain('--allow-same-account');
    expect(wizard).toContain('OwmStagingFoundation');
    expect(wizard).toContain('CHECK_ONLY');
    expect(wizard).toContain('chmod 600');
    expect(wizard).toContain('.prod-wizard-state');
  });

  it('keeps the provider key out of files and logs', () => {
    expect(wizard).toContain('read -rs');
    expect(wizard).toContain('put-secret-value');
    expect(wizard).toContain('file:///dev/stdin');
    expect(wizard).not.toContain('cdk destroy');
    expect(wizard).not.toContain('OR_KEY=');
  });

  it('prints the GitHub environment setup and the first tag command', () => {
    expect(wizard).toContain('gh variable set AWS_DEPLOY_ROLE_ARN');
    expect(wizard).toContain('gh secret set OWM_SENTRY_DSN');
    expect(wizard).toContain('git tag v0.1.0');
    expect(wizard).toContain('gh run watch');
  });

  it('writes the production environment and prefixes before bootstrap', () => {
    expect(wizard).toContain('save_var OWM_ENVIRONMENT production');
    expect(wizard).toContain('save_var OWM_STACK_PREFIX OwmProd');
    expect(wizard).toContain('save_var OWM_NAME_PREFIX owm-prod');
    expect(wizard).toContain('OWM_ENVIRONMENT=production OWM_STACK_PREFIX=OwmProd');
  });
});

describe('shell syntax', () => {
  it.each(['deploy.sh', 'setup-ci.sh', 'prod-wizard.sh'])(
    'infra/scripts/%s parses',
    (name) => {
      expect(() =>
        execFileSync('bash', ['-n', join(root, 'infra/scripts', name)]),
      ).not.toThrow();
    },
  );
});
