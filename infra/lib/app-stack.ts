import {
  CfnOutput,
  Duration,
  Stack,
  type StackProps,
} from 'aws-cdk-lib';
import * as appscaling from 'aws-cdk-lib/aws-applicationautoscaling';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53Targets from 'aws-cdk-lib/aws-route53-targets';
import type { Construct } from 'constructs';
import type { StagingConfig } from './config';

export type StagingAppProps = StackProps & {
  config: StagingConfig;
  vpc: ec2.Vpc;
  cluster: ecs.Cluster;
  albSecurityGroup: ec2.SecurityGroup;
  webSecurityGroup: ec2.SecurityGroup;
  workerSecurityGroup: ec2.SecurityGroup;
};

/**
 * Stateless half of staging: ALB, HTTPS, DNS and the two ECS services.
 *
 * Services reference their task definitions by family, not by ARN, so a new
 * image revision does not create a cross-stack export change. The release
 * script runs the migration task and then updates each service to the newest
 * revision (see infra/scripts/deploy.sh).
 */
export class StagingAppStack extends Stack {
  readonly alb: elbv2.ApplicationLoadBalancer;
  readonly targetGroup: elbv2.ApplicationTargetGroup;
  readonly webServiceName: string;
  readonly workerServiceName: string;

  constructor(scope: Construct, id: string, props: StagingAppProps) {
    super(scope, id, props);
    const { config } = props;
    const name = config.namePrefix;
    const clusterName = props.cluster.clusterName;
    const privateSubnetIds = props.vpc.privateSubnets.map((subnet) => subnet.subnetId);

    const zone = config.hostedZoneId
      ? route53.HostedZone.fromHostedZoneAttributes(this, 'HostedZone', {
          hostedZoneId: config.hostedZoneId,
          zoneName: config.hostedZoneName ?? config.domainName,
        })
      : undefined;

    const certificate = config.certificateArn
      ? acm.Certificate.fromCertificateArn(this, 'Certificate', config.certificateArn)
      : new acm.Certificate(this, 'Certificate', {
          domainName: config.domainName,
          validation: acm.CertificateValidation.fromDns(zone),
        });

    const alb = new elbv2.ApplicationLoadBalancer(this, 'Alb', {
      vpc: props.vpc,
      internetFacing: true,
      securityGroup: props.albSecurityGroup,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      idleTimeout: Duration.seconds(4000),
      dropInvalidHeaderFields: true,
      http2Enabled: true,
      deletionProtection: false,
    });

    const targetGroup = new elbv2.ApplicationTargetGroup(this, 'WebTargetGroup', {
      vpc: props.vpc,
      port: 3000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      deregistrationDelay: Duration.seconds(30),
      healthCheck: {
        path: '/api/health',
        healthyHttpCodes: '200',
        interval: Duration.seconds(15),
        timeout: Duration.seconds(5),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
      },
    });

    const httpsListener = alb.addListener('HttpsListener', {
      port: 443,
      protocol: elbv2.ApplicationProtocol.HTTPS,
      certificates: [elbv2.ListenerCertificate.fromCertificateManager(certificate)],
      sslPolicy: elbv2.SslPolicy.RECOMMENDED_TLS,
      defaultTargetGroups: [targetGroup],
    });
    alb.addListener('HttpListener', {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      defaultAction: elbv2.ListenerAction.redirect({
        protocol: 'HTTPS',
        port: '443',
        permanent: true,
      }),
    });

    if (zone) {
      new route53.ARecord(this, 'AppRecord', {
        zone,
        recordName: config.domainName,
        target: route53.RecordTarget.fromAlias(new route53Targets.LoadBalancerTarget(alb)),
      });
    }

    const webServiceName = `${name}-web`;
    const workerServiceName = `${name}-worker`;
    this.alb = alb;
    this.targetGroup = targetGroup;
    this.webServiceName = webServiceName;
    this.workerServiceName = workerServiceName;

    const webService = new ecs.CfnService(this, 'WebService', {
      cluster: clusterName,
      taskDefinition: `${name}-web`,
      serviceName: webServiceName,
      desiredCount: config.webDesiredCount,
      launchType: 'FARGATE',
      platformVersion: 'LATEST',
      networkConfiguration: {
        awsvpcConfiguration: {
          assignPublicIp: 'DISABLED',
          securityGroups: [props.webSecurityGroup.securityGroupId],
          subnets: privateSubnetIds,
        },
      },
      loadBalancers: [
        {
          containerName: 'web',
          containerPort: 3000,
          targetGroupArn: targetGroup.targetGroupArn,
        },
      ],
      healthCheckGracePeriodSeconds: 120,
      deploymentConfiguration: {
        minimumHealthyPercent: 100,
        maximumPercent: 200,
        deploymentCircuitBreaker: { enable: true, rollback: true },
      },
      enableExecuteCommand: false,
      propagateTags: 'SERVICE',
    });
    // A target group only gains its load balancer when the listener that
    // references it is created. `CfnService` links to the target group but not
    // to the listener, so without this dependency CloudFormation can create the
    // service first and ECS rejects it with "does not have an associated load
    // balancer".
    webService.node.addDependency(httpsListener);

    const workerService = new ecs.CfnService(this, 'WorkerService', {
      cluster: clusterName,
      taskDefinition: `${name}-worker`,
      serviceName: workerServiceName,
      desiredCount: config.workerDesiredCount,
      launchType: 'FARGATE',
      platformVersion: 'LATEST',
      networkConfiguration: {
        awsvpcConfiguration: {
          assignPublicIp: 'DISABLED',
          securityGroups: [props.workerSecurityGroup.securityGroupId],
          subnets: privateSubnetIds,
        },
      },
      healthCheckGracePeriodSeconds: 120,
      deploymentConfiguration: {
        minimumHealthyPercent: 0,
        maximumPercent: 100,
        deploymentCircuitBreaker: { enable: true, rollback: true },
      },
      enableExecuteCommand: false,
      propagateTags: 'SERVICE',
    });

    type ScalingRule = {
      id: string;
      serviceName: string;
      service: ecs.CfnService;
      minCapacity: number;
      maxCapacity: number;
      targetUtilizationPercent: number;
    };
    const scalable = (rule: ScalingRule) => {
      const { id, serviceName, service, minCapacity, maxCapacity, targetUtilizationPercent } =
        rule;
      const target = new appscaling.ScalableTarget(this, `${id}ScalableTarget`, {
        serviceNamespace: appscaling.ServiceNamespace.ECS,
        scalableDimension: 'ecs:service:DesiredCount',
        resourceId: `service/${clusterName}/${serviceName}`,
        minCapacity,
        maxCapacity,
      });
      // `resourceId` is a plain string, so Application Auto Scaling would
      // otherwise register the target before the ECS service exists and fail
      // with "ECS service doesn't exist".
      target.node.addDependency(service);
      target.scaleOnMetric(`${id}Cpu`, {
        metric: new cloudwatch.Metric({
          namespace: 'AWS/ECS',
          metricName: 'CPUUtilization',
          dimensionsMap: { ClusterName: clusterName, ServiceName: serviceName },
          statistic: 'Average',
          period: Duration.minutes(1),
        }),
        scalingSteps: [
          { upper: targetUtilizationPercent - 20, change: -1 },
          { lower: targetUtilizationPercent, change: 1 },
        ],
        adjustmentType: appscaling.AdjustmentType.CHANGE_IN_CAPACITY,
        cooldown: Duration.minutes(5),
      });
    };

    scalable({
      id: 'Web',
      serviceName: webServiceName,
      service: webService,
      minCapacity: config.minWebTasks,
      maxCapacity: config.maxWebTasks,
      targetUtilizationPercent: 60,
    });
    scalable({
      id: 'Worker',
      serviceName: workerServiceName,
      service: workerService,
      minCapacity: config.minWorkerTasks,
      maxCapacity: config.maxWorkerTasks,
      targetUtilizationPercent: 70,
    });

    new CfnOutput(this, 'AppUrl', { value: `https://${config.domainName}` });
    new CfnOutput(this, 'AlbDnsName', { value: alb.loadBalancerDnsName });
    new CfnOutput(this, 'AlbArn', { value: alb.loadBalancerArn });
    new CfnOutput(this, 'WebServiceName', { value: webServiceName });
    new CfnOutput(this, 'WorkerServiceName', { value: workerServiceName });
    new CfnOutput(this, 'TargetGroupArn', { value: targetGroup.targetGroupArn });
  }
}
