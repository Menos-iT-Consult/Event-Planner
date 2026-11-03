const privatePassLink = /(https?:\/\/[^\s/]+\/(?:rsvp|pass|passes)\/)[A-Za-z0-9_-]+/gi;

export function redactPrivateLinks(message: string): string {
  return message.replace(privatePassLink, "$1[REDACTED]");
}

