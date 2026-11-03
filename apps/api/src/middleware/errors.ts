import type { ErrorRequestHandler, RequestHandler } from "express";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";

export const notFound: RequestHandler = (_request, response) => {
  response.status(404).json({ error: "Not found" });
};

export const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  if (
    typeof error === "object" &&
    error !== null &&
    "type" in error &&
    error.type === "entity.parse.failed"
  ) {
    response.status(400).json({ error: "Request body contains invalid JSON" });
    return;
  }

  if (error instanceof ZodError) {
    response.status(400).json({
      error: "Invalid request",
      details: error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
    return;
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      response.status(409).json({ error: "A record with these details already exists" });
      return;
    }
    if (error.code === "P2025") {
      response.status(404).json({ error: "Record not found" });
      return;
    }
    if (error.code === "P2003") {
      response.status(400).json({ error: "The request references a record that does not exist" });
      return;
    }
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "type" in error &&
    error.type === "entity.too.large"
  ) {
    response.status(413).json({ error: "Request body is too large" });
    return;
  }

  console.error("Unhandled API error", error);
  response.status(500).json({ error: "Internal server error" });
};
