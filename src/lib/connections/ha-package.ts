/** The Home Assistant package that reports taps on the "done" button back to this app. The token comes from a secret. */
export function haActionPackage(appUrl: string): string {
  return `# packages/hauswart.yaml
rest_command:
  hauswart_action:
    url: "${appUrl}/api/v1/ha/action"
    method: post
    headers:
      authorization: !secret hauswart_bearer
      content-type: application/json
    payload: '{"action": "{{ action }}"}'

automation:
  - alias: hauswart done button
    triggers:
      - trigger: event
        event_type: mobile_app_notification_action
    conditions:
      - condition: template
        value_template: "{{ trigger.event.data.action.startswith('HW_DONE_') }}"
    actions:
      - action: rest_command.hauswart_action
        data:
          action: "{{ trigger.event.data.action }}"
`;
}
