import type { Request } from "express";
import { z } from "zod";

export function getRouteParam(request: Request, name: string): string {
  return z.string().min(1).parse(request.params[name]);
}
