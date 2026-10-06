import type { endpoints } from "$lib/api/registry";
import { getEmergency } from "$lib/server/emergency/emergency";
import { exportEmergencyPdf } from "$lib/server/emergency/pdf";
import type { Handler } from "../bind";
import { wireEmergency } from "../wire-share";

export const get: Handler<typeof endpoints.emergencyGet> = ({ ctx }) =>
  wireEmergency(getEmergency(ctx));

export const exportPdf: Handler<typeof endpoints.emergencyExport> = async ({
  ctx,
  query,
}) => {
  const includeSecrets = query.includeSecrets ?? false;
  const bytes = await exportEmergencyPdf(ctx, {
    locale: ctx.user.locale,
    includeSecrets,
  });
  return new Response(bytes, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="emergency-${ctx.today}.pdf"`,
      "cache-control": "no-store",
    },
  });
};
