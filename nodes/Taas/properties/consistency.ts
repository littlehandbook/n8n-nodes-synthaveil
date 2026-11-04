import type { INodeProperties } from 'n8n-workflow';

/**
 * `Consistency` (plan P5 Task 5.2, rm-24) — whether a real value keeps its
 * fake replacement across separate workflow runs, or gets a fresh one every
 * time.
 *
 * `stable` is byte-identical to today's scope behaviour: the same real value
 * always gets the same fake value inside a scope, run after run. `everyRun`
 * folds `this.getExecutionId()` into the request as `run_id` (P5 Task 5.1's
 * server-side fold) so the API re-keys per execution while still holding one
 * consistent fake value within a single run.
 *
 * Lives in its own module for the same reason `properties/returnMode.ts`
 * does — `Taas.node.ts` is at the 300-line ceiling (council condition PC-1).
 */
export const consistencyProperty: INodeProperties = {
  displayName: 'Consistency',
  name: 'consistency',
  type: 'options',
  default: 'stable',
  options: [
    {
      name: 'Stable (Recommended)',
      value: 'stable',
      description: 'The same real value always gets the same fake value inside a scope',
    },
    {
      name: 'Every Run',
      value: 'everyRun',
      description:
        'Not recommended for most workflows. A person keeps one fake name inside a single run, ' +
        'but gets a different fake name the next time the workflow runs. Example: Helen appears ' +
        "four times in a document — every run she is one consistent \"Mary\", but tomorrow's run " +
        'turns her into "Sarah". You cannot match, count or de-duplicate people across runs, and an ' +
        'AI step cannot remember that Helen is Mary from one run to the next. Choose Stable when you ' +
        'need memory across runs.',
    },
  ],
  displayOptions: { show: { resource: ['token'] } },
};
