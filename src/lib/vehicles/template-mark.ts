/** The `externalSource` of every task a vehicle template creates. */
export const VEHICLE_TEMPLATE_SOURCE = "vehicle_template";

/** The templates a vehicle can set its tasks up from (`templates.ts`); a mark names one of them. */
export const VEHICLE_TEMPLATE_IDS = [
  "tires_winter",
  "tires_summer",
  "service",
  "mfk",
  "vignette",
  "vehicle_tax",
  "brake_fluid",
  "ac_service",
] as const;
export type VehicleTemplateId = (typeof VEHICLE_TEMPLATE_IDS)[number];

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

function isTemplateId(id: string): id is VehicleTemplateId {
  return (VEHICLE_TEMPLATE_IDS as readonly string[]).includes(id);
}

/**
 * The template a task was made from, or null for a task that carries no (readable) mark, or one that
 * names a template this version does not know (the caller then judges the task as one without a mark).
 */
export function templateOfMark(task: {
  externalSource?: string | null | undefined;
  externalRef?: string | null | undefined;
}): VehicleTemplateId | null {
  if (task.externalSource !== VEHICLE_TEMPLATE_SOURCE || !task.externalRef) {
    return null;
  }
  const id = MARK.exec(task.externalRef)?.[1];
  return id !== undefined && isTemplateId(id) ? id : null;
}
