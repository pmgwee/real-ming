const ceoActorPrefix = "ceo:";

export function isCeoActor(actorId: string): boolean {
  return actorId.startsWith(ceoActorPrefix);
}
