/** The `externalSource` of every task a vehicle template creates. */
export const VEHICLE_TEMPLATE_SOURCE = "vehicle_template";

export type TemplateMark = {
  externalSource: typeof VEHICLE_TEMPLATE_SOURCE;
  externalRef: string;
};

/**
 * What marks a task as the work of a template: `<asset id>:<template id>`. The server keeps the pair
 * (`externalSource`, `externalRef`) unique, and a vehicle gets the same template again once the first
 * task is done, archived or finished (the next inspection), so the n-th task of a template on a vehicle
 * is `<asset id>:<template id>:<n>`.
 */
export function templateMark(assetId: string, id: string, n = 1): TemplateMark {
  return {
    externalSource: VEHICLE_TEMPLATE_SOURCE,
    externalRef: n <= 1 ? `${assetId}:${id}` : `${assetId}:${id}:${n}`,
  };
}

const MARK = /^[^:]+:([a-z_]+)(?::\d+)?$/;

/** The template a task was made from, or null for a task that carries no (readable) mark. */
export function templateOfMark(task: {
  externalSource?: string | null | undefined;
  externalRef?: string | null | undefined;
}): string | null {
  if (task.externalSource !== VEHICLE_TEMPLATE_SOURCE || !task.externalRef) {
    return null;
  }
  return MARK.exec(task.externalRef)?.[1] ?? null;
}
