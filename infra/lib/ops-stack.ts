import { CfnOutput, Duration, Stack, type StackProps } from 'aws-cdk-lib';
import * as budgets from 'aws-cdk-lib/aws-budgets';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cwActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import type { Construct } from 'constructs';
import type { StagingConfig } from './config';

export type StagingOpsProps = StackProps & {
  config: StagingConfig;
  alb: elbv2.ApplicationLoadBalancer;
  targetGroup: elbv2.ApplicationTargetGroup;
  clusterName: string;
  webServiceName: string;
  workerServiceName: string;
  workerLogGroup: logs.ILogGroup;
  queueName: string;
};

/**
 * Operational visibility and cost ceilings. Kept out of the App stack so
 * alarms can be added or tuned without rolling the services, and so the
 * alarm topic has one named owner rather than a list of scattered actions.
 */
export class StagingOpsStack extends Stack {
  readonly alarmTopic: sns.Topic;

  constructor(scope: Construct, id: string, props: StagingOpsProps) {
    super(scope, id, props);
    const { config } = props;
    const name = config.namePrefix;

    this.alarmTopic = new sns.Topic(this, 'AlarmTopic', {
      topicName: `${name}-alarms`,
      displayName: `OpenWeightModels ${config.domainName} alarms`,
    });
    this.alarmTopic.addSubscription(new subscriptions.EmailSubscription(config.alarmEmail));
    const alarmAction = new cwActions.SnsAction(this.alarmTopic);

    const alarm = (id: string, props: cloudwatch.AlarmProps) => {
      const created = new cloudwatch.Alarm(this, id, {
        ...props,
        alarmDescription: `${props.alarmDescription ?? id} (owner: ${config.alarmEmail})`,
      });
      created.addAlarmAction(alarmAction);
      created.addOkAction(alarmAction);
      return created;
    };

    // A 5xx here is the ALB failing before the app answers, or the target group
    // returning errors it produced.
    alarm('Alb5xxAlarm', {
      metric: new cloudwatch.Metric({
        namespace: 'AWS/ApplicationELB',
        metricName: 'HTTPCode_ELB_5XX_Count',
        dimensionsMap: { LoadBalancer: props.alb.loadBalancerFullName },
        statistic: 'Sum',
        period: Duration.minutes(5),
      }),
      threshold: 5,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: 'ALB returned 5xx responses for two consecutive 5-minute periods',
    });

    // An application 500 is a *target* 5xx; the ALB metric above only covers
    // failures the load balancer itself produced (no healthy target, timeout).
    alarm('Target5xxAlarm', {
      metric: new cloudwatch.Metric({
        namespace: 'AWS/ApplicationELB',
        metricName: 'HTTPCode_Target_5XX_Count',
        dimensionsMap: {
          LoadBalancer: props.alb.loadBalancerFullName,
          TargetGroup: props.targetGroup.targetGroupFullName,
        },
        statistic: 'Sum',
        period: Duration.minutes(5),
      }),
      threshold: 5,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: 'Web targets returned 5xx responses for two consecutive 5-minute periods',
    });

    // A failing web task is removed from the target group before it stops
    // answering health checks; this is the earliest ECS-level signal.
    alarm('UnhealthyWebTargetsAlarm', {
      metric: new cloudwatch.Metric({
        namespace: 'AWS/ApplicationELB',
        metricName: 'UnHealthyHostCount',
        dimensionsMap: {
          LoadBalancer: props.alb.loadBalancerFullName,
          TargetGroup: props.targetGroup.targetGroupFullName,
        },
        statistic: 'Maximum',
        period: Duration.minutes(1),
      }),
      threshold: 1,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: 'One or more web tasks are unhealthy',
    });

    // The worker has no target group, so watch its running task count. The
    // service minimum is one; a zero here means no one is draining the queue.
    alarm('WorkerRunningTasksAlarm', {
      metric: new cloudwatch.Metric({
        namespace: 'AWS/ECS',
        metricName: 'RunningTaskCount',
        dimensionsMap: {
          ClusterName: props.clusterName,
          ServiceName: props.workerServiceName,
        },
        statistic: 'Minimum',
        period: Duration.minutes(1),
      }),
      threshold: 1,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.BREACHING,
      alarmDescription: 'No worker task is running; Runs will not be generated',
    });

    // The worker writes one JSON line per minute. A metric filter keeps the
    // worker free of the CloudWatch SDK and IAM permissions.
    const queueDepthFilter = new logs.MetricFilter(this, 'QueueDepthFilter', {
      logGroup: props.workerLogGroup,
      filterPattern: logs.FilterPattern.literal('{ $.metric = "queue" && $.depth = * }'),
      metricNamespace: 'OWM/Queue',
      metricName: 'Depth',
      metricValue: '$.depth',
      defaultValue: 0,
      dimensions: { QueueName: props.queueName },
      filterName: `${name}-queue-depth`,
    });

    alarm('QueueDepthAlarm', {
      metric: queueDepthFilter.metric({
        statistic: 'Maximum',
        period: Duration.minutes(1),
        dimensionsMap: { QueueName: props.queueName },
      }),
      threshold: 25,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: 'Queue depth is above 25 for two minutes',
    });

    const failedFilter = new logs.MetricFilter(this, 'JobFailedFilter', {
      logGroup: props.workerLogGroup,
      filterPattern: logs.FilterPattern.literal('{ $.metric = "job" && $.outcome = "failed" }'),
      metricNamespace: 'OWM/Jobs',
      metricName: 'Failed',
      defaultValue: 0,
      filterName: `${name}-job-failed`,
    });
    const finishedFilter = new logs.MetricFilter(this, 'JobFinishedFilter', {
      logGroup: props.workerLogGroup,
      filterPattern: logs.FilterPattern.literal('{ $.metric = "job" && $.outcome = "finished" }'),
      metricNamespace: 'OWM/Jobs',
      metricName: 'Finished',
      defaultValue: 0,
      filterName: `${name}-job-finished`,
    });

    const failureRate = new cloudwatch.MathExpression({
      // Include failed Runs in the denominator: if every Run fails, finished is
      // zero and a failed/finished ratio would have no datapoint and stay silent.
      expression: '100 * failed / (failed + finished)',
      usingMetrics: {
        failed: failedFilter.metric({ statistic: 'Sum', period: Duration.minutes(15) }),
        finished: finishedFilter.metric({ statistic: 'Sum', period: Duration.minutes(15) }),
      },
      period: Duration.minutes(15),
      label: 'Failed Runs as a percentage of settled Runs',
    });

    alarm('JobFailureRateAlarm', {
      metric: failureRate,
      threshold: 20,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: 'More than 20% of settled Runs failed in the last 15 minutes',
    });

    // AWS Budgets covers infrastructure. Model spend is not an AWS charge; the
    // runtime cap in the app (MONTHLY_SPEND_CAP_USD) is the ceiling for that.
    new budgets.CfnBudget(this, 'MonthlyBudget', {
      budget: {
        budgetName: `${name}-monthly`,
        budgetType: 'COST',
        timeUnit: 'MONTHLY',
        budgetLimit: { amount: config.monthlyBudgetUsd, unit: 'USD' },
      },
      notificationsWithSubscribers: [
        {
          notification: {
            comparisonOperator: 'GREATER_THAN',
            notificationType: 'ACTUAL',
            threshold: 80,
            thresholdType: 'PERCENTAGE',
          },
          subscribers: [{ address: this.alarmTopic.topicArn, subscriptionType: 'SNS' }],
        },
        {
          notification: {
            comparisonOperator: 'GREATER_THAN',
            notificationType: 'FORECASTED',
            threshold: 100,
            thresholdType: 'PERCENTAGE',
          },
          subscribers: [{ address: this.alarmTopic.topicArn, subscriptionType: 'SNS' }],
        },
      ],
    });

    new CfnOutput(this, 'AlarmTopicArn', { value: this.alarmTopic.topicArn });
    new CfnOutput(this, 'AlarmOwner', { value: config.alarmEmail });
    new CfnOutput(this, 'MonthlyBudgetUsd', { value: String(config.monthlyBudgetUsd) });
    new CfnOutput(this, 'MonthlySpendCapUsd', { value: String(config.monthlySpendCapUsd) });
  }
}
