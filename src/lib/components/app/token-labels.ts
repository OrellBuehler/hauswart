import type { TokenKind } from "$lib/api/enums";
import type { Scope } from "$lib/api/scopes";
import { m } from "$lib/paraglide/messages";

export function kindLabel(kind: TokenKind): string {
  switch (kind) {
    case "integration":
      return m.token_kind_integration();
    case "ha":
      return m.token_kind_ha();
    case "mcp":
      return m.token_kind_mcp();
    case "mobile":
      return m.token_kind_mobile();
  }
}

export function scopeLabel(scope: Scope): string {
  switch (scope) {
    case "read":
      return m.scope_read();
    case "write":
      return m.scope_write();
    case "docs:write":
      return m.scope_docs_write();
    case "costs:write":
      return m.scope_costs_write();
    case "ha:action":
      return m.scope_ha_action();
    case "admin":
      return m.scope_admin();
  }
}

export function scopeHint(scope: Scope): string {
  switch (scope) {
    case "read":
      return m.scope_read_hint();
    case "write":
      return m.scope_write_hint();
    case "docs:write":
      return m.scope_docs_write_hint();
    case "costs:write":
      return m.scope_costs_write_hint();
    case "ha:action":
      return m.scope_ha_action_hint();
    case "admin":
      return m.scope_admin_hint();
  }
}
