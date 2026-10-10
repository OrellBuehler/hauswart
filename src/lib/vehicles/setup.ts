import {
  USER_LOCALES,
  type OdometerUnit,
  type UserLocale,
} from "$lib/api/enums";
import type { Task } from "$lib/api/schemas/tasks";
import { isValidDate } from "$lib/dates";
import { m } from "$lib/paraglide/messages";
import { odometerSignalKey } from "./odometer";
import {
  DEFAULT_SERVICE_DISTANCE,
  DEFAULT_SERVICE_MONTHS,
  VEHICLE_TEMPLATE_IDS,
  acService,
  brakeFluid,
  mfk,
  service,
  suggestMfkDate,
  tiresSummer,
  tiresWinter,
  vehicleTax,
  vignette,
  type VehiclePreparationBody,
  type VehicleTaskBody,
  type VehicleTaskTemplate,
  type VehicleTemplateContext,
  type VehicleTemplateId,
} from "./templates";

/**
 * The dialog that sets up a vehicle's recurring tasks from `templates.ts`: what the person types
 * (`SetupParams`, as text), the template that comes out of it, which templates the vehicle has a
 * task for already, and the run that sends the chosen ones to the API.
 */

/** What is checked when the dialog opens: the tasks nearly every vehicle has. */
export const DEFAULT_SELECTED: readonly VehicleTemplateId[] = [
  "tires_winter",
  "tires_summer",
  "service",
  "mfk",
];

export const SETUP_TEMPLATE_IDS = VEHICLE_TEMPLATE_IDS;

export type SetupContext = {
  assetId: string;
  firstRegistration: string | null;
  /** `YYYY-MM-DD` in the household time zone. */
  today: string;
  odometerUnit: OdometerUnit;
};

/** The parameters of the templates that have any, as typed. */
export type SetupParams = {
  serviceDistance: string;
  serviceMonths: string;
  mfkDate: string;
  taxMonth: string;
  taxDay: string;
  brakeFluidLastDone: string;
  acServiceLastDone: string;
};

export function defaultParams(ctx: SetupContext): SetupParams {
  return {
    serviceDistance: String(DEFAULT_SERVICE_DISTANCE[ctx.odometerUnit]),
    serviceMonths: String(DEFAULT_SERVICE_MONTHS),
    mfkDate: suggestMfkDate(ctx.firstRegistration, ctx.today) ?? "",
    taxMonth: "3",
    taxDay: "31",
    brakeFluidLastDone: "",
    acServiceLastDone: "",
  };
}

const MAX_DISTANCE = 10_000_000;
const MAX_MONTHS = 1200;

function parseNumber(text: string, max: number, whole: boolean): number | null {
  const cleaned = text
    .trim()
    .replace(/[\s'’]/g, "")
    .replace(",", ".");
  if (!/^\d+(?:\.\d+)?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  if (!(value > 0) || value > max) return null;
  return whole && !Number.isInteger(value) ? null : value;
}

export type BuiltTemplate = {
  template: VehicleTaskTemplate | undefined;
  /** Problems with the parameters, keyed like `SetupParams`. */
  errors: Record<string, string>;
};

/** The template for `id` with the person's parameters, or what is wrong with them. */
export function buildTemplate(
  id: VehicleTemplateId,
  ctx: SetupContext,
  params: SetupParams,
): BuiltTemplate {
  const context: VehicleTemplateContext = {
    assetId: ctx.assetId,
    firstRegistration: ctx.firstRegistration,
    today: ctx.today,
    odometerUnit: ctx.odometerUnit,
  };
  const errors: Record<string, string> = {};
  const done = (template: VehicleTaskTemplate): BuiltTemplate => ({
    template,
    errors,
  });
  const failed = (): BuiltTemplate => ({ template: undefined, errors });

  switch (id) {
    case "tires_winter":
      return done(tiresWinter(context));
    case "tires_summer":
      return done(tiresSummer(context));
    case "vignette":
      return done(vignette(context));
    case "service": {
      const distance = parseNumber(params.serviceDistance, MAX_DISTANCE, false);
      const months = parseNumber(params.serviceMonths, MAX_MONTHS, true);
      if (distance === null)
        errors.serviceDistance = m.vehicle_setup_error_number();
      if (months === null)
        errors.serviceMonths = m.vehicle_setup_error_number();
      if (distance === null || months === null) return failed();
      return done(service(context, { distance, months }));
    }
    case "mfk": {
      if (!isValidDate(params.mfkDate)) {
        errors.mfkDate = m.vehicle_setup_error_date();
        return failed();
      }
      return done(mfk(context, { date: params.mfkDate }));
    }
    case "vehicle_tax": {
      const month = parseNumber(params.taxMonth, 12, true);
      const day = parseNumber(params.taxDay, 31, true);
      if (month === null) errors.taxMonth = m.vehicle_setup_error_number();
      if (day === null) errors.taxDay = m.vehicle_setup_error_day();
      if (month === null || day === null) return failed();
      return done(vehicleTax(context, { month, day }));
    }
    case "brake_fluid":
    case "ac_service": {
      const field =
        id === "brake_fluid" ? "brakeFluidLastDone" : "acServiceLastDone";
      const lastDone = params[field].trim();
      if (lastDone !== "" && (!isValidDate(lastDone) || lastDone > ctx.today)) {
        errors[field] = m.vehicle_setup_error_date();
        return failed();
      }
      const options = lastDone === "" ? {} : { lastDone };
      return done(
        id === "brake_fluid"
          ? brakeFluid(context, options)
          : acService(context, options),
      );
    }
  }
}

const TITLES: Record<VehicleTemplateId, (locale: UserLocale) => string> = {
  tires_winter: (locale) => m.vehicle_task_tires_winter_title({}, { locale }),
  tires_summer: (locale) => m.vehicle_task_tires_summer_title({}, { locale }),
  service: (locale) => m.vehicle_task_service_title({}, { locale }),
  mfk: (locale) => m.vehicle_task_mfk_title({}, { locale }),
  vignette: (locale) => m.vehicle_task_vignette_title({}, { locale }),
  vehicle_tax: (locale) => m.vehicle_task_tax_title({}, { locale }),
  brake_fluid: (locale) => m.vehicle_task_brake_fluid_title({}, { locale }),
  ac_service: (locale) => m.vehicle_task_ac_service_title({}, { locale }),
};

/** The title a template gives its task, in every language of the app (a task made in the other language counts). */
export function templateTitles(id: VehicleTemplateId): string[] {
  return USER_LOCALES.map((locale) => TITLES[id](locale));
}

type TaskLike = Pick<
  Task,
  "id" | "title" | "category" | "assetId" | "trigger" | "state" | "archivedAt"
>;

/** A one-off task that was completed or skipped is over: the next one has to be made new. */
function isFinishedOneOff(task: TaskLike): boolean {
  return (
    task.trigger.type === "one_off" &&
    task.state !== null &&
    task.state.dueDate === null &&
    task.state.reasons.some(
      (reason) => reason === "completed" || reason === "skipped",
    )
  );
}

function sameTitle(a: string, b: string): boolean {
  return a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();
}

function followsTemplate(
  id: VehicleTemplateId,
  task: TaskLike,
  assetId: string,
): boolean {
  if (templateTitles(id).some((title) => sameTitle(title, task.title))) {
    return true;
  }
  // Whatever it is called: counting this vehicle's odometer is the service, an inspection on a date is the MFK.
  if (id === "service") {
    return (
      task.trigger.type === "counter_delta" &&
      task.trigger.entityId === odometerSignalKey(assetId)
    );
  }
  if (id === "mfk") {
    return task.trigger.type === "one_off" && task.category === "inspection";
  }
  return false;
}

/**
 * The task of this vehicle that already does what the template would (a title like the template's, in
 * either language, or the same kind of trigger for service and inspection), so it is not offered
 * twice. Archived tasks and finished one-off tasks do not count. The templates leave no mark on the
 * tasks they make (a mark would have to be unique per task, and the next inspection is a new task
 * of the same kind), so this is a likeness, not a certainty.
 */
export function findExistingTask<T extends TaskLike>(
  id: VehicleTemplateId,
  tasks: readonly T[],
  assetId: string,
): T | undefined {
  return tasks.find(
    (task) =>
      task.assetId === assetId &&
      task.archivedAt === null &&
      !isFinishedOneOff(task) &&
      followsTemplate(id, task, assetId),
  );
}

export type TemplateRun = {
  id: VehicleTemplateId;
  state: "running" | "created" | "failed";
  taskId?: string;
  /** Why the task could not be created. */
  error?: string;
  /** Preparations that could not be created; the task exists. */
  preparationErrors: { title: string; error: string }[];
};

export type TemplateClient = {
  createTask: (body: VehicleTaskBody) => Promise<{ id: string }>;
  createPreparation: (
    taskId: string,
    body: VehiclePreparationBody,
  ) => Promise<unknown>;
};

/**
 * Creates the tasks one after the other, then each one's preparations. A task that fails does not
 * stop the others and gets no preparations; a preparation that fails leaves its task in place and is
 * reported. `report` hears about every step, so the dialog can show the progress per template.
 */
export async function createTemplates(
  templates: readonly VehicleTaskTemplate[],
  client: TemplateClient,
  report: (run: TemplateRun) => void,
  messageOf: (err: unknown) => string,
): Promise<TemplateRun[]> {
  const runs: TemplateRun[] = [];
  for (const template of templates) {
    const run: TemplateRun = {
      id: template.id,
      state: "running",
      preparationErrors: [],
    };
    report({ ...run });
    try {
      const task = await client.createTask(template.task);
      run.taskId = task.id;
      for (const [index, preparation] of template.preparations.entries()) {
        try {
          await client.createPreparation(task.id, {
            sortOrder: index,
            ...preparation,
          });
        } catch (err) {
          run.preparationErrors.push({
            title: preparation.title,
            error: messageOf(err),
          });
        }
      }
      run.state = "created";
    } catch (err) {
      run.state = "failed";
      run.error = messageOf(err);
    }
    report({ ...run, preparationErrors: [...run.preparationErrors] });
    runs.push(run);
  }
  return runs;
}
