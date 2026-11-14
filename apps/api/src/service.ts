export const SERVICE_NAME = "gym-api";

export function describeService(name: string = SERVICE_NAME): string {
  return `service:${name}`;
}
